# R162-C — E2E heartbeat verification (ledger correction + first green heartbeat)

Task ID: R162-C · Lane C (E2E reliability truth) · 2026-10-17
Tree under verification: `ff53b858e9564b69657305cd12731a63cfad8bff` (= origin/main, R161 release + docs close)

This is a NEW evidence-backed note. No historical round report was edited;
corrections are recorded here only.

## (a) E2E_BASE_URL truth — R161 ledger correction

- API-verified this round (independently of the coordinator):
  `GET /repos/ahmadmedo1012/SubNation2/actions/variables/E2E_BASE_URL` →
  `{"name":"E2E_BASE_URL","value":"https://subnation.ly","created_at":"2026-10-10T21:35:29Z","updated_at":"2026-10-10T21:35:29Z"}`.
- Therefore the R161 round-close ledger item "the weekly job needs
  E2E_BASE_URL set" is **stale/false for the current state**: the variable has
  been set since 2026-10-10 (created during R128-IMP-4's heartbeat work, commit
  `eb50024`). The R161 report is left untouched; this note is the correction of
  record.
- The workflow itself is resilient either way
  (`.github/workflows/ci.yml:611`): `E2E_BASE_URL: ${{ vars.E2E_BASE_URL ||
  'http://localhost:8080' }}` — unset would fail loudly against localhost, not
  silently skip. The heartbeat design ("configure the variable, don't silence
  the alarm") holds.

## (b) Dispatch run evidence — the first heartbeat execution against the R161 tree

- Coordinator triggered `workflow_dispatch` on main at round start (HTTP 204);
  this lane polled it to completion.
- **Run 39066817448** — `event=workflow_dispatch`,
  `head_sha=ff53b858e9564b69657305cd12731a63cfad8bff` (the R162 tree, as
  required).
- Started `2026-10-17T20:27:57Z`, completed `2026-10-17T20:37:34Z` —
  **duration 9m37s**.
- **Conclusion: `success` — all 8 jobs green**, including the `e2e` job for the
  first time on a scheduled-class event:
  - Secret scanning (gitleaks) — success
  - **e2e — success** (test phase 2m12s)
  - Path filter (cost gate) — success
  - CVE scanning (pnpm audit, prod deps) — success
  - Unit tests (backend) — success
  - Unit tests (frontend) — success
  - Production build (API + Vite SPA) — success
  - Lint, typecheck, and drift gates — success
- e2e job (id 117496107927) log evidence: `Running 93 tests using 2 workers` →
  `93 passed (2.2m)`. **No flaky/retry markers** in the job logs (the
  `github` reporter collapses passing tests to dots, so per-project lines are
  not present in CI output; per-project counts come from the local run below).
- Local per-project breakdown (same tree, same target, list reporter +
  `--list` census): **desktop-chromium 31, mobile-390 31, tablet-768 31 = 93**
  — matching CI's total exactly.

### Local production-safe verification (sanctioned read-only runs)

`cd frontend && E2E_ENABLED=1 E2E_BASE_URL=https://subnation.ly pnpm exec playwright test …`
against https://subnation.ly, guest suite only:

- **Full suite (13 specs): 93 passed (7.9m), zero retries, zero flakes.**
- Targeted re-verification of the two history-relevant specs:
  - `login-page.spec.ts` (the scheduled-failure spec): **3/3 projects passed
    (13.5s)** — including mobile-390, the exact project/viewport that failed in
    run 38245700451. The R143 fix is independently confirmed on live
    production.
  - `home.spec.ts` + `mobile-390.spec.ts` (the R161 flake-adjacent specs):
    **24 passed (2.2m)**, all first-attempt.
- Production-safety contract held: no purchases, no topups, no logins, no OTP,
  no admin writes; the only non-GET is the documented session-scoped cart-gate
  add (`cart-gate.spec.ts` header note), never checked out.

## (c) Scheduled-failure root-cause history + in-main fix status

All 3 historical scheduled runs (workflow 273561264, state `active`, cron
`17 4 * * 1`) failed; each had a different, now-resolved cause:

| Run | Date (UTC) | Tree | Failed job(s) | Root cause | Status |
| --- | --- | --- | --- | --- | --- |
| 36412148403 | 2026-09-28 | `7191df01` | Path filter + gitleaks | Cost-gate + 2 secret-scan findings (pre-heartbeat workflow shape — no e2e job existed in the schedule yet) | Resolved in later rounds |
| 37302813560 | 2026-10-05 | `f10bb9b8` | gitleaks | 2 secret-scan findings (firebase-class, later killed/allowlisted by R128 `eb50024` "both live-verified leaks killed") | Resolved R128 |
| 38245700451 | 2026-10-12 | `dff50ad5` | e2e only (7 other jobs green) | `login-page.spec.ts` unscoped `buttons.first()` resolved to the Navbar desktop-categories toggle, hidden at the mobile-390 viewport → visibility timeout, 3-for-3 attempts | **Fixed in main** (R143 L15-1: locator scoped to `main button, main a[role='button']`, `frontend/e2e/login-page.spec.ts:16`) — verified green locally (this round) AND in dispatch run 39066817448 |

Note: the e2e job joined the weekly schedule in `eb50024` (2026-10-10,
R128-IMP-4), so 38245700451 was the FIRST — and until now the ONLY — scheduled
run to exercise it. Run 39066817448 is the first-ever green scheduled-class
execution of the heartbeat (as a dispatch), proving the whole chain:
variable → CI job → production target → guest suite.

## (d) Retries verdict — KEEP `retries: 2` (unchanged, rationale pinned)

Findings, honestly investigated:

1. **Retries cannot conceal the deterministic-defect class.** Scheduled run
   38245700451 executed WITH `retries: 2` active (verified:
   `git show dff50ad5:frontend/playwright.config.ts` → `retries: 2`) and the
   login-page defect still failed the run — the bad selector failed the
   initial attempt plus both retries (3-for-3). Deterministic failures are
   retry-proof by construction; Playwright only retries on failure, and a
   failure that fails every time fails the run.
2. **What retries DO smooth: transients against a live target.** The heartbeat
   points at real production (TLS handshakes, CDN cold starts, network blips).
   The R161 close recorded exactly one such case (a home-spec transient that
   passed on retry). Zeroing retries would turn 2-second network hiccups into
   weekly red alarms — alarm fatigue that erodes the heartbeat's whole purpose.
3. **Current retry-pass census: zero.** Neither the dispatched CI run (93
   passed, no flaky markers in job logs) nor this round's local full run (93
   passed in 7.9m, all first-attempt ✓) produced a single retry-passed test.
   Retries are not currently hiding any pattern.

**Verdict: keep `retries: 2`.** The verdict is pinned as a comment in
`frontend/playwright.config.ts` (R162-C) so future rounds do not re-litigate
it. No behavioral change was made.

## (e) Next scheduled run

- Cron `17 4 * * 1` = every Monday 04:17 UTC. Workflow state: `active`
  (API-verified), and 3 scheduled runs exist historically, so the schedule is
  genuinely armed (not just declared).
- **Next automatic heartbeat: Monday 2026-10-19 04:17 UTC.** With the fixes in
  main and E2E_BASE_URL set, it is expected to be the first-ever green
  *scheduled* run; it will run against whatever main is at that moment
  (currently ff53b858 + this round's merged lanes).

## Fixes made by this lane

- `frontend/playwright.config.ts` — comment-only (+3 lines): the retries
  verdict pinned at the `retries: 2` line. No behavioral change; config
  re-verified loading (`playwright test --list` → 93 tests in 13 files).
- No spec changes were needed: the dispatched run was green; the login-page
  fix was already in main and is re-verified here on production.

## Blockers

None. The dispatched run succeeded; no push was required.
