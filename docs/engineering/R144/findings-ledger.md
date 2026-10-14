# R144 Findings Ledger — consolidated & reconciled

Base: `ee5c5cf` (R143 head) → `5293b9e` (R144 head — 7 commits:
`7b21bcc` deps · `d75e446` migrate decomposition · `0cfcbef` storefront
fetch consolidation · `4e4f2c3` ops watchdog + operator runbooks ·
`387ffe0` RBAC page pins · `e5a0977` eager-budget decision · `5293b9e`
progress log). Sources: the R143 findings-ledger's open/deferred items +
the R144 lane reports (`/home/z/my-project/worklog.md` Task 144-C / -D /
-E1 / -E2 entries) + the round docs-fix lane. R144 was an **execution
round, not a fresh audit**: every R143 open item carries its FINAL status
below. Disposition: CLOSED-R144 (landed, commit cited) · OPERATOR
(external, honestly open) · DEFER (documented deferral).

## FINAL STATUS

All CLOSED-R144 dispositions landed in `7b21bcc..5293b9e` (local round —
not yet pushed). Full local gates at `5293b9e`: lint 0 errors (62
pre-existing warnings — the documented baseline) · typecheck clean ·
build + PWA green (Vite 8.78 s; eager 146,138 B silent ≤ 153,600; PWA
v1.3.0 generateSW precache 10 entries / 343.36 KiB; the migrate/
family's cyclic import graph bundles clean) · backend 270 files / 2,510
tests (shards 910 + 791 + 809) · frontend 256 files / 2,433 tests
(shards 772 + 805 + 856).

## The R143 open items — every one reconciled (11 rows, none dropped)

| ID | R143 open item | FINAL status (R144) |
|----|----------------|---------------------|
| L16-2 | migrate.ts split (4,378 lines, danger-flagged, "never batched") | **CLOSED — `d75e446`**: 4,378 → a 2,049-line gate-exempt orchestrator + the 8-module `migrate/` family; `runMigrations` byte-identical at 1,925 lines; 41/41 functions verbatim; 35/35 façade symbols; `build.mjs` fast-path hash extended over the migrate/ tree; battery 27 files / 201 tests incl. the PGlite fresh-install replay; size gate 4/4. Executed alone, as the danger flag required. |
| L10-1 residual | firebase-admin 14.x (clears the 2 MODERATE uuid advisories) | **CLOSED — `7b21bcc`**: firebase-admin 13.10.0→14.5.0 (app+auth-only usage — the major is a drop-in; firestore 9.3.1 / storage 8.4.0 arrive as optionalDependencies); uuid GHSA-w5hq-g745-h8pq ERASED from the api-server graph via google-gax 6.12.1; audits 43→32 — PROD TREE CLEAN. Also: express-rate-limit 8.4.1→8.7.1 (rate-limit-redis 5.0.0 peer resolved), vite 7.3.2→7.3.7 (GHSA-fx2h-pf6j-xcff HIGH cleared), vitest 4.1.6→4.1.11, esbuild 0.27.7 (tsx-blocked LOW documented), postcss floor ≥8.5.23→8.5.30. |
| L16-3 residual | storefront user-side raw-fetch family (~20 sites) | **CLOSED — `0cfcbef`**: 20 sites onto `customFetch` incl. the 3 deferred ApiError-`.data` restructurings; the raw-fetch adoption gate pins the 13 deliberate remaining occurrences across 7 files; custom-fetch-network battery — 20 tests (timeout / abort / network / 4xx / 5xx / malformed-JSON / 401 / concurrency). |
| L16-5 (storefront half) | storefront error-message unification | **CLOSED — `0cfcbef`** (error-copy unified with the consolidation). Admin-side copy residual: **DEFER** (documented — copy-level only; R143 already threaded the admin FETCH family). |
| L13-4 | RBAC page mutation test (deferred from R143's partial) | **CLOSED — `387ffe0`**: 6/6 pins — zero-scope destructive gate, exact-scope wire bodies, super-admin `permissions: ["all"]` preserve (the demotion regression class), session-kill disclosure before the POST. |
| L11-2 | eager-budget trim-or-raise decision | **CLOSED — `e5a0977`**: measured 146,850 B gz = 98.9% of the old warn line (R120 set 145 KiB with no documented rationale) → warn raised 145→150 KiB WITH the basis recorded (constant + PERFORMANCE.md/README lockstep); hard 160 KiB fail untouched (10.4% room); 105/105 gates. |
| L17-1 | Traefik :8080 dashboard/API + Reverb :6001 publicly exposed | **OPERATOR — honestly open**: remediation runbook + verification protocol SHIPPED (`docs/deployment/EXPOSURE_REMEDIATION_R144.md`, §3 preference order + §4 external verification incl. the Traefik `/api/version` probe going dark); **still live at the 2026-10-14 external probes** — reported, not claimed closed. |
| L17-5 | no external uptime watchdog (dead-container MTTD ≤ 7 days) | **IMPLEMENTED repo-side — `4e4f2c3`**: `uptime-monitor.yml` (5-min cron + `workflow_dispatch` test_alert drill; home + healthz + TLS-14-day probes; Telegram alert/recovery mirroring `alerting.service.ts` format; zero third-party actions; env-only secret hygiene). Activation **blocked on the 2 repo secrets** (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`); the test_alert drill is documented; **alert delivery NOT yet verified** — honest. |
| L12-5 / GSC | GSC verification token empty in production | **OPERATOR — honestly open**: runbook SHIPPED (`docs/deployment/GSC_VERIFICATION_R144.md`: token → `VITE_GSC_VERIFICATION` build arg → redeploy → verify, + the DNS-TXT alternative); **blocked on the owner's Google-account token** — never invented. |
| L18-1 / L18-2 | the two R142 ex-false-claims (fixed in R143 — verify they're real) | **RE-VERIFIED REAL (E1, independent)**: L18-1 opportunistic suite — 7/7 pass, two legs mutation-grade (hung-run floor re-arm; stale-finally vs the new entry's flag); L18-2 support conversion — 5 generated-client sites in `support.tsx`, 17/17 pass. |
| Mission §E | financial-invariant coverage (8 checklist items) | **Coverage map COMPLETE (E1)**: all 8 items covered by REAL existing tests — spot batches 45/45 + 61/61 green; no redundant tests manufactured (none needed); **zero production defects found · zero log leaks** (money-path loggers carry counters/messages only; redaction suite pins the property). |

## Implementation summary (7 commits, worklog lanes 144-B..F8)

- **Deps (`7b21bcc`)** — the firebase-admin 14.x major behind the firebase
  battery (app+auth-only usage verified; uuid advisory erased via
  google-gax), the express-rate-limit peer era, vite/vitest/postcss bumps,
  esbuild with the documented tsx-blocked LOW exception; audits 43→32,
  PROD TREE CLEAN.
- **migrate.ts decomposition (`d75e446`)** — the L16-2 danger-flagged split,
  executed alone: orchestrator + 8-module `migrate/` family, byte-identical
  `runMigrations`, 41/41 functions verbatim, 35/35 façade symbols, fast-path
  hash extended, 27-file/201-test battery incl. PGlite fresh-install replay.
- **Storefront fetch consolidation (`0cfcbef`)** — 20 sites onto
  `customFetch`, the adoption gate (13 pinned occurrences / 7 files), the
  20-test network battery, storefront error-copy unification (L16-5 half).
- **Ops (`4e4f2c3`)** — the external uptime watchdog workflow + the two
  operator runbooks (exposure remediation, GSC verification) +
  OPERATIONS_RUNBOOK §16 + the docs/README index rows.
- **RBAC page pins (`387ffe0`)** — 6/6 mutation-grade page tests for
  admins.tsx (L13-4).
- **Eager-budget decision (`e5a0977`)** — measured + decided (L11-2): warn
  145→150 KiB with the basis recorded; hard 160 untouched.
- **Progress log (`5293b9e`)** — the 2026-10-14 round ledger entry.

## Operator handoffs (external — honestly open, not closed)

| # | Handoff | Artifact | Honest status |
|---|---------|----------|---------------|
| 1 | Close 8080/6001 (Coolify proxy stop first, then the Contabo 22/80/443 firewall backstop) + run the §4 verification | `docs/deployment/EXPOSURE_REMEDIATION_R144.md` | STILL LIVE at the 2026-10-14 external probes |
| 2 | Add `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` repo secrets (the §12 Coolify values of record), then dispatch the "Uptime Monitor" workflow with `test_alert` | `OPERATIONS_RUNBOOK.md` §16 · `.github/workflows/uptime-monitor.yml` | watchdog live repo-side; alert delivery NOT yet verified |
| 3 | GSC: URL-prefix property → HTML-tag token → `VITE_GSC_VERIFICATION` build arg (Coolify §2.2) → redeploy → verify | `docs/deployment/GSC_VERIFICATION_R144.md` | blocked on the owner's Google-account token |

## Remaining accepted exceptions (documented, not debt-in-hiding)

- **esbuild LOW** — tsx-range-blocked upstream; serve-mode unreachable in
  this repo's build shape.
- **@lhci/cli dev-only chain** — latest 0.x; the documented dev-only
  dependency policy.
- **Unpatchables** — braces / extract-zip / sprintf-js (no upstream fix).
- **Admin-side L16-5 copy residual** — copy-level only; documented
  deferral (the storefront half landed in `0cfcbef`).

## Verification evidence

- Local full gates at `5293b9e` (numbers in FINAL STATUS above; commands +
  shard outputs in the round worklog entries).
- E1 independent re-verification runs: opportunistic 7/7 · support family
  4 files/17/17 · money spot batches 45/45 + 61/61 · checkout-coupon
  perline 9/9.
- Round record commit: `docs(r144): the round record — the ledger
  reconciled, the honest operator handoffs, the restamp` (this file +
  CHANGELOG R144 + the `.hermes.md` restamp + the reviewer's 2 doc fixes).
