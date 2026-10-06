# Changelog — SubNation2

One entry per repair round, newest first. SubNation2 ships by round (no
semver); each entry lists the feature-level changes with their evidence
trail. Rounds before R116 are summarized compactly at the bottom — full
history: `git log`, the release ledger `docs/deployment/FINAL_SIGNOFF.md`,
and the round reports indexed in `docs/README.md` (proposed `docs/archive/`).

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
