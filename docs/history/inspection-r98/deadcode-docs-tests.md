> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r98/deadcode-docs-tests.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R98-A8 — Consistency / Dead-Code / Docs / Tests Audit

- Agent: R98-A8 (read-only; only this file + the worklog touched)
- Date: 2026-10-30
- Repo state audited: `8ce3fc8` (main)
- Scope: dead exports & orphan files · dead env vars (both directions) · unused deps · shared-types drift vs `res.json` · docs drift (must-fix vs historical) · test-suite health (skips / weak asserts / flaky patterns / coverage gaps) · build graph & script correctness · tsconfig / eslint / prettier sanity · scripts dir.
- Method: static reading only. Export/import graph built by scripted `rg` sweeps over **all** packages (backend/src, backend/tests, frontend/src, shared/*, scripts) **including** generated dirs; every "dead" claim below was re-verified with a second full-repo word-boundary grep (see caveat on display artifacts in §0.4). No tests/builds/tsc were run.

Environment assumed (verified in render.yaml): Render **free** (suspended by operator billing gate), Vercel frontend live, Neon live, **no Redis**, **no workers**.

Prior rounds NOT re-reported: catalog 51/45 reconciliation, openwa key-separation fix itself, runbook worker-less/free-tier sections + dormant-alert thresholds, deploy-truth 4-way comparison.

---

## 0. Verification methodology & one tooling caveat

- **0.1 Dead exports**: 831 named value/type exports extracted from `backend/src/{lib,services,jobs}`, `shared/*/src` (non-generated); for each, importers searched across backend/src + backend/tests + frontend/src + shared + scripts, then re-verified including `shared/*/src/generated` (orval output can reference custom-fetch generics — two candidates were "resurrected" this way and dropped).
- **0.2 Orphan files**: full import-graph resolution (relative, `@/` alias, `@workspace/*` package exports, side-effect `import "..."`, dynamic `import()`), minus entry points / config / tests / documented manual scripts.
- **0.3 Env vars**: `process.env.X` + `import.meta.env.X` reads vs definitions in `render.yaml` + `config/env.example` (exact-match both directions; substring false-matches eliminated).
- **0.4 Display caveat**: several tool outputs in this session displayed `[m` sequences as eaten (e.g. `enum: [mobile_transfer…]` rendered `obile_transfer`). Verified with `od -c` + a PyYAML parse: **`shared/api-spec/openapi.yaml` is byte-correct and parses fine** — the "obile_transfer typo" is NOT real and is NOT reported. Only byte-verified findings are below.

---

## 1. Dead code

### [P2] Orphan file: risk hard-block middleware is implemented, spec-marked done, and mounted NOWHERE — `backend/src/middlewares/risk-hard-block.ts:36`
- **Evidence**: `riskHardBlockMiddleware` has zero importers repo-wide (import-graph + direct grep; only mentions elsewhere are comments in `risk-soft-block.ts:23,239`). Not referenced in `backend/src/routes/index.ts`, `app.ts`, or any test file. Spec `specs/003-anomaly-detection/tasks.md:63` marks **T011a [x] done**.
- **Why it matters**: the spec's Phase-3 auto-block defense (423 on `hard_block` risk events) silently does not exist at runtime — the tasks list says it ships, an auditor reading the spec believes it ships. Its gate `RISK_PIPELINE_ENABLED` is documented (`config/env.example:283`, default `false`) but absent from `render.yaml`, so even an operator who sets it gains nothing — nothing calls the middleware.
- **Minimal fix**: either mount it on the non-purchase triggering actions the spec intends (e.g. topup submission, next to `riskSoftBlockGuardMiddleware()` in `wallet.ts`/`orders.ts`-adjacent non-critical paths) + one test, or move T011a back to `[ ]`/mark "implemented, unwired (Phase 3 pending)" in the spec and delete-or-keep with an explicit dormant banner.
- Note: soft-block (T011) IS mounted (`orders.ts:118`, `wallet.ts:134`) and tested — only the hard sibling is orphaned.

### [P3] 63 fully-dead exports (zero importers anywhere, not even own file) — full table in §9.1
Highlights:
- `backend/src/lib/jwt.ts:148` `verifyAdminToken` — every real verifier uses `verifyAdminTokenDetailed` (socket.ts:236, metrics.ts:47). The non-detailed variant predates the alg-pinning split.
- `backend/src/lib/opportunistic.ts:59` `resetOpportunisticMaintenanceForTests` and `backend/src/services/copilot/provider-config.ts:143` `__resetCopilotProviderForTests` — test helpers exported **for tests that never import them**.
- `backend/src/lib/metrics.ts` — `safeSet`, `workerJobsTotal`, `neonConnectionsActive`, `neonInflightQueries` (consistent with the runbook's already-documented "job-outcome counter not emitted yet" dormant rule).
- `backend/src/lib/logger.ts:monitoringLogger`, `lib/correlation.ts` (3 exports), `lib/risk-emit.ts` (2), `lib/telegram-gateway.ts:sendMessageWithKeyboard`, `lib/cache.ts:cacheInvalidatePrefix`, `lib/forecast/dates.ts:daysBetween`, `lib/pricing-config.ts:PRICING_SETTINGS_PREFIX`, `services/risk-metrics.ts:recordAdminToAction`, `shared/error-codes/src/index.ts:ALL_ERROR_CODES`, forecast constants `DOW_WINDOW`/`HISTORY_WINDOW`, `RunOutcome`.
- 40 of the 63 are drizzle-convention type exports in `shared/db/src/schema/*` (`InsertOrder`, `WalletTopup`, `RiskEvent`, `SystemSetting`, …) — generated by habit, never consumed.
- **Fix**: delete (or un-export) in a dedicated mechanical commit; zero behavioral risk by construction.

### [P3] 193 "internal-only" exports — export keyword unnecessary, code alive
Exported symbols whose only usage is inside their own module: `lib/audits/neon-audit.ts` (10), `lib/audits/render-audit.ts` (9), `copilot/tools/read.ts` (8), `lib/risk-metrics.ts` (8), `lib/audits/context7-audit.ts` (8), `copilot/anomalies.ts` (6), `lib/socket.ts` (6), `lib/inspection-runner.ts` (6), etc. Not dead code — but they widen the public surface of internal modules (grep noise, future "is this used?" audits). **Fix**: drop the `export` keyword opportunistically; no rush.

### [P1→false-positive avoided] `backend/src/db/seed/risk-rules.seed.ts` and `backend/src/lib/env.ts` are NOT orphans
- `env.ts` is side-effect-imported by `backend/src/index.ts:1` (`import "./lib/env"`).
- `risk-rules.seed.ts` is a documented manual entry point (`pnpm tsx backend/src/db/seed/risk-rules.seed.ts` in its header). Both kept — listed here so the next audit doesn't re-flag them.

---

## 2. Dead env vars (both directions)

### [P2] `WHATSAPP_OTP_SETTLE_MS` — read in production code, invisible to the operator — `backend/src/services/openwa.service.ts:220`
- **Evidence**: 23 reads repo-wide (prod read at openwa.service.ts:220, default 45 s). Defined in **neither** `render.yaml` **nor** `config/env.example` **nor** `OPERATIONS_RUNBOOK.md`; only round-96 inspection/repair docs mention it.
- **Why**: this is the primary knob for the WhatsApp settle-gate (the round-96 P0 fix). An operator tuning OTP behavior has no way to discover it.
- **Fix**: add `WHATSAPP_OTP_SETTLE_MS` (sync:false, commented default 45000) to `render.yaml` + a commented row in `config/env.example` + one line in the runbook's WhatsApp section.

### [P2] Observability panel link envs read but documented nowhere — `backend/src/routes/admin/observability.ts:10-12`, `services/alerting.service.ts:826`
- **Evidence**: `SENTRY_DASHBOARD_URL`, `RENDER_DASHBOARD_URL`, `NEON_DASHBOARD_URL`, `ALERTING_RUNBOOK_URL` are read (null-fallback) to render deep links in the admin observability panel / alert footers. Not in render.yaml / env.example / runbook. When unset the panel silently hides the links — nobody ever set them.
- **Fix**: either document the four (env.example + render.yaml sync:false) or delete the reads; today the feature is dead-in-prod and undiscoverable.

### [P3] Read-but-never-defined knobs (defaults win silently)
`ALERT_*` thresholds (9: `ALERT_P95_MS`, `ALERT_P95_MIN_SAMPLES`, `ALERT_5XX_RATE_PCT`, `ALERT_5XX_MIN_REQUESTS`, `ALERT_LOCKOUT_DELTA`, `ALERT_AUTH_FAILURE_DELTA`, `ALERT_FIREBASE_FAIL_DELTA`, `ALERT_DB_FAILURE_THROTTLE_MS`), `HEALTH_AGGREGATE_TIMEOUT_MS`, `HEALTH_CHECK_TIMEOUT_MS`, `NEW_HEALTH_CHECKS_ENABLED`, `METRICS_ENABLED`, `PG_STATEMENT_TIMEOUT_MS`, `SCHEDULER_OP_TIMEOUT_MS`, `MIGRATION_WRITE_WAIT_*`/`MIGRATION_LEADER_WAIT_MAX_MS`/`MIGRATION_TRANSIENT_BACKOFF_MS`, `REDIS_CONNECT_TIMEOUT_MS`/`REDIS_COMMAND_TIMEOUT_MS` (dormant Redis paths), `OTP_HMAC_KEY` (documented only as a code comment in whatsapp-otp.service.ts:49), `SENTRY_DEBUG`, `JWT_SECRET` (legacy alias shim only in `scripts/src/{start,dev}.ts:6-14`), `FIREBASE_PRIVATE_KEY`/`FIREBASE_CLIENT_EMAIL` (alt service-account path, undocumented), `SENTRY_DSN_BACKEND`/`SENTRY_DSN_FRONTEND` (aliases only in `scripts/validate.ts:414-416` — it falls back to `SENTRY_DSN`, so benign), `VITE_APP_VERSION`/`VITE_RELEASE_SHA` (`frontend/src/instrument.ts:42-43` — never defined anywhere → release tag always falls back). **Fix**: one documentation pass over `config/env.example` (they are tuning knobs with sane defaults, not bugs — but they belong in the annotated reference).

### [P3] Defined-but-never-read (dead definitions)
- `render.yaml:77` `BASE_PATH=/` — never read by any code (vite config no longer consumes it). `config/env.example` **already marks it "DEAD: never read by code"** — render.yaml contradicts env.example. Delete from render.yaml.
- `render.yaml` `VITE_APP_NAME` — zero readers (frontend never reads it).
- `render.yaml` + `env.example:190` + Dockerfile ARG `VITE_FIREBASE_DATABASE_URL` — `frontend/src/lib/firebase.ts` initializes without it. Dead.
- `render.yaml` `VITE_FIREBASE_MEASUREMENT_ID` — zero readers (firebase.ts has no analytics init). Dead.
- `NEON_API_KEY` (`env.example:319`) — **OK by design** (manual operator incident tool, documented as such); keep, don't flag.

---

## 3. Unused deps

Verified by import-grep across all packages + shell-invocation checks (build.mjs `sentry-cli`, pino transports). Careful items cleared: `@sentry/cli` (used via `pnpm exec sentry-cli` in build.mjs), `esbuild-plugin-pino` (build.mjs import), `pino-pretty` (runtime transport passed to `esbuildPluginPino({transports:["pino-pretty"]})`), `thread-stream` (pino worker-thread runtime; keep), `@electric-sql/pglite` (test DB harness), `redis`/`rate-limit-redis`/`@socket.io/redis-adapter` (imported by dormant Redis-ready code — intentional, documented), `zod` in shared/db (peer of drizzle-zod, used by generated insert schemas), `@tanstack/react-query` in api-client-react (generated hooks).

### [P3] Unused dependency candidates (zero references anywhere)
| Package | Declared in | Evidence |
| --- | --- | --- |
| `next-themes` | frontend devDeps | only a prose mention in `components/ui/sonner.tsx:28` comment; no import anywhere |
| `@radix-ui/react-tooltip` | frontend devDeps | zero imports; no `ui/tooltip.tsx` exists (other radix pkgs all back a `ui/*` component) |
| `@lhci/cli` 0.15.1 | root devDeps | no `lhci` in any script, workflow, or lighthouserc; Lighthouse CI was dropped |
| `@types/node-cron` | backend devDeps | node-cron v4 ships its own types (`node_modules/node-cron/package.json` "types" field); @types stub is shadow weight under `moduleResolution: bundler` |
| `drizzle-zod` | backend devDeps | zero imports in backend/src; only `shared/db` (which declares its own) uses it |
| (note) `eslint-plugin-react-hooks` | BOTH root + frontend devDeps | single eslint.config.mjs at root resolves it from root; the frontend copy is redundant-but-harmless duplication |

**Fix**: `pnpm remove` per package (lockfile-only churn, no code impact). None are P1/P2 — nothing bloats the deployed bundles (all are devDeps except none).

---

## 4. Shared-types drift (spec → orval → frontend types vs actual `res.json`)

Endpoints compared field-by-field: `/products` list, `/products/:id`, `/products/by-slug/:slug`, `/cart`, `/cart/items`(+`{id}`), `/orders` (GET/POST), `/orders/:orderCode`, `/wallet`, `/wallet/topups`, `/auth/me`, `/auth/sessions`, `/admin/stats`, `/coupons/validate`, `/loyalty`, wallet/topups request bodies.

**Match exactly (clean)**: CartItem ✓, cart envelope ✓, AdminStats ✓, ValidatedCoupon ✓, LoyaltySummary ✓, Topup payment_method enum ✓ (byte-verified, §0.4), UserSession ✓.

### [P2] Product schema is missing `features` — `backend/src/routes/products.ts:390,464` vs `shared/api-spec/openapi.yaml` `Product` (line ~3524)
- **Evidence**: both `/products/:id` and `/by-slug/:slug` return `features: product.features ?? null`; the spec `Product` schema has no `features` property. The frontend reads it through a local `any` escape hatch: `frontend/src/pages/product.tsx:569` (`features?: string[] | null` local interface) + `productAny?.features` at :926-928.
- **Why**: the shared type system exists precisely so this hand-shake is typed; the `any` cast hides every future field regression on the money page.
- **Fix**: add `features: {type: ["array","null"], items: {type: string}}` to the spec Product schema, re-run `pnpm codegen`, delete the local interface + cast in product.tsx.

### [P2] User schema is missing 9 live fields — `backend/src/routes/auth.ts:732-751` (`formatUser`) + `:311` (`linked_identities`)
- **Evidence**: `/auth/me` (and `/auth/probe`) return `email, email_verified, phone_verified, display_name, photo_url, auth_provider, onboarded_at, onboarding_step, linked_identities[]` on top of the spec's `User` (id/phone/wallet_balance/loyalty_*/lifetime_spend/referral_code/created_at). None are in the OpenAPI `User` schema. Frontend re-declares them locally: `pages/profile.tsx:38-40`, `pages/checkout.tsx:35` (comment "returns the user FLAT"), `lib/admin/user-display.ts`.
- **Fix**: extend the spec `User` (or add `MeResponse`) + codegen; the local interfaces then collapse.

### [P2] Spec header claims idempotency "engages only when REDIS_URL" — `shared/api-spec/openapi.yaml:33-36`
- **Evidence**: header says "Idempotency-Key semantics … engage only when the deployment provides REDIS_URL; without Redis, dedup relies on the DB-level status guards (93-A8 F-3)". The **same file's** `/orders` description (lines ~350-360) documents the round-94 F10 **durable `idempotency_keys` guard** that works WITHOUT Redis — and production (no Redis) relies on exactly that. The header is the stale pre-F10 claim.
- **Why**: anyone reading only the header believes the no-Redis production has no idempotency — materially wrong for the money path.
- **Fix**: rewrite the header paragraph to describe the durable in-tx guard with Redis as an optional additional layer.

### [P2] Primary auth path has NO shared contract at all
- **Evidence**: `/auth/whatsapp/start`, `/auth/whatsapp/verify`, `/auth/providers`, `/auth/telegram`, `/auth/telegram/webapp`, `/auth/telegram/callback`, `/auth/firebase/session`, `/auth/firebase/refresh`, `/auth/probe` exist in the backend (`routes/auth-whatsapp.ts:33,156`, `routes/auth-settings.ts:201,844,890,938`, `routes/auth.ts`) and are the **most-used auth surface in production** (WhatsApp = the primary Libyan sign-in), but none are defined in `openapi.yaml` (56 paths; the WhatsApp/telegram/firebase names appear only inside a header comment listing CSRF exemptions). The frontend hand-rolls every call + error type (WhatsAppPhoneSignIn defines its own error funnel; use-public-auth-providers declares `whatsapp_status` locally).
- **Fix**: add the auth family to the spec (bodies + `{error,code}` + the whatsapp 503 `whatsapp_settling`/`retry_after_sec` shape) — this is the highest-leverage contract gap remaining.

### [P3] Order schema documents fields no route ever returns
- `Order.wallet_balance_before` / `wallet_balance_after` (`openapi.yaml` ~3700) — written to DB by `checkout.service.ts:565` but never serialized by `formatOrder` (orders.ts:54-75) or the wallet recent_orders projection (wallet.ts:85-102). Spec-only fields → optional in generated types, harmless but misleading. Either serialize on POST /orders or drop from the schema.
- (Note: `GET /products` list intentionally omits the optional detail-page fields — allowed by the schema, not drift.)

---

## 5. Docs drift

Classification rule: **must-fix** = present-tense claim that misleads an operator about today's production; **historical** = explicitly dated report, fine as-is.

### [P1] README keep-alive claim contradicts production by design — `README.md:122-123`
- **Evidence**: "A public keep-alive repo (`ahmadmedo1012/keep-alive`) pings both health endpoints every 10 minutes so free-tier instances never idle-spin-down."
- **Reality**: the 2026-09-20 free-tier round removed ALL keep-alive (GitHub workflow deleted — `docs/free-tier-optimization-2026-09-20.md:28,141` — cron self-ping removed; render.yaml header says "no keep-alive, no self-ping, no external pingers; this is ACCEPTED by design"). Cold-start 503 + frontend retry is the intended behavior.
- **Why P1**: an operator reading README would (a) think instances stay warm and misdiagnose the 503 cold-start UX as an outage, or (b) try to "fix" the missing pings and re-add exactly what the operator decision removed.
- **Fix**: delete/replace the sentence with the sleep-by-design + early-bind 503 sentence from render.yaml.

### [P2] README infrastructure rows are stale — `README.md:56,115,138` (+ `:41,52`)
- "Render (Docker): web + worker + Redis" (×2) and "`REDIS_URL` — Redis connection (**required in prod**; in-memory fallback in dev)". Production: single web service, plan free, NO worker (removed from blueprint), NO Redis (PG-lease scheduler), suspended by operator gate. `config/env.example:25-37` repeats "Redis (required for production)" and the fail-closed claim ("process exits 1") — the fail-closed exit is real code, but "required for production" is false today.
- **Fix**: README table → "Render (Docker, free): single web service + Neon; optional Redis/worker tiers documented in OPERATIONS_RUNBOOK"; env.example Redis header → "optional — unset in current production; PG-lease fallback active".

### [P2] PLATFORM.md wrong endpoint + live-status claims — `PLATFORM.md:34,43,101,3`
- `:43` "POST /api/orders/checkout — create order" — **no such route** (it's `POST /api/orders`; grep: no checkout route in orders.ts/index.ts).
- `:34` "GET /api/orders/:orderCode — order tracking (**public** via orderCode)" — it's `requireUser`-gated (`orders.ts:305`).
- `:3/:101` "all working"/"LIVE" incl. the Render web service — it is **suspended** (operator gate); last-updated 2026-09-02 (pre-suspension). README's doc table calls PLATFORM.md "Authoritative platform state".
- **Fix**: refresh the two endpoint lines, mark SubNation2 row "SUSPENDED (billing gate)", add "superseded by OPERATIONS_RUNBOOK §free-tier + docs/final-audit-2026-09-20.md" banner. (Deploy id/commit refs are fine as historical.)

### [P2] DISASTER_RECOVERY.md includes a Render Redis in scope — `docs/DISASTER_RECOVERY.md:3,12`
- Undated header: "backed by Neon … + a Render Redis service" and an RTO row for "Render Redis". No Redis exists; an incident responder would hunt a phantom dependency. **Fix**: drop the Redis scope row / mark "(optional, not provisioned — see runbook)".

### [P2] PROJECT_OVERVIEW.md is a 2026-08-25 snapshot marketed as "Start here" — `README.md:170` + `PROJECT_OVERVIEW.md:8-30,202`
- Explicitly dated (historical), but README funnels new readers to it as the 📌 entry point while it says: 21 tables (actual **40**), 32 route files (actual 42), "13 test files / 163 tests" (actual **186 files / ~1460 its**), "web (starter) + worker (starter) + redis (free)" deploy, Redis cache/state rows.
- **Fix**: keep as history, add a top banner "snapshot 2026-08-25 — current state: OPERATIONS_RUNBOOK + final-audit-2026-09-20" and demote the README "Start here" pin to OPERATIONS_RUNBOOK.

### [P3] Smaller stale claims
- `scripts/post-merge.sh:5-6` — comment says boot migrations are "Redis-lock-protected"; production lock is the PG leader lease (render.yaml's own comment says so). Comment-only.
- `specs/003-anomaly-detection/tasks.md:62-63` — paths say `src/middleware/` (singular); code lives in `src/middlewares/`. Plus the T011a "done" status vs §1 above.
- openwa README env table (`/home/z/my-project/repos/openwa/README.md`) — documents only `OPENWA_API_KEY`/`DATA_DIR`/`PORT`; `OPENWA_CREDENTIALS_KEY` and `PERSISTENCE_URL` (both read + tested in that repo) are missing. The key-separation itself was fixed/documented last round (persist.ts header + final-audit) — this is only the README table residual.
- `docs/WHATSAPP_OPERATIONS.md:63-66` — lists `PERSISTENCE_URL` + `OPENWA_API_KEY`; same residual: `OPENWA_CREDENTIALS_KEY` not listed (optional var, unset = legacy derivation — one line suffices).

### Verified clean (checked, no re-report)
`OPERATIONS_RUNBOOK.md` — every Redis/worker mention is inside an explicitly-dormant/historical note (prior fix intact). `docs/free-tier-optimization-2026-09-20.md`, `docs/final-audit-2026-09-20.md`, `docs/round-97-report.md`, `docs/inspection-r97/*`, `docs/inspection-r96/*`, `docs/API.md` — dated reports, claims consistent with their dates; runbook/r97 report file references resolve (abbreviated `backend/src/...` paths). README quick-start commands (`db:push`, `db:seed`, `dev`) all exist and match root scripts.

---

## 6. Test-suite health

Totals: **186 test files** (backend 119 / frontend 67), ~1460 `it(` (backend 1012 / frontend 448), 4174 `expect(`.

### (a) Skipped / only / todo
- Zero `.skip`, zero `.only`, zero `test.todo` except one file: `backend/tests/concurrency.test.ts:33-37` — **5 `it.todo`** ("inventory claim race", "wallet lost updates", "coupon usedCount once", "atomic topup approval", "duplicate topups").
- **[P3] Those todos are stale** — the races they describe are already regression-tested elsewhere with the pglite `tx-interleave` harness: claim-collision + per-user scoping in `checkout-idempotency.test.ts:232-313`, refund 3-column optimistic lock in `refund-points-race.test.ts:78-163`, composite topup dedup in `topup-composite-dedup.test.ts:85+`, payment-reference dedup in `topup-payment-reference.test.ts`. The file's own rationale ("needs a live Postgres … this unit suite does not stand up") predates the harness. Fix: convert the todos into `it.skip` pointers to the covering suites, or delete the block.
- The file is otherwise honest (real pricing-invariant tests, refuses `expect(true)`).

### (b) Weak assertions
- No `toMatchSnapshot`/`InlineSnapshot` anywhere. No `expect(true).toBe(true)` / tautologies found. Empty-try pattern: none in tests.
- `toBeDefined()` usage is modest and on legitimately-shaped objects (openwa settle-gate, telegram gates); none replaces a money-value assertion. `checkout-idempotency`, refund, topup, wallet suites assert exact balances/row-counts/status codes. **No finding.**

### (c) Flaky patterns
- **Midnight-flake family (the forecast-gate bug class)**: re-swept every test computing day boundaries. Only remaining same-family consumer is `alerts-dedupe.test.ts:105-107` (`todayUtcDate()` fixtures) — it compares **equal dates computed in the same tick**, so a midnight rollover mid-test cannot desynchronize it. `statistical.test.ts` is explicitly `Date.now()`-free (header comment). No other candidates (admin stats chart is Tripoli-bucketed in prod code but untested day-boundary-wise; coupon/flash expiry tests use now±offsets, not day boundaries).
- `Date.now()/new Date()` without freezing exists in ~20 test files but always as data seeding (`firedAt: new Date()`, `expiresAt: now+Δ`) — not boundary math. Frontend countdown tests freeze via `vi.useFakeTimers()` (`flash-sale-banner`, `flash-sales`, `whatsapp-phone-sign-in`, `format-relative-time` pins `FROZEN_ISO`). `Math.random` appears only for unique seed phones (uniqueness, not timing). No setTimeout race found.
- **[P3] Frontend test files are excluded from typecheck** — `frontend/tsconfig.json` `exclude: ["**/*.test.ts", "**/*.test.tsx", "src/test/**"]`, so `tsc --noEmit` never sees them (backend, by contrast, includes its tests). A type-drift in a frontend fixture compiles nowhere and is caught only at runtime. Fix: add a `tsconfig.test.json` or include tests in the typecheck script.

### (d) Coverage of critical paths
- **Strong**: checkout (idempotency replay/claim-collision/legacy-degradation, inventory-corrupt gate, variants, stale-product, coupon post-commit), wallet/topups (idempotency, payment reference, composite dedup, auto-guards, referral race), refunds (points race, revocation, extra-details, service suite), admin guards (session revocation, auth lockout, 2FA setup, bulk-status guard, users-loyalty guard, metrics-auth, copilot admin-request-security + tool gating, csrf-gate, cors gate), openwa transport + settle gate, safeDecrypt GCM matrix.
- **Gaps**: (1) `risk-hard-block.ts` — zero tests (orphan, §1); (2) the 5 stale todos above; (3) frontend tests un-typechecked; (4) openwa **crypto** (key separation) is tested in the sibling repo (`openwa/tests/persist-key-separation.test.mjs` — present and covering legacy-derivation, separation, re-key) — SubNation2-side safeDecrypt tests cover the shared primitive. No further gap found.

---

## 7. Build graph & script correctness (CI quota-dead; script wiring only)

- Root `build` = `lint → typecheck → pnpm --filter @workspace/api-server run build`; backend `build` = `build.mjs` (esbuild bundles index+worker to dist/*.mjs, optional Sentry map upload+strip) then chains the frontend build (`pnpm --dir .. --filter @workspace/subnation run build`). **`pnpm build` at root produces the complete deployable artifact** (backend dist + frontend dist/public) ✓.
- Shared packages need no prior build: backend esbuild and Vite both consume workspace `.ts` sources via package `exports` (`./src/index.ts`); `typecheck:libs` = `tsc --build` over the 4 project references (composite ✓ incremental .tsbuildinfo caching ✓).
- CI (`ci.yml`) step wiring matches real scripts: `pnpm run lint`, `pnpm run typecheck`, `tsx ../scripts/check-openapi-routes.ts` (file exists ✓), migration-drift via `drizzle-kit generate` + `git diff` (correct given drizzle out dir), `vitest run` per workspace, and `pnpm --filter @workspace/api-server run build` for the artifact — no duplicated lint inside the build job ✓. `deploy.yml` gates on `workflow_run.conclusion == 'success'` and checks the `RENDER_DEPLOY_HOOK_URL` secret — correct.
- Vercel `buildCommand` `pnpm --filter @workspace/subnation run build` + `outputDirectory frontend/dist/public` matches Vite's outDir (`dist/public`, confirmed by the bundle-budget plugin path) ✓; `/api` rewrites point at `subnation2.onrender.com` consistent with render.yaml `VITE_API_BASE_URL` ✓.
- Dockerfile `NODE_VERSION=22-alpine` = `.nvmrc` (22) = engines (>=22) ✓; copies every workspace package.json before install ✓.
- Only nit: root `build` runs lint+typecheck inline (heavier than CI's split ordering) — cosmetic, not a defect.

---

## 8. Config files

- **tsconfig consistency**: every package extends `tsconfig.base.json` ✓ (frontend, backend, scripts, all shared/*). Target `es2022` everywhere ✓. **[P3] Not fully strict**: base sets `strictFunctionTypes: false`, `noImplicitOverride: false`, `noUnusedLocals: false` (the rest of the strict family is on: strictNullChecks, noImplicitAny/This/Returns, useUnknownInCatchVariables, strictBindCallApply, strictPropertyInitialization). Documented or flip on in a dedicated pass; function-type variance is currently unchecked in every package.
- **eslint**: flat config, recommended + react-hooks (rules-of-hooks error, exhaustive-deps warn). Ignores `frontend/src/components/ui/**` (shadcn convention), `**/generated/**`, configs — sane. Gap (minor): `no-empty` allows empty catch globally — deliberate per comment; acceptable.
- **prettier**: `printWidth 100`, LF ✓. **[P3] `.prettierignore` ignores `shared/db/migrations/` — but drizzle's actual output dir is `shared/db/drizzle/`** (drizzle.config.ts has no `out`, default `./drizzle`). The `meta/*.json` snapshots are prettier-formattable JSON and currently unignored → `pnpm format` can rewrite generated snapshot JSON and create drift noise against the CI migration-drift gate. Fix: change the ignore entry to `shared/db/drizzle/`.
- `.nvmrc`/Dockerfile/engines agree (§7). `components.json` aliases match the `@/` tsconfig paths ✓.

---

## 9. Counts, files audited, tables

**Files audited**: 553 TS/TSX source files (backend/frontend/shared/scripts, excl. node_modules), 110 markdown docs, 9 package.json, 3 CI/deploy workflows, render.yaml/vercel.json/Dockerfile/tsconfigs/eslint/prettier, plus the openwa sibling's README/tests/persist.ts (docs/test scope).

**Counts**: 43 findings total → 1 P1, 11 P2, 31 P3. Dead exports: **63 fully dead** (+193 internal-only). Dead env: 2 directions (≈21 read-not-defined knobs, 4 defined-not-read + 4 link envs). Unused deps: 5 (+1 duplicate). Docs: 1 P1 + 6 P2 + 4 P3 stale claims. Tests: 0 skipped-for-real, 5 stale todos, 0 weak-assertion findings, 0 new flaky patterns.

### 9.1 Dead exports (verified zero importers repo-wide incl. generated)

| File | Dead export(s) |
| --- | --- |
| backend/src/lib/cache.ts | `cacheInvalidatePrefix` |
| backend/src/lib/copilot/ids.ts | `isPreviewId` |
| backend/src/lib/correlation.ts | `createCorrelationContext`, `setCorrelationRoute`, `setCorrelationUserId` |
| backend/src/lib/forecast/dates.ts | `daysBetween` |
| backend/src/lib/jwt.ts | `verifyAdminToken` |
| backend/src/lib/logger.ts | `monitoringLogger` |
| backend/src/lib/metrics.ts | `safeSet`, `workerJobsTotal`, `neonConnectionsActive`, `neonInflightQueries` |
| backend/src/lib/opportunistic.ts | `resetOpportunisticMaintenanceForTests` (no test imports it) |
| backend/src/lib/pricing-config.ts | `PRICING_SETTINGS_PREFIX` |
| backend/src/lib/risk-emit.ts | `clientFromReq`, `scoreEventAwait` |
| backend/src/lib/risk-metrics.ts | `recordAdminToAction` |
| backend/src/lib/telegram-gateway.ts | `sendMessageWithKeyboard` |
| backend/src/services/copilot/provider-config.ts | `__resetCopilotProviderForTests` (no test imports it) |
| backend/src/services/forecast/run-store.ts | `RunOutcome` (type) |
| backend/src/services/forecast/statistical.ts | `DOW_WINDOW`, `HISTORY_WINDOW` |
| shared/error-codes/src/index.ts | `ALL_ERROR_CODES` |
| shared/db/src/schema/*.ts (26 files) | `Insert*`/row types: `AccountLinkConsent, AdminAlert, InsertAdminUser, InsertCartItem, CopilotActionItem, InsertCopilotActionItem, CopilotAction, InsertCopilotAction, CopilotPreview, InsertCopilotPreview, EnrichmentDraft, InsertEnrichmentDraft, EnrichmentRun, InsertEnrichmentRun, InsertFlashSale, IdempotencyKey, InsertInventory, InsertInventoryForecastRun, InventoryForecastRun, InsertInventoryForecast, InventoryForecast, InsertOpenwaSession, OpenwaSession, InsertOrder, InsertProductVariant, InsertProduct, NewRiskConfig, NewRiskLabel, NewRiskRule, RiskEvent, SchedulerLeaderLease, SupportTicket, InsertSystemSetting, SystemSetting, UserAuthIdentity, InsertUser, WalletLedgerEntry, InsertWalletTopup, WalletTopup, WhatsappOtp` |

### 9.2 Unused deps list

| Package | Location | Import-grep evidence |
| --- | --- | --- |
| `next-themes` | frontend devDependencies | 0 imports (1 comment mention, `components/ui/sonner.tsx:28`) |
| `@radix-ui/react-tooltip` | frontend devDependencies | 0 imports; no `ui/tooltip.tsx` exists |
| `@lhci/cli` | root devDependencies | 0 references in scripts, workflows, or any lighthouserc |
| `@types/node-cron` | backend devDependencies | node-cron v4 ships its own `types`; 0 imports of the stub |
| `drizzle-zod` | backend devDependencies | 0 imports in backend/src (only shared/db, which declares it) |

### 9.3 Stale docs claims list

| # | File:line | Claim | Class | Reality |
| --- | --- | --- | --- | --- |
| 1 | README.md:122-123 | keep-alive repo pings every 10 min | **P1 must-fix** | all keep-alive removed 2026-09-20 by design (free-tier doc :28,:141) |
| 2 | README.md:56,115 | "web + worker + Redis" Render deploy | P2 must-fix | single free web service; worker+Redis removed from blueprint |
| 3 | README.md:138 + config/env.example:25-28 | `REDIS_URL` "required in prod" | P2 must-fix | no Redis in prod; PG-lease fallback active |
| 4 | PLATFORM.md:43 | `POST /api/orders/checkout` | P2 must-fix | route does not exist (it's `POST /api/orders`) |
| 5 | PLATFORM.md:34 | `/api/orders/:orderCode` "public" | P2 must-fix | `requireUser`-gated (orders.ts:305) |
| 6 | PLATFORM.md:3,101 | "all working"/"LIVE" Render web | P2 must-fix (doc dated 09-02 but README labels it Authoritative) | backend suspended (operator gate) |
| 7 | docs/DISASTER_RECOVERY.md:3,12 | Render Redis in DR scope/RTO table | P2 must-fix (undated header) | no Redis provisioned |
| 8 | PROJECT_OVERVIEW.md:8-30,202 + README.md:170 | 21 tables/32 routes/163 tests/starter+redis; pinned "Start here" | P2 must-fix (banner) | dated 2026-08-25 snapshot: 40 tables/42 route files/186 test files |
| 9 | shared/api-spec/openapi.yaml:33-36 | idempotency engages only with REDIS_URL | P2 must-fix | F10 durable `idempotency_keys` guard works without Redis (same file documents it) |
| 10 | scripts/post-merge.sh:5-6 | migrations "Redis-lock-protected" | P3 | PG leader lease in prod |
| 11 | specs/003-anomaly-detection/tasks.md:63 | T011a hard-block `[x]` done; path `src/middleware/` | P3 | implemented but never mounted (§1); actual dir `middlewares/` |
| 12 | openwa README env table | missing `OPENWA_CREDENTIALS_KEY`/`PERSISTENCE_URL` rows | P3 residual | both read + tested in that repo; SubNation docs (WHATSAPP_OPERATIONS.md:63) list PERSISTENCE_URL but not CREDENTIALS_KEY |

---

## 10. Recommended next actions (ordered)

1. **Docs quick wins (P1/P2, minutes)**: README keep-alive + infra rows; env.example Redis header; PLATFORM endpoints/status; DR Redis scope; PROJECT_OVERVIEW banner; spec idempotency header paragraph; add `WHATSAPP_OTP_SETTLE_MS` + the 4 observability link envs to render.yaml/env.example.
2. **Decide risk-hard-block's fate** (mount + test, or spec-back-to-pending + dormant banner) — it is the only orphan file in the repo.
3. **Spec/types pass**: add `features` to Product, extend User (or add MeResponse), add the WhatsApp/Telegram/Firebase auth family to openapi.yaml, drop `wallet_balance_before/after` from Order, then `pnpm codegen` and delete the frontend local interfaces/`any` casts (product.tsx:569/926, profile.tsx:38, checkout.tsx:35).
4. **Mechanical cleanup commit**: remove the 63 dead exports, un-export the worst internal-only offenders, `pnpm remove` the 5 unused deps, delete BASE_PATH/VITE_APP_NAME/VITE_FIREBASE_{DATABASE_URL,MEASUREMENT_ID} from render.yaml, fix `.prettierignore` path, convert the 5 stale `it.todo`s to pointers.
5. **Type-safety nudge**: include frontend tests in typecheck; plan a `strictFunctionTypes: true` enablement pass.
