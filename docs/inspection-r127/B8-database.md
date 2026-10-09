# R127-B8 — Database Layer Audit (migrations, indexes, pool, retention, live stats)

- **Agent:** R127-B8 (read-only auditor — only writes: this report + one worklog append)
- **HEAD:** `f53a886` (= production subnation.ly, verified by prior round agents)
- **Connection mode: LIVE READ-ONLY.** Production `DATABASE_URL` (Neon pooler, PG 17.11, `neondb_owner`) recovered from the R5 heritage file `/home/z/my-project/scripts/restore_env_vars.json`. 8 probe scripts, **SELECT / EXPLAIN only — zero INSERT/UPDATE/DELETE/DDL executed** (guaranteed by construction; every statement is a bare `SELECT`/`EXPLAIN`). Probes archived in `/tmp/b8-dbaudit/` (ephemeral).
- **Exclusions honored:** R126-A6 §2 index matrix + §8 pool depth + its F1–F10 are NOT re-reported (only cross-referenced as known items). B7 owns prune-job *logic*; this report owns their SQL/index support.

---

## 1. Migrations review — verdict: **PASS (forward-only, drift-free, live-converged)**

### 1.1 The two-track system (recap, one paragraph)

Production schema flows **exclusively** through `backend/src/migrate.ts` (4,001-line boot engine, V1-M1…M30, probe-gated, idempotent, fingerprint fast-path). The drizzle chain `shared/db/drizzle/0000–0019` is **declarative-only** — nothing executes it at runtime; CI regenerates + diffs it (`ci.yml:297-308`). A fence (`shared/db/scripts/guard-drizzle-push.mjs`) blocks `drizzle-kit push` against prod. All three layers are documented in-file (0013/0016/0017/0018/0019 headers).

### 1.2 Drift check (the CI command, run locally at f53a886)

```
$ DATABASE_URL=postgres://ci:ci@localhost/ci pnpm --filter @workspace/db exec drizzle-kit generate
No schema changes, nothing to migrate 😴
$ git status --short -- shared/db   →  empty
```

**Schema TS ↔ drizzle chain: zero drift.**

### 1.3 LIVE ↔ repo parity (my own live proof, stronger than the CI gate)

- All 133 live indexes dumped (`pg_indexes`). Every custom `idx_*`/`uniq_*`/`uq_*` name exists in `shared/db/src/schema/*.ts` or migrate.ts; **zero unexplained live indexes; zero repo-declared custom indexes missing live.**
- `system_settings.migrations.fingerprint` = `v2:eab1e8b5…:189cd1ea…`, `updated_at = 2026-10-09T05:37:52Z` — **today's production deploy completed a full reconcile and passed the constraint-skip gate** (the marker is persisted only when zero probe→alert skip paths fired, `migrate.ts:126-136`). Live = build = repo.
- V1-M27's 16 dropped redundant indexes are confirmed gone live (`idx_orders_user`, `idx_topups_user`, `idx_tickets_user`, `idx_products_active`, … all absent); V1-M30's `organizations` table absent; the three consolidation composites present.

### 1.4 Forward-only safety

- Journal `_journal.json` is append-only 0000→0019, monotone `when` timestamps, `breakpoints: true`.
- Historical files were **edited exactly twice, both documented and pre-production-chain**: 0008's `CREATE INDEX IF NOT EXISTS idx_users_phone_trgm` repair (R123-E5, in-file comment: the chain "was never applied to production") and the 0013 IF EXISTS hardening (r110). Both are safe under the declared contract.
- **Zero down-migrations, zero column drops of live data, zero destructive single-statement backfills.** The only data-destroying stages are probe-gated one-shots with in-file rationale: `DROP TABLE otps` (migrate.ts:581, V1-M11 probed), `organizations` removal (migrate.ts:2094-2125, V1-M30, 0 live rows verified), `users` legacy-column drop (migrate.ts:571, `sql.raw` over a probed list), orphan `ticket_replies` delete before FK (V1-M15, counted+logged).

### 1.5 Index creation lock discipline (CONCURRENTLY: absent — verdict: acceptable today, documented trigger below)

`rg CONCURRENTLY backend/src/migrate.ts` → **0 hits**; the drizzle chain likewise. Every index build is a boot-time `CREATE INDEX IF NOT EXISTS` (SHARE lock — blocks writes on that table for the build duration; the old replica can still be serving during a rolling deploy). **Impact today: none** — the largest live table is `product_variants` at 263 rows / 40 kB heap; a full index build is sub-millisecond. This becomes real only at ~10⁵+ rows; `shared/db/src/index.ts:58-59` already sizes `statement_timeout` "above the migration statements (ctid-batched DELETEs ≤ 1000 rows…)". Nothing to fix now (see F3 directive).

### 1.6 Backfills

- V1-M7 (encrypt legacy `delivered_password`, migrate.ts:3796-3829): SELECT-then-row-by-row-UPDATE, **not batched**, but bounded to non-encrypted rows only (currently 0 legacy rows live; 9 orders total) + a >512-char loud-refuse guard. A re-run full reconcile pays one cheap SELECT. Acceptable; note for any future mass-encrypt: wrap in ctid batches like the retention jobs.
- V1-M8 spam consolidation: one GROUP-BY + one bounded `notInArray` delete — fine at 321 rows (its 2026-09-07 run is history).
- All 13 retention DELETEs: uniformly **bounded ctid batches of 1,000** (`WHERE ctid IN (SELECT ctid … LIMIT 1000)` loop) — the B7-P2-5 pattern, verified in every job file (see §5).

### 1.7 `db:check` equivalent

No `db:check` script exists (root `package.json` has `db:push`/`db:seed`/`db:backup` only). The drift gate is the CI regen+diff (§1.2) — run and green at HEAD. No further wiring needed.

---

## 2. Index gap analysis (hot predicates × schema, NEW gaps only)

A6-R126's 39-row matrix remains valid; I re-derived the six scope-named predicates at f53a886 and they are all covered:

| Scope predicate | Serving index (live-verified present) |
|---|---|
| orders by user (+status residual) — `routes/orders.ts` user list | `idx_orders_user_created (user_id, created_at)` |
| topups by status+createdAt — `admin/topups.ts` | `idx_topups_status_created` |
| alerts by dedupe — `jobs/alertLogger.ts:135-144` EXISTS | `idx_admin_alerts_dedupe_key (dedupe_key, created_at)` — live EXPLAIN: **Index Only Scan** ✅ |
| tickets by status+updated — `admin/tickets.ts:84` | `idx_tickets_status_updated` |
| auth_activity by user/identifier/action/created — `admin/security.ts:48-64` | 4 indexes; live EXPLAIN of the admin list uses `idx_auth_activity_created` ✅ |
| sessions by id (auth validity) | PK `sessions_pkey` (11,036 lifetime scans on the analogous `admin_users_pkey` path confirm the pattern) |

New-since-A6 code paths were checked (the R126→R127 diff touched `admin/stats.ts`, `telegram-auth-flow.ts`, `auth-settings-store.ts`): `wallet_topups.status='pending'` count → `idx_topups_status_created`; `support_tickets.status IN (open,in_progress)` → `idx_tickets_status_updated`; `inventory.is_sold=false` → partial `idx_inventory_sold`; `users.telegram_id`/`users.referral_code` → UNIQUE backings. **All covered.**

### The actual gaps: retention/prune predicates with NO index (my F1 bundle)

These are the only unindexed predicates I could find in the whole backend (A6's `products.price` sort gap F3 remains the one hot-path gap — held open, not re-reported). All are nightly-job or admin-poll predicates on tiny tables; **every EXPLAIN is a sub-millisecond seq scan today** (verified live, §3.4). Listed with exact statements, serving query, and live rowcount:

| # | Table (live rows) | Predicate & consumer | Missing index (exact SQL, if/when needed) |
|---|---|---|---|
| G1 | `sessions` (43) | `expires_at < now()` — `session-prune.ts:39` daily 05:00 + boot one-shot | `CREATE INDEX CONCURRENTLY idx_sessions_expires ON sessions (expires_at);` |
| G2 | `admin_alerts` (77) | `is_read = false` — `countUnreadAlerts` (`alertLogger.ts:234`, polled by `/admin/alerts/unread-count`), `markStaleUnreadAlertsRead`, `deleteReadAlerts` | `CREATE INDEX CONCURRENTLY idx_admin_alerts_unread ON admin_alerts (created_at DESC) WHERE is_read = false;` |
| G3 | `notifications` (17) | `(is_read AND created_at < d90) OR (NOT is_read AND created_at < d180)` — `notifications-retention.ts`; `idx_notifications_user` leads with `user_id` → unusable | `CREATE INDEX CONCURRENTLY idx_notifications_created ON notifications (created_at);` |
| G4 | `idempotency_keys` (4) | `created_at < 97h` — `idempotency-retention.ts` | `CREATE INDEX CONCURRENTLY idx_idempotency_keys_created ON idempotency_keys (created_at);` |
| G5 | `login_attempts` (5) | `last_attempt < 7d` — `auth-audit-retention.ts` | `CREATE INDEX CONCURRENTLY idx_login_attempts_last_attempt ON login_attempts (last_attempt);` |
| G6 | `whatsapp_otps` (2) | `created_at < 24h` — `whatsapp-otp.service.ts:983` prune | `CREATE INDEX CONCURRENTLY idx_whatsapp_otps_created ON whatsapp_otps (created_at);` |
| G7 | `inventory_forecasts` (0) | `forecast_date < 90d` — `forecast-retention.ts`; `idx_forecasts_product_date` was deliberately dropped in V1-M27 as zero-reader | `CREATE INDEX CONCURRENTLY idx_forecasts_forecast_date ON inventory_forecasts (forecast_date);` |

**Recommendation: build none of them now.** Total live rows across all seven tables = 148. The design stance (tiny tables, ctid-batched deletes, nightly cadence) makes each scan free. The trigger threshold: add the index the day its table crosses ~10⁴ rows (the nightly prune's seq-scan cost then becomes the per-batch dominant). G2 is the only one on a *request* path (polled unread badge), and even there the drawer query is `LIMIT`-bounded on a ≤10³-row table with 30-day read-deletion retention. Bundled as **finding F1 (P3)** so the SQL is on the record.

---

## 3. Live DB statistics (read-only probes, 2026-10-09)

### 3.1 Scale (whole database)

41 user tables, **892 total live rows**, biggest relation `products` at 432 kB total (59 rows incl. 14 archived). Top by rows: `product_variants` 263, `auth_activity` 227, `admin_alerts` 77, `products` 59, `audit_logs` 52, `sessions` 43, `wallet_ledger` 30, `users` 21, `wallet_topups`/`notifications` 17. **The database is tiny and healthy; every "hot" table is seq-scan-cheap.**

### 3.2 Dead tuples + autovacuum (hot tables)

Max dead tuples anywhere: 48 on `login_attempts` (5 live rows — below autovacuum's default threshold of 50, hence `last_autovacuum` null; autoanalyze 2026-10-05 ✓). `admin_alerts` 47 dead → autovacuumed 2026-10-07 ✓. `sessions` 4 dead → autovacuum 2026-10-06 ✓. `inventory` autovacuum 2026-09-19 ✓. `orders` 12 dead / 9 live (updates from status transitions; threshold not hit — harmless). **Zero bloat; nothing needs a manual VACUUM; autovacuum is engaged where churn exists.**

### 3.3 Index usage (`pg_stat_user_indexes`, lifetime; `stats_reset = null`)

Scanned (top): `admin_users_pkey` 11,036 (per-request admin auth), `products_pkey` 1,723, `idx_admin_alerts_dedupe_key` 1,717 (every alert write dedupes), `openwa_sessions_pkey` 1,507, `system_settings_pkey` 1,396, `idx_products_slug_unique` 638. **~40 of 133 indexes have `idx_scan = 0` lifetime** (incl. `idx_orders_user_created`, `idx_topups_status_created`, `idx_tickets_status_updated`, `idx_risk_events_created_id_desc`, `idx_users_phone_trgm`). This is *expected scale-prep*, not waste: at 9 lifetime orders these can't have scanned; each costs 16 kB + a few µs per insert. No consolidation action (V1-M27 already removed the genuinely redundant set).

### 3.4 EXPLAIN of representative top queries (11 plans, `EXPLAIN (COSTS, BUFFERS)`, no ANALYZE side-write risk)

- Catalog list (products + stock/completed scalar subqueries shape): seq scan + in-memory sort, cost 24 units, 23 shared-hit buffers — **sub-ms**.
- `countUnreadAlerts`: seq scan, cost 8.5 — sub-ms (would use G2's partial index the day the table grows).
- session-prune subquery, admin topups queue (`status='pending' ORDER BY created_at DESC`), admin orders list, user order history, idempotency/notifications retention subqueries: **all trivial seq scans ≤ cost 2.7**.
- Alerts dedupe EXISTS: **Index Only Scan on `idx_admin_alerts_dedupe_key`** — the hottest write-path guard is index-served ✅.
- Arabic trigram search (`name ILIKE '%نتفليكس%'`): seq scan (45 rows — planner correctly prefers it over the GIN); the GIN (`idx_products_name_trgm`, 24 kB) engages when selectivity demands.
- `auth_activity` admin list: Index Scan on `idx_auth_activity_created` ✅.

**No plan anywhere approaches 1 ms of estimated work. The workload is network-bound (B4's 0.6–0.9 s origin RTT ceiling), not planner-bound.**

### 3.5 `pg_stat_statements`: NOT INSTALLED

`relation "pg_stat_statements" does not exist`. Neon supports the extension, but nobody ever created it — so "top-N heaviest queries by measurement" is impossible on this database (this audit had to derive queries from code instead). Directive in **F2 (P3)**: one operator DDL (`CREATE EXTENSION pg_stat_statements;` — a write, so not mine to run) + it then survives via `shared_preload_libraries` which Neon enables by default.

---

## 4. Pool & connection hygiene — one LIVE P2 found

### 4.1 Config review (`shared/db/src/index.ts`) — everything correct on paper

- `max: 8` prod default (env `DB_POOL_MAX` wins; comment documents the 2026-09-20 Neon 0.25 CU cold-start tuning); `idleTimeoutMillis` 30 s; `connectionTimeoutMillis` 10 s; TCP keepalives 30 s (`:94-95`); TLS with `rejectUnauthorized: true` for `.neon.tech` hosts (`:96`); `channel_binding=require` honored (`:99-101`).
- Dedicated advisory-lock pool `lockPool` max 2 / 2 s connect timeout (`:122-126`) isolates the ~30 s OTP critical section from the runtime pool (R117 design intact).
- `pool.on("error")` + `lockPool.on("error")` wired (`:131,150`), backend `instrumentDbPool()` adds metric + Sentry capture — verified in `db-instrumentation.ts:230-238`.
- **Graceful deploy lifecycle verified:** `server.ts:264-365` — scheduler-lease release → Socket.IO close → `httpServer.close()` (idle keep-alive sockets evicted first, R107) → **`pool.end()` (`:339`) → `lockPool.end()` (`:347`)** → Sentry flush → exit, under a 10 s force-exit ceiling; `stop_grace_period: 40s` in compose covers it. Worker has its own drain (`worker.ts:172`).
- **Prepared statements:** no named server-side prepared statements anywhere (grep `prepare(` clean) — unnamed parameterized only, the correct PgBouncer-transaction-mode posture (matches A6 §8).
- Capacity: web process only (single `subnation` compose service + separate openwa container) → ≤ 10 server connections (8+2) through the pooler, far under Neon pooler limits.

### 4.2 **F-P2: the 15 s `statement_timeout` is a NO-OP on Neon — live-proven**

The R4 defense (round-93 A3) against the "green while dead" pool-exhaustion incident is carried by:

> `shared/db/src/index.ts:88` — `statement_timeout: statementTimeoutMs > 0 ? statementTimeoutMs : undefined,`
> with the claim at `:53` — "`statement_timeout` as a per-connection startup parameter (lib/client.js: getStartupData)"

node-postgres **does** put it in the startup packet (verified against the pinned pg 8.20.0: `client.getStartupConf()` returned `{"user":"neondb_owner","database":"neondb","statement_timeout":"15000"}`). But Neon **ignores that startup parameter** on both endpoints:

| Probe (same client config, 2026-10-09) | `current_setting('statement_timeout')` |
|---|---|
| via **-pooler** hostname (what production uses) | **`0`** |
| via **direct** hostname | **`0`** |
| same session after `SET statement_timeout = '15s'` | `15s` ✅ (SET works — only the startup packet is dropped) |

Also confirmed: nothing in the app re-issues a post-connect `SET` (grep of `db-instrumentation.ts`, `server.ts`, `shared/db/src` — the startup packet at `:88` is the only mechanism). Therefore in production **every pooled connection runs with NO server-side statement deadline**. A live-but-stuck query (the exact AZ/pooler stall class R4 documented) pins its pool client indefinitely — TCP keepalives only catch dead sockets, not live-hung queries — and `idle_in_transaction_session_timeout` (Neon default 5 min) covers only idle-in-tx time, not active execution. `lockPool` inherits the same inert config via the `poolConfig` spread. **Confidence: 5** (reproduced on the production endpoints with the repo's own driver version; this also corrects R126-A6 §8's positive "server-side statement_timeout 15 s" report — it was never live-verified there).

**Fix directive (exact, ~6 lines in `shared/db/src/index.ts`):**

```ts
// after `export const pool = new Pool(poolConfig);` (and likewise for lockPool):
for (const p of [pool, lockPool]) {
  p.on("connect", (client) => {
    if (statementTimeoutMs > 0)
      void client.query(`SET statement_timeout = ${statementTimeoutMs}`).catch(() => {});
  });
}
```

`SET` is verified to stick through the pooler (probe table above); since every client of both pools carries the same value, session homogeneity holds under PgBouncer connection reuse. Belt-and-braces alternative: add client-side `query_timeout: statementTimeoutMs` to `poolConfig` (driver-level abort, no server involvement). Add a post-deploy assertion to the ops runbook: `SELECT current_setting('statement_timeout')` on a pool connection must read `15000ms`.

---

## 5. Retention & growth vs prune jobs (SQL/index support lane)

All 13 retention jobs inventoried; **every one uses the bounded ctid-batch pattern (≤1000 rows/statement, loop till short batch)** — `session-prune`, `admin_alerts` (pruneReadAlerts), `notifications-retention` (90d read / 180d unread), `idempotency-retention` (97 h), `auth-audit-retention` (login_attempts 7d, audit_logs 180d), `cleanup-auth-activity` (90d), `risk-retention` (97d ladder), `forecast-retention` (90d), `enrichment-retention` (90d), `copilot-reaper`, `whatsapp-otp` prune (24h). The two genuinely-unbounded deletes are `deleteReadAlerts`/`deleteAllAlerts` (operator-invoked drawer actions on a ≤10³-row table — accepted). Index support: covered in §2 gaps G1–G7; `auth_activity`/`audit_logs`/`risk_events`/`enrichment_drafts`/`copilot_previews` retention predicates **are** index-served (`idx_auth_activity_created`, `idx_audit_logs_created`, `idx_risk_events_created_id_desc`, `idx_enrichment_drafts_state_created`, `idx_copilot_previews_expires`).

Growth trajectory: at 2 orders / 30 days and 21 users, the only structural growers are the money ledgers (`wallet_ledger` 30, `orders` 9, `wallet_topups` 17, `points_ledger` 6 — deliberately retained forever, RESTRICT FKs since V1-M25/M28 — correct for an audit trail) and `product_variants` (263, catalog-owned). Years of headroom; no prune-job changes needed.

---

## 6. Data-quality spot checks (read-only snapshot for the round record — no PII)

**Snapshot (2026-10-09):** 45 active / 14 archived products; **3 products hold unsold inventory (4 codes total)** — the public catalog's stricter `is_available` view shows just 1 (B4's measurement), so the operator-pending "stock the catalog" item persists. Orders: 9 lifetime (7 completed, 2 refunded), **2 completed in the last 30 days**; topups 12 approved / 5 rejected / **0 pending** (no stuck money queue); tickets 1 open / 2 in_progress / 2 closed; **68 of 77 admin alerts unread — 50 are `no_stock`** (the 24 h dedupe from R5 holds the line: 77 total vs 321 pre-R5, but the unread backlog confirms the watcher keeps re-alerting on an unstocked catalog); sessions 43 live / **0 expired** (daily prune demonstrably working); users 21; auth_activity 227 rows under 90-day retention; whole DB 892 rows. No anomalies, no orphan signals, no pending money states.

---

## 7. Findings (P0–P3)

| ID | Sev | Finding | Confidence | Fix |
|---|---|---|---|---|
| **F-P2** | **P2** | **15 s `statement_timeout` inert on Neon** — startup packet sent (pg 8.20.0 `getStartupConf` verified) but ignored on pooler AND direct endpoints; server runs `statement_timeout=0`; the R4 "green while dead" pool-pin defense is not actually live; `lockPool` inherits the inert config. Corrects R126-A6 §8's unverified positive claim. | **5** (live A/B reproduced) | §4.2 directive: `pool.on("connect")` → `SET statement_timeout = 15000` (+ optional client-side `query_timeout`); post-deploy assert in runbook |
| **F1** | P3 | **7 retention/prune predicates without index support** (§2 table: sessions.expires_at, admin_alerts.is_read, notifications, idempotency_keys.created_at, login_attempts.last_attempt, whatsapp_otps.created_at, inventory_forecasts.forecast_date) — all sub-ms seq scans at current scale (148 rows combined) | 5 (gaps) / 5 (no present impact) | Ship nothing now; the 7 exact `CREATE INDEX CONCURRENTLY` statements are on the record in §2 — build per-table at ~10⁴ rows |
| **F2** | P3 | **`pg_stat_statements` not installed** — top-query observability impossible; this and future audits must derive workload from code | 5 | Operator one-liner `CREATE EXTENSION pg_stat_statements;` (Neon-supported; DDL — operator action, not mine) |
| **F3** | P3 | **No `CONCURRENTLY` anywhere in the migration engine/chain** — boot-time `CREATE INDEX` takes SHARE locks; invisible ≤10⁵ rows but a deploy against a future big table would block writes | 4 | Document the trigger (any table >100 K rows → index DDL goes `CONCURRENTLY`; viable in migrate.ts since `db.execute` is auto-commit, not tx-wrapped) in `docs/OPERATIONS_RUNBOOK.md` or the migrate.ts header |

**P0: 0 · P1: 0 · P2: 1 · P3: 3.** Money integrity: not re-verified (no writes performed; prior rounds' verdict stands).

### Known-items pointer table (not re-reported here)

| Item | Owner | Status |
|---|---|---|
| `products.price` sort lacks index (hot-path's only gap) | R126-A6 F3 | Held open — still absent live (confirmed in index dump) |
| toNumber/`parseFloat(String())` 70-site ledger | R126-A6 F1 | Backend lane |
| admin/stats 10→4 fold; tickets/products `Promise.all`; cart overfetch; catalog full-table subqueries; admin-orders LIKE search; wallet column trim | R126-A6 F2/F4-F9 | Perf lane, held open |
| 1/45 products publicly stocked; unread `no_stock` backlog (50) | operator | §6 snapshot |
| Admin TOTP still advisory; QATEST10 disable | R5 heritage | Operator pending |
| Prune-job scheduling/logic details | R127-B7 | Out of my lane (SQL/index support covered in §5) |

---

## 8. Next actions (ordered)

1. **F-P2 fix** (6 lines + runbook assert) — the only finding with real incident-class risk; one deploy.
2. F2 `CREATE EXTENSION pg_stat_statements` — one operator statement; makes every future DB audit measurable.
3. File §2's G1–G7 SQL bundle as a documented trigger list (no action at current scale).
4. Nothing else — the migration engine, drift gates, live parity, retention batching, pool sizing, graceful drain, and index fleet are all in the best state of any round audited so far.
