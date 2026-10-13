# Lane F findings — Database, Drizzle, migrations & persistence (R142, Task 142-F1)

HEAD `a9f5e83`, read-only audit. Scope: `backend/src/migrate.ts` (4,368L, ALL), all 39 `shared/db/src/schema/*.ts` + `index.ts` + package/config/guard files, the **24** drizzle SQL migrations (0000–0023) + `_journal.json`, structural validation of all **24** `meta/*_snapshot.json`, plus cross-cuts (`boot-migrations.ts`, `test/db.ts`, `schema-parity.test.ts`, drift gate, category/search predicates). Zero DB writes; zero repo code edits.

**Charter-count correction:** the inventory and disk both hold **24** migrations (0000–0023), not 25; and **24 snapshots == 24 migrations** (drizzle-kit v7 emits one snapshot per migration — the latest, 0023, IS the current-schema snapshot; the charter's "migrations + 1" expectation does not apply to this drizzle version). Journal: 24 entries, idx 0–23 linear, `when` strictly monotonic, tags byte-match the SQL filenames, snapshot numbering == journal idx — **no gaps, no reordering**.

## Architecture verdict (duty 4 — migrate.ts deep-audit)

The live Neon DB is built **only** by `backend/src/migrate.ts` — an imperative, idempotent boot reconciler (V1-M1…M34 stages + body blocks). The drizzle chain is **declarative-only documentation** (nothing executes it at runtime; CI regenerates + diffs it — `ci.yml:367-378`). `db:push` is fenced by `shared/db/scripts/guard-drizzle-push.mjs` (exit 1 unless `I_ACCEPT_DRIZZLE_PUSH_DANGER=true`) because the live DB carries **boot names** (`fk_orders_user`) that diverge from chain names (`orders_user_id_users_id_fk`) — a push would DROP+re-ADD every FK/unique constraint. Tripwire confirmed from the schema side (lane A verified CI side).

**Applied-state tracking:** no per-migration ledger. A build-time composite fingerprint `v2:<codeHash>:<schemaHash>` (code = migrate.ts, schema = schema TS + emitted chain) is persisted into `system_settings.migrations.fingerprint` **only after a fully-converged run** — any constraint-skip path (probe → alert) leaves the marker untouched so the next boot re-reconciles (r110). Steady-state boots take the fast-path (one SELECT, ~141 no-op round trips skipped). `MIGRATIONS_FORCE_RECONCILE` = true/1/yes bypasses.

**Partial failure mid-boot:** every statement is single-purpose and guarded (`IF NOT EXISTS` / `IF EXISTS` / catalog probe → skip, `DO $$ … duplicate_object` swallow), each `db.execute` is auto-commit, so a mid-run crash leaves a partially-applied but re-convergable state. `boot-migrations.ts` (a) gates on writability (poll `pg_is_in_recovery()` + `transaction_read_only`, 120 s budget) **before any DDL** — the exact B7-P0-1 class that killed deploy dep-daf0rt8n74is73fra; (b) classifies failures: transient (25006 read-only, 0800x/57P0x connection, ECONNRESET…) → **re-run the whole `runMigrations()` from the top** (5s/15s/45s backoff, lock TTL refreshed); idempotent (42P07/42701/42710) → log+continue; critical → **re-throw, production refuses to boot** (never serve on a truncated schema). Constraint-violation probes (orphan counts, duplicate refs, arithmetic violations) alert the admin (deduped 24 h) instead of running a failing ALTER — "reboot to apply" semantics, blocked from silently no-op'ing.

**Expand-first discipline (duty 1):** verified migration-by-migration. No destructive renames anywhere; the only column drops are documented pre-launch cleanups (`users.password_hash` + legacy provider columns — Stage C; dead `organization_id` — V1-M30, provably NULL-only/0-row) and dead-table drops (`otps`, `organizations`). Backfills present and idempotent: `products.slug` (+collision suffixing), legacy-provider → `user_auth_identities` (per-provider try/catch, catalog-probed), `points_ledger` opening balances (`WHERE loyalty_points <> 0` — the R115-R1 P0 guard), `orders.refund_*` from `wallet_ledger` evidence, `users.welcome_bonus_granted`, AES-GCM re-encryption of legacy plaintext credentials (row-by-row, format-guarded, 512-char refusal), one-time `["all"]` admin permissions grant. Each migration's DDL matches its snapshot delta — verified by direct snapshot-pair diffs for 0011→0012, 0012→0013 (idempotency FK drop), 0015→0016 (unique flip), 0016→0017 (notifications swap), 0017→0018 (RESTRICT), 0018→0019 (organizations removal + 16 index drops), 0021→0022 (type-index drop), 0022→0023 (keyset tails + coupons partial). Chain↔boot↔schema-TS three-way parity holds at HEAD for every money object (the drift gate regenerates from schema.ts and is green at a9f5e83 per lanes A/N).

**Schema truth (duty 2):** all 41 tables audited. PKs: serial (34) / varchar/text (sessions, admin_sessions, system_settings, openwa_sessions, copilot_previews, idempotency_keys, account_link_consents) / singleton-integer (risk_config, scheduler_leader_lease with `CHECK (id = 1)`). **Every timestamp column is `TIMESTAMPTZ`** (verified across snapshot 0023 — the auth_activity plain-`timestamp` wart was fixed in chain 0011 + R98-DB-04). **Money: uniform `numeric(10,2)`** on all 24 LYD/points-adjacent columns (max 99,999,999.99 — ample; 2-dp is the platform-wide display/settlement convention, `formatCurrency` and the 100:1 points rate are exact at 2 dp; LYD's theoretical 3-dp dirham is never used by the catalog or the wallet). Nullable money columns are correct-by-design: `orders.refund_amount` (NULL = never refunded, guarded by `chk_orders_refund_amount_range`) and `points_ledger.lyd_credited` (conversion_out only, rate pinned in-row). **12 enums match migrate.ts's `pg_type` guard block and the schema TS byte-for-byte** (order_status, topup_status, ticket_status, coupon_type, audit_actor_type, ledger_entry_type, risk_event_type ×12, risk_level, risk_action_taken, risk_label_kind, provider_fulfillment_status, points_ledger_type); lane N verified zero drift vs the OpenAPI side.

**FK graph / ON DELETE (duty 3):** 39 FKs total. **Money-history RESTRICT confirmed everywhere** (lane G): `orders`, `wallet_ledger`, `wallet_topups`, `points_ledger` (user FKs) + `referral_events` referrer/referee — a manual `DELETE FROM users` can never erase financial history; `orders.product_id` also RESTRICT (historical pricing anchor). CASCADE only on ephemeral/derived rows (cart, sessions, notifications, tickets+replies, copilot_action_items, provider_fulfillments→orders, inventory→products, variants→products, forecasts, drafts). SET NULL only where an immutable copy or documented contract survives (orders.variant_id + variant_label, orders.inventory_id + delivered_*, inventory.variant_id with the AUD103-1-F6 demotion warning). Dangling-by-design (no FK, documented): `audit_logs.actor_id/target_id`, `wallet_ledger.reference_id` + `reference_type` (polymorphic), `points_ledger.reference_id`/`actor_admin_id`, `orders.refunded_by_admin_id`, `idempotency_keys.order_id` (V1-M20 dropped it — app-owned polymorphism). **No NULL can leak into a non-null frontend money type**: nullable API-surfaced columns are `wallet_topups.reviewed_at` (`?? null`, spec-nullable) and the write-only refund columns (never serialized — grep-verified zero API references); lane N's contract suites pin the rest.

**Constraint coverage:** 24 CHECK constraints across 17 tables (see table below) — every money arithmetic/positivity/non-negativity invariant is DB-level, probe-gated at boot, and behaviorally pinned by `schema-parity.test.ts` + 19 stage suites. Unique guards: payment_reference partial unique (dup-transfer guard), points exactly-once partial unique, provider-order unique, variant NULLS NOT DISTINCT unique (boot-owned — drizzle cannot express it), flash-sale active singleton, login-attempt identifier, cart (user, product).

---

## Findings

### F-1 (P3) — `runMigrations()` body is never executed by any test; boot-critical DDL only ever runs against live Neon
- **What this is:** `backend/src/migrate.ts:2448-4368` — the body of the boot reconciler: the multi-statement `CREATE TABLE IF NOT EXISTS` batches for ~20 tables (users, orders, wallet_ledger/topups, products/variants, copilot×3, forecast×2, enrichment×2, risk×4, sessions…), the products-index block, the fkStatements loop, the encryption backfills, the seeds. Only the 25 **exported stages** (V1-M9…M34, each with an injectable executor) and the fingerprint plumbing are tested.
- **Problem:** the repo's own test documents why: `migrations-fast-path.test.ts:25-26` — "The full 141-statement chain cannot run under the pglite harness (multi-statement batches — the historical reason every other migrate test pins individual STAGES)." pglite's prepared-statement path rejects multi-statement `db.execute` (42601), and the body contains ~50 such batches (e.g. `migrate.ts:3767-3842` is one 75-line batch creating three copilot tables + ten indexes). A syntax error, a wrong column name, or an ordering regression in the body surfaces **only at production boot** — the one place where "critical" classification means a 503 crash-loop until manual intervention.
- **Concrete case:** rename a column in the `copilot_previews` CREATE batch and run the full backend suite: every test stays green (stages + harness DDL unaffected), CI stays green (chain regenerates from schema.ts), and the first production boot fails with `42703` → critical → refused start.
- **Fix (minimal):** one integration test that reads `migrate.ts`'s body statements the way `migrate-drizzle-0016.test.ts:86-99` already parses chain files — or simpler: route a test-only `SqlExecutor` through pglite's `client.exec` (multi-statement capable — `execTestSql` in `test/db.ts:548-550` already proves it) and run `runMigrations()` end-to-end against a fresh pglite, asserting the final table count.
- **If we skip it:** the next body edit is verified only by a production deploy.

### F-2 (P3) — Three hand-maintained DDL copies; the pglite harness has already drifted from production in 6 spots, and no test applies the 24-migration chain sequentially
- **What this is:** the schema exists as three hand-kept copies: `migrate.ts` (truth), the drizzle chain (declarative mirror, drift-gated in CI), and `backend/src/test/db.ts` (test harness DDL — mirrored by hand, no gate at all).
- **Problem 1 — harness drift, concrete cases (test/db.ts vs production):**
  - `test/db.ts:273` — `wallet_ledger.reference_type varchar(32)` while prod is `varchar(50)` (`migrate.ts:3003`, `schema/wallet_ledger.ts:41`, chain 0000:409). The comment even claims "align with schema/migrate varchar(32)" — the opposite of the truth.
  - `test/db.ts:175` — `orders.discount_amount numeric(10,2) DEFAULT '0.00'` missing `NOT NULL` (prod: NOT NULL — `migrate.ts:3100-3104`, R97-DB-03). The harness is LOOSER than prod — the exact "certifies prod-forbidden behavior" class the A10 header (db.ts:38-44) warns about.
  - `test/db.ts:379-386` — `sessions.user_id` has no FK (prod: `REFERENCES users(id) ON DELETE CASCADE`, migrate.ts:3091).
  - `test/db.ts:357` — `system_settings.key varchar(100)` (prod: 255).
  - `test/db.ts:79` — `users.referred_by REFERENCES users(id)` with no ON DELETE (prod: SET NULL) — a delete behaves differently in tests.
  - `test/db.ts:362-377` — `cart_items` missing `fk_cart_items_product` (prod ships it, migrate.ts:2867).
  None currently falsifies a money invariant (those are pinned by `schema-parity.test.ts`), but each is silent testimony that the third copy rots exactly like the first two did before A10/R118-B3.
- **Problem 2 — chain applyability:** the hand-hardened files 0013–0022 are executed individually against the pglite runtime shape by their stage tests (migrate-v1m24/25/31/32/33 + migrate-drizzle-0013/0016), but **nothing applies 0000→0023 sequentially on an empty database** — the "chain-safe-apply promise" the 0009/0013/0016/0017/0018 headers state. That exact class produced the historical 0009 bug (bare `CREATE INDEX idx_users_phone_trgm` re-creating the 0005 object → 42P07 on a chain-built DB), fixed by hand. A future generated file can reintroduce it silently.
- **Fix (minimal):** (a) correct the six harness lines (one edit each; the money tables are already right); (b) add one test that loops the journal, parses each SQL file with the existing `parseStatements` helper (`migrate-drizzle-0016.test.ts:86-92`), and executes all 24 files against a **fresh** pglite — the machinery already exists in the repo.
- **If we skip it:** harness rot continues one round at a time; the chain's "safe the day it IS applied" stays a comment, not a guarantee.

### F-3 (P4) — `migrate.ts:3281` still creates `idx_users_referral_code`; the r103 cleanup dropped it from the chain, the schema, and added a boot drop-stage — but missed removing the boot creator
- **What this is:** `migrate.ts:3281` — `CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL` runs unconditionally in the body's missing-indexes block of **every full reconcile**; ~950 lines later, V1-M15 step 5 (`migrate.ts:826-839`, the r103 AUD103-1-F4 block) probes for that exact name and **DROPs it**.
- **Problem:** create-then-drop churn on `users` per full reconcile (2 catalog DDLs + 2 probes), and fresh databases get the index and lose it in the same boot. The V1-M27 comment (`migrate.ts:1746-1759`) states the house rule — "the superseded CREATE INDEX statements that lived in the runMigrations BODY blocks were REMOVED in the same edit" — and lists four deliberately-frozen stage creators (V1-M9/M12/M16/M21), but this fifth body creator was neither removed nor listed. The chain (0012:15), the snapshot (0012+), and `schema/users.ts` all agree the object must not exist. Compare its sibling `idx_users_firebase_uid`, whose creator WAS removed (comment at migrate.ts:3112-3119).
- **Concrete case:** `MIGRATIONS_FORCE_RECONCILE=1` boot: line 3281 creates the partial index, line 826's probe finds it, line 834 drops it. Net schema: correct. Cost: two needless AccessExclusiveLock-class statements on `users` per forced reconcile, plus a transient index fresh installs never keep.
- **Fix:** delete `migrate.ts:3281` (one line) and add the name to the V1-M27 frozen-creator note for the record.
- **If we skip it:** harmless today (fast-path skips steady-state boots), but every full reconcile pays the churn and the doc invariant ("fresh databases never get the redundant twin") is false for this one object.

### F-4 (P4) — Storefront category filter `LOWER(category) = LOWER($slug)` is served by no index (lane I confirmation, schema-side evidence)
- **What this is:** `catalog.service.ts:357` (the `?category=` listing filter) and `:398` (the R132 Arabic category-alias branches) compare `LOWER(products.category)`; the only indexes on the column are raw-column btrees (`idx_products_category`, `idx_products_active_category` — snapshot 0023). Postgres cannot serve a `LOWER(col)` predicate from a plain btree on `col` → seq scan.
- **Problem:** the same service's OTHER category comparison idiom is raw equality — the search route ORs `category = <slug>` (documented at `arabic-search.ts:301`), which IS index-served. Two idioms for the same semantic comparison, one of them indexless. At the live catalog size (~45 rows, list capped ≤500) a seq scan is a non-event — this is debt on the catalog-growth path, not a live slowdown.
- **Fix (minimal, either):** lowercase the parameter app-side and compare raw (`category = ${slug.toLowerCase()}` — categories are lowercase slugs by construction, per `seo.ts:266` and the seed data), or add the one expression index `CREATE INDEX IF NOT EXISTS idx_products_category_lower ON products (LOWER(category))` as a V1-M35 additive twin + schema mirror.
- **If we skip it:** category pages seq-scan forever; fine at 45 products, visible at ~10⁴.

### F-5 (P4) — Admin search predicates defeat the trgm/GIN indexes built for them
- **What this is:** `routes/admin/orders.ts:218-222` — `LOWER(COALESCE(users.phone,'')) LIKE '%x%'` (also email/display_name/product name) cannot use `idx_users_phone_trgm` (a gin trgm index on the **raw** phone column serves `phone ILIKE '%x%'`, not a `LOWER(COALESCE(...))` expression). `routes/admin/products.ts:128` — `LOWER(category) LIKE '%x%'`, same class (F-4).
- **Problem:** the repo paid for two trgm indexes (products.name, users.phone — migrate.ts:3851, 4115) precisely to serve leading-wildcard search; the admin orders search's LOWER(COALESCE) spelling sidesteps the users.phone one. Same scale caveat as F-4 (~10²–10³ rows today).
- **Fix:** use `ILIKE` directly on the columns (drop the LOWER/COALESCE spelling — `phone ILIKE ${like}` is served by the trgm index and is the repo's own idiom in catalog.service), or accept seq scans until rowcounts grow.
- **If we skip it:** admin order search stays a seq scan; invisible at current size.

### F-6 (P4) — Vocab CHECK coverage gaps: the V1-M29 domain sweep stopped short of the copilot/notification/ticket vocabularies
- **What this is:** snapshot-0023 survey of varchar "poor-man enums" without a CHECK: `copilot_actions.outcome` (9 documented values), `copilot_actions.action_class` / `copilot_previews.action_class` (~12 values), `risk_tier` (3 values), `copilot_action_items.outcome` (3), `notifications.type`, `ticket_replies.author_type`, `wallet_topups.payment_method`, `users.loyalty_tier`, `users.auth_provider`, `idempotency_keys.reference_type`.
- **Problem:** V1-M29 closed 8 domain CHECKs (quantity, price×2, referral status, run outcomes×2, risk score/confidence) with the exact rationale "the zod perimeter already enforces X; the CHECK closes the bypass writers." The copilot outcome/action_class/risk_tier triple is the same shape (closed vocabularies, indexed, filtered by admin dashboards) with no DB-level closure — a bypass writer (cron, SQL console) can write `"outcome": "succes"` and it flows into every filter/metric unchallenged.
- **Fix:** a V1-M35 stage re-using the V1-M29 `checkConstraints` loop verbatim (probe-gated count-then-add) for the three copilot columns; schema TS mirrors in the same edit. Others can stay app-owned (documented low-stakes).
- **If we skip it:** garbage vocab values are display-level noise, not money — dormant.

### F-7 (P4) — Four `information_schema` probes omit `table_schema`, diverging from the house idiom
- **What this is:** `migrate.ts:514-519` and `572-578` (users column probes), `2298-2303` (idempotency_keys body_hash probe), `3590-3604` (onboarding columns DO block) query `information_schema.columns WHERE table_name = '…'` with no `table_schema` filter. The sibling probes use `table_schema = current_schema()` or `= 'public'` (V1-M14/M30/M32, legacy-provider migration at 3629-3634).
- **Problem:** if any other schema in `search_path` ever held a same-named table, `present` sets would be polluted (false "column exists" → skipped ADD). Single-schema Neon makes this dormant; it is a consistency defect against the codebase's own probe idiom.
- **Fix:** add `AND table_schema = current_schema()` to the four probes (one line each).
- **If we skip it:** zero effect on current deployments.

---

## Migration timeline (journal order, all verified expand-first / hand-hardened apply-safe)

| # | Tag | Date | Content (vs snapshot N-1 → N) | Expand-first verdict |
|---|-----|------|-------------------------------|----------------------|
| 0000 | nifty_green_goblin | 2026-08-25 | Baseline: 10 enums + 30 tables + FKs/indexes (incl. legacy shapes later cleaned: organizations, idx_users_firebase_uid, (user_id,is_read) notifications, CASCADE money FKs) | Baseline; pure CREATE |
| 0001 | smooth_wendell_rand | 2026-08-25 | `idx_products_slug_unique` | Additive |
| 0002 | strong_freak | 2026-09-06 | `cart_items` + uniq(user, product) | Additive |
| 0003 | secret_invisible_woman | 2026-09-06 | system_settings + openwa_sessions tables; audit_logs indexes; flash-sale singleton; login_attempts unique; pg_trgm + products trgm | Additive |
| 0004 | lively_virginia_dare | 2026-09-06 | `orders.delivered_password` → varchar(512) (in-place widen, no data loss — ciphertext re-encryption is the boot twin V1-M6/M7) | Safe widen |
| 0005 | yellow_peter_parker | 2026-09-06 | 4 serving composites + users trgm | Additive |
| 0006 | high_the_enforcers | 2026-09-07 | admin_alerts.dedupe_key + index | Additive |
| 0007 | tranquil_dagger | 2026-09-08 | admin_sessions + idempotency_keys (V1-M13/M12 mirrors) | Additive |
| 0008 | polite_felicia_hardy | 2026-09-11 | account_link_consents + scheduler_leader_lease (V1-M14); drops dup idx_users_firebase_uid; orders.discount_amount SET NOT NULL (0-default, safe); hardens 0005's trgm re-create with IF NOT EXISTS (documented historical 42P07 fix); payment_reference partial unique | Additive + guarded drops |
| 0009 | chubby_mulholland_black | 2026-09-19 | product_variants + variant wiring on cart/inventory/orders + SEO columns (V1-M16) | Additive |
| 0010 | lucky_moon_knight | 2026-09-19 | products.features jsonb | Additive |
| 0011 | dashing_lila_cheney | 2026-09-20 | auth_activity → timestamptz; cart user FK; variant/at-risk/partial indexes; enrichment+forecast CHECKs (R98-DB-03); DESC NULLS LAST index wave | Type-strengthen + additive |
| 0012 | clever_otto_octavius | 2026-09-21 | provider_fulfillments (V1-M18); idempotency order_id nullable + reference_type (V1-M19); drops idx_users_referral_code; re-creates the DESC wave | Expand-first generalization (FK drop follows in 0013) |
| 0013 | wandering_mister_fear | 2026-09-22 | idempotency_keys FK drop, IF EXISTS-hardened (V1-M20; boot name divergence documented) | Guarded drop (polymorphism) |
| 0014 | fuzzy_jazinda | 2026-09-29 | points_ledger + indexes + welcome_bonus_granted + orders refund columns (V1-M21/M22) | Additive |
| 0015 | smart_bruce_banner | 2026-10-05 | wallet_topups.reviewed_by (V1-M23) | Additive |
| 0016 | neat_wither | 2026-10-06 | MIRROR_CHECKS re-emit: 10 money CHECKs + unique flip of points exactly-once + idx_admin_alerts_created — all DO-block/IF-hardened | Idempotent re-emit |
| 0017 | silent_greymalkin | 2026-10-07 | notifications index swap (user_id, created_at DESC) + tickets status composite (V1-M24) | Same-name swap, IF-hardened |
| 0018 | large_speedball | 2026-10-07 | 4 money user-FKs → RESTRICT (boot names) + chk_orders_amount_pos + chk_ledger_arithmetic (V1-M25/M26) | Guarded converge |
| 0019 | sturdy_omega_red | 2026-10-08 | V1-M27..M30 mirror: 3 composites + 16 redundant drops; referral FKs RESTRICT; 8 domain CHECKs; organizations/table+column removal (0 rows) | Guarded drops + additive |
| 0020 | hot_mojo | 2026-10-09 | 8 retention/prune indexes, 2 partial (V1-M31); NOT-CONCURRENTLY decision on record | Additive |
| 0021 | lazy_cardiac | 2026-10-11 | idempotency_keys.body_hash (V1-M32) | Additive |
| 0022 | far_human_cannonball | 2026-10-11 | 18 same-name DESC convergences + idx_wallet_ledger_type drop (V1-M33, A8-F2) | Same-name swaps |
| 0023 | conscious_wrecking_crew | 2026-10-12 | coupons expiry partial + 2 keyset tails (V1-M34) | Additive + same-name swap |

**Missing-test census (duty 5):** stage suites exist for V1-M9/M10/M12/M14/M15/M17/M24/M25/M26/M27/M28/M29/M30/M31/M32/M33/M34 + users-DDL + fast-path + boot-resilience/leader-wait + schema-parity + chain twins 0013/0016/0017/0018/0020/0021/0022. **Uncovered:** (1) the `runMigrations` body (F-1); (2) sequential whole-chain application 0000→0023 (F-2); (3) V1-M13/M16/M18/M19/M20/M21/M22/M23 stages as units (their objects are covered indirectly — admin-sessions by auth suites, variants by product/catalog suites, provider_fulfillments + refund columns by checkout/refund suites, points_ledger by points/schema-parity — but the stage functions themselves have no direct probe-gate/skip-path tests, unlike their siblings); (4) no test asserts the live DB's constraint set (a `pg_constraint` diff vs snapshot 0023 would catch out-of-band drift — today only the build fingerprint heuristic covers it).

## Constraint / unique-index / FK coverage table (snapshot 0023 == schema.ts == boot, verified)

| Table | CHECKs | UNIQUE guards | Serving indexes (btree unless noted) | User-delete behavior |
|---|---|---|---|---|
| users | wallet_balance ≥ 0; loyalty_points ≥ 0 | phone, google_id, telegram_id, firebase_uid, referral_code (5 constraints) | referred_by, email, created, phone trgm (gin) | referred_by SET NULL |
| orders | amount > 0; refund range (0, amount] | order_code | product; created DESC; status+created; user+created DESC+id DESC (keyset); variant | **RESTRICT** |
| wallet_ledger | amount ≠ 0; type-aware arithmetic | — | created DESC; user+created DESC+id DESC (keyset) | **RESTRICT** |
| wallet_topups | amount > 0 | payment_reference (partial, approved-only) | user+created DESC; status+created | **RESTRICT** |
| points_ledger | arithmetic; delta ≠ 0; balances ≥ 0; reason-for-manual | (type, reference_id) partial — exactly-once per source | type; user+created | **RESTRICT** |
| referral_events | status ∈ {pending, credited} | referee_id | referrer+created DESC | **RESTRICT** ×2 |
| products | price > 0 | slug (index) | category; (is_active, category); slug; name trgm (gin) | — |
| product_variants | price_lyd > 0 ∧ cost_price ≥ 0 | (product, plan, duration) NULLS NOT DISTINCT — **boot-owned** | product+active | product CASCADE |
| coupons | used_count ≤ max_uses | code | expires_at (partial) | — |
| cart_items | quantity ≥ 1 | (user, product) | — | user/product/variant CASCADE |
| inventory | — | — | product; sold (partial, unsold); product+sold; variant | product CASCADE; variant SET NULL (documented demotion) |
| sessions | — | id (PK) | user_id; expires_at (prune) | user CASCADE |
| admin_sessions | — | id (PK) | admin_id; expires_at; revoked_at (partial) | admin CASCADE |
| idempotency_keys | — | key (PK) | created (prune) | — (order_id FK dropped — polymorphic, app-owned) |
| notifications | — | — | user+created DESC (bell); created (retention) | user CASCADE |
| support_tickets / ticket_replies | — | — | tickets: user+created, status+updated; replies: ticket+created | user / ticket CASCADE |
| login_attempts | — | identifier | last_attempt (prune) | — |
| admin_alerts | — | — | dedupe_key+created; created DESC; unread (partial) | — |
| audit_logs | — | — | action; actor; target; created DESC | — (no FKs by design) |
| auth_activity | — | — | user; identifier; action; created DESC | — |
| user_auth_identities | — | (provider, provider_uid) | user; firebase_uid | user CASCADE |
| flash_sales | — | active singleton (partial, `ON (true)`) | — | — |
| provider_fulfillments | — | (provider, provider_order) plain UNIQUE (NULLS DISTINCT by design) | order | order CASCADE |
| copilot_previews/actions/action_items | — | id PKs | admin+created; expires; action_class; outcome; preview; entity | admin **RESTRICT** (previews/actions); preview SET NULL; action CASCADE |
| enrichment_runs/drafts | outcome; state; field; published/rejected consistency | — | started DESC; outcome+started; state+created; product+field+state+rejected; run | run/product CASCADE; admin refs SET NULL |
| inventory_forecast_runs/forecasts | outcome; confidence; insufficient-consistency | (product, forecast_date) | started DESC; outcome+started; run; forecast_date (prune); at-risk (partial) | run/product CASCADE |
| risk_events/rules/config/labels | score 0-100; confidence 0-1 | risk_rules.name | user+created; level+created; type+created; created+id DESC NULLS LAST (keyset); enabled; labels ×3 | user SET NULL; admin refs SET NULL |
| scheduler_leader_lease | id = 1 (singleton) | id (PK) | — | — |
| account_link_consents | — | token (PK) | — (TTL-consumed) | — |
| system_settings / openwa_sessions / whatsapp_otps | — | key / name PKs | phone+purpose+created; expires_at | — |

---

**Not checked:** live Neon state (no DB connections made — read-only charter); `drizzle-kit` internals; the 332-765 tail of boot-migrations.ts line-by-line (covered by its docstring + green boot suites); `specs/**` design-time artifacts (lane N verified zero runtime references).
