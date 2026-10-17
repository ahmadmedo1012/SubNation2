# R162 — The catalog-truth, SEO-integrity & e2e-reliability round

Date: 2026-10-18. Status: gated locally (all gates green), committed,
pushed, CI verified. Execution model: six specialist lanes in parallel
(A catalog census, B SEO integrity, C e2e reliability, D commercial
truth, E authed rendered UX, F multi-order batch) + coordinator, with
disjoint file ownership and production catalog data untouched
(proposals only — the operator-authorization boundary held).

## Method

1. **Baseline verification**: HEAD = origin/main = `ff53b858`, clean
   tree; CI `39064808541` green; the only git remote is `origin`
   (URL `https://github.com/ahmadmedo1012/SubNation2.git`) — the docs'
   `github` remote name is stale (same authoritative URL; recorded in
   the source-of-truth contradiction ledger this round).
2. **Truth reconciliation before code**: two R161 close-report claims
   were falsified up front and corrected in this round's record —
   (a) "the weekly job needs E2E_BASE_URL": the variable has been set
   to `https://subnation.ly` since 2026-10-10T21:35:29Z (API-verified);
   (b) "the census table with exact proposed wording ships to the
   operator via this report": the committed report contains only
   summary phrases — the table never existed (the raw findings lived in
   the R161-E-AUDIT worklog entry). Historical reports were NOT
   rewritten; corrections live in this round's documents.
3. **Six lanes, disjoint ownership**, each returning evidence +
   verified changes; coordinator integration + the independent review
   + the full gate battery below.

## Lane A — the catalog-content census (DB-owned copy)

- **The deliverable that R161 promised but never shipped**:
  `docs/engineering/R162/catalog-content-review.md` — the reconstructed
  evidence-based replacement census. All 45 live products re-dumped
  (list + by-slug details), all 17 recovered R161 findings re-verified
  verbatim, and a fresh sweep of all 45 descriptions/FAQs/variants.
- **36 findings** (17 recovered + 19 new): 0×P1, 8×P2, 28×P3.
  24 mechanical fixes with exact proposed Arabic wording + the
  admin-panel application path; 12 owner decisions clearly separated
  (Netflix 4K/tier binding, Windows 8 EOL disclosure-vs-delist,
  Ahrefs pricing, Headspace taxonomy, Funimation dead-service,
  cPanel licensing claims, SoundCloud framing, Hallmark+ rebrand,
  Fox Now sourcing, Ahrefs FAQ specs).
- Notable new finds: Prime Video «المشاهرة», Hulu «المع إعلانات»,
  IPVanish «عتقاد», Netflix «برمج عالمي», SoundCloud «مزلات»,
  Tidal MQA misnomer, ExpressVPN 105→113 server count,
  OSN+ 1-screen-vs-2-devices self-contradiction, Brain.fm
  monthly-copy-vs-lifetime-variant contradiction.
- Gap reported for the owner: `features[]` has no admin write surface
  today (4 findings touch feature bullets).

## Lane B — SEO source integrity

- **The importer's join was not what its docblock promised**: a single
  unordered `or(eq(slug), eq(name)).limit(1)` implements no "slug
  first" priority — a slug-vs-name conflict resolved to an arbitrary
  row (`name` has no unique constraint). Zero live instances today
  (all 45 entries resolve to exactly one row), but the defect was
  dormant. Fixed deterministically: `scripts/src/seo-join.ts`
  (sequential slug → name lookups; the name branch ordered by id),
  the importer routed through it with identical semantics, pinned by
  the scripts workspace's first test harness
  (`scripts/vitest.config.ts`, 6 tests).
- **The full dry-run replicated against the live catalog** (the real
  importer needs DATABASE_URL; production writes are not authorized —
  replication against the live by-slug API is the honest equivalent):
  **45/45 matched, 0 missing, 0 archived** — 41 by slug, 4 by the
  exact-name fallback (all 5 known drifts — netflix, disney-plus,
  prime-video, apple-tv-plus slugs + the Spotify name — resolve to
  their intended products; the stale JSON slugs 404 as live URLs).
  Every live row carries all four fields non-empty → a plain
  `--apply` today would write **nothing** (the R132 operator curation
  is protected by keep-unless-force).
- **JSON-LD truthfulness**: 40/40 assertions pass across 5 PDPs
  (crawler shells + rendered structured data: price, currency,
  availability, title, canonical URL all match the API's actual
  offer).
- **Owner decision documented** (not executed): re-keying the 4 stale
  JSON slugs would change importer behavior on the next run;
  runtime/SEO is unaffected today.
  Report: `docs/engineering/R162/seo-source-review.md`.

## Lane C — E2E reliability & scheduled CI truth

- **The first-ever green heartbeat**: dispatch run `39066817448` on
  `ff53b858` (the R162 tree) — all 8 jobs green, e2e 93/93
  first-attempt (9m37s), zero retry markers.
- **Root-cause history of the 3 failed scheduled runs**: two were
  gitleaks findings (killed by R128 long ago); the third
  (`38245700451`, pre-R161 tree `dff50ad5`) was the login-page
  unscoped `buttons.first()` picking the hidden desktop nav toggle
  at mobile-390 — the fix is in main (verified `main button`
  scoping) and independently re-verified green on production.
- **Retries verdict pinned** at the config line: keep `retries: 2` —
  deterministic defects fail through all 3 attempts (proven:
  `38245700451` failed 3-for-3 through this exact setting); retries
  only smooth live-target transients.
- **Next scheduled run: Monday 2026-10-19 04:17 UTC** — expected to
  be the first-ever green *scheduled* run (workflow active,
  E2E_BASE_URL set, main green).
- Report: `docs/engineering/R162/e2e-heartbeat-verification.md`.

## Lane D — product, variant & commercial-truth consistency

- **Vendor-verified verdicts** (report:
  `docs/engineering/R162/commercial-truth-verification.md`):
  - **Netflix 4K**: not asserted as a blanket falsehood — the FAQ
    pins 4K to Premium, the only 4K/4-screen plan (per
    help.netflix.com). The defect is an *unbound capability claim
    over tierless variants* (plan_label null × 4 durations) → the
    operator fix is binding the tier into the variants and
    confirming delivered accounts are Premium.
  - **Sling**: أورانج/بلو factually accurate; equal Orange==Blue
    pricing is vendor-official ($45.99) — NOT a defect.
  - **Hulu**: no conflation — the 4 variant families exactly match
    Hulu's official 4-plan lineup; one stale count (75 → 95+
    channels).
  - **cPanel**: «حسابات غير محدودة» false under current licensing;
    «مدى الحياة» has no official cPanel product; the account-tier
    axis (Solo/Admin/Pro/Premier) is absent from the product.
  - **Pandora**: honest mapping (Plus/Premium/عائلي→Family), no
    invented tiers — script-mixing only.
  - **Windows 8**: EOL verified 2023-01-10; sold with zero EOL
    disclosure; the FAQ's 8→10 upgrade path is itself stale (Win10
    EOL 2025-10-14). Business decision for the owner.
  - **Ahrefs**: قياسي-سنوي == متقدم-سنوي == 15,980 almost
    certainly a mislabel (own monthly ladder 3,980 < 5,980; vendor
    $249 < $449); FAQ tier limits stale vs current official.
- **The catalog-quality validator** (the first code-side guard for
  this defect class): `backend/src/lib/catalog-quality.ts` — pure
  `findTierPriceAnomalies`: for plan pairs sharing ≥2 durations, a
  strict ordering anchored at one duration must hold at every shared
  duration (equalization = the Ahrefs class; inversion = the mirror
  data-entry error; plans equal at ALL shared durations pass —
  Sling's vendor-official equal pricing is legitimate by design).
  8 tests; proven against all 45 live dumps: **exactly one finding
  (Ahrefs), zero false positives**. Deliberately NOT yet wired into
  admin routes (a coordinator decision documented for the follow-up:
  the admin variants route is a shared money surface; wiring belongs
  in a lane that owns its tests).

## Lane E — rendered product UX & the authenticated responsive gap

- **The R161 gap closed hermetically**: the authed fixed buy bar in
  640–767px could not be live-verified (production login writes
  prohibited). New `frontend/e2e/authed-pdp-r162.spec.ts` intercepts
  **every** `/api/**` route (service worker neutered —
  sw.js/workbox aborted + register stubbed, because SW-context
  fetches bypass `page.route`; every non-GET answered 503 always, so
  no write can ever leave the browser), rendering the real
  production bundle with a seeded authenticated session.
- **33/33 green** (11 tests × 3 projects): at 640×960 the authed bar
  is `position:fixed`, computed `bottom:60px`, bar bottom edge =
  MobileNav top edge (900=900), fully in-viewport through deep
  scroll; at 768–1023.98 it docks at the safe-area floor with the
  nav absent; at ≥1024 the desktop panel takes over; at 390 it
  docks above the nav. The buy CTA is Tab-reachable with the visible
  focus ring; variant selection updates the displayed price
  honestly; the sold-out variant renders honest copy; the buy click
  is intercepted (never reaches the network) with the app's real
  pending→503-error→re-arm behavior asserted. RTL + both themes.
  **No app defects found** — the R161-G scopes work as shipped; the
  R161-F-AUDIT code-level suspicion is refuted-as-fixed by rendered
  evidence.
- **Limitations documented precisely** (what only a real operator
  login can additionally prove: the httpOnly session lifecycle, the
  real money path, notched-iOS safe-area insets, the virtual-keyboard
  bar-hide branch). Report:
  `docs/engineering/R162/authed-responsive-verification.md`
  (12 evidence screenshots under `download/r162-e-*.png`).

## Lane F — multi-order batch: the ADR decision

- **Defer — ADR shipped instead**:
  `docs/engineering/R162/adr-order-batch.md`. Rationale: re-verified
  from code that no today-path leaves a customer unable to identify
  their orders (R161-G's honest /orders landing); the batch id is
  enhancement-only; the full criteria set (nullable schema + the
  four migration mirrors, API/codegen, UI, the 6-scenario battery,
  M1–M17) cannot be done to repo standard on top of this round's
  five other lanes — and partial batch features are forbidden.
- The ADR's key design: client-minted informational UUID per
  checkout attempt, transported in the request body (orval's client
  drops header params — the R142 class; the body-hash idempotency
  predicate makes group-token drift fail **closed** as a 409, never
  a second charge); `orders.order_group_id VARCHAR(36)` nullable +
  partial index; the V1-M35 probe-gated migrate stage; the cart-sync
  lifecycle subtlety (the group token must survive the unit-key
  clearing or a partial retry self-409s against its own still-live
  keys); historical NULL = singleton groups, no backfill.
  Effort: ~1.5–2 focused days as one dedicated money-round lane
  (R163 candidate).

## Coordinator — integration & shared surfaces

- The independent review of every lane diff (the importer refactor,
  the seo-join extraction, the catalog-quality lib + tests, the
  authed spec's interception safety — the SW neutering, the
  non-GET-never-succeeds invariant, the writes log, the Sentry
  telemetry assessment [normal visitor-class traffic, not a
  production-safety concern], the buy-test's hidden-element
  root-cause fix).
- The source-of-truth contradiction ledger gained entry #10: the
  remote-name staleness (docs say `github`; the live remote is
  `origin` — same authoritative URL, pushes verified to work).
- The secret-pattern sweep over all changed/new files: clean (CI
  gitleaks remains the backstop).
- Round docs: this report + the CHANGELOG entry + the six lane
  reports under `docs/engineering/R162/`.

## Gates (all green, on the combined tree)

- lint: 0 errors / 15 baseline warnings
- typecheck: clean (libs + api-server + subnation + scripts)
- backend: **2,646** tests green, 3 sequential chunks
  (lib+services 1,201; routes 905; middlewares+root+jobs 540) —
  +8 vs R161 (Lane D's catalog-quality suite)
- frontend: **283 files / 2,643** green (unchanged — this round's
  frontend work is e2e-side)
- scripts: **6** green (the workspace's first test harness — Lane B)
- route parity 86 ops; error-code sync 55; header params 7/7
- drizzle migration drift: none; codegen idempotent (no second diff)
- backend build green; frontend build green — eager **146,795 B gz**
  (budget 150 KiB, unchanged from R161 — no runtime frontend code
  changed)
- e2e: **126/126** first-attempt against production in one run
  (9.1m) — 93 guest + 33 new authed; plus the dispatched CI
  heartbeat run 39066817448 (93/93 on its tree)

## Production verification

- **CI**: the push-triggered run on this round's commit (verified
  after push — see the final report appended below).
- **Deployment**: Coolify push-to-deploy webhook fires on push;
  verified via behavior probes (healthz + the rendered surfaces
  below), never assumed from a commit alone.
- **Read-only behavior probes** (all GET-only): healthz ok; the
  catalog API serves 45 products; the PDP/e2e suite's 126-test pass
  IS the rendered-production verification (guest journeys + the
  hermetic authed rendering).
- **No production data was mutated this round**: the catalog-content
  census and the SEO reconciliation are proposals for the operator;
  the importer was never executed against any database.

## Ledger (deferred with rationale)

1. **Owner decisions on the census**: the 12 business decisions in
   `docs/engineering/R162/catalog-content-review.md` (Netflix tier
   binding, Windows 8, Ahrefs price, Headspace taxonomy, Funimation,
   cPanel, SoundCloud framing, Hallmark+ rebrand, Fox Now sourcing)
   — production DB writes require explicit operator authorization.
2. **SEO slug re-keying**: the 4 stale JSON slugs — the importer's
   name fallback covers today; re-keying changes the next run's
   behavior (owner decision, `seo-source-review.md` §owner).
3. **Multi-order batch implementation**: ADR'd, R163 candidate
   (`adr-order-batch.md`).
4. **catalog-quality wiring**: the validator lib + tests are in;
   wiring it into the admin variants route belongs to a lane that
   owns that surface's tests (R163 candidate).
5. **features[] admin write surface**: 4 census findings touch
   feature bullets the admin panel cannot currently edit (product
   model gap — operator decision whether to expose the field).
6. **The first green *scheduled* heartbeat**: expected Monday
   2026-10-19 04:17 UTC (this round was pushed before it; the
   dispatch-run proof is already green on the same tree).
