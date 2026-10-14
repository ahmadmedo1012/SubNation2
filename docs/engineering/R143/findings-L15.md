# Lane L15 — CI, regression tests & release quality (R143)

Read-only audit @ HEAD `528ef39` (tree clean; the only writes were `.agents-r143/`
reports and `/tmp/l15` scratch). Sources: `.github/workflows/ci.yml` (612 lines)
and `docker.yml` (262) read end-to-end; both R142 gates executed locally with
sabotage demos; GitHub Actions API used through the token in the git remote
(token never printed) to pull runs 471/478/479/481/482 incl. job logs; money-path
coverage measured with a targeted 28-suite vitest run. Zero repo modifications.

---

## R142 fix verification

**M-2 (push-time boot smoke) — VERIFIED at HEAD.**
- The step exists and runs on every code push in the `build` job:
  `.github/workflows/ci.yml:529-558` ("Boot smoke — the built shell must be
  bootable", directly after "Production build (API + Vite SPA)"). CI run 482
  (528ef39) shows the step `success` in the build job (Actions API job-step
  listing).
- What it EXACTLY asserts — and nothing more: on `frontend/dist/public/index.html`
  with all HTML comments stripped (`replace(/<!--[\s\S]*?-->/g, "")`, ci.yml:540):
  (1) a module-entry tag `<script type="module" src="…/index-*.js">`
  (ci.yml:542-543), (2) at least one `<link rel="stylesheet" href="…css">`
  (ci.yml:544-549), (3) the PWA `<script src="/registerSW.js">` (ci.yml:550-551).
  It is **static/browser-free by design** — no JS execution, no HTTP fetch.
- Saboteur-demonstrated (twice): (a) the R142 record — IMPL-wave-report.md:32
  "push-time boot smoke in CI (proven: fails on sabotaged shell) … sabotage
  demonstration recorded", CHANGELOG.md:1826 "(proven against a sabotaged
  shell)"; (b) **re-demoed by this lane now**: I ran the exact script replica
  against the current built artifact (`[boot-smoke] OK`, exit 0) and against a
  sabotaged copy with the entry tag wrapped in a comment →
  `[boot-smoke] FAIL … module entry script (index-*.js) not found outside HTML
  comments`, exit 1.
- Companion layer also verified at HEAD: the vite closeBundle gates are now
  comment-stripped (B-2/M-1 fix) — `frontend/vite.config.ts:52-56`
  (`findBundleEntry` strips comments first), `:64-76` (`collectEagerFiles`
  same), `:115-124` (CSP src-less-inline-script ban on the BUILT shell), and
  the eager-path gate fails on referenced-but-missing files (`:197-199`) — so
  the entry asset's existence on disk is also guarded (the boot smoke itself
  only checks tags).
- Residual limits (see L15-7): runtime JS execution, CSP-at-execution, and the
  compiled BACKEND artifact remain unguarded on push — the static seam is
  closed, the runtime seam now hangs entirely on the e2e heartbeat (L15-1).

**N-1 (header-param survival gate) — VERIFIED at HEAD.**
- The step exists and runs in the `checks` job on every code push:
  `.github/workflows/ci.yml:367-376` ("OpenAPI header-param survival gate",
  positioned after the ErrorCode sync gate, before the migration drift gate).
  Run 482 job-step listing: `success`. Also wired as a package script
  (`scripts/package.json:15` → `check:header-params`).
- Executed locally at HEAD via the same tsx path: `7/7 spec header params reach
  the zod mirror; 7 ride the documented RequestInit escape hatch`, exit 0.
- Sabotage demo (doctored COPY under `CHECK_HEADER_PARAMS_YAML`, shared/
  untouched): adding an 8th spec header param (`X-Money-Trace-Id` on POST
  /orders) → exit 1 with three failure rows, including the exact N-1 class:
  "is silently DROPPED by the generated react client and carries no
  KNOWN_DROPPED ledger row". The gate also asserts the zod Header-object count
  equals the spec-side count (a $ref'd param breaks equality instead of
  passing vacuously) and fails on stale ledger rows in both directions
  (emitted-but-ledgered, ledgered-but-not-in-spec) — code read at
  `scripts/check-openapi-header-params.ts:247-288`.
- Scope note (documented in-script, `:197-213`): the react-client survival
  check reads only `generated/api.ts` + `generated/api.schemas.ts`; an orval
  emission into any other file reads as "still dropped" — the safe direction.

---

## Findings

### L15-1 · P2 · The weekly e2e heartbeat — the system's ONLY runtime boot guard — is 0-for-3 lifetime and currently red on a deterministic test-side bug; R142 (49 fixes) shipped with zero e2e verification
- **Evidence (Actions API + job logs, token via git remote, never printed):**
  schedule runs of the CI workflow: #414 (2026-09-28, failure), #424
  (2026-10-05, failure — gitleaks full-history, later fixed by the R130
  commit-scoped allowlist), **#471 (2026-10-12, failure — the e2e job)**. Run
  471's log: `E2E_BASE_URL: https://subnation.ly` (the repo variable IS
  configured), `43 passed (1.4m)` / `1 failed` —
  `[mobile-390] › e2e/login-page.spec.ts:6:3 › provider buttons match the
  passwordless model + legal links resolve`: `expect(locator).toBeVisible()
  failed … Locator: locator('button, a[role=\'button\']').first() … Received:
  hidden … 24 × locator resolved to <button … aria-controls=
  "desktop-categories-menu" …>` — failed all 3 attempts (retries: 2).
  Root defect present at HEAD: `frontend/e2e/login-page.spec.ts:12`
  `await expect(buttons.first()).toBeVisible()` — the first button in DOM
  order is the Navbar's desktop categories toggle
  (`frontend/src/components/layout/Navbar.tsx:462-466`), which is hidden at
  the mobile-390 project's Pixel-7 viewport (`frontend/playwright.config.ts:29-40`
  runs EVERY spec under BOTH projects). No e2e run of any kind since 2026-10-12
  (last workflow_dispatch = run #467, 2026-10-10); next heartbeat 2026-10-19.
  R142's `2df0a62` (2026-10-13) therefore has zero runtime/e2e verification.
- **Root cause:** viewport-dependent locator choice (`.first()` on a generic
  button locator) in a spec that was clearly written (and passing) against the
  desktop project; plus a cultural one: a permanently-red scheduled gate
  carries no owner — 3 scheduled runs have never once been green and nobody
  has acted on #471.
- **Proposed fix:** make the assertion viewport-invariant
  (`buttons.filter({ visible: true }).first()`, or scope to
  `page.locator("main button")`), and give the heartbeat an owner + a
  triage rule (red heartbeat = incident, fix or explicitly snooze within a
  day). Optionally: dispatch the suite once after this fix to re-baseline.
- **Test requirement:** none new (this IS the e2e fix); assert in the same PR
  that the spec passes under BOTH projects locally
  (`E2E_ENABLED=1 npx playwright test login-page --project=mobile-390`).
- **Risk:** the R141-class detection ceiling degrades from "≤7 days" to
  **never** — a permanently-red heartbeat trains everyone to ignore it, and
  the next live-prod regression hides inside the noise. This also nullifies
  the documented intent at ci.yml:566-574 ("configure the variable, don't
  silence the heartbeat") — the variable IS configured and the heartbeat is
  still red for a test-side reason.

### L15-2 · P2 · CONFIRMS L9-1 from the CI side: the migration drift gate is bytes-only — no job in either workflow ever parses or applies the chain, and no real Postgres exists anywhere in CI
- **Evidence:** the gate is exactly
  `.github/workflows/ci.yml:378-389`: `pnpm --filter @workspace/db exec
  drizzle-kit generate` + `git diff --exit-code -- shared/db` — a byte diff;
  it never executes a single SQL statement. No job in `ci.yml` or `docker.yml`
  has a `services:` block (no postgres container); the suites' DATABASE_URL is
  the synthetic never-connected `postgres://ci:ci@localhost/ci`
  (ci.yml:285,422,495) and the backend harness aliases `@workspace/db` to
  in-process pglite (`backend/vitest.config.ts:17-22`) whose DDL is a
  hand-mirrored harness (`backend/src/test/db.ts`), not the chain. L9-1
  (independently reproduced this round): `shared/db/drizzle/
  0003_secret_invisible_woman.sql` carries `… USING btree (true) …` which is
  a 42601 syntax error on real PGlite/Postgres — yet run 482's "Migration
  drift check" step is `success`, exactly as predicted.
- **Root cause:** the gate protects schema↔SQL *synchronization*, and was
  never designed to validate *applicability*; the chain's documented purpose
  ("MIRROR chain for fresh installs + CI drift gate") quietly assumed both.
- **Proposed fix:** add one CI step (same `checks` job, ~seconds, zero
  services): replay `shared/db/drizzle/*.sql` in journal order into a
  throwaway PGlite instance and assert (a) zero errors, (b) a second pass is
  a no-op (the idempotence the headers promise). L9's `/home/z/l9-scratch`
  dry-run proves the approach; pglite already caught the 0003 defect when
  actually applied. The 0003 hand-fix (`USING btree ((true))`, precedent in
  0008's header) lands in the same PR — L9 owns the details.
- **Test requirement:** the new step itself; plus the existing
  migrate-*/schema-parity suites stay green (L9 ran them green: 21 files/164
  tests).
- **Risk:** a fresh install provisioned from the chain dies at file 3 of 24
  with a partial schema; the historical 42P07 hand-fix class stays unguarded;
  the gate keeps certifying bytes that cannot run.

### L15-3 · P3 · Coverage is report-only with the promised baseline still unmeasured — and the report EXCLUDES the two most production-critical boot files; this lane delivers the first measured money-path numbers
- **Evidence:** both coverage blocks carry no `thresholds`
  (`backend/vitest.config.ts:23-42`, `frontend/vitest.config.ts:55-73`); CI
  runs `test:coverage` and uploads 7-day artifacts
  (`ci.yml:454-475`, `if-no-files-found: warn` — a crashed coverage step
  silently produces no artifact). The stale promise lives at ci.yml:460-462
  ("thresholds land in R137 calibrated against the first CI runs' artifact
  numbers") — R137→R143, six rounds. NEW observation: the backend report
  **excludes `migrate.ts` and `server.ts`** (vitest.config.ts:39-40) — the
  idempotent boot reconciler that owns the live schema (and whose body no test
  executes — F-1 DEFER) is outside the measurement entirely, so even future
  thresholds would never see it; the frontend excludes `main.tsx` +
  `instrument.ts` (entries — defensible).
- **Measured baseline (this lane, the calibration data the deferral waits
  for):** targeted vitest run of the 28 money-labeled backend suites at HEAD
  (checkout/orders/wallet/loyalty/coupons/admin-money/idempotency/ledger),
  v8 coverage, per-file statements/branches/functions:
  `routes/orders.ts` **98.0/91.4/100** · `routes/wallet.ts` **85.1/79.9/100**
  · `routes/loyalty.ts` **93.9/80.3/100** · `routes/coupons.ts` 79.4/61.6/90
  · `middlewares/idempotency.ts` **95.4/92.0/85.7** · `lib/money.ts`
  100/100/100 · `lib/ledger.ts` 100/88.9/100 · `lib/idempotency.ts`
  75.0/69.8/83.3 · `lib/points-ledger.ts` 29.2/26.6/75 ·
  `routes/admin/orders.ts` 78.1/58.3/65.4 · `routes/admin/topups.ts`
  **70.0/26.8**/66.7 · `routes/admin/referrals.ts` **51.0/15.8**/42.9 ·
  `routes/admin/users.ts` 68.9/59.0/40.0.
  Caveat: this is the money-labeled-suite LOWER BOUND — other suites
  (topup-referral-race, whatsapp-referral-events, admin-filters-pagination,
  csrf-gate, openapi-response-contracts, the three pricing suites) add
  coverage to the admin rows.
- **Root cause:** recorded deferral (A-2/M-3: "hard thresholds need a measured
  baseline first") that nobody has come back to collect.
- **Proposed fix:** land per-directory floors from the measured numbers
  (e.g. orders/wallet/loyalty/idempotency-middleware ≥90% stmts — already
  true, so the ratchet starts green; admin/topups + admin/referrals branch
  floors at a triaged lower number with a follow-up), or rewrite the stale
  comment to record "report-only by design". Remove `migrate.ts` from the
  exclusion the day F-1's chain test lands (L15-2's step would execute it).
- **Test requirement:** none beyond the thresholds themselves (they ARE the
  regression test); money floors must be calibrated so the first landing run
  is green (never gate on never-green numbers).
- **Risk:** deleting covered branches drops the numbers with zero CI signal;
  the admin money routes' thin branch coverage (topups 26.8%, referrals
  15.8% branch from their money suites) has no enforcement floor.

### L15-4 · P3 · Docker: no image vulnerability scan anywhere in the pipeline, and docker.yml's STATUS header contradicts the Actions run record — two fully-green publishes exist
- **Evidence (docker.yml read end-to-end + repo grep + Actions API):**
  (a) **No scan step**: `docker.yml` contains exactly two jobs —
  `build-and-push` (checkout/buildx/login/metadata/build-push, :88-168) and
  `merge` (imagetools, :173-263). Repo-wide grep for trivy/grype/syft in
  `.github/`, `scripts/`, `Dockerfile`, `docker-compose.yml`: zero hits. The
  only CVE gate in the repo is `pnpm audit --prod` on source deps
  (ci.yml:250-256 — critical blocks, high informs). The published IMAGE is
  never scanned by anything.
  (b) **STATUS paragraph vs run record**: docker.yml:46-58 (R127-L4, verified
  2026-10-09) claims "NO completed publish is on record … no manual dispatch
  has been recorded since the repo went public (R122)". The Actions API shows
  the Docker workflow (id 364089871) has 4 runs: **#1 (2026-10-02, tag
  v0.0.1-coolify-test): arm64 + amd64 + merge ALL success**; **#3
  (2026-10-06, workflow_dispatch): all three success**; #2 cancelled; #4
  arm64-leg failure with amd64+merge success. Two fully-green publishes
  predate the "verification".
  (c) Trigger shape: dispatch + `v*` tags only (docker.yml:61-69) — never on
  push (Coolify builds per-push on the VM, by design); a Dockerfile/compose
  regression surfaces only in Coolify's VM build or at the next dispatch/tag;
  `Dockerfile` is in the ci.yml path filter (code gate) but nothing in CI
  docker-builds it.
- **Root cause:** (a) the supply-chain watch was scoped to the pnpm graph
  when the audit job landed; container scanning was never in CI (the hermes
  skill table routes `trivy-security-scan` as a manual skill). (b) the R127-L4
  "verification" trusted an anonymous registry probe (403 = private-or-
  absent) over the workflow's own run record.
- **Proposed fix:** add a scan-only step to `build-and-push`
  (`aquasecurity/trivy-action`, SHA-pinned like its siblings, `scan-type:
  image`, exit on CRITICAL, findings to SARIF) — the image is published for
  the emergency rollback path, so it should be scanned before it's the only
  thing left to roll back to. Rewrite the STATUS paragraph from the run
  record (runs #1/#3 green; whether tags are still in GHCR needs a
  read:packages PAT — operator step, not an assumption).
- **Test requirement:** the scan step's own zero-finding baseline on the
  current image.
- **Risk:** a critical CVE baked into the rollback image is discovered during
  the emergency it exists for; operators re-dispatch or mistrust the runbook
  §2 image path based on a stale header.

### L15-5 · P3 · TOTP fix 528ef39 is robust, not timing-lucky (independently confirmed from CI evidence + math) — but the class stays open at 3 of 5 mint sites (CONFIRMS L8-2)
- **Evidence:** run 481's backend log pins the original failure precisely:
  `FAIL src/routes/admin/__tests__/2fa-totp-encryption.test.ts > R118-B1c
  (A4 F-4) — TOTP secret encrypted at rest > end-to-end: setup → verify-setup
  … → verify-2fa session`, at the pre-fix line `:191:34`
  (`expect(verifySetup.status).toBe(200)` — Step 2's 401), `7 tests | 1
  failed`, single test 236 ms — every other job in 481 green. The fix
  (git show 528ef39, 66+/13-): on a first-attempt 401, wait 1.1 s, re-mint
  with `generateSync`, retry ONCE — at Step 2 (:202-221) and Step 4
  (:239-249).
- **Robustness verdict (my analysis, agreeing with L8):** if the first mint
  at T₁ failed the step boundary B, then B ∈ (T₁, T₁+RTT]; the retry mints at
  T₁+1.1 s, i.e. ≥ 1.1 s − RTT into the NEW 30 s step — a second boundary hit
  requires RTT ≥ ~29 s. The retry deliberately keeps real time and real HTTP
  (no fake clock), and a PERSISTENT 401 (decrypt failure, wiring regression)
  still fails the test on the second attempt — the contract is not weakened.
  Robust, with residual failure probability ~0 for realistic CI RTT. Not a
  fake-timer conversion, which would have been stronger but riskier against
  otplib internals.
- **Residual (coordinate — L8-2 owns it):** 3 success-expecting bare mints
  remain: `2fa-totp-encryption.test.ts:283` (legacy-plaintext verify-2fa),
  `:334` (verify-setup inside the wrong-code test),
  `2fa-verify-setup-lockout.test.ts:189` (enrollment completion). Same class,
  same CI flake surface (~RTT/30s per site per run).
- **Remaining time-sensitive assertion census (duty: enumerate):**
  - **Wall-clock bounded assertions (real time, generous headroom):**
    `whatsapp-otp-start-lock.test.ts:276-277` (`elapsed ≥ 20 && < 2_000` on a
    25 ms unlock timeout — 80× headroom); TOTP retry sleeps (1.1 s × ≤2).
  - **Real `setTimeout` micro-sleeps (ordering, not timing bounds):** 19
    backend files (cache-singleflight 10-15 ms, isolate-async 50 ms,
    session-liveness 5 ms, idempotency, scheduler-coordinator, coupons…)
    + 17 frontend files (custom-fetch-network, boot-sentry-dsn-guard,
    dashboard-chart-race, referrals-search-race…). Low flake risk — none
    assert elapsed time; they yield to pending macrotasks.
  - **Fake-timer suites (deterministic, the GOOD class):** openwa-settle-gate
    (45 uses), whatsapp-watch (23), alerting-reliability (11),
    telegram-dispatch-retry (11 — R142's L-1 suite), health-neon-warmup (9),
    idempotency-degradation, whatsapp-otp-daily-cap; frontend
    flash-sale-banner (14), format-relative-time, session-activity-manager…
    Socket suites (socket-auth/revocation/alert-room-reconcile/admin-temp-
    token) use no raw timers — deterministic. Zero direct `Date.now()` in
    test assertions (backend); frontend mocks time via `vi.setSystemTime`.
  - **CI-observed flake ledger (Actions API, last 12 runs):** TOTP boundary
    (481 — FIXED), login-page mobile-390 (471 — OPEN, L15-1), gitleaks
    full-history (424 — fixed R130), R142-wave WIP frontend reds (478/479 —
    pre-R142-final commits, resolved by a9f5e83). The e2e suite itself showed
    no other flake (43/44 green on live prod).
- **Proposed fix:** L8-2's — extract the retry idiom or sleep-to-mid-window
  before minting (`15000 - (Date.now() % 30000)`) at all 5 sites; pin with a
  comment referencing 528ef39.
- **Test requirement:** none new (this IS the test fix).
- **Risk:** unaddressed, the next boundary hit at a bare site re-reds CI at
  ~60% of the original rate — the exact "spurious red erodes trust" failure
  mode that produced 481.

### L15-6 · P3 · E2E journey census: every money and admin journey has ZERO browser-level end-to-end coverage — by documented design, with pglite suites as the only net
- **Evidence:** `frontend/e2e/` = exactly 10 specs (api-contracts,
  auth-gates, cart-gate, category, home, login-page, mobile-390,
  product-detail, search-arabic, seo), 44 tests, 2 projects; the design
  contract is written in the config header — `playwright.config.ts:6-15`:
  "Guest journeys ONLY … NO purchases, NO topups, NO logins, NO OTP requests,
  NO admin." `cart-gate.spec.ts` stops at the login wall; nothing exercises
  checkout submit, topup create/approve/reject, referral credit, coupon apply
  at purchase, any admin operation, or the WhatsApp/Telegram auth flows. The
  cadence: the e2e job runs ONLY on workflow_dispatch/schedule
  (ci.yml:577) — on live prod (`vars.E2E_BASE_URL`) — never on push/PR.
- **Root cause:** deliberate production-safety constraint (a money-spending
  e2e against prod is unacceptable; no staging stack exists), so this is a
  recorded design boundary, not an oversight. The mitigation stack: typed
  orval client + zod pin suite (49/111 ops) + ~2,458 backend tests on real
  SQL + the money suites measured in L15-3.
- **Proposed fix (if ever wanted):** a staged e2e environment (compose stack
  + seeded pglite/postgres) would let checkout/topup-approval/admin journeys
  run per-push without touching prod — that is an infrastructure decision,
  not a spec patch; until then, the honest position is "money journeys are
  integration-tested only", and the weekly guest heartbeat (L15-1) is the
  sole runtime check that exists at all.
- **Test requirement:** n/a (census); any new spec must respect the guest
  contract or the staged-stack boundary.
- **Risk:** regressions visible only in a browser (interaction order, cookie
  flows across the SPA↔API seam, SSE/socket UX) surface in production use;
  the R125/R141 precedents were both browser-visible classes.

### L15-7 · P4 · Boot smoke residual: the gate is tag-level static; the compiled backend artifact is never booted in CI
- **Evidence:** ci.yml:536-558 asserts tags only (no `existsSync` on the
  referenced entry/CSS/registerSW files — that class is covered by the vite
  budget gate's file-existence check, vite.config.ts:197-199, in the same
  job); no step anywhere boots the built backend bundle — the api-server
  `build` output is never executed (unit suites boot the app from SOURCE via
  `buildApp()` + `listen()` in hundreds of tests, so source-level boot is
  well covered; compile/bundle-time surprises (esbuild/tsc emit differences,
  dist require-graph) are the unprotected residue).
- **Root cause:** M-2's charter was the SPA shell (the R141 class); the
  backend boot seam was never in scope.
- **Proposed fix:** one `node -e` healthcheck step after the build: spawn
  `node backend/dist/…` with synthetic env + `--dry-migrate`-style flag (or
  hit `/api/healthz` with a 10 s timeout, then SIGTERM). ~10 lines in the
  build job.
- **Test requirement:** the step's green baseline at HEAD.
- **Risk:** low frequency (compile output regressions), high confusion when
  it hits — the deploy is where it surfaces.

### L15-8 · P4 · CI hygiene nits: suite-count tripwire is manual-only; coverage artifact upload warns instead of failing; docker.yml edits bypass the code filter
- **Evidence:** (a) `.hermes.md:42-44` defines the "combined total far below
  ~3,000 means a suite silently did not run" tripwire — but no CI step
  asserts test/file counts; a silently-emptied suite (config include break)
  exits 0. (b) `ci.yml:475` (`if-no-files-found: warn`): if the coverage step
  dies before writing reports, the artifact silently doesn't upload. (c) the
  code path filter (ci.yml:141-157) lists `ci.yml`, `Dockerfile`,
  `docker-compose.yml` but NOT `.github/workflows/docker.yml` — a docker.yml-
  only edit takes the docs-only route (harmless for the node gates, but the
  YAML never gets exercised until dispatch/tag either way).
- **Proposed fix:** (a) one step in each tests leg: parse vitest's json
  reporter summary and fail below a floor (backend ≥2,400 tests / ≥250
  files; frontend ≥2,250 / ≥240 — the .hermes tripwire, automated);
  (b) `if-no-files-found: error`; (c) add docker.yml to the filter list for
  cleanliness.
- **Test requirement:** the floors themselves (calibrate green-first).
- **Risk:** silent coverage loss with a green checkmark.

---

## CI failure-class coverage matrix

Verdict legend: ✅ protected on every code push · 🟡 partial/deferred/weekly · ❌ unprotected.

| # | Failure class | Protected by (gate @ file:line) | Verdict |
|---|---|---|---|
| 1 | Secret in a new commit | gitleaks push scan, last-commit scope (ci.yml:73-97) | ✅ |
| 2 | Historical secret | schedule full-history scan (ci.yml:84-91) | 🟡 weekly (fixed class since R130 allowlist; run 424 precedent) |
| 3 | Lint / type regression | checks job: impeccable → lint → typecheck (ci.yml:313-342) | ✅ |
| 4 | UI anti-pattern (slop) source patterns | impeccable source gate (ci.yml:313-336) | ✅ source-only (rendered-mode scan = documented Phase 2 decision) |
| 5 | Undocumented / drifting route | route parity gate (ci.yml:344-352) | ✅ existence-level (89 allowlisted gaps; semantics = lane N blind spots) |
| 6 | ErrorCode enum drift | YAML↔const sync gate (ci.yml:354-365) | ✅ |
| 7 | Spec header param dropped by codegen (N-1 class) | header-param survival gate (ci.yml:367-376) | ✅ VERIFIED + sabotage-re-demoed |
| 8 | Schema ↔ migration SQL drift | drizzle regen byte-diff (ci.yml:378-389) | ✅ bytes |
| 9 | Invalid SQL in the chain / broken fresh-install replay | NOTHING — bytes-only gate, no apply, no PG service | ❌ CONFIRMED (L15-2 / L9-1: 0003 rides green) |
| 10 | PG-vs-pglite grammar/behavior drift | NOTHING — pglite harness only, chain never applied | ❌ (same seam as #9) |
| 11 | Hand-edit of generated clients | orval regen diff over both src dirs, clean:true (ci.yml:391-402, orval.config.ts) | ✅ (verified mechanics; hand-written files outside generated/ are the sanctioned extension point) |
| 12 | Semantic spec loosening (spec+regen consistent) | response-contract zod pins, 49/111 ops, over-promising only | 🟡 (lane N classes 1-6; under-documentation passes) |
| 13 | Frontend bypasses typed client (raw fetch + casts) | per-site shape gates (settings-telegram-rows) only | 🟡 no machine check for the class (N-4 was the live proof) |
| 14 | Dead SPA shell (comment-swallowed tags) | source pins (shell-head-anchors) + comment-stripped budget/CSP gates + push-time boot smoke (ci.yml:529-558) | ✅ VERIFIED static, on push |
| 15 | Runtime boot failure (JS crash, CSP-at-execution, 404 asset at runtime) | weekly e2e heartbeat ONLY (ci.yml:577, schedule cron :19) | ❌ on push; heartbeat 0-for-3 and currently RED (L15-1) |
| 16 | Compiled backend artifact fails to boot | NOTHING boots dist (source-level app boot well-tested) | 🟡 low residue (L15-7) |
| 17 | Coverage regression (deleted covered branch) | report-only artifacts, 7-day retention (ci.yml:454-475) | ❌ thresholds deferred R137→R143 (L15-3; first money-path baseline now measured) |
| 18 | Critical CVE in prod deps | pnpm audit --prod critical (ci.yml:250-256), deps-gated + weekly | ✅ |
| 19 | High CVE in prod deps | informational step (ci.yml:237-248) | 🟡 INFORM by recorded triage policy |
| 20 | CVE in the published docker image | NOTHING — no trivy/grype anywhere (L15-4) | ❌ |
| 21 | Dockerfile / compose build regression | nothing on push (docker.yml dispatch/tag only; Coolify builds on VM) | 🟡 accepted design; first signal = deploy-time |
| 22 | TOTP / time-boundary test flake | regenerating retry at 2/5 sites (528ef39) | 🟡 3 bare sites remain (L15-5 / L8-2) |
| 23 | Cross-user money-read regression | H-1 suite + money suites (unit, push) | ✅ |
| 24 | Live-prod guest contract drift | weekly e2e against subnation.ly | 🟡 mechanism sound; signal dead while heartbeat red (L15-1) |
| 25 | Suite silently shrinks to zero tests | manual .hermes.md count tripwire only | ❌ no CI assertion (L15-8a) |

**Gates order / parallelism / wall time (measured from the Actions API):**
secret-scan (~15-20 s) + path filter (~5-8 s) run first and are `needs` of
checks/tests/build — the cheapest gate fails the run before any heavy leg
starts (a leak blocks in ~20 s). audit is deps-gated (filter `deps`) and runs
parallel. checks / tests(backend,frontend matrix, fail-fast:false) / build all
run in parallel after that — no workflow-level fail-fast (both matrix results
are kept as signal; only a NEWER push cancels via concurrency, ci.yml:23-25).
Within `checks`, the serial order is cheapest-first: impeccable source scan →
lint → typecheck → 4 drift gates (codegen regens last). Measured wall time:
run 482 = **6 m 58 s** total (backend leg 6 m 38 s is the critical path;
frontend 4 m 04 s; checks 1 m 11 s; build 36 s warm-cache; audit skipped — no
dep changes); run 481 = 7 m 43 s (failed backend leg ran to completion);
schedule run 471 = 6 m 18 s. Docs-only pushes are designed to collapse to
~2 min (ci.yml:116-120; heavy jobs skip via filter outputs) — no recent
docs-only run observed to confirm live. Per-job timeouts: 15 min heavy / 20
e2e / 10 secret+audit / 3 filter — ~2× headroom on the observed legs.

**docker.yml flow (end-to-end):** triggers = workflow_dispatch (optional `ref`
input) + `v*` tags only; concurrency per-ref without cancel; least-privilege
perms (workflow `contents: read`; `packages: write` only on the two publishing
jobs); every `uses:` SHA-pinned (checkout v4.4.0, buildx v3.12.0, login
v3.7.0, metadata v5.10.0, build-push v6.19.2 — the file's own r110 policy);
build args keep every VITE_* empty (single-origin contract); per-arch cache
scopes; build-and-push emits arch-suffixed tags (sha-<short>-amd64, semver,
latest, branch); the merge job probes GHCR for what actually landed and mints
canonical tags via `imagetools create`, failing loudly if amd64 is missing and
never retro-fitting immutable sha- tags. **Vulnerability scan step: NONE**
(L15-4). Publish history: 4 runs — 2 fully green (L15-4b contradicts the
file's STATUS header).

**481 → 482 anatomy:** run 481 (2df0a62) failed in exactly one job/step —
backend suite, the TOTP Step-2 boundary race (L15-5); every other gate
including the newly-landed boot smoke and header-param gate was green on the
R142 wave commit itself. 528ef39 (test-only, 1 file) flipped run 482 green.
The R142 wave therefore shipped through CI with its own two new gates already
proven on the failing run's build/checks legs.

**Test-quality sweep at HEAD (re-verification of lane M's R142 census):**
zero `.skip(` in backend+frontend unit trees (the only 10 hits are the
per-file e2e opt-in `test.skip(!E2E_ENABLED)` lines); zero `.only(`; zero
`it.todo`/`describe.todo`; zero literal tautologies
(`expect(true).toBe(true)` / `expect(1).toBe(1)`). The anti-tautology culture
(concurrency.test.ts's deleted-todo pointers) is intact.

## Not checked / limits

- The live GHCR registry was not probed (needs read:packages PAT — the 403
  anonymity problem L15-4 documents); docker conclusions rest on the Actions
  run record. No e2e run was executed in this sandbox (needs a live stack;
  the heartbeat evidence is run 471's log). The full backend/frontend suites
  were not re-run (charter + sandbox limits — lane M precedent); the 28-suite
  money run stands as the executed evidence. Playwright browser install and
  coverage artifact contents on GitHub were not downloaded. orval regen was
  NOT executed (would rewrite generated trees; mechanics argued from config +
  gate logic + run 482's green drift steps).
