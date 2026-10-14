# Lane L9 findings — Database, migrations & data integrity (R143)

HEAD `528ef39` (R142+ assurance round), read-only audit. Charter: schema/code
agreement, migration chain ordering + fresh-install replay, `migrate.ts` boot
reconciler, constraints/indexes for money queries, transaction boundaries,
query efficiency, connection lifecycle, test-harness parity (F-2 verify),
F-1 feasibility. Zero DB connections made; zero repo edits (all probes ran
from `/home/z/l9-scratch` outside the tree — a PGlite chain replay, an
esbuild-stubbed full `runMigrations()` body dry-run, and targeted vitest
runs of the migration suites).

**Test evidence at HEAD:** `npx vitest run src/jobs/__tests__/migrate- src/services/__tests__/schema-parity.test.ts`
→ **21 files / 164 tests green**; plus executor-single-use (E-1), money-reads-horizontal-authz
(H-1), migrations-fast-path, boot-resilience → **4 files / 46 tests green**.

**Headline:** the live migration path (`migrate.ts`) is healthy — a full
fresh-database boot dry-run executes 339 statements cleanly, reaches the
exact documented end shape (41 tables / 29 CHECKs / 39 FKs / 139 indexes,
post-Stage-C users, every money guard present), and is idempotent on a
second run. The **declarative mirror chain is NOT**: file 0003 contains a
statement that is a syntax error on real Postgres, so the chain's
"fresh-install replay" promise fails at file 3 of 24 — and the CI drift
gate cannot see it because it only diffs bytes.

---

## Findings

### L9-1 · P2 · Chain 0003's flash-sale singleton index is unapplyable — the mirror's fresh-install replay dies at file 3 of 24

- **Evidence:** `shared/db/drizzle/0003_secret_invisible_woman.sql` (singleton statement, after the audit-logs block):
  ```sql
  CREATE UNIQUE INDEX "uniq_flash_sales_active_singleton" ON "flash_sales" USING btree (true) WHERE is_active = true;
  ```
  Executed against a fresh PGlite (real Postgres grammar in WASM):
  `42601 syntax error at or near "true"`. Control experiment on the same
  engine: `ON tt (true)` → same syntax error; `ON tt ((true))` → OK. The
  index_elem grammar requires a constant expression to be parenthesized
  (`'(' a_expr ')'`), so `(true)` is a syntax error on real Postgres too —
  this is not a PGlite quirk.
- **Root cause:** `shared/db/src/schema/flash_sales.ts:28-30` declares
  `uniqueIndex("uniq_flash_sales_active_singleton").on(sql\`true\`)`, which
  drizzle-kit renders as the unparseable `(true)`. The runtime owner spells
  it correctly — `migrate.ts:2842-2843`:
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_flash_sales_active_singleton ON flash_sales ((true)) WHERE is_active = true;`.
  The CI "Migration drift check" (`.github/workflows/ci.yml`, `drizzle-kit
  generate` + `git diff --exit-code -- shared/db`) regenerates and diffs
  **bytes only** — it never parses or applies a single statement, so a
  syntactically broken statement rides green CI forever.
- **Impact today:** zero live impact — nothing executes the chain at
  runtime; the live Neon DB got the index from migrate.ts's correct
  spelling (probe-verified in the L9 boot dry-run: `uniq_flash_sales_active_singleton`
  exists). But the chain's documented purpose ("MIRROR chain for fresh
  installs + CI drift gate", `.hermes.md` project shape; the 0009/0013/0016
  headers promise chain-safe-apply) is void: a fresh install provisioned
  from the chain aborts mid-0003 with a partial schema and nothing applied
  to the journal. It also means the historical 42P07 hand-fix class
  (documented in 0008's header) still has no automated guard — this is a
  *different* defect class (parse failure) in the same "chain-safe-apply
  promise" family.
- **Proposed fix:** hand-edit 0003 to `USING btree ((true))` — the exact
  precedent documented in 0008's header ("the chain was never applied to
  production, so editing the historical file is safe — it fixes the stated
  promise") — and change the schema TS to an expression form that renders
  parseable SQL, then regenerate so the drift gate stays green. Add the
  L9-2 chain-apply test as the permanent regression pin.
- **Test requirement:** the sequential chain replay test (F-1/F-2b) fails
  on this exact statement today — that is the pin.
- **Risk:** low immediate risk (declarative-only), high latent risk (any
  future chain-based provisioning, `drizzle-kit migrate` on a fresh
  environment, or disaster-recovery replay).

### L9-2 · P3 · Deferred chain-apply test (F-1/F-2b) still absent — and it is the only automated guard that would have caught L9-1

- **Evidence:** no test loops the journal and applies the 24 files
  sequentially — `rg '_journal.json'` hits 7 stage tests, each extracting
  only its own entry (`migrate-drizzle-0016.test.ts:80-99` being the
  machinery donor). `docs/engineering/R142/lanes/IMPL-wave-report.md:37`
  records F-2 as "harness prod-parity ×6 + copilot tables" — the parity
  half landed, the chain-apply half did not; the ledger defers F-1
  ("chain-apply test — harness DDL parity landed instead").
- **Root cause:** the deferral reason ("might balloon") is now disproven —
  see the F-1 feasibility section below: both the chain loop and the full
  `runMigrations()` body run cleanly in seconds with ~40-90 lines of test
  code.
- **Proposed fix:** land the two-part test: (a) journal loop + existing
  `parseStatements` + `client.exec`, skipping pg_trgm statements exactly
  the way `ensurePgTrgmExtension` (migrate.ts:211-238) degrades, asserting
  end-shape table/index counts; (b) optionally the full-body boot test via
  a test-only `db.execute` seam (see feasibility verdict).
- **Test requirement:** is itself the test.
- **Risk:** without it, the next chain edit (generated or hand) is verified
  only by a production provision attempt.

### L9-3 · P3 · Admin inventory set-count trim can delete a concurrently-claimed (sold) unit — unguarded check-then-act DELETE

- **Evidence:** `backend/src/routes/admin/products.ts:606-617`:
  ```ts
  const oldest = await db
    .select({ id: inventoryTable.id })
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)))
    .orderBy(asc(inventoryTable.id))
    .limit(surplus);
  await db.delete(inventoryTable).where(
    inArray(inventoryTable.id, oldest.map((r) => r.id)),
  );
  ```
  The DELETE has **no `is_sold = false` predicate** and no transaction.
  The checkout claim takes the **same oldest-first rows**
  (`services/providers/manual.provider.ts:44-48` — "two ordered `FOR UPDATE
  SKIP LOCKED` selects … ORDER BY id keeps each pool deterministic") inside
  the purchase transaction with a guarded claim UPDATE (`WHERE is_sold =
  false`, migrate.ts-stage sibling idiom). If a purchase commits a claim on
  one of the `oldest` ids between the trim's SELECT and DELETE — or the
  DELETE simply blocks on the buyer's row lock and then executes under
  READ COMMITTED — the sold unit is deleted: `orders.inventory_id` flips
  to NULL (`fk_orders_inventory ON DELETE SET NULL`), the sold-at history
  row vanishes, and sold/total stock stats shift.
- **Root cause:** classic check-then-act outside a transaction; the DELETE
  predicate does not re-assert the condition the SELECT filtered on. This
  is the same class R142 fixed for the copilot preview (E-1 "conditional
  claim") on the money-adjacent inventory table.
- **Why P3 not P2:** money is provably safe — `orders.delivered_*` are
  immutable copies written inside the purchase tx (pinned by
  `orders-credentials-serialization` + checkout suites), the refund path
  never reads inventory, and no double-credit is possible. The loss is
  provenance/stock-history (order → source-unit link severed, sold-unit
  row gone), operator-visible but not customer-money-visible.
- **Proposed fix (one line):** re-assert the predicate in the DELETE:
  `.where(and(inArray(inventoryTable.id, ids), eq(inventoryTable.isSold, false)))`
  and treat a reduced row count as the honest "X units were claimed while
  trimming" outcome (log + audit). Optionally wrap SELECT+DELETE in
  `db.transaction`.
- **Test requirement:** an interleaving test using the existing
  `services/__tests__/helpers/tx-interleave.ts` — mark one `oldest` unit
  sold between SELECT and DELETE, assert it survives and `orders.inventory_id`
  stays intact.
- **Sibling (same class, narrower window):** `routes/admin/product-variants.ts:433-447`
  — COUNT-then-DELETE order-history guard; an order created in the window
  gets its `variant_id` SET NULL'd (label copy survives). Same one-line
  belt applies (`DELETE … WHERE id = $id AND NOT EXISTS (SELECT 1 FROM orders WHERE variant_id = $id)`).
- **Risk:** real on any active product whose stock an operator corrects
  downward while purchases are flowing; both actors deliberately target
  the oldest unsold units.

### L9-4 · P4 · boot-migrations.ts log prefix corrupted on all 22 boot-critical log lines ("igrations]")

- **Evidence:** `backend/src/lib/boot-migrations.ts` — 22 occurrences of
  `"igrations]"` where `"[migrations]"` was intended, e.g. the CRITICAL
  paths: `"igrations] CRITICAL — database never became writable; production must refuse to start"`
  and `"igrations] CRITICAL failure — production must refuse to start"`.
  Present since the file's birth commit `6f476ca` (git log -S confirms).
- **Root cause:** systematic string typo at file creation, never reviewed.
- **Impact:** operators (and any log-based alerting) grepping `[migrations]`
  get zero hits on the most boot-critical messages in the system — the
  exact messages the B7-P0-1 incident class depends on.
- **Fix:** one sed over the 22 strings. Zero behavior change.
- **Risk:** none (log-only).

### L9-5 · P4 · R142 P4 debt re-verified still open (F-4, F-5, F-6, F-7) — all four confirmed at HEAD with fresh evidence

- **F-4 (indexless category idiom):** `services/catalog.service.ts:368`
  (`LOWER(${productsTable.category}) = LOWER(${category.trim()})`) and
  `:412` (the Arabic-alias branches) — still no `LOWER(category)`
  expression index in snapshot 0023 (only raw-column btrees
  `idx_products_category` / `idx_products_active_category`). Seq scan per
  category page; fine at ~45 products, visible at ~10⁴.
- **F-5 (admin search defeats trgm):** `routes/admin/orders.ts:218-222` —
  `LOWER(COALESCE(${usersTable.phone}, '')) LIKE ${like}` (+ email /
  display_name / product name) cannot use `idx_users_phone_trgm` (gin
  trgm on the raw column serves `ILIKE`, not a LOWER(COALESCE)
  expression); `routes/admin/products.ts:128` — `LOWER(category) LIKE`
  (F-4 class).
- **F-6 (vocab CHECK gaps):** snapshot 0023 enumerates 26 CHECK names,
  none on `copilot_actions.outcome`/`action_class`/`risk_tier`,
  `copilot_previews.action_class`/`risk_tier`, `notifications.type`,
  `ticket_replies.author_type`, `wallet_topups.payment_method`,
  `users.loyalty_tier`/`auth_provider`,
  `idempotency_keys.reference_type` — the V1-M29 sweep still stops short
  of the copilot/notification/ticket vocabularies.
- **F-7 (probe idiom inconsistency):** five `information_schema.columns`
  probes without `table_schema` filter at `migrate.ts:516`, `:575`,
  `:2304`, `:3602`, `:3609` (the onboarding DO block), while siblings at
  `:2122-2124` and `:3640-3641` correctly filter. Dormant on single-schema
  Neon.
- All four carry recorded R142 dispositions (debt); re-listed here only to
  keep the ledger honest with current line numbers. No action required
  this round beyond the recorded debt.

### L9-6 · P4 · Enrichment candidate sweep materializes the whole products×drafts join unbounded before the JS cap

- **Evidence:** `services/enrichment/candidates.ts:49-68` — a single
  `SELECT … FROM products p LEFT JOIN enrichment_drafts d … GROUP BY p.id`
  with `json_agg(...) FILTER (...)` and **no LIMIT**; `perRunCap` is
  applied only in the JS pass after the full result set (including every
  product's complete draft history) has crossed the wire and been
  JSON-aggregated.
- **Root cause:** the comment itself says "at 10k products this matters"
  — but only the *filter* is SQL-side; the materialization is not.
- **Impact:** off-peak cron mitigates; at the current catalog (~45
  products) it is trivial. Growth-path memory/latency debt on one round
  trip.
- **Fix (minimal):** push the cap into SQL — restrict to products with an
  eligible field (`description IS NULL OR …`) and `LIMIT 5 × perRunCap`,
  or paginate by id cursor.
- **Risk:** dormant.

---

## R142 fix verification

**F-2 (harness prod-parity ×6 + copilot tables): VERIFIED.** All six
drift spots are corrected at HEAD in `backend/src/test/db.ts`, each with a
truthful `R142 (F-2)` comment:

| Spot | Harness line (HEAD) | Parity target |
|---|---|---|
| `referred_by` ON DELETE | :82 `referred_by integer REFERENCES users(id) ON DELETE SET NULL` | migrate.ts fkStatements `fk_users_referred_by` |
| `orders.discount_amount` NOT NULL | :179 `discount_amount numeric(10,2) NOT NULL DEFAULT '0.00'` | migrate.ts:3107-3110 / R97-DB-03 |
| `wallet_ledger.reference_type` width | :279-283 `varchar(50)` (old comment claiming varchar(32) replaced with the truthful one) | migrate.ts:3009 / schema / chain 0000 |
| `system_settings.key` width | :366-367 `varchar(255)` | migrate.ts:2927 |
| `fk_cart_items_product` | :383-386 `CONSTRAINT fk_cart_items_product … ON DELETE CASCADE` | migrate.ts:2873 |
| `sessions.user_id` FK | :391-393 `user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE` | migrate.ts:3097 |

Plus the E-1 copilot additions: `copilot_previews` + `copilot_actions`
tables with the consumed_at/confirmed columns and all seven indexes, and
both names appended to the `TABLES` truncate list (test/db.ts:599-601).
Regression evidence: the full migration + parity battery (21 files / 164
tests) and the four R142 regression suites (46 tests) are green at HEAD.
The promised *second half* of F-2 (sequential chain-apply test) did NOT
land — see L9-2 and the feasibility verdict.

**F-3 (dead idx_users_referral_code creator): VERIFIED.** The body creator
is gone — `migrate.ts:3287-3291` now carries only the tombstone comment
("F-3 (R142): idx_users_referral_code used to be created here — …"), and
the V1-M27 frozen-creator note at `migrate.ts:1750-1755` documents the
completed sweep ("R142 (F-3) completed the sweep: the fifth body creator …
is now removed too"). Grep across migrate.ts: the only remaining
references to `idx_users_referral_code` are the V1-M15 probe-gated DROP
(:826-839) — the intended convergence path. Fresh-database proof: the L9
boot dry-run's final index set contains no `idx_users_referral_code`.

## F-1 feasibility

**Verdict: YES — small. Both halves are proven by execution at HEAD.**

1. **The chain half (F-2b): ~40 lines.** A scratch replay of the journal
   loop (`parseStatements` from `migrate-drizzle-0016.test.ts:86-92` +
   PGlite `client.exec`) applied **24/24 files with only 5 statement
   failures**: four environmental (`CREATE EXTENSION pg_trgm` → 0A000 and
   gin_trgm_ops → 42704 on PGlite — migrate.ts degrades identically via
   `ensurePgTrgmExtension`, so the test must skip them the same way) and
   **one real defect: the L9-1 `(true)` syntax error**. End shape:
   41 tables / 29 CHECKs / 39 FKs / 138 indexes. The test = journal loop +
   exec + pg_trgm skip + shape assertions; every piece of machinery
   already exists in the repo.
2. **The body half (F-1 proper): ~80 lines.** An esbuild-bundled
   `migrate.ts` with a test-only `db.execute` (drizzle `PgDialect.sqlToQuery`
   → `client.exec` for multi-statement batches, parameterized
   `client.query` for single statements) ran the **entire `runMigrations()`
   body against a fresh PGlite: COMPLETED, 339 statements, ~2.6 s**, end
   shape **41 tables / 29 CHECKs / 39 FKs / 139 indexes**, post-Stage-C
   `users` (password_hash gone), money objects all present
   (`chk_ledger_arithmetic`, `uniq_wallet_topups_payment_reference`,
   keyset `idx_orders_user_created`, RESTRICT `fk_orders_user`). A second
   run completed cleanly (idempotent — the guarded no-ops are exactly the
   ~141 round trips the R104 fingerprint fast-path skips in steady state).
   The blocker lane F cited ("the full 141-statement chain cannot run
   under the pglite harness (multi-statement batches … 42601)") is
   bypassed precisely by routing multi-statement SQL through `client.exec`
   — the same path `execTestSql` (test/db.ts) already proves works. The
   in-repo shape: export an exec-with-results seam from test/db.ts (~4
   lines), monkeypatch `db.execute` in one test file (migrate.ts resolves
   `db.execute` at call time through the vitest alias, so the patch
   covers both the default executor and the body's direct calls), run
   `runMigrations()` twice, assert shape + zero errors.
3. **Bonus cross-check:** diffing the boot-built vs chain-built index name
   sets shows the only substantive divergence is exactly the L9-1 flash-sale
   singleton (boot has it, chain doesn't) — everything else is the
   documented boot-name vs chain-name convention (`_key` vs `_unique`
   backing indexes, the db:push tripwire). Three-way substance parity
   (boot ↔ chain ↔ schema TS) holds at HEAD except for that one statement.

## Closed-with-positive-evidence (no finding)

- **Boot reconciler discipline:** stage ordering verified (extension
  probe → enums → core tables → fkStatements → backfills → V1-M9…M34
  tail → fingerprint persist); every stage probe-gated or IF-guarded;
  partial-failure safety via per-statement autocommit + critical-class
  re-throw (server.ts:225-238 exits production before listen; app is
  503-gated on `bootReady`). Transient classification + full re-run from
  the top with TTL refresh reviewed (`boot-migrations.ts:539-…`).
- **Expand-first:** verified across the body — the only column drops are
  the documented pre-launch cleanups (Stage C legacy auth columns, dead
  `organization_id`), all catalog-probed; backfills are idempotent and
  violation-guarded (`WHERE loyalty_points <> 0`, `refunded_at IS NULL`,
  per-provider try/catch).
- **Money constraints:** all 24+ CHECKs, the partial unique
  payment_reference guard, points exactly-once, RESTRICT money-history
  FKs, keyset composites — presence verified by execution in the boot
  dry-run; all money mutations (checkout/topup approve/reject/refund/
  adjust/loyalty convert) run inside `db.transaction` with in-tx re-checks
  and advisory locks (`topup.service.ts:272-…`, `checkout.service.ts:434-…`).
- **Connection lifecycle:** pool max 8 (prod) + dedicated 2-conn lock pool;
  post-connect `SET statement_timeout` belt (Neon drops the startup
  packet); keepalives; warmup-then-measure Neon health probe
  (`health-checks.service.ts:263-285`); liveness (`/healthz/live`) pure,
  readiness admin-gated + cached, public summary fail-open 200-degraded.
- **Query efficiency spot-audit:** user money lists all bounded (orders
  limit param, wallet statements cap 200, notifications bell 40, loyalty
  history 200, sessions LIMIT landed R142); admin users directory bounded
  with page-scoped `inArray` counts (no N+1); admin products inventory
  preview capped at 200 + exact aggregates. The only loop-query N+1 found
  is the copilot `resolve_product` candidate loop
  (`copilot/admin-direct.ts:261-287`, bounded by the small synonym map,
  admin-only, LIMIT 5) — and its docblock claims "a single SQL query",
  which the code no longer matches (cosmetic).

*Not checked (out of charter/scope):* live Neon state (no connections);
drizzle-kit internals; OpenAPI/zod contract parity beyond spot checks
(lane N territory).
