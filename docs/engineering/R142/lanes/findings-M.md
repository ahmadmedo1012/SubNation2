# R142 Lane M (RETRY) — Tests & tooling integrity audit (read-only)

Task ID: 142-M1r · HEAD a9f5e83 · tree clean (only untracked `docs/engineering/` lane outputs).
Scope: all 17 inventory files deep-read end-to-end (0 BLOCKED reads) + cross-cut review of
frontend/e2e/* (10 specs), playwright.config.ts, frontend/src/test/setup.ts, both vitest
configs, ci.yml (e2e/tests/build jobs + path filter), vite.config.ts bundle-budget gates,
frontend/src/lib/__tests__/shell-head-anchors.test.ts. Backend suite NOT re-run (per charter —
CI + lanes L/B/G re-ran green at HEAD: 344/120/190 + money suites). Frontend full suite
attempted, see BLOCKED below.

---

## e2e verdict (duty 2 — PRIORITY)

**What the 44 Playwright tests (10 files, 2 projects) assert:** guest read-only journeys only —
home boot (title, h1, product card, ZERO console errors), Arabic search with API-ground-truth
parity (search-arabic.spec.ts — API answer first, DOM must surface exactly that, or the exact
empty-state strings), cart/checkout login gates (buy-CTA-or-sold-out disjunction, the R128-IMP-4
evaporating-assertion repair), auth money-page redirects, robots.txt/sitemap + unknown-path
noindex + client 404 UI, mobile-390 overflow/tap-target floors, catalog-stats/auth-providers
contract smoke. No logins, no money, no admin — the design contract is written in the config
header and respected.

**Locally runnable?** Yes for enumeration: `cd frontend && PATH=/home/z/.npm-global/bin:$PATH
timeout 120 npx playwright test --list` → `Total: 44 tests in 10 files`. Actually *running*
needs a live stack at `E2E_BASE_URL` (default `http://localhost:8080`) plus `E2E_ENABLED=1`;
without the env var every spec self-skips (`test.skip(!process.env.E2E_ENABLED)`, 1 line/file,
all 10 accounted for).

**Why CI skips them:** `.github/workflows/ci.yml:534-535` — the `e2e` job's own guard:
`if: github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'`. Push/PR
NEVER run it (the path-filter gate only skips the heavy jobs on docs-only pushes; e2e is
excluded from push entirely by this `if`). The weekly cron (Mon 04:17) is the only heartbeat —
it targets `vars.E2E_BASE_URL` (live prod) and fails loudly against the default
`localhost:8080` if the variable is unset (documented: "configure the variable, don't silence
the heartbeat").

**Would they have caught the R141 dead-shell outage?**
- **On content: YES.** A shell whose injected entry/CSS/modulepreload payload sits inside a
  comment never boots JS. `home.spec.ts:12-17` fails within 15s (`h1` never renders — the
  static fallback is a no-JS notice, not an h1; product card never appears), and
  `seo.spec.ts:27` fails too (the client 404 UI «غير موجودة» never renders). The vite.config
  comment (line 66-67) even records the sibling incident class: the R125 CSP inline-script bug
  was caught by exactly these live "no console errors" assertions.
- **On cadence: NO.** The outage shipped through green push CI — the e2e job does not run on
  push/PR. Detection ceiling = the weekly heartbeat (≤7 days later), and only if
  `E2E_BASE_URL` is configured. R125 and R141 both went through this exact hole;
  api-contracts.spec.ts:26-27 documents the drift class in-file ("the e2e job is
  workflow_dispatch-only, so it hadn't run in rounds").

**The exact check that catches injected-tags-inside-a-comment:**
`frontend/src/lib/__tests__/shell-head-anchors.test.ts` — the R141 regression suite, which
DOES run on every code push (frontend leg of the `tests` matrix job). Three layers:
(1) `indexOfOutsideComments` primitive units incl. THE INCIDENT SHAPE;
(2) each custom injector (font preloads / preload gate / GSC meta) pinned comment-aware
against the reconstructed r140 shell AND the real index.html;
(3) **the tag-sequence ban (lines 224-236): NO comment in the real template may contain a
literal `<head` / `</head` sequence — the source-level gate that fails CI before any deploy
can ship a dead shell**, plus the anchors-live check (real head open/close exist outside
comments). Backend twin: `spa-shell-comment-guard.test.ts` (comment balance on the real
template + boot degrade) + the R120 hotfix describe in `spa-shell-rewrite.test.ts:648-719`.

**Is there ANY e2e/runtime-level guard?** Yes — `home.spec.ts` (h1 + card + zero console
errors) and `seo.spec.ts` (client 404 UI) are genuine runtime boot guards — but neither runs
on push; they are dispatch/weekly-only. The one guard that DOES run against a built artifact
(the `build` job's `bundle-budget` closeBundle on dist/public/index.html) is comment-blind in
exactly the dangerous spot — see **M-1**.

## Findings

**M-1 (P3) — the build job's only post-build shell checks are comment-blind where it matters.**
- File: `frontend/vite.config.ts:73-91` (bundleBudgetPlugin.closeBundle), `:134` (eager scan).
- Case: replay the r140 incident shape — a comment in index.html spelling out the head-close
  sequence. The custom injectors now skip it (R141 fix), but if Vite's own entry/CSS/
  modulepreload injection (or any future first-match injector) lands inside that comment, the
  entry lookup `html.match(/<script[^>]*type="module"[^>]*src="…index-*.js"/)` (line 84-86)
  still MATCHES the tag inside the comment, the budget gate happily measures the referenced
  file, and `process.exit(0)` — the build certifies a shell that can never boot. The CSP
  inline-script gate ten lines above already demonstrates the correct pattern
  (`html.replace(/<!--[\s\S]*?-->/g, "")` before matching, line 73-75); the entry lookup and
  the eager-path `<link>` scan (line 134) just don't use it.
- Fix: strip comments before both matches (reuse the same one-line replace) — a swallowed
  entry then fails the build with the existing "No module entry index-*.js found" error. 2
  lines, no new tooling.
- If skipped: the R141 class is caught only by the source-template unit test
  (shell-head-anchors ban) — a new injector or a Vite upgrade that regresses to first-match
  ships a dead shell with a green build job.

**M-2 (P3) — no push-time runtime guard: the boot-level e2e journeys never run on push/PR.**
- File: `.github/workflows/ci.yml:534-535` (e2e `if:`), `frontend/e2e/home.spec.ts:3`.
- Case: any regression that kills SPA boot (dead shell, CSP-blocked script, 404 entry asset,
  broken hydration) passes every push gate — checks/tests/build all green — and surfaces only
  via the Monday 04:17 heartbeat against live prod, ≤7 days after ship, and only when
  `vars.E2E_BASE_URL` is set. Two proven precedents in-file: R125 CSP inline script and the
  R141 dead shell (plus the R125 api-contracts drift pair).
- Fix (minimal): a push-time "boot smoke" — serve the built artifact (`vite preview` or the
  backend against dist) and run ONLY `home.spec.ts` with `E2E_ENABLED=1`; guest-only, no
  secrets, ~2 min. The full guest suite can stay weekly.
- If skipped: next R141-class outage is caught by users, not CI.

**M-3 (P4) — coverage gates promised for R137 never landed; both suites are report-only.**
- Files: `.github/workflows/ci.yml:448-451` ("thresholds land in R137 calibrated against the
  first CI runs"), `backend/vitest.config.ts:23-42`, `frontend/vitest.config.ts:55-73` —
  neither coverage block carries a `thresholds` key.
- Case: deleting a covered branch drops the number with zero CI signal; the stale comment has
  now outlived 5+ rounds (R137→R142). Coverage artifacts (7-day retention) exist since R136,
  so the calibration data the comment waits for already exists.
- Fix: land calibrated `thresholds` (or ratchet-style floors) in both configs, or rewrite the
  comment to record a decision "report-only by design". Either is ≤6 lines.

**M-4 (P4) — pin-test idiom: sound core, brittle tail (formatting-coupled pins).**
- Judgement: `toContain`-on-source-text pins are legitimate when the pinned bytes ARE the
  contract; three anchors each way below. The brittle ones all fail LOUD (throw / empty-map →
  parity mismatch), so the cost is maintenance noise + false alarms, never silent coverage
  loss.
- (a) Pins anchored to real contracts:
  1. `shell-head-anchors.test.ts:225-236` — the tag-sequence ban on the real index.html: the
     contract is the absence of that byte shape in comments (the R141 root cause itself).
  2. `spa-shell-comment-guard.test.ts:122-130` — comment-balance of the real shipped
     template: the d22f24e corruption precondition; a one-character unclosed edit fails CI.
  3. `rate-limits-intent.test.ts:221-236` — app.ts mount-order pin (three money-intent
     limiters BEFORE the generic `/api` limiter): ordering is the contract; a reorder that
     voids the 12/min budgets fails here.
  (Honorable mention, not source-text but the lane's strongest pin: `openapi-response-
  contracts.test.ts` — zod `safeParse` of every 2xx body against the orval-generated schema
  through the REAL app + pglite.)
- (b) Pins anchored to whitespace/layout brittleness:
  1. `spa-shell-category-parity.test.ts:37` — `entryRe = /^ {2}("?)([a-z-]+)\1: \{$/gm`
     demands exactly-two-space top-level entries; a prettier re-indent or a structural
     refactor of categories.ts yields zero blocks → loud false alarm on unchanged behavior.
  2. `spa-shell-route-parity.test.ts:71-77` — `useSeoCopy` takes the LAST string literal of a
     prop statement whose end is "first line with a trailing comma"; a template-literal
     title, a trailing comment, or statement re-layout changes which literal is "last".
  3. `spa-shell-rewrite.test.ts:225` (also 386-387/430/436) — `toContain('property="og:image:
     width" content="1280"')` pins the emitted attribute ORDER + spacing; an emitter change
     that reorders attributes (semantically identical meta) fails the pin.
- Fix: for the og pins, match the tag then extract `content` (the suite's own `metaContent`
  helper already does this — reuse it); for the extractors, accept and document the coupling
  (they fail loud) or export the copy as a typed constant both trees import. Lowest priority
  of the four findings.

## False-positive hunt (duty 3)

- Committed skips: **10** `\.skip(` hits — ALL are the per-file e2e opt-in
  `test.skip(!process.env.E2E_ENABLED, …)` lines (10 spec files, 1 line each). **Zero**
  `.skip(` anywhere in backend/frontend unit trees.
- `.only(`: **0**. `xit(`/`xdescribe(`: **0**. `it.todo(`: **0**.
- Literal tautologies (`expect(true)…`, `expect(1).toBe(1)`): **0**. The ~14 bare
  `.toBeTruthy()` uses sit on real objects (e.g. csrf-gate's boot assertion immediately
  followed by `typeof createCsrfGate === "function"`).
- Best counter-example found: `backend/tests/concurrency.test.ts` — five former `it.todo`
  race placeholders were DELETED and replaced with pointers to the real pglite tx-interleave
  suites (file + case line each), and the two pure pricing invariants are genuinely tested;
  the header explicitly refuses the `true === true` coverage-faking class. This is the
  repo's test-truth culture working as designed.

## Setup truth (duty 4)

- **Frontend:** jsdom environment; `src/test/setup.ts` = jest-dom matchers + afterEach
  cleanup + `asyncUtilTimeout: 5_000` (documented R130/R131 load-flake fix — patience only,
  no assertion weakened) + defensive `randomUUID` polyfill. **No MSW** — deliberate
  (vitest.config.ts comment): pages mock `@workspace/api-client-react` per-test with
  `vi.mock()` so each suite states exactly which generated calls it fakes.
- **Backend pglite census:** 255 test files under `src/**` + `tests/`; **170 (67%) import the
  pglite harness** (`initTestDb`/`resetTestDb`/`test/db`); **62 of 74 route suites (84%)**
  ride real SQL; 47 files use `vi.mock` (18%) — but 22 of those ALSO ride pglite (mocking
  externals like instrument/Redis/fetch while keeping real SQL), leaving **25 mock-only files
  (10%)**, and the ones read (scheduler-leadership, worker-sigterm, health-neon-fallback,
  rate-limits) are correctly unit-scoped with documented injection reasons.
- **Harness quality:** `src/test/db.ts` mirrors production constraint NAMES and definitions
  (chk_ledger_amount_nonzero, partial uniq_wallet_topups_payment_reference,
  chk_points_ledger_arithmetic, NULLS NOT DISTINCT variant dedup…) — the A10 round-93 fix
  that stopped the harness certifying prod-forbidden behavior. `src/test/env.ts` mirrors
  ci.yml exactly so local == CI boot.
- **Fixture realism:** real-world UA strings (16 in share-card-bot-split incl. Googlebot
  Smartphone), verbatim Arabic money copy, real RFC-shaped rate-limit headers, e2e specs that
  take the live API's answer as ground truth before asserting DOM, and one documented
  session-scoped cart write (no money) in cart-gate.spec.ts.

## Coverage at tooling level (duty 5)

Which CI job catches a broken build shell? **The `tests` (frontend matrix leg) job — via
`shell-head-anchors.test.ts` running in `vitest run` on every code push** (tag-sequence ban +
injector pins). The `build` job does NOT (M-1: its post-build entry gate is comment-blind;
only the CSP inline-script sub-gate strips comments). The `e2e` job WOULD (runtime boot
assertions) but never runs on push (M-2). Coverage itself is report-only (M-3). The gap
chain, concretely: source template guarded (unit, push) → injectors guarded (unit, push) →
built artifact NOT guarded against comment-swallowed payloads (build job, M-1) → runtime boot
NOT guarded on push (e2e, M-2).

## BLOCKED (recorded per charter)

- `cd frontend && PATH=/home/z/.npm-global/bin:$PATH timeout 235 npx vitest run --silent` →
  **exit 124** (killed at 235s; the 243-file/2,306-test suite exceeds a single ≤240s command
  window in this sandbox — the lane's first-attempt timeout class). Partial output showed only
  green files, no failures. Relying on recorded evidence per charter: worklog baseline
  (frontend 243 files / 2,306 tests), lane K's 7-suite frontend re-run green at HEAD (95
  tests), and CI green on every push (.hermes.md). Suite-count tripwire: no sign of a
  silently-not-run suite — file count matches baseline exactly (243).
- Backend suite intentionally not run (charter: CI + lanes L/B/G re-ran major parts green at
  HEAD — 344 / boot 120 / SEO 190 / money suites). Baseline 872 suites / 2,390 tests stands
  on recorded evidence.

## Verdict

The test infrastructure is unusually honest for its size: zero committed skips outside the
deliberate e2e opt-in, zero tautologies, an anti-tautology exemplar, a 67%-real-SQL harness
that mirrors production constraints by name, and contract pins that fail loud rather than
pass empty. The two real exposures are both in the same place — **the seam between "the shell
boots" and "CI says green"**: the build job's artifact checks are comment-blind exactly where
the R141 incident lived (M-1), and the only runtime boot guards run at most weekly (M-2).
Both fixes are single-digit-line changes. M-3/M-4 are hygiene.

Not checked: full frontend suite execution (BLOCKED, above), backend suite execution
(skipped per charter), live e2e run against a real stack, CI artifact contents (coverage
numbers), Playwright browser install.
