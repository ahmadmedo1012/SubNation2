> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r118/R118-A3-database.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R118-A3 — Live Database & Data Hygiene Audit (SubNation2)

- **Scope**: exhaustive read-only audit of the production Neon PostgreSQL DB (census, schema drift vs Drizzle mirror, data hygiene, integrity spot-checks, index audit, inventory-loading readiness, Neon-specific checks). No writes, no DDL, no schema changes were executed.
- **Connection**: `postgresql://neondb_owner:***@ep-spring-term-avwgxrte-pooler.c-11.us-east-1.aws.neon.tech/neondb` (PgBouncer pooled endpoint), read via the repo's `pg` module. Connection timestamps: **2026-10-06T14:59–15:3x UTC**.
- **Method**: four probe scripts (`/home/z/my-project/scripts/r118_a3_{census,drift,drift2,hygiene,integrity,indexaudit,availability,drilldown}.js`), all SELECT/pg_catalog/pg_stat only. Raw dumps: `/home/z/my-project/download/r118-db-*.json`. Repo at `ef3d0c3` (clean). Drizzle state compared against `shared/db/drizzle/meta/0015_snapshot.json` after proving TS↔snapshot parity by running `drizzle-kit generate` on a temp copy (**result: "No schema changes, nothing to migrate"** — TS source at HEAD generates exactly the 0015 snapshot).
- **Server**: PostgreSQL 17.11 (aarch64), Neon compute `compute-shiny-water-av7fan14`, endpoint `ep-spring-term-avwgxrte`, branch `br-lucky-bird-avkvvzo7`, region c-11 (us-east-1).

---

## CENSUS

### Database & objects

| Metric | Value |
|---|---|
| DB size (`neondb`) | **12 MB** (12,623,872 bytes); sibling `postgres` DB 7.7 MB |
| Tables in `public` | **42** (0 views, 0 materialized views, 33 sequences, 12 enums, 0 triggers) |
| Schemas | `public` only |
| Extensions installed | **pg_trgm 1.6, plpgsql 1.0** (pg_stat_statements preloaded but NOT installed — see F7) |
| Timezone | `SHOW timezone` = **GMT**; `now()` = `2026-10-06T14:59:54.368Z` (UTC-consistent) |
| Replication slots | 2 physical, Neon-internal: `wal_proposer_slot` (active), `wal_retention_slot` (reserved). No logical slots, no publications/subscriptions. |
| Active connections | **2** (1 idle production pgbouncer conn + this audit session). `max_connections=112`. |
| Key settings | `statement_timeout=0`, `idle_in_transaction_session_timeout=300000ms`, `synchronous_commit=on`, `autovacuum=on` (naptime 60s), `wal_level=replica` |

### Top 15 tables by total size (heap+indexes)

| Table | Size | est. rows | exact rows | dead tup | last autovac | last autoanalyze |
|---|---|---|---|---|---|---|
| products | 464 kB | 59 | 59 | 0 | 2026-09-21 | 2026-09-21 |
| users | 208 kB | 17 | 18 | 13 | – | 2026-09-07 |
| openwa_sessions | 176 kB | 1 | 0 | 30 | 2026-09-11 | 2026-09-11 |
| orders | 160 kB | 7 | 7 | 12 | – | – |
| auth_activity | 152 kB | 168 | 186 | 0 | – | 2026-10-05 |
| admin_alerts | 144 kB | 72 | 123 | 0 | 2026-10-05 | 2026-10-05 |
| product_variants | 144 kB | 263 | 263 | 0 | – | 2026-09-19 |
| inventory | 144 kB | 10 | 13 | 0 | 2026-09-19 | 2026-09-19 |
| audit_logs | 128 kB | −1 | 44 | 0 | – | – |
| wallet_topups | 96 kB | 10 | 13 | 17 | – | – |
| wallet_ledger | 96 kB | 8 | 23 | 8 | – | – |
| points_ledger | 88 kB | −1 | 3 | 0 | – | – |
| user_auth_identities | 80 kB | −1 | 11 | 32 | – | – |
| sessions | 80 kB | 15 | 9 | 53 | – | 2026-10-05 |
| scheduler_leader_lease | 64 kB | 1 | 1 | 21 | 2026-10-04 | 2026-10-04 |

Dead-tuple counts are trivially small everywhere (max 53); a handful of tiny tables (audit_logs, points_ledger, user_auth_identities) have never been analyzed (`reltuples=-1`) — cosmetic at this scale, autovacuum will pick them up when thresholds trip.

### Exact row counts (all 42 tables)

products 59 · product_variants 263 · inventory 13 · orders 7 · users 18 · user_auth_identities 11 · sessions 9 · admin_sessions 6 · admin_users **1** · admin_alerts 123 · audit_logs 44 · auth_activity 186 · login_attempts 7 · wallet_topups 13 · wallet_ledger 23 · points_ledger 3 · coupons 2 · notifications 12 · support_tickets 4 · ticket_replies 5 · cart_items 1 · whatsapp_otps 2 · system_settings 10 · scheduler_leader_lease 1 · risk_config 1 · flash_sales 0 · risk_events 0 · risk_rules 0 · risk_labels 0 · copilot_actions 0 · copilot_previews 0 · copilot_action_items 0 · enrichment_drafts 0 · enrichment_runs 0 · inventory_forecasts 0 · inventory_forecast_runs 0 · referral_events 0 · organizations 0 · provider_fulfillments 0 · idempotency_keys 0 · account_link_consents 0 · openwa_sessions 0.

### Neon-specific checks (cold-start / suspend / limits)

- **Auto-suspend is NOT visible at the SQL level** (it is a Neon control-plane endpoint setting) — nothing in `pg_settings` beyond `neon.*` plumbing confirms or denies it; the DB-visible endpoint facts: `neon.endpoint_id=ep-spring-term-avwgxrte`, `neon.branch_id=br-lucky-bird-avkvvzo7`, `neon.compute_mode=primary`, file cache limit 607 MB, LFC/tiered cache off.
- **Cold-start latency measured live**: 3 fresh client connects (direct, non-pooled) → **1,434 / 1,525 / 1,402 ms** to first `SELECT 1` — corroborates R117's diagnosis that the first `checkNeon` probe after a suspend exceeds the 500 ms degraded-threshold (health.ts) and yellows `/api/healthz/summary` until the warmup probe lands. Production traffic rides the pooled endpoint (`…-pooler` via PgBouncer, observed `application_name=pgbouncer`, client `::1`), so real requests amortize this — only cold first-probes flap.
- **Connection limits**: `max_connections=112`; audit snapshot saw **2** connections (1 idle app conn mid-`flash_sales` probe + this audit). `idle_in_transaction_session_timeout=300s` protects against leaked transactions. No connection-pressure risk.
- **Backups/branching**: 2 physical WAL slots are Neon-internal plumbing (`wal_proposer_slot` active, `wal_retention_slot` reserved); no user logical slots → no WAL-retention runaway possible from this DB side.

---

## FINDINGS

### F1. [P1] Sellable stock is still effectively zero — R117's #1 blocker persists; 42/45 active products unsellable, the only 3 "available" products are backed by 3 credential-less placeholder rows

**Evidence** (SQL replicating `deliverableUnitCondition()` two-pool semantics from `products.ts:83-87`):
- `SELECT ... FROM inventory WHERE is_sold=false AND (pw OR email OR extra IS NOT NULL)` grouped by pool → **all 13 inventory rows have `variant_id IS NULL`** (zero variant-scoped stock exists anywhere).
- Availability census: `active_products=45, active_variants=263, available_variants=13, products_with_any_available_variant=3` — Netflix (4 variants), cPanel (6), Lifetime Cloud Storage (3) each served by exactly **1 generic-pool row**.
- Those 3 rows (`inventory.id` 79/80/81, `product_id` 62/61/1) were uploaded by admin `ahmadmedo` on **2026-10-05 14:35–14:38 UTC** (audit_logs ids 29–31, action `product.inventory.upload`) and have **`account_email` NULL + `account_password` NULL + only `extra_details`** (64–70 chars).
- The other 3 unsold rows sit under archived test products (id 23 «محاكاة 94», id 19 Test Product Playwright).

**Impact**: the store still cannot sell 42 of 45 products. Worse, the 3 newly-available products would sell a unit whose payload is *extra_details only* — the R93-DATA gate passes any row with ≥1 credential field, so a buyer of Netflix `شهر واحد` (79.80 LYD) or cPanel `مدى الحياة` (5,980 LYD) would receive only whatever that note contains, unless these are genuine code-style goods.
**Fix sketch**: operator loads real stock per `docs/operations/FINAL_INVENTORY_LOADING.md` §2 (per-product admin upload; generic pool; ≤500 rows/batch). **First verify whether rows 79/80/81 are real deliverable codes or test placeholders — if placeholders, delete them (unsold-only, §5 rollback shape) before launch.**
**Effort**: M (operator data entry; no code change).

### F2. [P2] Drizzle mirror drift: `uniq_points_ledger_type_reference` declared **non-unique** in TS/snapshot while the live index is UNIQUE — a `drizzle-kit push` would silently strip the points exactly-once guard

**Evidence**:
- Live: `CREATE UNIQUE INDEX uniq_points_ledger_type_reference ON points_ledger USING btree (type, reference_id) WHERE (reference_id IS NOT NULL)` (pg_indexes).
- Snapshot (`meta/0015_snapshot.json`, and the TS source `shared/db/src/schema/points_ledger.ts:93-97`): declared `index(...)` with `where` but **`isUnique: false`** — the word `uniqueIndex` never appears.
- The schema's own docblock (points_ledger.ts:46-48) claims “partial UNIQUE (type, reference_id) … double-grant impossible”, contradicting its own declaration.
- `migrate.ts:1230` re-creates it with `CREATE UNIQUE INDEX IF NOT EXISTS` — after a push rebuilt the index non-unique under the same name, the boot reconcile would **skip** it (name exists), leaving the weakened guard permanently.

**Impact**: the documented mirror invariant (“drizzle chain mirrors live prod”) is broken for a money-adjacent integrity guard; the CI drift gate cannot catch it (it compares generated-vs-committed SQL, both derived from the same wrong TS). Risk materializes only if someone runs `pnpm --filter @workspace/db push` (script exists in package.json).
**Fix sketch**: `points_ledger.ts`: `sourceUnique: uniqueIndex("uniq_points_ledger_type_reference").on(t.type, t.referenceId).where(sql\`reference_id IS NOT NULL\`)` + `drizzle-kit generate` (0016) + commit. One-word change.
**Effort**: S.

### F3. [P2] Drizzle mirror drift: 10 live CHECK constraints (7 money/integrity) are absent from the Drizzle snapshot — `drizzle-kit push` would drop them

**Evidence** (`pg_constraint` vs snapshot `checkConstraints`; snapshot carries only 7 checks — enrichment_drafts×4, inventory_forecasts×2, scheduler_leader_lease×1 — live has 17):

| Constraint | Live definition (pg_get_constraintdef) |
|---|---|
| users.chk_users_wallet_balance_nonneg | `CHECK ((wallet_balance >= (0)::numeric))` |
| users.chk_users_loyalty_points_nonneg | `CHECK ((loyalty_points >= 0))` |
| wallet_ledger.chk_ledger_amount_nonzero | `CHECK ((amount <> (0)::numeric))` |
| wallet_topups.chk_topups_amount_pos | `CHECK ((amount > (0)::numeric))` |
| coupons.chk_coupons_used_le_max | `CHECK (((max_uses IS NULL) OR (used_count <= max_uses)))` |
| orders.chk_orders_refund_amount_range | `CHECK (((refund_amount IS NULL) OR ((refund_amount > 0) AND (refund_amount <= amount))))` |
| points_ledger.chk_points_ledger_arithmetic | `CHECK ((points_after = (points_before + points_delta)))` |
| points_ledger.chk_points_ledger_delta_nonzero | `CHECK ((points_delta <> 0))` |
| points_ledger.chk_points_ledger_balances_nonneg | `CHECK (((points_before >= 0) AND (points_after >= 0)))` |
| points_ledger.chk_points_ledger_reason_for_manual | `CHECK ((type <> ALL (ARRAY['admin_set','correction'])) OR (reason IS NOT NULL))` |

**Impact**: identical class to R5's P0-5 push trap (which this repo already fixed once for the index set). Push would drop these guards; the boot reconcile re-adds them, but only on next boot — and until then money tables run unprotected. The TS schema files simply never declare them (drizzle-kit 0.31 supports `check()` — it is already used for enrichment_drafts/inventory_forecasts).
**Fix sketch**: add the 10 `check(...)` declarations to the corresponding schema files (users/wallet_ledger/wallet_topups/coupons/orders/points_ledger), regenerate 0016, commit. Mechanical.
**Effort**: S/M.

### F4. [P3] `uniq_product_variants_plan_duration` is NULLS NOT DISTINCT live but plain-UNIQUE in the snapshot (documented limitation, accurate for drizzle-orm 0.45.2)

**Evidence**: live indexdef includes `NULLS NOT DISTINCT`; snapshot has no `nullsNotDistinct` flag. The schema comment (product-variants.ts:104-111) explicitly documents this as a known drizzle-orm limitation — verified accurate: in drizzle-orm 0.45.2, `nullsNotDistinct()` exists only on `unique()` constraints (unique-constraint.js:19), not on `uniqueIndex()`. V1-M17's boot stage (migrate.ts:969-1010) skips rebuild if the name exists, so a push-weakened index would persist.
**Impact**: same push-trap family as F2/F3 but explicitly acknowledged in code; boot migration is the authoritative DDL. No live risk today.
**Fix sketch**: none available within drizzle-orm 0.45.2 short of converting the index to a `unique()` constraint (a live DDL change — operator/agent-with-write decision); at minimum add this object to the F2/F3 remediation test so drift tooling knows it is intentional.
**Effort**: S (test/doc) / M (constraint conversion).

### F5. [P3] FINAL_INVENTORY_LOADING.md §8 “r112 truth” is stale vs today's DB

**Evidence**: doc claims “Deliverable stock under ACTIVE products: 1 unit — netflix-premium; 10 deliverable units total incl. archived products' stock”. Live today: **3 deliverable units under active products (Netflix, cPanel, Lifetime Cloud Storage) and 6 unsold total (3 active + 3 archived)**. Every mechanism/line-cite in §1–§7 was re-verified at `ef3d0c3` and is accurate (deliverableUnitCondition products.ts:83; two-pool claim manual.provider.ts:50-79; R93-DATA gate :97-110; guarded claim :114-119; upload route admin/products.ts:509-749 incl. 500-row cap at :627, advisory lock :642, `skipped_duplicates` :718; set-count :435; copilot `update_stock` refuses +N admin-direct.ts:533+; stats.ts:77; stockWatcher orphan block :121-166; InventoryUploadDialog.tsx + inventory-parser.ts exist; no script/endpoint sets `variant_id` — confirmed: all 13 live rows are NULL and no write path passes it).
**Impact**: an operator reading §8 today would think Netflix has the only unit and that stock shrank (10→6); §8 is datestamped r112 so it's partly by design, but it is the section a stressed operator reads first.
**Fix sketch**: append a dated “R118 observed state” line to §8 (3 active-product units, ids 79/80/81, uploaded 2026-10-05, extra_details-only; 6 unsold total).
**Effort**: S (docs-only).

### F6. [P3] 103 unread admin_alerts (87 `no_stock`) — expected noise while stock is zero, plus 6 legacy NULL dedupe_key rows (all read, no backfill)

**Evidence**: `SELECT type, COUNT(*), COUNT(*) FILTER (WHERE is_read=false)` → no_stock 93/87, low_stock 10/3, whatsapp_channel 10/7, system 8/6, refunded_live_credentials 1/0, inventory_corrupt 1/0. Oldest unread = 2026-10-01 (5d, inside the 14-day stale policy — 0 unread >14d; 0 read rows >30d still present, so retention is working). Dedupe spacing verified: repeated keys (`inventory:orphan-archived` ×5, `whatsapp:channel:unreachable` ×3) are all >24h apart — the 24h dedupe window works. `dedupe_key IS NULL` on exactly 6 rows, all created before 2026-10-01, **all read** (`unread_dedupe_null=0`) — no backfill happened, harmlessly.
**Impact**: alert fatigue risk for the operator; the no_stock flood will collapse once real stock is loaded (and the 14-day stale policy bounds it regardless). No defect.
**Fix sketch**: none required; optionally “mark all read” from the admin panel after loading stock.
**Effort**: S (operator).

### F7. [P3] pg_stat_statements is preloaded but not installed — top-query visibility unavailable read-only

**Evidence**: `shared_preload_libraries` = `neon,pg_stat_statements,timescaledb,…` but `SELECT * FROM pg_extension` shows only `pg_trgm`, `plpgsql`. `SELECT … FROM pg_stat_statements` is not possible without `CREATE EXTENSION` (a write/DDL action — operator action, not executed by this audit).
**Impact**: no evidence-based top-query list for future performance work (the mission's pg_stat_statements item).
**Fix sketch**: operator runs `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` once (Neon allows it; it is in `neon.allowed_extensions`), after which `pg_stat_statements` becomes queryable.
**Effort**: S (operator, one statement).

### F8. [P3] 10 of 40 FK columns have no leading-column index — all on dormant/low-traffic paths at current scale

**Evidence**: FK-vs-index-coverage join → uncovered: `users.organization_id`, `orders.inventory_id`, `cart_items.product_id`, `cart_items.variant_id`, `enrichment_drafts.published_by/rejected_by`, `risk_rules.created_by/updated_by`, `risk_config.updated_by`, `risk_labels.labeled_by`. Code check: `orders.inventory_id` is written (checkout.service.ts:519) but never used as a query filter; `users.organization_id` is unused in backend (organizations table is empty, 0 rows); cart columns matter only for product/variant DELETE cascades (cart_items has 1 row).
**Impact**: none at 59 products/18 users/7 orders; would matter only if risk/enrichment tables grow or organizations ships.
**Fix sketch**: skip — revisit when any of these tables exceeds ~10k rows or organizations becomes live.
**Effort**: — (informational).

### F9. [P3] Naming-only drift: 11 unique-constraint backing indexes + 40 FKs use PG/boot-SQL names (`*_key`, `*_fkey`, `fk_*`) instead of drizzle-generated names (`*_unique`, `<table>_<col>_…_fk`)

**Evidence**: shape-insensitive comparison: all 40 FKs match snapshot FKs exactly on (table, columns → ref table, columns, onDelete, onUpdate); all 11 unique constraints match on (table, columns). Examples: live `users_phone_key` vs snapshot `users_phone_unique`; live `fk_orders_user` vs snapshot `orders_user_id_users_id_fk`. Index counts reconcile 1:1: 104 live non-pkey indexes − 11 name-variant = 93 snapshot indexes, all present with matching semantics.
**Impact**: a `drizzle-kit push` would drop-and-recreate these under new names (brief unprotected window, identical semantics). No current risk; documented here so a future diff pass doesn't re-flag them as real drift.
**Fix sketch**: none needed (or, if F2/F3 are fixed via 0016, optionally align names in the same change).
**Effort**: — (informational).

### F10. [P3] Secrets hygiene: Telegram bot token stored in cleartext in `system_settings` (`auth.telegram.bot_token`)

**Evidence**: `SELECT key FROM system_settings` → `auth.telegram` row contains a live-looking bot token value (not reproduced here). This is the app's designed settings store (admin-editable), but it means DB dumps/backups carry a usable credential.
**Impact**: any DB export/backup leak exposes the users-bot token. Low operational risk given access controls, worth knowing.
**Fix sketch**: keep as-is or move bot tokens to env-only; at minimum ensure backups are encrypted and the token can be rotated from BotFather if a dump ever leaks.
**Effort**: S (operator decision).

---

## OPERATOR ACTIONS (require write access / human decision — NOT executed by this audit)

1. **Load sellable inventory** per `docs/operations/FINAL_INVENTORY_LOADING.md` §2 (per-product admin upload, generic pool). Before launch: decide the fate of the 3 extra_details-only rows (ids 79/80/81) — if they are test placeholders, delete them unsold-only (§5 shape: `DELETE FROM inventory WHERE id IN (79,80,81) AND is_sold=false` after the scope-verify count).
2. **Optional DDL**: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` for query visibility (F7).
3. **Admin TOTP** is still unset (by design until the operator chooses): single admin `ahmadmedo`, `totp_enabled=false` — run `docs/operations/FINAL_ADMIN_TOTP_SETUP.md` when ready (the weekly `admin:no-totp` advisory will keep nagging otherwise).
4. After stock load: optionally “mark all alerts read” (103 unread, F6).
5. If the F2/F3 mirror fixes are made by a write-capable agent, they are code+drizzle-emit changes (no live DDL needed — the live DB is already correct); the live DB needs nothing.

## VERIFIED-OK (25 clusters)

1. **Tables/columns/enums**: 42/42 tables, 422/422 columns (type+nullability+default modulo formatting), 12/12 enums with identical label sets, 33/33 sequences — live ↔ 0015 snapshot.
2. **TS ↔ snapshot parity**: `drizzle-kit generate` on a temp copy of `shared/db/src` at HEAD → “No schema changes” (chain 0000–0015 is current).
3. **Migration state**: journal 16/16 entries = 16 files on disk; **0015_smart_bruce_banner applied live** (`wallet_topups.reviewed_by varchar(100)` present); no `__drizzle_migrations` table by design — runtime `migrate.ts` owns state via `system_settings."migrations.fingerprint"` = `v2:b8f4e81e…:738fa0f5…` updated **2026-10-05T19:20:59Z** (last boot reconciled at current build).
4. **R5 P0-5 money constraints all live with exact definitions**: `uniq_wallet_topups_payment_reference` (partial UNIQUE `WHERE payment_reference IS NOT NULL AND btrim(payment_reference)<>'' AND status='approved'`), `chk_ledger_amount_nonzero`, `chk_users_wallet_balance_nonneg`, `chk_topups_amount_pos`, `chk_coupons_used_le_max`, `uniq_product_variants_plan_duration` (UNIQUE, NULLS NOT DISTINCT), `uniq_points_ledger_type_reference` (partial UNIQUE — live side), `uniq_provider_fulfillments_provider_order` (plain UNIQUE), `idx_login_attempts_identifier` (UNIQUE), `uniq_cart_items_user_product`, `uniq_flash_sales_active_singleton` (partial on `(true) WHERE is_active`), `idx_products_slug_unique`, `orders_order_code_key`, 4× audit_logs indexes, GIN trigram `idx_products_name_trgm` + `idx_users_phone_trgm` — **every R5-era guard verified present**.
5. **Wallet reconciliation**: 6/6 users with balances → `wallet_balance` == latest `balance_after` (diff 0.00); 0 chain breaks (`balance_after = prev + signed amount` per type); 0 negative balances; ledger purchases Σ401.49 == orders Σamount 401.49; ledger refunds Σ160.00 == Σorders.refund_amount 160.00; ledger topups Σ581.00 == approved topups Σ531.00 + the 50.00 documented sim opening-balance row (id 27, `reference_id IS NULL`).
6. **Points reconciliation**: 3/3 users' `loyalty_points` == latest `points_after`; only 3 `correction` rows (R115 opening balances, Σ+240).
7. **FK integrity**: 0 orphan rows across all 40 FK relationships (auto-generated sweep).
8. **Orders hygiene**: 7 orders (5 completed, 2 refunded); `delivered_password`: 5/5 non-null values in `iv:tag:ct` ciphertext format, **0 plaintext**; the 2 refunded orders are scrubbed NULL; all 7 have `inventory_id` set.
9. **Inventory encryption**: 10/13 rows' `account_password` in ciphertext format, 3 NULL (the F1 placeholder rows); 0 plaintext passwords.
10. **admin_users**: exactly **1** — `ahmadmedo`, role=admin, permissions `["all"]`, is_active=true, TOTP disabled/absent (matches R117 cleanup); audit rows of deleted sim admins (ids 3/4) preserved by design.
11. **Session prune (05:00 job working)**: 9 sessions, only 2 expired-and-present, both expired **today 13:15 UTC** (after today's 05:00 run) → the daily job runs; oldest session row 2026-09-06 within 30d window.
12. **admin_sessions prune (24h grace)**: 6/6 expired but all within the 24h grace (`expires_at < now()-24h` is the delete predicate) — correct.
13. **whatsapp_otps**: 2 rows, both expired <24h ago — the hourly :15 prune (24h window) is consistent.
14. **Retention windows honored**: login_attempts oldest 4d (<7d), auth_activity oldest 42d (<90d), audit_logs oldest 42d (<180d), notifications oldest 42d (<90/180d).
15. **Alert retention/dedupe**: 0 unread >14d, 0 read >30d still present; duplicate dedupe keys spaced >24h apart (window works).
16. **Census health**: no views/matviews/triggers; single schema; extensions minimal; GMT timezone consistent with UTC app code.
17. **Index usage**: 0 of 146 indexes have `idx_scan=0` (nothing clearly dead); hot paths use PKs + `idx_orders_status`, `idx_admin_alerts_dedupe_key`, `idx_products_slug_unique` as designed.
18. **Seq-scan profile sane**: heaviest seq scans are 1-row `scheduler_leader_lease` (39,687 — lease polling), 0-row `flash_sales` (10,874 — health probe), `products` (5,776 — 59-row catalog list) — all cheap by design.
19. **Cart integrity**: 1 cart item, 0 orphans (its product is archived — noted in F6-adjacent trivia, harmless; checkout would reject cleanly).
20. **Catalog shape**: 45 active products all have ≥1 variant and an image; 263 variants all active, priced >0, cost_price populated (0 NULL/nonpositive), pricing settings live (`pricing.usd_to_lyd=10`, `pricing.markup_percent=100`).
21. **Replication topology**: only Neon-internal physical slots; no logical replication debt.
22. **Neon connectivity**: pooled endpoint (`-pooler`), 2 connections vs limit 112, `idle_in_transaction_session_timeout` 5min guards leaked txns.
23. **FINAL_INVENTORY_LOADING.md mechanics (§1–§7)**: every referenced file, route, line-cite, cap, lock, and guard re-verified at HEAD (see F5 for the §8-only staleness).
24. **Zero drifted columns** between live and mirror (the risk_config jsonb “default mismatches” are key-order/whitespace formatting only; enum default casts normalize away).
25. **No unauthorized writes**: all probes SELECT/pg_catalog/pg_stat; scripts saved outside the repo; repo tree untouched except this file.

---

**Findings by severity: P0: 0 · P1: 1 · P2: 2 · P3: 7 (+ 25 VERIFIED-OK)**
