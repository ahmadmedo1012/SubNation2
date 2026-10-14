# R143 Findings Ledger — consolidated & deduplicated

Base: 528ef39 (R142+ head). Sources: 18 parallel investigation lanes
(findings-L{1..18}.md in this directory — full evidence with file:line).
Severity: P0 critical / P1 core-journey broken / P2 material / P3 meaningful /
P4 polish. Disposition: FIX-R143 (landed in 29f5cea) · OPERATOR (reported —
needs human action outside the repo) · DEFER (recorded decision).

## FINAL STATUS

All FIX-R143 dispositions landed in `29f5cea` (CI #483 green, deployed +
live-verified: 52/52 guest e2e on both projects; release identity probed via
data-route-chunks / latin-700 preload / honest flash-meta markers + fresh
entry hash). Full gates: lint 0 errors · typecheck green · backend 270 files /
2,510 tests · frontend 254 files / 2,418 tests · build + PWA green · OpenAPI
parity 84 ops · header params 7/7 · migration + orval drift clean.

## Aggregate: 0×P0 · 0×P1 (the R142 posture held under fresh 18-lane scrutiny)

## P2 (8 — all resolved or reported)

| ID | Finding | Disposition |
|----|---------|-------------|
| L9-1 | drizzle chain 0003 flash-sale singleton index `btree (true)` = 42601 on real Postgres; fresh-install replay dies at 3/24; bytes-only drift gate blind | FIX-R143 (SQL + schema TS + 0024 pair + chain-apply/body tests — L9-2/F-1 closed) |
| L2-1 | two-layer calm elevation = 21-site copy-pasted literal, theme-blind (30–40% black in .light vs the documented 6–14% ceiling) | FIX-R143 (--shadow-calm token, theme-aware, tree-wide sweep + ban pins) |
| L11-1 | PDP deep-link boots (dominant WhatsApp traffic) warm home instead of the product chunk — LCP 4892 ms | FIX-R143 (data-route-chunks gate; prefixes mirror route-chunk-warmup.ts) |
| L15-1 | weekly e2e heartbeat — the ONLY runtime boot guard — 0-for-3 red (selector picked the hidden Navbar toggle at mobile viewport) | FIX-R143 (scoped to main; verified green LIVE on both projects) |
| L15-2 | migration drift gate is bytes-only (confirms L9-1) | FIX-R143 (the chain-apply PGlite test runs in the backend suite = in CI) |
| L16-1 | backend had no size gate; 4 files >1,000 lines, 2 crossed during R142 unnoticed | FIX-R143 (backend-size-gate-r143.test.ts; caught products.ts 1,021 mid-round → extracted to 987) |
| L17-1 | **Traefik dashboard + unauthenticated API PUBLICLY EXPOSED on 169.58.100.161:8080, soketi on :6001** — violates the documented 22/80/443-only firewall contract | **OPERATOR — close 8080/6001 at the Contabo firewall (report to owner; not fixable from the repo)** |
| L17-2 | rollback runbook's deployed-SHA gate references healthz `.version` which is always null (schema is status-only) | FIX-R143 (runbooks now use the working SENTRY_RELEASE / healthz-ready probes) |
| L16-3 | 43 raw-fetch sites vs 2 wrappers (fetch-family fragmentation) | PARTIAL FIX-R143 (support.tsx + 10 admin sites threaded; the storefront user-side family remains — next round) |
| L18-1/L18-2 | two R142 FALSE completion claims (fabricated "opportunistic suite"; C-1's support half never landed) | FIX-R143 (tests written / conversion landed; IMPL-wave-report corrected in place) |

## P3 (selected — all FIX-R143 unless noted)

L7-1 lypay zero-dedup approval window (sender-account guard landed) ·
L5-1/L5-2 checkout coupon pre-flight timeout + honest 4xx-vs-transient
classification · L8-1 born-dead session (fail-closed) · L8-2/L15-5 TOTP
race at 3 remaining mint sites (armored) · L6-3 unbounded Firebase
verifyIdToken (bounded) · L9-3 set-count trim race (guarded DELETE + interleave
test) · L9-2/F-1 chain-apply test (LANDED — was deferred since R142) ·
L10-1 H-3 stale → firebase-admin 13.10.0 (HIGH cleared; 2 MODERATE remain,
need 14.x) · L1-1 onboarding orphaned (wired into 4 auth paths) · L1-2
topup-return dead-end (wallet affordance) · L1-3/L4-1 «شاهد» unstocked claim ·
L2-2 /60 sweep residue ×8 · L2-3 BulkConfirmModal floor · L2-5 admin focus
rings ×8 · L2-6 GlobalSearch focus · L3-1 tabular-nums no-op (truth pinned;
classes kept as future-proofing) · L3-2 dir=auto ×6 · L3-6 mobile money-route
specs (landed + live-verified) · L4-2 is_active EXISTS · L4-3 search re-sort
gating · L12-1 flash-sales meta truth (FE + shell) · L13-1/L6-2 admin
bare-fetch threading · L13-2 adminFetch timeout pin · L13-3 Copilot SSE
watchdog · L13-4 admin mutation pins (PARTIAL — RBAC page test deferred) ·
L14-1 the missing opportunistic test · L14-2 TOTP advisory capture · L14-3
Render→Coolify alert copy · L15-3 coverage baseline measured (report-only) ·
L15-4 docker.yml STATUS corrected · L16-4 isSessionExpiredError ×6
consolidated · L16-5 error-message bypass (37 sites — PARTIAL, next round) ·
L17-3 rollback hard-floor extension · L17-5 no external watchdog
(**OPERATOR decision**) · L17-6/L17-8 deploy-path seams (documented;
webhook-waits-for-CI is an operator Coolify setting) · L18-3 CHANGELOG order ·
L18-4/L18-5 .hermes restamp · L3-3 latin-700 preload · L7-2 formatLyd ×5 ·
L9-4 log prefixes ×22 · L14-5 Telegram TZ.

## P4 (fixed opportunistically where ≤3 lines: L5-3, G-4, G-5, L1-4, E-7,
L2-4, L2-7, L4-4, L4-5/L4-6, L12-2/3/5 documented; the rest recorded as debt
in the lane files)

## Deferred (recorded decisions)

- **migrate.ts split** (4,378 lines): now UNBLOCKED by F-1's landed tests, but
  danger-flagged — never batched with other work (L16-2). Next round's
  candidate.
- **Eager-budget headroom**: 146,130/148,480 B gz (0.3% under the warn line)
  — trim-or-raise decision with a measurement, next round (L11-2).
- **firebase-admin 14.x** (clears the 2 MODERATE uuid advisories): major
  bump, evaluate behind the firebase test battery (L10-1 residual).
- **Storefront user-side raw-fetch family** (~30 sites): rides the generated
  client adoption pass (L16-3 residual) with the error-message unification
  (L16-5).
- **Per-job observability in-app** (L14-4), **coverage thresholds** (A-2/M-3 —
  L15's baseline: admin/topups 26.8% branch is the weakest money surface),
  **spec churn** (N-2/N-3/N-5 unchanged), **BuildKit secret** (H-2),
  **external watchdog** (L17-5 — operator), **GSC token** (L12-5 — operator),
  **copilot per-tool latency** (L11-4), **caniuse-lite refresh** (L11-6).

## Verification evidence

- CI run #483 on 29f5cea: SUCCESS (all jobs).
- Live probes post-deploy: healthz 200 `{"status":"ok"}` · fresh entry hash
  index-BtO8WpXK.js · data-route-chunks present in the served shell ·
  latin-700 preloaded · /flash-sales meta carries the honest no-sale arm ·
  52/52 guest e2e (desktop-chromium + mobile-390) against the live release.
- Local full gates: see FINAL STATUS above (commands + numbers in the round
  commit message and /home/z/my-project/worklog.md).
