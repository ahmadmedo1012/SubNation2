# Changelog — SubNation2

One entry per repair round, newest first. SubNation2 ships by round (no
semver); each entry lists the feature-level changes with their evidence
trail. Rounds before R116 are summarized compactly at the bottom — full
history: `git log`, the release ledger `docs/deployment/FINAL_SIGNOFF.md`,
and the round reports indexed in `docs/README.md` (historical rounds now
live under `docs/history/` — executed R122).

## Round R128 — المظهر (appearance) deep round: 15 auditors (7 visual dimensions) + 9 implementation lanes — admin palette unification (227 raw-hue hits → 0), coherent brand-asset suite, motion/typography closes, PWA leaks killed, cross-surface money/copy truth — 2026-10-10

The appearance round ("المظهر وكل ما يخصه"). Fifteen read-only auditors:
**7 A-lanes on visual dimensions** (A1 design tokens, A2 storefront
visual, A3 admin visual, A4 Arabic typography, A5 motion, A6 icons +
imagery, A7 appearance-tooling research) + **8 B-lanes** (B1 R127
residuals, B2 perf/PWA re-measure, B3 security red-team, B4 money
paths — the fourth full audit, B5 test quality, B6 Arabic SEO, B7 docs
+ GitHub presentation, B8 cross-surface consistency). Findings: **0 P0 ·
0 P1**, P2 ≈ 8, P3 ≈ 28, P4 ≈ 45 (docs/inspection-r128/). Nine
implementation lanes + parent closes landed every P2 and the
high-value P3/P4 set; B2 re-measured the R127 boot fixes LIVE: home
mobile LCP 4,307→3,111 ms (−28%), /login TBT 621→89 ms, all five routes
out of POOR.

### Storefront craft
- **Bidi title anchoring (A2-F1)**: every Latin product title anchored to
  the RTL reading edge — `text-right` alongside the existing `dir="auto"`
  on the card h3 + PDP h1 (Latin names floated 21–97 px off the edge,
  live-measured); `dir="auto"` added to the three truncating Latin-name
  sites (cart/checkout line names, bell messages) so the ellipsis eats
  the END, not the beginning.
- **Product-404 convergence (A2-F2)** + **gate-intent banners (A2-F4)**:
  the product 404 now rides the not-found.tsx recipe; gated
  wallet/orders/loyalty/referrals visitors get a per-surface
  «سجّل دخولك لمتابعة…» banner instead of cold generic chips — keyed off
  the SANITIZED `?redirect=` (open-redirect values never reach the
  banner). The **`/products` alias (A2-F3)** now redirects to home
  instead of a dead 404.
- **Typography (A4-F1/F3)**: `leading-tight` deleted from every
  storefront h1 + the login/register banner cousins (the base layer's
  Arabic-safe 1.3 floor owns the leading); **A4-F2 residue**: the admin
  `muted-foreground/70` 11 px ink pair → `/85` (AA both themes) —
  products/variants (lane) + the six coupons.tsx mobile labels (parent
  sweep).
- **Motion (A5-1/A5-3)**: `fill-mode: both` → `backwards` — the filled
  animation was permanently pinning `transform` on every
  `.card-spring`/`.press-spring` element (45 home cards, admin stat
  cards, category chips), killing the sanctioned hover lift; the blur-in
  reveal joined the fix. Press-spring now rides the cart steppers/trash
  + num-pop on the cart/unread badges.
- **Icons (A6 P4-4)**: the ✓ text-glyph residue swapped for lucide
  `Check` (product balance line, account-tab 2FA, alerts empty-state) —
  and the copilot tool-trace feed's emoji/✓/✗ prefixes render as lucide
  icons (render-layer swap; the string transport untouched).

### Motion
- Folded into storefront craft above (A5-1 fill-mode + A5-3
  press-spring/badge pop) — the motion lane's closes rode the same
  index.css + component commits.

### Brand assets
- **One mark everywhere (A6 P2-1/2/3, R128-L2)**: the fragmented suite
  (blank `#FF3C00` favicon, banner-lockup PWA icons reused as maskable,
  stale screenshot og card) replaced by ONE canonical shield+play tile
  in real token colors (`#dc1840` / white, 5.0:1): favicon.svg +
  favicon-32 + PWA 96/192/512 any + **true maskable** 192/512 (81 px
  safe-zone margin, pixel-scan-proven) + apple-touch 180 + a regenerated
  **1200×630 og card** (35.7 KB — tagline, wordmark, 4 category chips)
  + the structured-data logo (brush-streak artifact killed). MetaTags'
  og dims follow the real file (1200×630); every manifest ↔ IHDR ↔ meta
  dimension agrees. Scratch pipeline: `scripts/r128-l2/`.

### Design tokens + DESIGN.md
- **`frontend/DESIGN.md` (A1 §7)**: the published design-system contract
  for humans and design-aware tooling — every color is the computed
  equivalent of the HSL channel tokens (index.css stays the single
  source of truth). Adopted by the `.impeccable` config as its token
  feed.

### Admin console unification
- **The palette migration (A1-F1/A3, IMP2)**: 227 raw-palette line-hits
  → **0** across `pages/admin/**` + `components/admin/**` (~250 class
  tokens, 20 files). New AA-tuned both-theme tokens:
  `--status-success-surface` (retires the hand-rolled emerald-700
  approve button), `--status-purple`, `--tier-bronze/silver/gold/platinum`,
  plus the canonical 9-hue `--cat-*` family replacing
  `CATEGORY_INITIAL_COLOR` (the one true admin↔storefront hue split).
  D1 severity maps scripted across 14 files with alphas preserved
  byte-for-byte; topups badges → StatusBadge; layout count dots → the
  sibling pill's AA recipe; referrals medals → tier tokens.
- **Admin a11y/craft batch**: h1 unification across the 19 surfaces,
  drawer/chart/table polish (A3-F1/F2/F9), formatCount stragglers,
  skeleton lengths, the CSV export helper (`lib/csv.ts` + tests) for
  the users page.

### Backend cross-surface consistency
- **B8-D1**: the WhatsApp/Telegram share card now renders the operator's
  curated `seo_title`/`seo_description` (same fields + same fallbacks as
  the shell rewriter and the hydrated page) — the #1 share channel used
  to show raw name+description while every other surface showed the
  curated Arabic. **B8-D2**: the folded Telegram approval card rides the
  canon. **B8-D3**: `formatLyd`/`formatLydNumber` — the ONE backend LYD
  display formatter (en-US grouping + «د.ل»), mirroring the web's
  formatCurrency so the same amount renders identically on every
  channel («1,380.00 د.ل», not «1380.00»). Rate-limit Arabic copy
  unified («مجدداً»); copilot 403 strings ride the code-map wording
  (B14-13/B1 item 4); «رمز التحويل» canon now 100% live in admin.

### PWA + a11y + test infrastructure
- **Both live-verified leaks killed (B5-F1/F2, B1 item 10)**:
  `workbox.sourcemap: false` + the sourcemap-guard sweep extended to the
  dist ROOT (`/sw.js.map` + 217 KB `workbox-*.js.map` no longer publicly
  fetchable); `/assets/*` misses now 404 instead of soft-200ing the SPA
  shell (pinned by `spa-static-assets-404.test.ts` through the real app
  composition). **B5-F3**: the SW navigation-fallback denylist extended
  to the SW's own root files. **B5-F4**: the offline reveal 2.5 s → 6 s
  (no more flash on bandwidth-bound first visits).
- **a11y tails (B1 item 9)**: cart badge `aria-live="polite"` (the count
  announces), footer column titles h3→h2 (the 1→3 heading skip on short
  pages), text-link 24 px floors.
- **Test infra (B5)**: the evaporating cart-gate e2e assertion now HARD
  (B5-1 — the PDP must show the pinned CTA or «نفد المخزون»); the weekly
  e2e heartbeat rides `schedule` (B5-3 — the LIVE-prod leg had none;
  needs the repo variable `E2E_BASE_URL`); vitest include widened to
  `*.spec.*` (B5-5 — the latent never-run hole); negative-window sleeps
  → the fake-timer idiom (B5-4).

### Money-UX closes
- **B4-F5**: `roundLyd` — not `+toFixed(2)` — is now the idiom at every
  balance-mutation boundary (the five legacy sites were safe by
  construction; a future writer can no longer reintroduce the
  half-cent class silently).
- **Cart stock honesty (B-11/B13 §3)**: the cart line carries a stock
  snapshot (captured at add, refreshed by re-quote), the honest per-line
  verdicts («نفد المخزون» / «متبقٍ N فقط») + the client-side checkout
  block — a sold-out product no longer looks buyable until charge time.
  Pinned by `cart-stock-snapshot.test.tsx`.
- **Support thread freshness (B1 item 7)**: 25 s poll-while-open; **the
  notifications page (B1 item 8)**: backend `?page=` pagination + the
  slim `/notifications` surface.

### Performance verification
- **B2 re-measured R127's boot fixes LIVE (5 routes × 3 runs, LH
  13.5.0)**: home LCP 4,307→3,111 ms (−28%, score 74→84), product
  4,323→3,310, login 4,260→3,444 (TBT 621→89, score 66→84), /category
  −675 ms, /flash-sales 2,518 (score 90) — ALL routes out of POOR into
  NEEDS-IMPROVEMENT; vendor-sentry 0 fetches in 15/15 runs; card-image
  warming live. Gap-to-GOOD remains the known O1 CDN + SPA-discovery
  pair (B2 §O1). Full data: `docs/inspection-r128/B2-perf-pwa.md`.

### Docs truth
- README/CONTRIBUTING/ONBOARDING restamped (frontend **176 test files /
  1,238 tests** · backend **241 files / 2,240 tests** — the round-close
  recount, +8 frontend / +1 backend files over R127); latest-rounds
  pointer now R128+R127; the R127 boot-perf story added to
  both performance surfaces; mobile home + cart screenshots embedded.
- `docs/README.md` gained the R127 round-record block + the R128 in-flight
  block; the money canon (`FINAL_MONEY_INVARIANTS.md`) re-cited M1/M2/M3
  at HEAD and folded M15-M17 into the table (suite index 32→43 files);
  `FINAL_UX_SYSTEM.md` re-verified (11px floor, z-index code truth,
  `.card-enter` deletion, the icon-direction contract, cross-surface
  conventions); the on-call runbook's Redis triage no longer cites dead
  Render; the architecture capacity row now points at the Contabo host.
- **R127 ledger correction** (no retro-edit, per convention): OpenAPI
  batch-2 landed **11** ops — admin family **52→63**, not 62 (56
  admin-tagged + 7 copilot-tagged at HEAD, recounted R128; the 62 was a
  plan-time count). The contract-suite half (38→49) verifies.

### Round record
- Gates on the merged R128 tree, run locally before push: typecheck
  **green** (libs + backend + frontend + scripts) · ESLint **0 errors**
  (84 pre-existing hook-deps warnings, none on touched lines) · backend
  vitest **2,240/2,240** (241 files, ~958 s) · frontend vitest
  **1,238/1,238** (176 files, ~461 s) · frontend production build +
  bundle budget **pass** (eager path 145.7 KB gzip) · sourcemap guard:
  dist root + assets **0 .map files** (the F1 fix proven at build
  level). One test-bug found and fixed during the gates: the bare
  `/assets` probe 301'd (express.static's default directory redirect)
  before the new 404 guard could own it — `redirect: false` on the
  assets mount (the A11-F2 precedent) closes it.
- Held open at close (owner-tracked): O1 CDN origin-RTT (~870 ms TTFB
  ceiling), GSC verification (needs the operator's real token), GitHub
  topics/homepage/releases (operator-side, B7 §5-1), B14-C1/C2/C3
  catalog-naming operator decisions, B15-4 ticket attribution schema.
- Fleet + lane evidence: 15 reports in `docs/inspection-r128/` + the
  implementation lanes' logs; worklog `round-128` entry.

## Round R127 — the deepest fleet yet: 2 research + 15 auditors (7 dimensions no prior round ran) + 12 implementation lanes + tool adoptions (impeccable gate · actionlint · zizmor · Knip) — 2026-10-09

The round after "المرحلة التالية الأدق والأعمق والأكثر شمولا". Pushed
R126 live first (10 commits, `186b131..f53a886`) and verified it with
the full guest e2e against production (**40/40**, console clean) — then
ran the largest fleet so far: **17 read-only agents** — 2 tool-research
(ponytail/impeccable verdicts + gstack deep-dive → methodology harvest)
and **15 auditors** covering R126's eleven dimensions deeper PLUS seven
no-prior-round dimensions: live Lighthouse measurement · PWA/service-
worker update-flow · socket.io full-stack · cron/scheduler · database
live-read-only (Neon) · CI/CD supply-chain (zizmor/actionlint) ·
Docker/build shadow-surface · git-history security archaeology · SEO
live · impeccable UI-anti-pattern detection · admin full-journey walk
(19 surfaces). Findings: **0 P0 · 0 P1**, ~12 P2, ~40 P3
(docs/inspection-r127/). Twelve implementation lanes + parent picks
closed every P2 and the high-value P3s; adversarial reviewer R127-R1:
**SHIP — 0 P0/P1/P2** (1 P3, closed pre-push).

### Backend/infra hardening (P2s)
- **`statement_timeout` was a NO-OP on Neon** (startup packet ignored
  server-side; R4's pool-pin defense inert since forever) — now `SET`
  on every pool connect, both pools (B8; probe-verified through the
  pooler).
- **Retention/prune predicates had no index support** (7 audited gaps;
  `login_attempts` was the credential-stuffing incident amplifier) —
  migration **0020** adds 8 partial/covering indexes (schema twins +
  drizzle SQL + V1-M31 boot stage; CONCURRENTLY documented-absent with
  the 10⁵-row trigger on record). Drift check green.
- **Boot one-shots lied on failure** ("will run again at its cron slot"
  — false for 7/17) + were Sentry-invisible — now classified per-kind
  with truthful messages + `captureSchedulerFailure`. Sentry denylist
  gains phone/initdata/tokens **before** any DSN ever activates.
- **Sockets**: the alert-room scope reconciliation was dead code after
  an early return (a revoked `support` scope kept streaming admin-alert
  PII) — moved + 6 tests; `SOCKET_RESYNC_EVENT` was a no-op regression
  (R96-M5 money-screen reconnect recovery) — restored via
  SessionActivityManager + token gating; admin park→revive now resyncs
  the zero-poll admin keys; admin logout disconnects the zombie
  admin-room; topup toasts dedupe on id not amount; `connection_limited`
  surfaced for CGNAT users.
- **Supply-chain**: zizmor 13→0 (3 unpinned e2e refs → in-file SHAs,
  docker.yml packages:write → job-level, persist-credentials:false ×6);
  quality job split (−4-8 min/push), arm64 QEMU leg dropped (−15-25
  min/publish); Dockerfile −60MB (corepack cache + no tests/srcs/worker
  in runtime + manifest-first install); Coolify stop-grace truth
  documented (compose's 40s never applied on the Coolify path).
- **impeccable detector** (pbakaus/impeccable, researched this round)
  now gates `frontend/src` in CI (exit 2 blocks; 5 documented waivers;
  proven exit-0 on this tree).

### Admin console (the operator's explicit focus)
- **The audit trail finally exists as a UI**: `GET /api/admin/audit-logs`
  (triple-gated, PII-lean, LEFT-JOINed actor attribution, auth-activity
  filter idioms) + a «إجراءات المسؤولين» tab on security.tsx (generated
  client, action/actor/date filters, honest pagination) — WHO approved
  money actions is visible for the first time. Telegram-path topup
  approvals now write audit rows (they moved money silently before).
- **OpenAPI batch-2**: 10 highest-cadence ops exposed handler-faithfully
  (metrics · dashboard/risk summaries · diagnostics · scheduler ·
  alerts recent/new · forecast ×3) — admin family 52→62; contract suite
  38→49 rows. The 4 deferred flips landed: dashboard chart-data,
  topups bulk/approve-all (per-item idempotency keys pinned), referrals
  (params-in-key + credit LYD preview), tickets (getErrorMessage truth).
- **Data honesty residue**: products.tsx select-all membership fix (the
  last repo-wide instance) + 2 tests; SessionManager /profile outage
  honesty (r.ok guard + logout-all failure surfaced); points→LYD
  preview made universal; formatCount plurals ×4; provider-card dead
  error span wired; dead code removed (trust-card.tsx, 7 dead exports,
  2 broken scripts fixed).

### Storefront / performance / SEO
- **Mobile card titles stopped clipping mid-glyph** (impeccable K1:
  16/45 titles starved to 20-50px by a shrink-0 badge — now wrap/truncate
  cleanly; browser-verified 0/12 clipped at 390px, no shift on good
  cards). Toaster respects the notch (safe-area offset); home's last
  two sub-44px controls reach the target; skeleton radii unified.
- **Boot perf** (live LCP was POOR 4.2-4.3s mobile on all 4 routes):
  the budget gate now measures a DSN-shaped build (was 2.3KB blind);
  vendor-sentry (111KB br, 70% unused, 221ms LCP-phase long task)
  defers to first interaction with the early-crash guarantee preserved;
  exact-`/login` boots render optimistically through the 0.6-0.9s auth
  probe (money-page splash contract intact, 12 pins); first-4 card
  images warmed at catalog-prefetch resolve + LCP-card fetchpriority.
- **SEO shell truth**: `/` never reached the meta rewriter (express.static
  directory-index served it first — `index:false` on the static mount)
  — home shell now carries the keyword-forward Arabic copy; flash-sales
  description de-staled; new route-parity suite (6 tests) drift-proofs
  every static baseline against its runtime builder.
- **Arabic copy batch** (~60 strings): رمز/كود الإحالة unified on the
  registration conversion path; «رمز التحويل» canon ×7; wallet allowlist
  copy now lists all 4 methods (was 2-of-4); «لوحة الإدارة» ×4; retry
  canon ×16; مزود spelling unified; 2FA term unified; the enrichment
  prompts now mandate western digits (kills the ٠-٩ leak path); A8's
  residue one-liners closed.

### Round record
- Gates: typecheck 4/4 programs · ESLint 0 errors · backend **2,221/2,221**
  (240 files, 4 batches) · frontend **1,159/1,159** (168 files) · build +
  budget (146.7KB no-DSN / 147.4KB DSN-shaped vs 148.5KB warn) + CSP gate
  (0 inline scripts) + PWA precache green · orval regen pure-additive ·
  drizzle drift green ×2.
- Held open (R128 pointers, auditors' ledgers): retry-verb/fallback
  cross-repo canon (F18 policy), copilot 403 wording, dashboard
  chart-race stragglers, image srcset/sizing variants, alert-dedupe
  restart persistence, catalog data P3s (naming tier convention,
  windows-8 mixed pills, Headspace category — operator decisions).

## Round R126 — deeper than R125 on every axis: 13-agent audit (2 new dimensions) + 10 implementation lanes + test-inclusion widening + splits + live-CSP hotfix — 2026-10-09

The round the operator asked to be "أعمق وأشمل وأقوى وأدق من السابقة بكل
المعايير" over **the whole project + the admin console in all its
details**. Thirteen parallel read-only auditors — ELEVEN going deeper
than R125's twelve (admin money pages · catalog/customers ·
ops/security/settings · data-layer/contracts · FE perf (built+measured)
· BE perf/DB (39-index matrix) · security red-team (116/116 RBAC
matrix) · storefront UX · test quality · live verification ·
docs/repo) plus **TWO dimensions no prior round ran**: Arabic
language-quality sweep (terminology canon + grammar + English leaks)
and a **real-browser accessibility/mobile pass against live
production**. Findings: 3 P1 + ~14 P2 + ~90 P3, every one
file:line-evidenced (docs/inspection-r126/). Ten implementation lanes
+ the parent closed everything P1/P2 and the high-value P3s; an
adversarial reviewer returned **SHIP — 0 P0/P1/P2** (5 P3, all closed
before push).

### The live P1 (found by R126-A11's live e2e — R125's own fix was the bug)
- **The R125 inline admin-preload gate script was blocked by helmet's
  CSP** on 100% of storefront boots: console error + 2 live e2e
  failures + the optimization fully inert. Now an **external
  content-addressed asset** (`assets/preload-gate-*.js`, sha256-named,
  immutable) referenced CSP-clean via `<script src … data-home-chunk>`;
  a **new build-time gate fails the build** if any src-less `<script>`
  ever reappears in the built shell; 19 unit tests pin tag/anchor/
  gating; dist-verified 0 inline scripts, eager path under budget.

### Honesty P1s (admin trust surfaces)
- **Password-change copy promised sessions survive; the backend revokes
  every one** — the hint now states the truth, success surfaces the
  backend's message, clears the dead session and lands deliberately on
  /admin/login. `errors.ts` priority fix: the server's specific Arabic
  message beats the generic code-map (wrong current-password reads
  «كلمة المرور الحالية غير صحيحة», not «غير مصرح»). Login 401 English
  prefix gone.
- **Telegram money alerts labeled every non-madar network «ليبيانا»** —
  full allowlist map (LyPay now «LyPay (تحويل مصرفي)»), plus the A8
  copy sweep: طريقة الدخول, اعتماد canon, security-advisory fusha
  rewrite, Arabized internal errors (8 backend findings).

### Security (A7 red-team: 116/116 routes, zero gaps — one real fix)
- **`/api/admin/stats` + `/chart-data` sat before the scope-gated
  router** — a support-only session could read total revenue + wallet
  balances; both now `requirePermission("finance")`, with the frontend
  polling gates matched (no zombie 403s — R1's P3 closed). Ticket
  reply/status mutations write audit rows; adminAuth 401s gain no-store
  at both producers; the products family finally emits
  `admin-stats-update` (8 sites — the emit R125's changelog claimed);
  stats summary folded 10 aggregates → 5 FILTER scans.

### Admin console (the operator's named focus — all 21 pages + seams)
- Socket invalidation keys extended to tickets + risk (the emits R125
  shipped were landing nowhere); topups status-tabs ride the backend
  `?status=` param (no more hard-empty over a partial window); users
  CSV export RFC-4180-quoted (columns no longer shift ≥1,000 LYD);
  points-only wallet edits pass the money confirm; whatsapp load
  failure is an alert + retry (not a false «لا يوجد جلسات»); referrals
  list joins the 401-aware family; products mutations co-invalidate
  stats; bulk toasts route through the Arabic error guard; select-all
  membership, coupons aria-pressed, pricing stale-keep fixed.

### Storefront (money-path mobile fixes from the real-browser pass)
- **The mobile sticky purchase bar now carries the guarded
  add-to-cart** (the mobile-majority market could not complete a
  variant add from the PDP — live-verified at 390px); sold-out beats
  the login CTA (guests see «نفد المخزون», never «تسجيل الدخول
  للشراء»); guest drawer closes on Escape with dialog semantics +
  focus trap; safe-area insets land on the sticky chrome
  (viewport-fit=cover was declared but env() never used); touch
  devices ride 16px inputs (no iOS zoom-on-focus, iPads included);
  sale-price badge + checkout/pricing inks tokenized; ticket
  notifications deep-link `?ticket=`; orders/wallet filters mirror
  into the URL; `/products` 301 double-hop gone; product shells serve
  real og:image; sitemap lastmod per-entity.

### Contracts (A4's batch-1)
- **OpenAPI batch-1: 17 admin endpoints exposed** (alerts ×7, tickets
  ×4, settings ×2, chart-data, auth-stats ×2, referrals) — all
  handler-faithful, the response-contract suite 21→38 rows (every new
  endpoint safeParse-pinned against the real app), orval regen
  drift-free, alerts + security pages flipped to the generated client.

### Type safety + test infrastructure (A10's staged plan executed)
- **T1**: backend tests/ + frontend e2e/ + configs join the
  typechecked programs (0 errors). **T2**: the three frontend test
  excludes dropped; all errors fixed fresh-measured (the widened gate
  also caught @sentry/vite-plugin@4's dead `deleteSourcemapsAfterUpload`
  option — maps were never plugin-deleted; `filesToDeleteAfterUpload`
  is real). **T3**: ops-suite fetches gain real timeouts
  (AbortSignal.timeout on validate.ts ×2 + the presigned-PUT full-DB
  backup upload that had none); scripts join the typechecked program.
  search-arabic e2e rewritten from false-passable (swallowed nav
  timeouts, mangled `aref=` selectors) to API-ground-truth pins; the
  retired real-sleep race pattern fully retired (referrals + topups
  suites on fake timers).

### Structure (A3's execution-ready plans, zero behavior change)
- settings.tsx 1,736L → 4 modules; backend auth-settings.ts 1,276L →
  4 modules (the 4 `as any` casts dead). Byte-identical moves
  (spot-verified by the adversarial reviewer).

### Repo presentation (the operator's standing order — A12's plan)
- OSS trust surface: LICENSE (MIT, as package.json declared),
  SECURITY.md, CONTRIBUTING.md, issue/PR templates, CI badge. README
  restamped + simplified (Arabic product intro, live screenshots,
  project-graph links finally referenced); docs/ONBOARDING.md +
  docs/PERFORMANCE.md layer the developer journey; project-graph 00/12
  truth-ups; API.md documents `?fields=list`.

### Gates on the merged tree
typecheck clean FE+BE+scripts+libs under the WIDENED programs · lint
0 errors · build + budget + **CSP gate** PASS (0 inline scripts) ·
frontend **159 files / 1,076 tests** PASS · backend **234 files /
2,148 tests** PASS (3 chunks) · contract suite 38/38 · adversarial
review **SHIP**.

### Deferred (documented, not forgotten)
Dashboard/system chart-data + remaining raw-fetch flips (batch-2 with
the OpenAPI 53-endpoint remainder) · admin/auth ×8 + observability +
diagnostics spec exposure · toNumber 70-site consolidation (A6's 3-PR
plan) · notifications full-history page (needs backend `?page=`) ·
GSC verification token (ops) · «تجربة» flash-sale deletion (ops —
re-flagged by A9 one round later) · http→https 301 + gzip exclusions
(Traefik/Coolify edge, ops) · inventory loading runbook (operator
decision, Embronic track untouched per standing order).

## Round R125 — the deepest round: 12-agent admin-focused audit + 8 implementation lanes + strictFunctionTypes enabled + live e2e — 2026-10-09

The round the operator asked to be "أعمق وأشمل وأقوى وأدق" with the whole
project and **the admin console in all its details** under the microscope.
Twelve parallel read-only auditors (A1 money-pages UX · A2 catalog/pricing ·
A3 ops/security · A4 data layer · A5 performance (built + measured) ·
A6 a11y/RTL · A7 storefront follow-up · A8 backend · A9 strictFunctionTypes
feasibility · A10 test quality · A11 live smoke · A12 docs truth) produced
**3 P1 + ~30 P2 + ~85 P3, every finding file:line-evidenced**
(docs/inspection-r125/). Eight implementation lanes executed (I1 shell/a11y ·
I2 money dashboards · I3 catalog vertical + SEO payload · I4 users/tickets/risk
· I5 ops pages + 2FA · I6 backend · I7 storefront · I8 docs truth sweep);
six lanes hit infra context-deadlines AFTER completing their work — the parent
closed their gaps (3 syntax/type errors, 9 drifted test expectations), verified
everything via full gates + diff forensics, and reconstructed their worklog
records. An adversarial reviewer (R1) then tried to break the whole round:
**verdict SHIP — 0 P0/P1/P2**, every money/auth hunk challenged and cleared.

### Admin console (the round's focus — all 21 pages)
- **[P1] Per-route document.title** — admin navigation is announced
  (RouteAnnouncer was silent on every admin page; PAGE_TITLES now feeds it).
- **[P1] alerts hover-only row actions** now reveal on keyboard focus;
  **[P1] topups bulk-approve** left the 2.57:1 emerald-on-pink (outline
  variant) and row-approve cleared 3.77:1 — the money path's buttons.
- **2FA re-enroll dead-end killed**: rotating an enabled secret now presents
  a labeled current-password re-auth gate — the backend VERIFIES it with the
  change-password lockout before minting (fresh enrollment stays bodyless;
  both paths pinned by the page's first real test suite).
- **Data layer**: `/admin/stats` co-invalidation after tickets/users/risk/
  products mutations (4 frontend + 5 backend `admin-stats-update` emits,
  byte-matching the orders idiom); risk events honor the `hasMore` cursor
  envelope (events #101+ were unreachable); the SEO editor finally DISPLAYS
  existing overrides (backend list projection +2 props → spec → orval regen
  — drift-free → startEdit seeds); tickets' shipped-but-never-rendered
  `has_unread_admin` surfaces as «بانتظار ردك».
- **Money console**: topups queue memoization (the missed mirror of the
  orders R118 pattern); dashboard chart fetch abort-guarded (stale 7d
  responses could overwrite 90d money series AND feed TrendBadge/sparklines)
  + refresh single-fire + memoized chart data; orders footer partial-window
  sum honestly labeled «مجموع المعروض».
- **A11y/RTL batch**: skip-link for admin; role=status/alert on the shared
  TableSkeleton/EmptyState/FetchErrorCard; GlobalSearch palette focus trap +
  return; aria-pressed on every chip bar + row selectors + select-all;
  hamburger/collapse sr-only names + aria-current; ~25 text-primary + raw
  -400 hue sites token-swept to both-theme-safe inks; security timeline
  honest «عرض N» + filter race guard; bare-loading pages got skeletons.

### Performance (built + dist-verified)
- **vendor-charts (514.75 KB raw / 134.74 KB gz) off the admin landing
  paint**: dashboard + system's only recharts reference is now a lazy
  ChartsLoader bridge — dist-verified `import("./vendor-charts-*.js")`
  dynamic boundaries, zero entry references, KPI tiles paint on the route
  chunk alone with height-reserved Suspense fallbacks (no CLS).
- **Admin boots no longer pay the home-chunk modulepreload** (~8.5 KB gz ×
  every admin session): the inject is runtime-gated on `!pathname.
  startsWith("/admin")` — storefront behavior byte-identical.
- Eager path 145,709 B gz (no-DSN) / 146,096 B gz (DSN) — under the 145 KiB
  gate both ways; sentry-replay boundary intact (40.58 KB gz, dynamic-only).

### Type safety (the R123-deferred "own round" item — closed)
- **strictFunctionTypes ENABLED** (tsconfig.base.json): the probe measured
  11 errors, all mechanical parameter-contravariance annotations — fixed
  via the four standard idiom widenings (lazyWithRetry `ComponentType<any>`
  — which also unlocked the recharts bridge's typing —, isolate
  `(...args: any[]) => any`, the test router double typed as `Router[]`,
  qrcode callback `Error | null | undefined`). FE+BE typecheck clean under
  the flag. FE test-inclusion (49 pre-existing errors under current flags)
  documented with a staged T1-T3 plan (A9 report §6.2) — next round's item.

### Backend
- **Pricing recompute is now transactional** (mid-failure can't leave mixed
  prices; the rollback test drives REAL pglite failures and asserts
  row-invariance + zero audit rows). Copilot's 47 hand-rolled error
  envelopes consolidated onto the shared shape (byte-identical). pageParam
  ceilings on tickets/alerts; observability no-store lift; coupons
  toFixed→roundLyd; security summary 4× count(*) → 1 FILTER; V1-M27
  docblock truth-ups.

### Tests (the round's quiet doubling-down)
- FE suite 131 → **148 files / 908 → 996 tests** (risk, risk-event,
  enrichment, admins, settings get their FIRST render suites); BE
  ~199-files-claim corrected to the true count → **227 files / 2101 tests**
  (3 chunks). The A10 audit's premise correction documented: no memoization
  pin existed anywhere — topups/dashboard memo + chart-abort + refresh
  single-fire are now pinned.
- **Live guest e2e executed for the first time in rounds** (the CI job is
  workflow_dispatch-only): 40/40 green — and it caught 2 contract drifts
  in the specs themselves (catalog/stats `available_products`, auth
  providers `{providers: [...]}` wrapper), both corrected to the shipped
  contract.

### Docs truth (I8 — 35 rows, 0 skipped)
- The stale-308 cluster corrected across 7 ops files + source-of-truth (the
  both-states 301/308 convention with timestamps); the «تجربة» flash-sale
  deletion handoff recorded as OPEN where it belongs (CHANGELOG Deferred +
  runbook §14); the progress ledger's missing R124 entry appended; backend
  test-count claims corrected; 3 justified 308 survivors documented.

### Deferred (documented, not forgotten)
FE test tsconfig inclusion (A9 staged plan) · OpenAPI exposure of the 70
admin endpoints absent from the spec (A8 §C list) · toNumber 70-site
consolidation · auth-settings 1,267-line split · settings.tsx 1,493-line
split · raw-fetch migration remainder (A4 B-1: 18→~11 sites after this
round) · FlashSaleBanner lazy-mount CLS residual · raw-hue long tail
(alerts/system documented residuals) · GSC verification token (ops) ·
«تجربة» flash-sale deletion (ops) · http→https 301 + gzip exclusions
(Traefik/Coolify edge, ops) · inventory loading runbook (operator decision,
Embronic track untouched per standing order).

### Gates on the merged tree
typecheck clean FE+BE under strictFunctionTypes · lint 0 errors (30 BE +
14 FE warnings, pre-existing class) · build + budget PASS both DSN modes ·
frontend 148 files/996 tests PASS · backend 227 files/2101 tests PASS
(3 chunks) · e2e guest-only 40/40 vs LIVE production · orval regen
drift-free · adversarial review verdict SHIP (0 P0/P1/P2).

## Round R124 — the biggest round: impeccable/ponytail-driven 10-agent audit + 7-lane implementation + replay byte-gate + catalog projection — 2026-10-09

The round the operator asked to be "أعمق وأشمل وأدق" with the largest
agent fleet. Ten parallel read-only auditors ran the external
impeccable/ponytail/gstack methodologies (cloned into the workspace,
craft-floor as the visual rubric) over `c736d13`: A1 storefront UX · A2
performance (live-measured) · A3 visual design (computed contrast) ·
A4 mobile/responsive · A5 accessibility (WCAG 2.1 AA) · A6 admin console ·
A7 live production smoke · A8 frontend org · A9 backend org · A10
SEO/copy — **93 findings, 0 P0, evidence-cited to file:line**
(docs/inspection-r124/). Then seven write lanes in parallel (I1 money
pages · I2 catalog · I3 design system · I4 auth/support · I5 admin ·
I6 build/perf — I2/I5/I6 interrupted by infra timeouts, completed by
dedicated C1/C2 agents + the parent) + one mechanical extraction pass
(I8) + the parent's cross-cutting A2-F3 catalog projection + an
adversarial independent reviewer (verdict FIX-FIRST → both P1s fixed +
6 P2s cleaned, re-verified).

### Performance (live-measured, A2's numbers)
- **Sentry Session Replay byte-gate, completed end-to-end (A2-F1):** the
  recorder rode the SDK chunk every visitor idle-loads. The first
  implementation (lazy wrapper + import swap) was NOT enough — the
  parent's dist forensics found the prebundled @sentry/browser barrel
  keeps its replay re-export alive and Rollup merged the wrapper back in
  (vendor-sentry still 469,777 B with rrweb inside). Two more build
  moves make it deterministic: the barrel's two replay re-export lines
  are stripped at build time (loud shape-drift guard) and the recorder +
  wrapper are pinned into their own `sentry-replay` manual chunk.
  Measured: vendor-sentry 469,777 → **328,652 B (−141 KB raw, −30%)**,
  recorder 126,497 B now fetched ONLY on the sticky 10% session roll /
  first error, via a real dynamic-import boundary. No debug markers in
  shipped code; pinned by 18 tests (runtime + build-config halves).
- **Catalog list projection (A2-F3):** `GET /api/products?fields=list`
  omits the variant tree (62.6% of the wire bytes) + usage_terms; the
  grids read `price` (already MIN(variants.price) by import invariant) +
  new `variant_count` (both projections). Spec gains `ProductListItem`,
  orval/zod regen, contract suite 21/21 still green (full view is a
  structural superset), boot head-start key kept byte-identical to
  home's query.
- **Route-chunk warm-up (A2-F4):** pointerenter/focusin delegation
  warms likely-next-route chunks (−150-400 ms perceived nav on 3G/4G),
  saveData-respecting, pinned by route-chunk-warmup.test.ts.
- **Micro-chunk merge (A2-F5):** `experimentalMinChunkSize: 2048`
  (Rollup 4's actual option — the audit's `minChunkSize` does not
  exist) folds ~70 per-icon 511-855 B chunks into their consumers.
- **Home chunk modulepreload (A2-F6)** + SW assets-js cache cap
  40→160 (146-chunk builds were LRU-thrashing the offline story).
- Eager path 145,879 B gz (no-DSN) / 146,276 B gz (DSN-set) — under the
  145 KiB gate both ways; 138 chunks total.

### Storefront UX / a11y / mobile (craft-floor rubric)
- **[P2] Wallet topup sequencing**: the required «رمز التحويل» receipt
  field sat BEFORE the USSD transfer step that generates it — moved
  after, zero validation change. Pending terminology unified
  («قيد المراجعة»), rejection modal now links /support + preserves the
  return path.
- **Contrast (A3, all computed):** light-theme category accents on
  ProductCard badges failed AA (education 2.50:1) — darkened via the
  repo's own R116-S1 method (now 4.88:1); ::selection/caret-color
  themed; Footer/Navbar muted-fg/80 (4.15:1) + FlashSaleBanner alphas
  + --status-purple dark (4.09→4.80:1) fixed; raw `text-primary` as
  text swept to `text-primary-text` repo-wide (login, register,
  checkout consent, loyalty, profile, wallet, product 404 link).
- **44px tap floor:** 9 money/recovery controls under 44px fixed
  (checkout topup link was ~20px — the only path from a failed
  checkout), footer links min-h-6 (WCAG 2.5.8), orders retry, loyalty
  convert, referrals share, profile logout, support form.
- **A11y:** aria-pressed on wallet method/network/preset/phone
  selectors + support pills + terms tabs; Navbar aria-current; sonner
  toast region Arabic labels; OTP countdown aria-live + error
  associations; single-h1 home; underline idiom on footer/inline links.
- **SEO:** product 404 soft-404 killed (was index,follow + canonical→
  homepage on an infinite URL space — now noindex, self-canonical,
  regression-tested); category titles branded ≤60ch (backend SPA-shell
  parity resynced, 8 parity tests green); flash-sales description to
  contract length; /terms#privacy fragment stripped from canonical.
- **Craft-floor REFUSE cleanups:** gradient text (3 hero sites + dead
  CSS twins), cta-glow zero-offset halo (4 money CTAs), toast 3px side
  stripes, ghost-card double elevation, emoji-as-icons in support,
  tablet quick-add hover-only fallback, ProductCard min-w-0.

### Admin console
- Toast success-variant unified (~22 sites) + emoji removed; filter-tab
  vocabulary now derives from the same statusLabel source as row badges
  (orders/topups/dashboard); product editor's 9 fields (+3 promotions
  +1 pricing) got real labels; keystroke memoization (R118-B2 pattern)
  extended to users/products/referrals; topups money queue got debounced
  search (3 new tests); CopilotPanel lazy-loaded out of the layout
  chunk; dashboard dates to the Latin-digits pin; nav title drifts +
  «الكتالوج» group label unified from NAV_SECTIONS.

### Code organization (ponytail: deletion beats addition)
- **−~570 LOC net**: FetchErrorCard extracted (19 sites, 3 preserved
  size families, drifted sites documented) + LoadMoreButton (6 files,
  spinner drift standardized) + 12 dead exports deleted (boot-sentry
  opQueue, firebase-auth ×3, breadcrumbSubsystem, getCorrelationContext,
  authLogger, workerLogger, hasCriticalFailure, isErrorCode, DEFAULT_DIR,
  TicketStatus).
- **Backend (A9 P2s):** coupons.ts now composes the GENERATED
  CreateCouponBody (the hand-rolled divergent twin deleted; the test
  imports the real schema); both swallowed catches (alerts/referrals)
  log with correlation; generic /api 404 got Cache-Control: no-store.

### Gates on the merged tree
typecheck clean (FE+BE) · lint 0 errors (85 pre-existing warnings) ·
frontend build + budget PASS (both DSN modes) · frontend 131 files /
908 tests PASS · backend 227 test files / ~2050 tests PASS (3 chunks) ·
contract suite 21/21 · spa-shell parity 8/8 · replay-lazy 18/18.
Independent review verdict: no P0; both P1s (description projection
regression + build marker) fixed and re-verified with dist forensics.

### Deferred (documented, not forgotten)
A9's bigger refactors (copilot error envelope ×47, diagnostics.ts
modernization, toNumber consolidation, auth-settings split) · A8's
tsconfig test-inclusion · FlashSaleBanner light-wash contrast token ·
delete the live «تجربة» test flash sale (admin → promotions —
`docs/inspection-r124/A1` §ops) · post-deploy `window.__sentryTest` replay
canary (ops) · GSC verification
token (ops) · inventory loading runbook (operator decision — store is
browse-only with 1 sellable product) · http→https 301 + origin gzip
exclusions (Traefik/Coolify edge, ops).

## Round R123 — the deepest phase: audit octet + six fix waves + codegen pipeline reborn + V1-M27..M30 — 2026-10-08

Eight parallel read-only auditors (A1 money chain · A2 test quality · A3
storefront RTL/Arabic · A4 admin · A5 security tools · A6 API contracts ·
A7 database · A8 live-browser on production) over `a474d8c` → **0 P0
findings, money chain verified hardened**; then six write agents in
isolated worktrees (E1 money, E2 codegen/contracts/e2e, E3 admin, E4a
money-frontend, E4b storefront, E5 infra/DB — E5+E2 completed by the
parent after an infrastructure outage killed the agent launcher) + one
independent reviewer (verdict SHIP-WITH-FOLLOWUPS, 0 P0/P1). 15 commits
`952e902`→`27a70dd`, 158 files, +19.1k/−3.5k. Gates on the merged tree:
typecheck clean, lint 0 errors, build + budget PASS (eager path
145,510 B gz), backend ~217 files / ~2050 tests PASS (2 contention
flakes re-verified), frontend 128/884 PASS, frozen lockfile, drizzle
drift gate, openapi parity 83/83. **Live-verified post-deploy (push
19:44Z → live 19:53Z, ~9 min): healthz ok (V1-M27..M30 applied on the
live DB — a failed stage would have aborted boot), passwordless FAQ +
canonical topup SLA in the live support chunk, old email-login claim
gone, Arabic search «نتفليكس»→Netflix, unknown-path noindex, sitemap
200, www→apex 301, CI green on every R123 push incl. the new orval
drift gate's first run.**

### Security & supply chain
- **OTel instrumentation family pinned** (CVE-2026-104872 /
  GHSA-qqmp-wf37-98f9): the six `@opentelemetry/instrumentation-*` DB
  drivers pulled by @sentry/node's umbrella shipped the DB username as
  an unconditional `db.user` span attribute; workspace overrides pin
  the fixed versions — `pnpm audit --prod` 8→2 (both remaining are
  pre-documented accepted-risks: node-forge no-fix-exists via
  firebase-admin; uuid unreachable via google-gax).
- **A5 fresh sweep** (semgrep owasp+secrets+ts, trivy fs, gitleaks full
  history + no-git, osv-scanner, pnpm audit): ~112 raw findings → **0
  exploitable** (7 secret fixtures in scanner self-tests, HTML-escaped
  Telegram bodies, package-manager rule misparses; headers/cookies
  posture live-verified STRONG).

### Database (probe-gated boot stages + chain mirror 0019)
- **V1-M27 serving-index consolidation**: 3 user-history composites
  created (`idx_topups_user_created`, `idx_referral_referrer_created`,
  `idx_tickets_user_created`) + 16 redundant twins dropped probe-gated
  (13 prefix/duplicate/zero-reader + 3 superseded single-column FK
  twins; `idx_idempotency_keys_order` was pure write amplification on
  the checkout claim path).
- **V1-M28**: referral_events referrer/referee FKs CASCADE→RESTRICT —
  deleting a referee no longer erases the referrer's pending credit
  claim (the V1-M25 boundary extended to money-adjacent attribution).
- **V1-M29**: eight domain CHECKs (cart quantity ≥ 1, price > 0 ×2,
  referral status, run outcomes ×2, risk score 0-100, confidence 0-1).
- **V1-M30**: the dead `organizations` table + `users.organization_id`
  removed (zero readers/writers verified twice — audit + reviewer
  independent greps; 0 live rows).
- **Chain 0008 repaired** (duplicate CREATE INDEX broke fresh
  chain-apply with 42P07) and the `login_attempts` gap mirrored into
  the pglite harness.

### Backend & contracts
- **Codegen pipeline REBORN** (A6-P1): orval 8.40 kept, zod pinned to
  v3 syntax via `override.zod.version` (the root cause: orval's
  auto-detection found no zod dep in api-spec and emitted zod-4 syntax
  against the workspace's zod ^3.25.76) + react-query v5 hook-signature
  pin; generated clients regenerated and resynced (page params ×4
  lists, AdminStats fields, CreateProductBody seo fields,
  ProductRecommendation slug, firebase session 200/201 + 409 code,
  user_agent, decrypt_failed, maxItems 200).
- **Response-contract suite** (21 endpoints): the REAL app object over
  pglite, every documented 2xx body safeParsed against the
  orval-generated zod schemas — first-run catch: `/api/auth/providers`
  emitted `whatsapp_status: null` when the OTP channel is unconfigured
  vs a non-nullable enum (spec fixed to nullable).
- **Coupon-validate cap parity** (A1-P2): `/api/coupons/validate` now
  applies the R115 combined cap — the money screen can no longer
  confirm a discounted total the checkout refuses (flash 45% + coupon
  10% > 50% cap case).
- `roundLyd` adopted across the pricing pure-math; topup referral block
  keys on the in-tx `referredBy` read; reject-path `topup-updated`
  socket emit carries `amount`; 409 consent body carries the
  conflict-family code; no-store on the admin GET stragglers;
  risk_labels orphan prune joins the retention ladder.

### Frontend
- **Topup funnel truth** (A1-P1): `payment_reference` is now required
  in the UI on the mobile_transfer flow (backend 400'd it since R111
  while the label said "optional") — the default Libyana/Madar flow no
  longer breaks post-submit.
- **Product-page CLS 0.21 → fixed** (A8-P2): both product skeletons
  under-reserved height vs the real two-column layout; ProductShell now
  mirrors the real geometry (lg split + rail + sticky-bar slot) —
  locally verified zero-pixel swap.
- **Passwordless FAQ truth** (A3-P1): the support FAQ claimed email
  login exists and omitted WhatsApp OTP (public + JSON-LD) — rewritten;
  the topup-approval SLA unified across every surface (30 min).
- **Admin**: 56 raw-fetch sites → the 401-aware contract (R122's
  claim was only 3 sites — CHANGELOG corrected in place); the product
  SEO form landed (R122 claimed it existed — corrected); alerts poll
  support-scoped; dashboard chart fetch finance-gated; deleteRead
  confirm; URL-synced filters; aria names; dirty guards.
- Storefront polish batch: pending-terminology canon (قيد المراجعة /
  قيد الانتظار), register return-path forwarding, tap targets ≥44px,
  bidi badge unification, onboarding guest skeleton, status title,
  `connection_limited` toast, skeleton shapes matched to real layouts.

### Testing & CI
- **26 new money tests** (checkout points-award triad incl. optimistic-
  lock interleave, Telegram approval card, coupons-validate matrix,
  wallet summary, real-service admin approve/reject + audit rows,
  code-generator properties) + the 21-endpoint contract suite +
  register-return-path suite; 884 frontend / ~2050 backend total.
- **Committed e2e smoke** (10 guest read-only Playwright specs,
  E2E_ENABLED-gated skip-by-default, mobile 390 project) + **CI orval
  drift gate** (codegen + git diff --exit-code) + manual-first e2e job.
- Two contention flakes (scheduler timing, one routes test) re-verified
  green in isolation — documented as 2-CPU container artifacts.

### Deferred (honest ledger, next round)
strictFunctionTypes (needs its own round) · observability router
no-store batch (P3) · V1-M27 docblock correction (idx_products_archived
IS a leading predicate in 3 queries — drop still defensible at current
cardinality) · coupons.ts toFixed→roundLyd uniformity · orders.tsx
raw-fetch → generated hook migration · admin SEO editor needs the
list payload to display existing overrides · copilot_actions retention
(operator decision) · GSC token + Sentry org:ci swap (operator) ·
catalog restock (Embronic track — untouched, per standing order) ·
FlashSaleBanner lazy-mount 44px push (~0.03-0.05 residual CLS).

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
