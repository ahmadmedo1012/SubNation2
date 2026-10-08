# Changelog — SubNation2

One entry per repair round, newest first. SubNation2 ships by round (no
semver); each entry lists the feature-level changes with their evidence
trail. Rounds before R116 are summarized compactly at the bottom — full
history: `git log`, the release ledger `docs/deployment/FINAL_SIGNOFF.md`,
and the round reports indexed in `docs/README.md` (historical rounds now
live under `docs/history/` — executed R122).

## Round R122 — full-spectrum audit quartet + Arabic search + DB safety + docs truth — 2026-10-07

Eleven parallel read-only auditors (storefront UX, admin, backend, database,
security, performance, SEO, code quality, testing/CI, docs truth, live
browser) over `1f4b24c`, then nine fix agents; 10 thematic commits
`e91cab0`→`663ee8e` + this docs commit. Gates on the merged tree: backend
214 files / **2003 tests** PASS (+15/+224), frontend 125 / **853** PASS
(+3/+10), typecheck clean, lint 0 errors, build + budget PASS with the
eager path **152,438 → 144,618 B gz** (out of the warn zone). CI verified
ALIVE and green on every R122 push (the repo is PUBLIC — the
"private-billing dead CI" premise was false; stale comments corrected).
Live-verified post-deploy: Arabic search («نتفليكس»/«نتفلكس»/«سبوتيفاي»/
«ديزني»/«في بي إن»/«يوتيوب» all resolve), unknown-path shells noindex,
sitemap per-route lastmod, Sentry release `663ee8e` in the live bundle,
healthz green, CI green.

### Security
- **RBAC grants subset-bounded** (`e91cab0`): a scoped admin could mint
  puppet admins holding the full 7-scope union (functionally "all",
  bypassing the H9 gate) — grants are now inside the actor's own envelope
  on create, patch AND the re-enable path. 2FA setup-verify gained the
  per-admin lockout its login sibling had; deep healthz subroutes are
  settings-scoped like their diagnostics twins; sessions/providers carry
  `no-store`.
- **Money-ledger FKs CASCADE→RESTRICT** (`108ebde`): a manual
  `DELETE FROM users` could atomically erase a user's entire financial
  history — V1-M25 (probe-gated, V1-M9/M21 discipline) rebuilds
  wallet_ledger/points_ledger/orders/wallet_topups user FKs as
  `ON DELETE RESTRICT`; V1-M26 adds the two money CHECKs the R118 sweep
  missed (the wallet arithmetic identity in the type-aware purchase-debit
  form); drizzle chain mirror `0018`; `drizzle-kit push` fenced behind
  `I_ACCEPT_DRIZZLE_PUSH_DANGER` (one push against the boot-built live DB
  = drop/recreate all 40 FKs by name — the one-command outage, A4-P1-1).

### Fixed
- **Arabic search** (`aaed70a`): the live-verified defect «نتفليكس» → 0
  results against an English-named catalog. Query-side bridge: Arabic
  normalization (tashkeel/tatweel/alef folds/Arabic-Indic digits), a
  65-entry curated brand-alias map from the real catalog, transliteration
  fallback with hard bounds. Pure-English SQL byte-identical to before.
- **SEO shell** (`6ba4b5e`): the product shell prefers row-level
  seo_title/seo_description (write paths now wired through zod + copilot
  ALLOWED_FIELDS — the columns were write-orphaned [corrected R123: the
  R122 phrasing "through admin form" overclaimed — no admin form existed;
  copilot (+ the zod/API surface) was the ONLY write path. The admin
  product form's SEO fields land in R123.]); unknown
  public paths + dead category slugs emit `noindex,follow` (the raw shell
  no longer contradicts the SPA's 404); the uncached `/product/:slug`
  shell lookups ride the catalog cache (they sat outside every rate
  limiter — cheap-DoS surface); a boot-time comment-balance guard refuses
  to run the rewriter on an imbalanced shell (the d22f24e class);
  per-route sitemap lastmod (editorial statics omit the noisy tag);
  recommendations DTO carries slug.
- **Storefront UX** (`2cb85b4`): guests get shaped RouteSkeletons instead
  of blank/zeroed frames; login redirects preserve the full return path
  (commerce `?redirect=` idiom); `<Link><button>` nesting eliminated;
  RTL Telegram-account row reads correctly; hero chips navigate; in-stock
  items surface first where the grid allows; Arabic plurals, letterspacing
  unification, ≥44px tap targets; MetaTags clamps at word boundary and
  stops declaring 1280×720 on ~450px images.
- **Admin UX** (`dc11827`): the referrals credit button is finance-gated
  client-side (the last un-gated money action); the dashboard shows the
  honest error state on 403/5xx (was a false "no orders yet"); the
  always-green status pill reflects error/stale; GlobalSearch + money
  KPIs scoped by permission; bulk topup actions take notes; ~30 raw
  fetches routed through the 401-aware admin-session contract
  [corrected R123: overcounted — only GlobalSearch (3 sites) was routed
  in R122; the ~56 remaining raw-fetch sites are converted in R123];
  product form gains the SEO fields [corrected R123: the form fields did
  NOT land in R122 — see the SEO shell correction above; they land in
  R123].
- **Backend contracts** (`c2f531a`): pageParam capped (unbounded OFFSET
  closed); loyalty referral counts exact past the 200-row limit +
  pagination; cart `intParam` digit-exact; idempotency body-hash
  key-order-insensitive (canonical JSON serializer — reordered identical
  bodies no longer false-409); checkout dead branch → honest assertion;
  points-replay bounded.

### Build/Deploy
- **Deploy-time typecheck gate** (`ad05d11`): Coolify's push-webhook
  deploys WITHOUT waiting for CI — the Docker build now enforces
  `pnpm run typecheck` (the strongest cheap gate) before bundling; the
  R104 build-only comment rewritten honestly. The lucide manualChunks
  rule (all 135 icons pinned eagerly) removed: eager path −8 kB gz, back
  under the warn line with 5.9 kB headroom.
- **Money-path tests** (`772be0f`): the Telegram chat-button topup
  approve/reject path (allowlist, stale pre-check, exactly-once incl.
  callback replay, actor attribution, always-200) had ZERO coverage —
  now pinned over the real TopupService; whatsapp/verify + firebase/
  refresh contracts pinned (43 tests).

### Docs
- **Truth pass + 4-bucket reorg** (`663ee8e` + this commit): 24 false/
  stale statements fixed across 17 files (all 7 "www serves 200" claims →
  the live redirect; "Sentry optional" → live; README test counts + CI
  section; the org:ci token-swap recommendation actually logged); the
  runbook restructured to 6/6 operator sections (Coolify-first rollback,
  Sentry pipeline, Telegram ops, edge canonicalization, GSC, backups);
  CHANGELOG R121 entry; 74 files → `docs/history/`, 16 →
  `docs/deprecated/`, 1 → `docs/pending/`; ~46 links repointed, 0 broken
  (97 verified). R122 verification correction: the live www→apex status
  is **301** (probed HTTP/2 + HTTP/1.1, path+query preserved) — the R121
  record's "308" digit was wrong; runbook §13 + WWW doc updated.

### Known open items (operator)
- **Catalog 98% sold out** (44/45 products) — restock is a business
  decision through the (intentionally deferred) inventory/Embronic track.
- GSC `VITE_GSC_VERIFICATION` still awaits the operator's token
  (paste-and-go).
- Product `seo_title`/`seo_description` are wired end-to-end but EMPTY on
  existing rows — filling them (Arabic keyword titles per product) is the
  next highest-leverage SEO action for the operator.
- Sentry org:ci token swap recommendation stands (runbook §11).

## Round R121 — admin revival + Telegram ops + 308 edge + Sentry LIVE — 2026-10-07

Triggered by a live browser audit of all 20 admin pages (session minted for
the audit, revoked after). Chain `b5c9151`→`1f4b24c` plus two operator
actions at the edge/env; every fix verified on production post-deploy.

### Fixed
- **Broken admin surfaces revived** (`b5c9151`):
  `/admin/products/enrichment` + `/admin/risk/events/:id` rendered the
  PUBLIC 404 — the top-level dispatch used `/admin/:rest*`, which regexparam
  3 parses as a single segment (`[^/]+?`), so nested paths fell through to
  the storefront NotFound; bare `/admin/*` is the true multi-segment splat
  (verified against regexparam 3.0.0's parser). `/admin/system` hit the
  error boundary — the metrics endpoint wraps its snapshot in a
  last-known-good envelope (`{value, lastKnownGoodAt, stale}`) while the
  page read the flat shape; the query now unwraps and treats `value:null`
  as an honest error state. Post-deploy re-audit: all 20 admin pages
  render; cold-start-settle 400s gone.
- **Sentry fully activated, both sides** (`8530dfa` + `e1de0e6` + Coolify
  env): org `subnation` (EU/de), projects `javascript-react` +
  `subnation-backend`; `VITE_SENTRY_DSN` (frontend build arg) + `SENTRY_DSN`
  (backend runtime) + `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`
  (build args → source-map pipeline). The vite plugin release is pinned to
  `VITE_RELEASE_SHA` (was `name@version` — orphaned maps) with Dockerfile
  ARG passthrough. Deploy `e1de0e6` exposed a real gate bug: Coolify
  passes `GIT_SHA` declared-but-EMPTY and `??` kept `""`, slipping
  `--release=""` past the gate — switched to `||` with a `SOURCE_COMMIT`
  fallback. Verified END-TO-END under release `e1de0e6`: both bundles'
  upload reports green; `sentry-debug` → `dsnConfigured:true,
  release:e1de0e6`; a controlled `?mode=throw` event reached
  `subnation-backend` (verified via API, then deleted); real-browser
  `__sentryStatus()` → `initialized:true, release:e1de0e6`; the console
  Sentry warning is gone. (Pipeline now documented in
  `OPERATIONS_RUNBOOK.md` §11.)
- **GCM `authTagLength` native enforcement** (`1f25dff`, recovered from a
  stalled agent session per `26035eb`): `createDecipheriv` now passes
  `authTagLength` at construction — native Node enforcement under the
  existing 128-bit `setAuthTag` gate; 25/25 encryption tests pass incl.
  the rotation ladder.

### Operator actions landed (same round, verified live)
- **Telegram ops channel LIVE**: `TELEGRAM_BOT_TOKEN` (login-bot reuse
  from `system_settings:auth.telegram`) + `TELEGRAM_WEBHOOK_SECRET`
  (generated) + `TELEGRAM_CHAT_ID`/`TELEGRAM_ADMIN_IDS` set in Coolify;
  webhook re-registered WITH the secret (deliveries had been 403-ing since
  R98). Verified via the app's own diagnostic
  `POST /api/admin/diagnostics/telegram-test` →
  `{configured:true, delivered:true, attempts:1}`.
- **www→apex 308 edge canonicalization**: standalone Traefik file-provider
  router `/data/coolify/proxy/dynamic/www-redirect.yml` (priority 1000,
  apex untouched); the dead v2-syntax `subnation.yml` that poisoned the
  whole dynamic directory archived with its 4 backups to
  `dynamic-archive/`. Live probes: www → 308 apex (query preserved), apex
  200, all 12 routers enabled.

### Verification
- **R121-C security sweep** (semgrep auto + trivy CRITICAL + gitleaks full
  history): one real finding — the GCM fix above; everything else
  false-positive (telegram/aws/jwt "key" hits are synthetic test fixtures;
  the 2 gcp-api-key history findings are the PUBLIC Firebase web key;
  `minimumReleaseAge: 1440` already set). Trivy: zero CRITICAL.
- **R121-D e2e: 19/19** (Playwright/Chrome) — storefront journey
  (home → category → product → cart → checkout guest gate), auth gates
  never 5xx, API contracts (products/providers/healthz/sitemap/robots/404
  shape), login shows Google + Telegram; mobile 390px: no overflow, zero
  console errors.
- **R121-E Mimosa deep scan** (seal sha256:1f52f7e8…): 716 files, 174
  entry points, 686 auth surfaces, **124 findings — 0 real issues** (the
  record for this repo): all 13 "actionable" candidates debunked
  (strict-regex topup callback ≠ command injection; JS `Array.sort()` ≠
  mongo `$sort`; parseInt-defaulted query params); 12 HIGH false
  positives; 99 inconclusive = query-budget exhaustion, not safety.

### Gates
Backend 199 files / 1779 tests, frontend 122 / 843, typecheck clean
(R120 baseline + the `37ac15e` polish + R121 additions).

### Known deferred (operator-only)
GSC `VITE_GSC_VERIFICATION` token (paste-and-go — runbook §14); swap the
full-scope Sentry build token for an `org:ci`-scoped one (runbook §11
recommendation, not blocking).

## Round R120 — full-spectrum product excellence — 2026-10-07

8 specialist auditors (storefront UX, admin UX, mobile, a11y, frontend
code/perf, backend/DB, SEO/content, security) → 129 findings; 6 fix
agents closed ~70 (all P1/P2-actionable + cheap P3s) in 5 commits +
1 verified-on-production hotfix. Reports: `tool-results/r120-audit-*.md`
(outside the repo) — headline evidence below.

### Fixed (P1/P2)
- **SEO money pages were invisible** (`5d2de5b`): category + flash-sales
  discarded the `useSeo()` element (default title, zero JSON-LD on 8
  sitemap-promoted pages); `/support` hard-redirected anonymous visitors
  to /login (11 pre-sale FAQs unreachable); the static shell canonicalized
  EVERY URL to the homepage for no-JS crawlers. Now: per-route server-side
  canonical/title/description rewrite, real 404 for dead product slugs,
  noindex for auth families, public support FAQ with auth-gated inbox.
  Hotfix `d22f24e` (found verifying production): the rewriter is now
  comment-blind — the V3-A1 shell comment mentioning `<title>` in prose
  used to pair with the real title tag and eat the canonical + og set.
- **Storefront catalog affordance** (`c3965f0`): card surface 1.05:1 →
  border/shadow chrome; persistent desktop quick-add (was hover-only);
  available-first ordering (sold-out led the grid); mobile first-card fold
  915px → ~685px; guest bottom nav + cart tab; sold-out cards navigate
  again (pointer-dead + aria-disabled lie removed); Button-in-Link
  nesting eliminated; input borders 1.2→3.5:1; confirm-dialog focus
  return; OTP auto-submit mid-request edge.
- **Admin RBAC honesty** (`99ac56e`): coupons nav scope inventory→finance
  (403 wall), products page honest counts + server-side search (false
  catalog total), global open-tickets badge, finance-gated money UI,
  fake security checklist → facts, single-alert delete confirm, error
  cards on settings integrations, honest last-updated pill.
- **Data layer** (`4ae5de5`): loyalty/referrals share one cache identity
  (points conversion left /referrals stale 60s), tickets → the shared
  infinite-query idiom, bundle gate now covers the FULL eager path
  (152,460 B gz, warn >145 KiB, fail >160 KiB).
- **Backend** (`63ae271`): user money-history `page` param (200-row hard
  caps permanently hid oldest purchases), auth probe fails closed for
  sid-less tokens in prod, notification + ticket-list indexes (drizzle
  0017 + boot V1-M24), CreateOrderBody tightened (int/min 1, regenerated
  zod), admin tail routes zod'd, enrichment final_text 16k cap, OTP
  global daily send ceiling (OTP_DAILY_SEND_CAP, deduped admin alert),
  Dockerfile digest-pinned.
- **Independent-review polish** (`37ac15e`, post-entry): A4-F1 nesting
  sweep completed — the 6 remaining Button-in-Link instances (checkout,
  orders, order-detail ×3, StockoutRiskPanel) converted to the
  asChild/buttonVariants single-tab-stop idiom, pinned by the
  a4-f1-nesting-sweep test; A6-F1 fully closed — the orders page now
  CONSUMES `?page=` via the accumulating useInfiniteQuery idiom (a
  reseller past 200 orders could see but never reach order #201+; honest
  عرض N badge + load-more + cross-page dedup); guest bottom-nav enabled on
  `/product/*`; `openapi.yaml` documents the `?page=` param (4 user
  money-history routes) + `open_tickets` in admin stats; drizzle `0017`
  boot-stage naming corrected; copy fix «حقائق الأمان المطبَّقة» +
  `--text-2xs` 11→12px. Frontend gates after it: 122 files / 843 tests,
  lint 0 errors / 85 warnings.

### Gates
Backend 199 files / 1776 tests (+72), frontend 119 / 829 (+59), typecheck
clean, lint 0 errors / 84 warnings (−6), build in budget, frozen
lockfile OK, prod audit 9 (unchanged accepted register). Verified live
on production: category title/description rewrite, dead-slug 404,
/support 200 anonymous, /login noindex, unknown paths canonical-free.

### Known deferred (documented in round reports)
www→apex 301 + http→https 301 (edge/Coolify action); `VITE_SENTRY_DSN`
still unset (frontend telemetry off — operator action; the guard now
logs once, not 24×/load); GSC verification token unset; component
extraction of 14 >1,000-line files; CSS admin-share split; CSP img-src
`https:` register entry; A6-F2 X-Total-Count; A6-F9/F10 migrations.

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
reports and inspection folders indexed in `docs/README.md` (historical
rounds now live under `docs/history/` — executed R122).
