# Changelog — SubNation2

One entry per repair round, newest first. SubNation2 ships by round (no
semver); each entry lists the feature-level changes with their evidence
trail. Rounds before R116 are summarized compactly at the bottom — full
history: `git log`, the release ledger `docs/deployment/FINAL_SIGNOFF.md`,
and the round reports indexed in `docs/README.md` (proposed `docs/archive/`).

## Merge `966d70f` — 2026-10-06 (one main, one production chain)

Unified the R118 audit round with the parallel mission-waves line (below) —
both diverged from `ef3d0c3`. Reconciliations of record:

- **`encryption.ts` superset** — R118 crypto v2 kept (`v2:` prefix +
  `ENCRYPTION_KEY_PREV` rotation fallback + re-encrypt job); the waves-line W7
  strict 128-bit GCM auth-tag check ported into `decryptSegments` (the single
  funnel covering all three decrypt paths).
- **README status unified** — the merged README carries the single production
  story: Coolify git-source build + push-to-deploy webhook, Vercel/Render
  retired, R118 test counts.
- **`render.yaml` + `vercel.json` deletions ratified** (remote retirement wins;
  preserved in git history only).
- **Two latent type errors fixed** — auth-settings cache middleware express
  type imports (`NextFunction`/`Request`/`Response`); nullable `message`
  column type in `admin-credentials-gate-alert.test.ts`.
- **Gates re-verified on the merged tree** — backend 188 files / 1697 tests,
  frontend 111 / 770, typecheck clean, lint 0/90, build in budget (27,171 gz).
- Post-merge docs truth pass over the mission-era trees: R119-B4 (2026-10-07).

## Mission waves 0–10 — 2026-10-05 (Coolify-only productionization)

Parallel line by the mission agent (base `ef3d0c3`; merged in `966d70f`
above). Evidence: `docs/project-plan/10-progress-log.md` (append-only),
`docs/project-state/`. Headline commits: `d92de60` (W1), `af4d4ff` (W2),
`f717c6f`/`3f1dc2b` (W7), `62ee976` (retirement), `a507adb` (integrations
record).

### Changed
- **Coolify git-source cutover (Wave 1)** — new app `kjxqu3ytcnwb1btmlw56la5r`
  (applicationId 3): git source `#main`, dockerfile pack, push-to-deploy
  GitHub webhook (HMAC-verified), healthcheck-gated; old dockerimage app 2
  deleted; all 21 runtime envs migrated server-side; `SOURCE_COMMIT` build
  arg feeds `GIT_SHA` (`728b6a6`).
- **Vercel/Render retired** — Vercel project + GitHub App integration deleted
  after an independence proof; `deploy.yml` / `render.yaml` / `vercel.json`
  removed from the repo (`62ee976` — preserved in git history only).
- **Supply-chain overrides** — lockfile pins (protobufjs 7.6.6, busboy 3.2.2,
  ws ≥ 8.21.0, brace-expansion 2.1.7): Trivy prod vulns 35→11 at the time
  (one HIGH: node-forge, no upstream fix); OSV 113→75 (W7).
- **128-bit GCM tag strictness** — decrypt rejects auth tags that are not
  exactly 128-bit before `setAuthTag` (`bfc974b`; ported into
  `decryptSegments` by the merge).
- **WhatsApp control plane fixed + session paired** — root cause of the OTP
  outage (missing `openwa` network alias under Coolify's generated compose)
  fixed; session `subnation-otp` paired & READY (operator, 2026-10-05).
- **auth-providers 60s cache** — `cacheWrap("auth:providers:settings", 60)` +
  `Cache-Control: s-maxage=60, stale-while-revalidate=300` (`c37ddd5`).

### Added
- **29 mission doc files** — `docs/project-graph/` (14 Mermaid maps at the
  time; 13 after the R119-B4 stale-map deletion), `docs/project-plan/`
  (00–10), `docs/project-state/` (4) — incl. the Embronic adapter design (no
  invented endpoints) and the external-integrations final record.

## R118 — 2026-10-06 (landing this round)

Audit fleet (7 agents, reports under `docs/inspection-r118/`) + fixes.
Entries are feature-level on purpose: the exact file list lands via the
parallel fix agents — per-finding evidence, line cites, and fix sketches are
in the inspection reports.

### Added
- **Schema mirror guards** — the Drizzle TS schema now declares
  `uniq_points_ledger_type_reference` as UNIQUE and the 10 live CHECK
  constraints (7 money guards) that were live-DB-only; emitted as migration
  `0016`. A `drizzle-kit push` can no longer silently strip the points
  exactly-once guard or the money CHECKs (R118-A3 F2/F3).
- **Encryption key versioning** — credential blobs move to a versioned
  `v2:` format with a previous-key decrypt-only fallback
  (`ENCRYPTION_KEY_PREV`; rotation no longer orphans stored credentials),
  plus a re-encrypt path; see `backend/src/lib/encryption.ts` and the R118
  entry of the operator actions doc (R118-A4 F2).
- **TOTP secret at rest** — `admin_users.totp_secret` is now encrypted with
  the existing AES-256-GCM helpers (legacy-plaintext passthrough handled)
  (R118-A4 F4).
- **Buyer-side `decrypt_failed` honesty** — the buyer's order view now flags
  "cannot decrypt — contact support" instead of rendering empty delivered
  fields (parity with the R117 admin-side signal) (R118-A1 F-7).
- **`admin_alerts` created-at index** — the three admin alert read paths
  (list, `/new`, unread-count) stop seq-scanning as the table grows
  (R118-A6 F-4).
- **New operator docs** — `docs/README.md` (the docs index),
  `docs/operations/CONTABO_COOLIFY_OPERATIONS.md`,
  `docs/operations/NEON_COLD_START_RUNBOOK.md`,
  `docs/operations/WWW_TO_APEX_301.md`,
  `docs/operations/OPERATOR_ACTIONS_R118.md` (R118-A7 F34).

### Changed
- **Docs truth pass** — the stale set flagged by R118-A7 (40-file verdict
  table) is being reconciled this round; `docs/README.md` is now the
  front-door index with CURRENT/STALE/ARCHIVED status.

### Fixed
- **Topup approve/reject contract** — a contract-valid body without
  `admin_note` no longer 400s on the money-approval routes (null-conflation
  fix) (R118-A1 F-1).
- **Idempotency same-tick 409** — the middleware now honors its `SET NX`
  result: two same-key requests arriving in the same tick no longer both
  execute; the loser gets the documented 409 (durable DB claims were already
  the backstop) (R118-A1 F-3).

### Performance
- **`cacheWrap` single-flight** — concurrent cache misses share one loader
  run instead of stampeding Neon after every catalog TTL expiry / generation
  bump (R118-A6 F-2).
- **Product-detail stage collapse** — the detail route's sequential DB
  stages collapsed (3→1 for `/:id`), removing ~2× app→Neon RTT per
  cache-miss (R118-A6 F-1b).

### Tests
- ~13 new test suites pinning the above (schema mirror, encryption v2,
  topup contract, idempotency, single-flight, decrypt parity, alerts index);
  see `docs/inspection-r118/R118-A5-tests.md` for the coverage map.

## R117 — 2026-10-05 (commits 8acba4a · 6538909 · e394815 · ef3d0c3)

R116 verification + repair round ("docs/inspection-r117/" + round report
`docs/r117-round-report.md`).

### Security / reliability
- **OTP `lockPool`** — dedicated advisory-lock pool (max 2, 2 s connect,
  instrumented + drained on shutdown); an OTP start can no longer pin a
  runtime-pool client for a ~30 s WhatsApp send, and a failed
  `pg_advisory_unlock` destroys the client instead of leaking the lock.
- **Credentials-reveal volume gate** — 60 reveals / 10 min sliding window
  per admin; over-budget answers 429 + `Retry-After: 300` and raises a
  deduped admin alert naming the admin.
- **`decrypt_failed: true`** (admin-side) — orders reveal now says
  «تعذّر فك التشفير» when raw fields exist but every GCM auth fails,
  instead of a misleading empty panel.
- **Copilot path-gate fix** — `//`/`..` traversal checks run on the
  URL-normalized pathname only (legal queries with `//` in `?next=` stopped
  400-ing); split-era-origin boot warn restored (deleted by accident in
  `f10bb9b`).

### Health
- **Neon cold-resume warmup probe** — `checkNeonWith` runs an unmeasured
  warmup probe before the measured one: the first query after Neon
  auto-suspend no longer yellows `/api/healthz/summary` as "degraded" while
  every real check is green; genuine outages still escalate via the streak
  counters. `/healthz` got family-consistent `Cache-Control: public,
  max-age=5`.

### Frontend — mobile money-page + a11y
- Buy-panel mobile gutters restored (six blocks full-bleed against the card
  border — the round's P1); FAQ moved into the buy column so mobile
  DOM/Tab/reading order matches visual order (WCAG 1.3.2/2.4.3); the iOS
  keyboard-hide hook actually wired (+ orientationchange re-anchor); legacy
  `/product/123` rewrite no longer re-fires ScrollToTop; RouteAnnouncer
  dropped the stale pre-navigation title; sonner options forwarded; coupon
  buttons raised to the 44 px floor.

### SEO / schema / contracts
- Static `<link rel="canonical">` baked into `frontend/index.html` (survives
  the build); Drizzle `0015` mirror re-emit (V1-M23 `wallet_topups.
  reviewed_by`); OpenAPI documents `decrypt_failed` + the reveal-gate 429;
  orval clients regenerated; contract gate 83/83.

### Admin / docs
- Admin accounts cleaned to exactly one (`ahmadmedo`; the two disabled QA
  simulation accounts deleted in a transaction with audit rows).
- Docs truth batch (9 files): WHATSAPP_OPERATIONS Coolify rewrite,
  CLOUDFLARE_FINAL_CUTOVER §8 canonical-host addendum, money-invariant
  cites, Contabo observed-host notes.
- Gates: backend 165 files / 1517 tests · frontend 109 / 751 · typecheck
  clean · lint 0 errors / 89 warnings · entry 27.12 KB gz.

## R116 — 2026-10-04/05 (ca67360 + merge 7cee846 + f10bb9b)

The complete product overhaul (103 files, external contribution, merged and
verified). Full detail: `docs/r116-round-report.md`.

- **Security & money:** credentials-on-demand (the admin orders list no
  longer decrypts up to 600 credential fields per refresh — audited,
  no-store reveal endpoint instead); refund bulk path finance-scoped;
  `/api/auth/me` + `/probe` `no-store`; public search LIKE-escaped;
  safeDecrypt throttled + key memoized.
- **Storefront:** product-page desktop split (2-column + sticky buy panel);
  whole-dinar topups (USSD cannot carry fractions); `variant_label` chips
  through purchase; live wallet topup socket updates; 44 px tap-target
  sweep; route-change focus management + sr-only title announcer.
- **Design system:** shadow/AA-status token fixes, CTA recipe unified,
  `statusColor()` retired (10 sites), dead token families deleted.
- **Admin:** topup reviewer attribution (V1-M23); durable order-status
  notifications; `whatsapp_channel` alert type + send-failure watch.
- **Performance:** entry diet −8.7 KB gz (sonner lazy + replay bridge,
  admin-session dynamic import, Firebase gated on real use).
- **SEO:** 37 curated Arabic product entries (8 → 45 products) +
  `docs/SEO_PRODUCTS.json`; twitter/og static.
- **Fix:** `f10bb9b` removed the in-app www redirect that caused the
  Cloudflare loop (the www→apex 301 belongs at Traefik — see
  `docs/operations/WWW_TO_APEX_301.md`).

## Pre-R116 (2026-09-06 → 2026-10-01) — compact summary

Rounds 92–115: built and hardened the money core on the Render free tier
(R5 money-constraint P0 batch, R93-DATA corrupt-inventory gate, r104–r110
reliability/ops pass incl. the nightly 03:15 UTC backup cron), R111 UX/a11y
round, R112–R115 migration prep + Neon schema mirror + restore drills, and
the **R115 cutover to self-hosted Docker (Coolify on a Contabo VM, Traefik +
Let's Encrypt at origin) executed 2026-10-01/02** — release ledger:
`docs/deployment/FINAL_SIGNOFF.md`. Per-round detail: `git log` + the round
reports and inspection folders indexed in `docs/README.md` (proposed
`docs/archive/`).
