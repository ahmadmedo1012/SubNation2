# R134-A6 — Performance & Database audit + A8-F1 regen-wave scoping

- **Agent:** A6 perf-DB auditor (R134 comprehensive round), read-only
- **HEAD:** `5d5227c` (R133, deployed; working tree = HEAD, clean)
- **Method:** file:line evidence only — no builds, no DB connections, no
  code changes. drizzle-kit/drizzle-orm behavior verified by reading the
  installed toolchain sources (`drizzle-kit@0.31.9` bin.cjs serializer,
  `drizzle-orm@0.45.2` pg-core types), not by running generate.
- **Inputs read first:** `docs/inspection-r130/A8-database.md`,
  `docs/inspection-r126/A6-backend-performance.md`.

---

## Verdict

**SHIP-WORTHY. 0×P0, 0×P1, 0×P2, 4×P3 (one is the A8-F1 spec, deferred
by design), 4×P4.** No N+1, no unbounded query, no uncapped client
parameter on any hot route; the R132/R133 deltas (arabic-search round 2,
cart variant-pricing parity, admin state-truth trio) introduced **zero
query-shape regressions**. The A8-F1 regen wave is fully scoped below —
18 sites (not 19 — one site is provably convergent), ~35 min of careful
work, zero live-DB risk by construction.

---

## Part 1 — MANDATE 1: the A8-F1 DESC-index regen wave (implementation spec)

### 1.1 The divergence, precisely

drizzle-kit serializes a `.desc()` index column as
`"col" DESC NULLS LAST` (snapshot entry
`{"expression":"col","isExpression":false,"asc":false,"nulls":"last"}` —
verified in `meta/0020_snapshot.json` `public.orders.indexes.idx_orders_created`).
The boot twins in `backend/src/migrate.ts` create plain `DESC`
(= `DESC NULLS FIRST`, the Postgres default null ordering for DESC).
The declared shape is the divergent one; the live boot-created shape is
canonical (pinned in `shared/db/src/schema/index.ts:1-17`).

**Two facts that sharpen the R130 claim:**

1. **Every desc-indexed column is NOT NULL** (verified per-file:
   `createdAt`/`updatedAt`/`startedAt`/`state`/`outcome` all
   `.notNull()`, ids are PK/FK ints — e.g.
   `wallet_ledger.ts:43`, `support_tickets.ts:16-17`,
   `enrichment_runs.ts:26,29`, `admin_alerts.ts:20`). On NOT NULL
   columns `DESC` and `DESC NULLS LAST` produce **byte-different but
   order-identical** btrees — the wave's value is chain↔boot parity
   (one source of truth, closing the documented finding), not a live
   perf delta. R130's "a hair less optimal" is therefore cosmetic
   today; it becomes real only if a column ever turns nullable.
2. **One site is already convergent:** `risk.ts:105`
   (`idx_risk_events_created_id_desc`) — its boot twin
   (`migrate.ts:3883-3884`) is
   `ON risk_events (created_at DESC NULLS LAST, id DESC NULLS LAST)`,
   the r4 port of the 0005 shape verbatim, i.e. chain == boot for this
   index. Rewriting it would *create* a divergence. **Exclude it.**

**Correction to the R130 doc:** it attributes the `DESC NULLS LAST`
output to "drizzle-kit 0.45" — the installed toolchain is
**drizzle-kit 0.31.9** + **drizzle-orm 0.45.2** (pnpm-lock.yaml:3737;
`.pnpm/drizzle-kit@0.31.9`). The emitted shape is real either way (the
chain files are the ground truth); only the version note is wrong.

### 1.2 (a) The 18 divergent sites (file:line, declaration → target raw shape)

Boot-twin line refs are `backend/src/migrate.ts`.

| # | Site | Index | Declared today (chain file) | Boot twin (plain DESC) |
|---|------|-------|------------------------------|------------------------|
| 1 | `schema/admin_alerts.ts:35` | `idx_admin_alerts_created` | 0016:33 | :1416 |
| 2 | `schema/admin_alerts.ts:44-46` | `idx_admin_alerts_unread` (partial) | 0020:79 | :2228-2229 |
| 3 | `schema/audit_logs.ts:35` | `idx_audit_logs_created` | 0003:17 | :2718 |
| 4 | `schema/auth_activity.ts:34` | `idx_auth_activity_created` | 0012:33 | :2839 |
| 5 | `schema/copilot_actions.ts:83` | `idx_copilot_actions_admin_created` | 0012:34 | :3602 |
| 6 | `schema/copilot_previews.ts:92` | `idx_copilot_previews_admin_created` | 0012:35 | :3573 |
| 7 | `schema/enrichment_drafts.ts:66` | `idx_enrichment_drafts_state_created` | 0012:36 | :3772 |
| 8 | `schema/enrichment_runs.ts:50` | `idx_enrichment_runs_started_at` | 0012:37 | :3739 |
| 9 | `schema/enrichment_runs.ts:51` | `idx_enrichment_runs_outcome` | 0012:38 | :3741 |
| 10 | `schema/inventory_forecast_runs.ts:57` | `idx_forecast_runs_started_at` | 0012:40 | :3672 |
| 11 | `schema/inventory_forecast_runs.ts:58` | `idx_forecast_runs_outcome` | 0012:41 | :3674 |
| 12 | `schema/notifications.ts:39` | `idx_notifications_user` | 0017:25 (drop+recreate swap) | :1435 + :3080 |
| 13 | `schema/orders.ts:107` | `idx_orders_created` | 0012:43 | :3073 |
| 14 | `schema/referral_events.ts:32` | `idx_referral_referrer_created` | 0019:70 | :1756 |
| 15 | `schema/support_tickets.ts:27` | `idx_tickets_user_created` | 0019:71 | :1760 |
| 16 | `schema/support_tickets.ts:36` | `idx_tickets_status_updated` | 0017:24 | :1412 |
| 17 | `schema/wallet_ledger.ts:51` | `idx_wallet_ledger_created` | 0012:44 | :2817 |
| 18 | `schema/wallet_topups.ts:61` | `idx_topups_user_created` | 0019:72 | :1752 |
| — | `schema/risk.ts:105` | `idx_risk_events_created_id_desc` | 0005:2 | **EXCLUDED — twin is NULLS LAST too (:3883)** |

Grep verification: `rg '\.desc\(\)' shared/db/src/schema` → 20 column
occurrences across 19 declarations; 0 programmatic references to the
extra-config keys (`createdIdx`, `userCreatedIdx`, …) anywhere in
backend/frontend — the rewrite is purely declaration-level.

### 1.3 (b) Chain/snapshot files affected by the regen

**None of the existing files are touched.** The chain is append-only
history (`meta/_journal.json`: idx 0..20, tags byte-match filenames,
breakpoints true). The regen **adds**:

- `shared/db/drizzle/0021_<auto-name>.sql` — NEW file (next idx 21)
- `shared/db/meta/0021_snapshot.json` — NEW snapshot
- `shared/db/meta/_journal.json` — one appended entry

The 19 historical declarations live in 7 chain files
(0003:1, 0005:1, 0012:11 — one of which, `idx_forecasts_product_date`
at 0012:42, is already dead history: dropped in 0019:50 —, 0016:1,
0017:2, 0019:3, 0020:1 = 20 `NULLS LAST` occurrences total). All stay
byte-frozen. Snapshots 0000–0020 likewise stay frozen (snapshot N is the
input the next generate diffs against).

### 1.4 (c) The migration engine + chain discipline (read, verified)

**Boot engine** (`backend/src/migrate.ts`, 4,127 lines): ~31 stages
`V1-M1..V1-M31` called exactly once each from `runMigrations()`
(:3970-4111). LAST stage number = **V1-M31**
(`applyRetentionPruneIndexesStage`, :2212-2248 — the R127 retention
bundle, V1-M24 additive-twin form: unconditional `CREATE INDEX IF NOT
EXISTS`, zero-DDL steady state). **Next free number: V1-M32.**

**Probe-gated idiom family (V1-M27..M30, R123-E5):**
- V1-M27 `applyIndexConsolidationStage` (:1664-1800): 3 unconditional
  `CREATE INDEX IF NOT EXISTS` + 16 probe-gated DROPs — one
  `pg_indexes` read, drop only what exists (V1-M15 duplicate-cleanup
  form).
- V1-M28 `applyReferralFksRestrictStage` (:1803-1910): per-column
  orphan-count probe → Arabic alert + skip (V1-M9 short-circuit), then
  `DROP CONSTRAINT IF EXISTS` + DO-block `ADD … RESTRICT`.
- V1-M29 `applyDomainCheckConstraintsStage` (:1915-2023): count-then-add
  CHECKs, V1-M9 idiom verbatim.
- V1-M30 `applyOrganizationsRemovalStage` (:2026-2128): any-name FK
  sweep (V1-M20 idiom) + existence probe + `DROP … IF EXISTS` belt.

**Drizzle mirror discipline:** every boot stage is mirrored into the
schema TS + chain so the declarative track stays truthful. Precedents:
- **0015 mirror re-emit** (commit `e394815`, "chore(schema,r117):
  Drizzle 0015 mirror re-emit"): boot V1-M23 (`wallet_topups.reviewed_by`,
  migrate.ts:1372-1382) mirrored 1:1 as chain `0015_smart_bruce_banner.sql`
  (`ALTER TABLE "wallet_topups" ADD COLUMN "reviewed_by" …`).
- **Post-r110 chain hardening idiom** (0013/0016/0017/0019/0020 headers):
  the generated SQL is hand-hardened — `DROP INDEX IF EXISTS` /
  `CREATE INDEX IF NOT EXISTS` — "so the chain is ALSO safe the day it
  IS applied" (0017:9-22).
- **guard-drizzle-push.mjs** (`shared/db/scripts/`, R122 A4-P1-1): the
  chain is **DECLARATIVE-ONLY — nothing in the repo executes it at
  runtime** (guard comment lines 5-10; R98 doc: "no `drizzle-kit
  migrate` script exists"). CI only regenerates + diffs it
  (`ci.yml:343-354` "Migration drift check": `drizzle-kit generate`
  with a synthetic `DATABASE_URL` (ci.yml:280) — generate never
  connects — then `git diff --exit-code -- shared/db`).

**0012 precedent for this exact wave:** `0012_clever_otto_octavius.sql`
is a same-name DROP+CREATE regen of 13 indexes (drizzle-kit emits the
pair when the index squash key `expression--isExpression--asc--nulls--
opclass` changes — bin.cjs:6399). This wave is the same class of diff.

### 1.5 (d) The exact fix (hand the main agent this)

**Step 1 — rewrite 18 declarations as raw sql expression columns.**
In each schema file, replace the `.desc()` column with a verbatim raw
expression (mixed columns are legal:
`.on(...columns: [Partial<ExtraConfigColumn> | SQL, ...])` —
drizzle-orm 0.45.2 `pg-core/indexes.d.ts:39`; in-repo precedent:
`flash_sales.ts:30` `.on(sql\`true\`)` has round-tripped the toolchain
since 0003):

```ts
// before (orders.ts:107)
createdIdx: index("idx_orders_created").on(t.createdAt.desc()),
// after
createdIdx: index("idx_orders_created").on(sql`created_at DESC`),
```

Per-site column text (matches the boot twins' bytes exactly —
unquoted, uppercase `DESC`):

| Sites | Rewrite |
|---|---|
| #1 | `.on(sql`created_at DESC`)` |
| #2 | `.on(sql`created_at DESC`).where(sql`is_read = false`)` (where clause unchanged) |
| #3, #4, #13, #17 | `.on(sql`created_at DESC`)` |
| #5, #6, #18 | `.on(t.adminId / t.userId, sql`created_at DESC`)` |
| #7 | `.on(t.state, sql`created_at DESC`)` |
| #8, #10 | `.on(sql`started_at DESC`)` |
| #9, #11 | `.on(t.outcome, sql`started_at DESC`)` |
| #12 | `.on(t.userId, sql`created_at DESC`)` |
| #14 | `.on(t.referrerId, sql`created_at DESC`)` |
| #15 | `.on(t.userId, sql`created_at DESC`)` |
| #16 | `.on(t.status, sql`updated_at DESC`)` |

Toolchain proof (drizzle-kit 0.31.9 bin.cjs:26741 — the index-column SQL
emitter): `isExpression` columns emit the expression text **verbatim** —
`sql\`created_at DESC\`` → `USING btree (created_at DESC)`, no
appended ` NULLS …` (the nulls suffix applies only to non-expression
columns). Snapshot stores
`{"expression":"created_at DESC","isExpression":true,"asc":true,"nulls":""last"}`
and printSchema round-trips it back as `` sql`created_at DESC` ``
(bin.cjs:86036-86040), so future regens are stable.

**Step 2 — regen:** `pnpm --filter @workspace/db exec drizzle-kit
generate` (DATABASE_URL must be *set* — any string — but is never
contacted). Emits `0021_*.sql` with 18 same-name
`DROP INDEX "x";→ CREATE INDEX "x" ON … (… DESC);` pairs + the new
snapshot + journal entry. Nothing else diffs (the drift gate is green
at HEAD: schema TS == snapshot 0020).

**Step 3 — hand-harden 0021** (r110 idiom, 0017 precedent): make every
drop `DROP INDEX IF EXISTS` and every create `CREATE INDEX IF NOT
EXISTS`, with a header comment in the 0017 house style explaining the
wave (A8-F1 close-out: declared shape converges to the boot twins'
plain DESC; chain stays declarative-only; live DB untouched — names
parity, IF NOT EXISTS no-ops).

**Step 4 — update the pinned-convention comment**
(`schema/index.ts:1-17`) to the landed state: plain DESC canonical,
raw-sql expression columns are the canonical *spelling*, risk.ts:105
documented as the intentional NULLS-LAST twin-parity exception.

**Step 5 — gates:** typecheck (mixed SQL columns are typed-legal),
lint, backend vitest (schema suites), CI drift check re-runs generate
→ no diff. Commit.

**Effort:** 18 one-line edits + comment + regen + hand-harden ≈ 30-45
min. **Risk: LOW** (declarative-only track; CI-gated byte-for-byte).

### 1.6 Safety argument — does the regen re-execute anything against live?

**NO, on four independent grounds:**

1. `drizzle-kit generate` is a **local offline diff** (schema TS vs
   `meta/0020_snapshot.json`). It never opens a connection — CI runs it
   with `DATABASE_URL: postgres://ci:ci@localhost/ci` (ci.yml:279-280).
2. **Nothing in the repo executes the chain.** No `migrate` script
   exists in `@workspace/db` package.json (only `push`/`push-force`,
   both behind `guard-drizzle-push.mjs`); runtime schema flows
   exclusively through `migrate.ts` boot stages (guard:5-10).
3. **Even a hypothetical manual `drizzle-kit migrate` against live is
   guarded by the hardened 0021:** every live index already exists
   under the same names (boot twins, table in §1.2), so each
   `DROP IF EXISTS + CREATE IF NOT EXISTS` pair rebuilds each index
   once under a SHARE lock — sub-millisecond at current rowcounts
   (~10²-10³ rows; same NOT-CONCURRENTLY decision class as V1-M31,
   migrate.ts:2201-2208).
4. **The only live effect is by design and bounded:** the regen changes
   the boot fingerprint's schemaHash (build.mjs hashes
   `shared/db/src/schema/*.ts` + the whole chain incl. `meta/*`,
   build.mjs:29-30,57-74) → the next deploy takes **one full boot
   reconcile** instead of the fast-path — ~141 guarded no-op round
   trips (IF NOT EXISTS / probes), the r110-designed behavior for any
   schema edit, then the new marker persists.

### 1.7 A8-F2 note — trivially combinable with this wave (appended per mandate)

`idx_wallet_ledger_type` (`schema/wallet_ledger.ts:49`) still has zero
predicate consumers at HEAD (verified: `wallet.ts:209` reads `e.type`
for a display label only; no WHERE/ORDER BY on `wallet_ledger.type`
anywhere). If the operator wants it closed in the same round: add boot
stage **V1-M32** (probe-gated `DROP INDEX IF EXISTS idx_wallet_ledger_type`
after a `pg_indexes` probe, V1-M27 drop idiom) + delete the
`schema/wallet_ledger.ts:49` declaration in the SAME schema edit — the
single `generate` run then folds its `DROP INDEX` into 0021 alongside
the 18 pairs. If kept separate, A8-F1 needs no boot stage at all.

---

## Part 2 — MANDATE 2: query patterns (hot routes)

### 2.1 N+1 sweep — CLEAN (delta since R126 verified by diff)

`git diff 186b131..5d5227c -- backend/src/routes` shows the only
query-shape-relevant changes are products.ts (R132 arabic-search),
cart.ts (R133 A7-F2), notifications.ts (R128 ?page=), wallet.ts,
admin/audit-logs.ts (new R127-L5). All verified batched:

- **Products list/search/category** (`routes/products.ts:305-601`):
  unchanged 2-stage shape — S1 main join ∥ flash-sale, S2 batched
  variants ∥ per-pool stock GROUP BY (`fetchVariantPoolData`
  :114-168, two `inArray` queries, ≤500 ids). R132 additions are
  bounded: `MAX_TOKENS_CONSIDERED=8`, `MAX_TRANSLIT_TERMS=3`
  (`lib/arabic-search.ts:404-405`), every branch escapeLikeTerm'd,
  all inside the `LIMIT 500` (:489). Relevance ORDER BY (:518-521) is
  computed over the same bounded branch set — no extra queries.
- **Cart GET** (`routes/cart.ts:107-158`): H19 batched (cart rows →
  one products `inArray` + one variants `inArray` + cached flash
  sale). The R133 A7-F2 change is a WHERE tightening
  (`isActive = true` on the variant pool, :126-136) — strictly less
  work.
- **Notifications** (`routes/notifications.ts:38-93`): bell branch =
  one capped query (LIMIT 40, :60); paged branch = one page + one
  count in a Promise.all (:70-82). No N+1.
- **Admin lists** — topups (`admin/topups.ts:88-104`, single
  left-join + user identity columns), orders (`admin/orders.ts:237-260`,
  single 2-join + escapeLikeTerm'd palette search), audit-logs
  (`admin/audit-logs.ts:129-159`, page+count pair + attribution join)
  — all single-query, no loops.
- **telegram-auth-flow** (new since R126, `services/telegram-auth-flow.ts`):
  sequential single-row lookups + one tx (:73-153) — no N+1.

### 2.2 SELECT column bloat — PASS

List/grid paths carry explicit tight projections
(`products.ts:469-481` + the A2-F3 `fields=list` split :578-592;
recommendations `products.ts:876-898` selects 5 columns + LIMIT 4).
Full-row `select()`s are confined to single-row lookups whose DTOs
consume most columns (detail-by-slug :713-730 — description/usage
terms/SEO fields all used by the detail DTO), per-user small tables
(cart, notifications — 8 columns, all in the DTO), and the admin money
queue (`topup: walletTopupsTable` + 7 user columns — the DTO reads
~all of them). No hot-path bloat found.

### 2.3 LIMITs / client-triggerable unbounded queries — PASS, no new uncapped param

- Products list hard ceiling LIMIT 500 (:486-489); slug length guard
  ≤160 (:694-697); slug served by `idx_products_slug_unique`
  (schema/products.ts:41-43).
- All `?page=` consumers route through `pageParam` (floor 1, ceiling
  MAX_PAGE=10,000 — `lib/http.ts:69-75`, 12 call sites verified).
  Every `?limit=` is clamped: loyalty/wallet ≤200
  (loyalty.ts:306-307, wallet.ts:187-188), admin risk ≤200
  (risk.ts:118-120), forecast ≤50 (forecast.ts:54-56), enrichment ≤50
  (enrichment.ts:74-76), copilot history ≤MAX_LIMIT (history.ts:43-45),
  notifications ≤100 (notifications.ts:22,66).
- R132/R133 introduced **zero** new client-facing numeric params
  (diff-verified; the R132 compound-search surface is parameter-bounded
  by construction, §2.1).
- Catalog cache key space: still bounded (no-search-only caching,
  B6-02 — products.ts:352-360,599; `listView` rides the key per A2-F3).

### 2.4 Catalog projection (R124) coherence after R132/R133 — PASS

The list/detail projection split is intact and still tested
(`__tests__/variant-availability-pricing.test.ts:149` "list DTO (the
grid's fields=list projection) agrees with the detail price"). R132's
ranking touched ordering only (result sets unchanged — products.ts:506-509);
R133's `displayBaseFromVariants` (products.ts:546-549) changed the
*price semantics* of the card (availability-aware cheapest) in both
projections symmetrically, and the cart GET parity change (§2.1) keeps
the cart pricer on the same active-variant pool. Coherent.

### 2.5 Inherited scale-watch (carried, unchanged)

- **R126-A6 F7** (carried): the list loader's stock/order aggregate
  subqueries are uncorrelated full-table GROUP BYs joined to the
  bounded product set (`products.ts:441-459`). Fine at catalog scale
  (~10¹ products); revisit if inventory/orders grow 10³×.
- **R126-A6 F3 / R130 carried**: `?sort=price_asc|price_desc`
  (products.ts:492-493) has no `products.price` index (schema has only
  category/active-category/trgm — products.ts:103-117). In-memory sort
  on ≤500 rows; harmless, still the documented open item.

---

## Part 3 — MANDATE 3: boot + worker efficiency

### 3.1 Boot one-shot roster — final state (R132), verified

`jobs/boot-one-shots.ts`: **17 entries**, strictly sequential
(cold-start query-storm guard), fire-and-forget at leader start with a
7 s post-leadership deferral (`BOOT_ONE_SHOT_DELAY_MS`,
lib/web-scheduler.ts:133-137 — retention DELETEs never race first
user requests through the 8-connection pool). Per-kind retry truth
roster (`BOOT_ONE_SHOT_RETRY_KINDS` :84-102: 10 cron / 5 opportunistic
/ 2 boot-only) + per-failure Sentry capture under the cron-tag contract
(:120). R132's fix was test-harness truth (fake clocks + the 3 missing
job mocks — CHANGELOG:111-127), not a production behavior change; the
production roster is as documented. Scheduler economics: production
runs `SINGLE_INSTANCE_MODE=true` → **zero periodic Neon coordination
queries** (no PG-lease heartbeat; web-scheduler.ts:44-68), election
machinery env-gated intact.

### 3.2 Cron schedules — verified (all UTC-pinned, independent try/catch, per-job Sentry tags)

`jobs/cron.ts`: 00:00 admin-alert retention (:57) + idempotency_keys
48h retention (:90); 00:05 TOTP advisory (:122); 02:15 forecast runner
(WORKER_TIER-gated, :316); 03:30 risk-events 90d (:278); 03:35 forecast
retention (gated, :337); 03:50 enrichment runner (gated, :361); 04:00
enrichment retention (gated, :378); 04:30 auth-activity 90d (:401);
05:00 sessions block — user sessions + admin sessions + notifications
90/180d + login_attempts 7d + audit_logs 180d, five independent
try/catches (:143-239). No two heavy jobs share a minute. The R117
claims hold.

### 3.3 statement_timeout — TRUTHFUL

`shared/db/src/index.ts:144-181`: post-connect
`SET statement_timeout = 15000` on **both** pools (runtime `max:8`
prod-fallback + `lockPool max:2`), R127 finding that Neon drops the
startup-packet parameter, R128-B3-F1 failure **logging** with pool
identity (deliberate console.error — workspace-dependency direction
documented :162-170). `PG_STATEMENT_TIMEOUT_MS` env escape hatch;
`resolveStatementTimeoutMs` guards NaN/negative (:80-84). One nuance:
the 15 s ceiling vs the 7 s boot-one-shot deferral and ctid-batched
DELETEs ≤1000 rows — sized correctly (comment :58-62).

### 3.4 Cache layers — verified

- **Catalog cache** (`lib/catalog-cache.ts`): generation-counter
  in-process cache, single-instance-correct (SINGLE_INSTANCE_MODE
  note :31-36), 200-only semantics, admin-CRUD generation bumps. Call
  sites: list 30 s / stats 60 s / flash-sale 30 s / **detail-by-slug
  60 s** (R122, products.ts:705) / detail-by-id 60 s (:779) /
  recommendations 60 s (:857). Search stays uncacheable (B6-02).
- **Auth providers** (`routes/auth-settings.ts:157-187`): 60 s
  cacheWrap + `Cache-Control: s-maxage=60, stale-while-revalidate=300`;
  the R119-B2 invalidation is an **awaited** `cacheDelete
  (AUTH_PROVIDERS_CACHE_KEY)` after every admin PATCH upsert (:627-635),
  single shared constant so rename can't drift (:159-163). TTL
  composition documented in-file.
- **Redis absence**: in-memory LRU fallback documented + bounded
  (lib/cache.ts:9,89-103); opportunistic sweeps are traffic-triggered
  with throttles (lib/opportunistic.ts family).

### 3.5 Socket rooms — efficient

`lib/socket.ts`: server-driven room joins on connect only
(`user:<verified-id>`, `admin-room`, scope-gated `admin-alerts-room`
:991-1019 — never trusts client payloads); per-IP + total concurrent
connection caps checked **before** gauge/timers/rooms with polite
event + hard disconnect (:960-990); 5-min identity re-verify with
leave-room-on-revoke (:738-817); emissions are room-targeted only
(`io.to(user:${id})` :1137, `io.to("admin-room")` :1147,
`io.to(ADMIN_ALERTS_ROOM)` :1159 — no `io.emit` broadcasts). One async
admin-permissions read per admin connection for the alert-room scope
(bounded, best-effort, reconciled on re-verify) — the only per-connect
DB cost, by design.

---

## Part 4 — Budget gate + build record (read-only, per mandate)

- **Gate config** (`frontend/vite.config.ts:14-36,160-205`): entry
  chunk hard-fail >56,320 B gz (55 KiB); **eager-path sum** (every
  modulepreload chunk + entry + styles from `dist/public/index.html`)
  hard-fail >163,840 B (160 KiB), warn >147,456 B (145 KiB), CSP
  src-less-inline-script gate included.
- **Latest record** (CHANGELOG.md:92-97, R133 tree): `pnpm build` green
  — eager path **144,296 B gz** (PASS, +23 B vs R132; ~1.2 KiB under
  the warn line, ~19.5 KiB under hard-fail).
- **New heavy imports since R126:** none in backend (new modules are
  drizzle/sentry/logger-local: telegram-auth-flow.ts:15-30,
  auth-settings-store.ts:17-18). No frontend build run (mandate) —
  the R133 a11y/cart diffs are component-level; no new barrel/lazy-gate
  violations visible in the diff surface.

---

## Findings (ranked)

### A6-F1 [P3 — SPEC READY] A8-F1 DESC-index regen wave — full implementation spec delivered (Part 1)
18 divergent `.desc()` sites (19th — risk.ts:105 — provably convergent,
excluded); raw `sql\`col DESC\`` expression rewrites; append-only regen
(0021 + snapshot + journal); hand-harden per 0017 idiom; zero live-DB
contact (4-ground safety argument §1.6); effort 30-45 min. Optionally
fold A8-F2's V1-M32 into the same generate (§1.7). **This is the round's
work item — nothing else below is.**

### A6-F2 [P3 — CARRIED, unchanged] R126-A6 F7: uncorrelated full-table GROUP BY subqueries in the products list join — products.ts:441-459
Scale-watch only; bounded by catalog size today.

### A6-F3 [P3 — CARRIED, unchanged] R126-A6 F3 / R130: `?sort=price_*` has no products.price index — products.ts:492-493
In-memory top-N sort on ≤500 rows; index only if the catalog balloons.

### A6-F4 [P3 — DOC] R130-A8 version note wrong: `DESC NULLS LAST` emitter is drizzle-kit 0.31.9 (not "0.45"); drizzle-orm is 0.45.2 — pnpm-lock.yaml:3737 + §1.1
Fold the correction into the A8-F1 commit message / schema/index.ts
comment rewrite (Step 4) so the record stops propagating it.

### A6-F5 [P4 — NUDGE] 0021 hand-hardening keeps DROP-then-CREATE order; on a future real chain application the same-name pair rebuilds each index once (SHARE lock, non-CONCURRENTLY) — same documented decision class as V1-M31 (migrate.ts:2201-2208)
No action needed beyond keeping the header comment honest (§1.5 Step 3).

### A6-F6 [P4 — OBSERVATION] boot reconcile on the A8-F1 deploy: the schemaHash change forces exactly one full ~141-statement no-op reconcile (fast-path miss) — r110-designed, seconds, first-boot-only — build.mjs:29-30,57-74
Worth a line in the deploy notes so the "fingerprint changed — running
full reconcile" log line isn't mistaken for a regression.

### A6-F7 [P4 — VERIFIED-CLEAN] No new N+1 / uncapped param / SELECT bloat in the R127→R133 delta — §2.1-2.3
New/changed routes (admin/audit-logs, notifications ?page=, cart
parity, arabic-search round 2, telegram auth flow) all follow the house
batching/clamping idioms.

### A6-F8 [P4 — CARRIED, unchanged] A8-F3/F4 (payment_reference NULLability; run-metadata retention) — still correctly parked per R130 dispositions.
