# R161 — The Arabic-first discovery & semantic localization round

Date: 2026-10-18. Status: gated locally (all gates green), committed,
pushed, CI verified. Execution model: three read-only audit lanes in
parallel (E content census, F rendered-browser UX/a11y, G checkout
carry-over) → five parallel implementation lanes with disjoint file
ownership (A backend search, B storefront search UX, C taxonomy, D
admin search, G checkout) → coordinator integration (the P1 focus fix,
the static-shell sweep, the admin-route extraction past the tripwire,
the DESIGN.md contract amendment, the full regression battery).

## Method

1. **Baseline verification**: HEAD = origin/main = `8358952`, clean
   tree; production `healthz` ok; live probe `?search=نتفلكس` returns
   the Netflix product (the R122/R132 engine live).
2. **Audits first** (the mission's inspect-before-plan rule): Lane E's
   39-finding Arabic content census (every live product name/
   description + the repo-owned copy + a 40-family alias coverage
   matrix with live 0-result probes); Lane F's rendered-storefront pass
   (agent-browser, 390/640/768/1024/1280 × RTL × themes × keyboard —
   47 evidence screenshots); Lane G's code-level carry-over audit
   (multi-order receipt options analysis, the 640px geometry root
   cause, a 15-item rendered-funnel checklist, 4 new checkout defects).
3. **Implementation lanes** (disjoint files, targeted tests): each
   landed with in-line R161 rationale comments, the repo's
   deliberate-re-pin convention for changed contracts, and worklog
   entries.
4. **Coordinator integration**: the shared-surface fixes the lanes
   could not own (index.css focus composite × the sticky-bar CSS in
   the same file — sequenced), the size-gate extraction past the
   growth-banned tripwire, the R144 raw-fetch gate violation repair
   (the generated imperative client replaced Lane B's raw fetch), and
   the complete gate battery.

## Lane A — backend Arabic search & ranking

- **11 new aliases** (every one evidence-based on a live 0-result
  probe or the SEO keyword file): brand — نيتفلكس, صاوند كلاود,
  اتش ام ايه, سمراش, «سم راش»; category — مشاهدة + «منصات المشاهدة»
  (the new canonical label must find its own category), انمي, راديو,
  مكتبة, بروكسي.
- **Cross-brand noise suppression** (the one behavioral change): when
  a query resolves a BRAND alias AND a modifier («نتفلكس بريميوم»),
  the modifier's bare OR nameTerm is suppressed — the compound
  AND-branch + the brand OR branch carry the intent. Before: the
  recall included every *Premium*-named product (YouTube Premium,
  Spotify Premium…) below the Netflix prefix match; after: only
  Netflix. A modifier-only query («بريميوم») keeps today's breadth;
  variantTerms (R142's `search=شهر` law) untouched.
- **Acceptance matrix pinned**: all 4 Netflix spellings → Netflix only
  (multi-family seeded catalog, false-positive guards assert Disney/
  Spotify/Windows/ExpressVPN rows absent); ديزني/سبوتفاي/يوتيوب/
  ويندوز ١٠ digit-folding/شات جي بي تي/في بي ان/مشاهدة/سم راش;
  mixed script «Netflix اشتراك»; diacritics/tatweel/extra spaces;
  unrelated Arabic → honest []; 10k-char adversarial stays bounded.
- 165 → **210 tests** in the two search suites.

## Lane B — storefront search experience

- **Live product suggestions** (the dropdown showed history only):
  debounced 300ms, ≥2 chars, ≤5 rows + «عرض كل النائج» affordance,
  riding the generated imperative client (see coordinator note below)
  with AbortController supersession; silent error fallback (the grid
  keeps the page's honest error surface).
- **Keyboard/a11y** (F audit #2/#7): Escape dismisses the dropdown
  (was broken); ArrowDown/Up walk an aria-activedescendant highlight
  through rows + view-all; Enter on a highlight navigates, Enter
  otherwise commits (preserved); role=option + aria-selected; the R134
  blur-guard kept; flip-up when no room below.
- **Touch floor** (F #4): search input + sort select h-10 → h-11 base
  (44px), iOS-zoom-safe text-base preserved, ≥md compact kept.
- **Copy** (E #38): the sold-out empty state reads
  «نفد مخزون كل المنتجات المطابقة حالياً».
- **e2e**: deploy-race-safe suggestions + Escape specs (feature-detect
  + loud named skip pre-deploy — the soldout-pdp precedent).
- New suite `home-search-suggestions-r161` (11 tests) + the 7
  home-surface pin suites re-verified green (95).

## Lane C — canonical taxonomy

- **The semantic defect fixed at source**: `streaming` was labeled
  «بث مباشر» (live broadcast) while all 17 live products are
  video-on-demand platforms. Canonical label now **«منصات المشاهدة»**
  — chip-brevity AND adminLabel (identical), landing label, h1
  «اشتراكات منصات المشاهدة في ليبيا», metaTitle (55/60 chars), intro
  (the false «والعربية» claim dropped; «وأكثر من 12 منصة عالمية
  أخرى»), FAQ vocabulary — propagated through every surface:
  utils.categoryLabel, category-registry, categories.ts, seo-builders
  (Organization LD), routes.tsx fallback meta, category.tsx (h2
  template «اشتراكات {label}»), ProductCard comment, GuestHero (the
  shadda+JSX-break phrase the plain-regex census missed), backend
  spa-shell mirror (parity suite green), index.html + manifest.json
  (coordinator), docs/SEO_PRODUCTS.json (Netflix keyword dropped; HBO
  Max reworded; Sling/DirecTV KEEP «بث مباشر» — genuinely live-TV).
- **music → «موسيقى وصوتيات»** (3 of 11 products are audio-not-music:
  TuneIn/Headspace/Brain.fm); metaTitle unchanged (search intent).
- **The regression net**: `taxonomy-consistency-r161` (12 tests) —
  label ≡ registry derivation, adminLabel divergence only where
  documented (ai-tools), landing labels are the definite-article
  forms, and a shadda/whitespace-tolerant source guard over the four
  canonical maps asserting «بث مباشر» never returns.
- 10 test suites re-pinned with in-line R161 rationale; residual
  census: 28 legitimate occurrences (SEO keywords for real live-TV
  products, immutable history docs, the guard's own matcher).

## Lane D — administration catalog search

- The admin sweep was a raw lowercase ILIKE over English names —
  «نتفلكس» found nothing for an operator to edit or restock. The
  bounded Arabic expansion now ORs in beside the raw branch (same
  discipline as the public catalog route): nameTerms + latinTerms
  ILIKEs, category equality; compounds/variantTerms deliberately
  skipped (operators need recall, not tiers) — pinned by test.
- GlobalSearch + the products toolbar ride the same endpoint → both
  inherit the fix (verified, no edit needed).
- **Size-gate extraction** (coordinator): +28 lines pushed
  routes/admin/products.ts to 990 > its growth-banned 967; the sweep
  lifted to `routes/admin/product-search-sweep.ts` (the R158
  products-field-limits precedent) → parent back to 950.
- New suite `admin-products-arabic-search-r161` (8 tests: Arabic→
  Netflix only, category branch, mixed script, pure-English
  byte-identity, honest [], 401 guard, the 200 cap with expansion
  active); sibling admin-products suites 54/54.

## Lane G — R160 carry-over + checkout completion

- **Multi-order receipt honesty** (the R160 NO-GO): full success with
  >1 created order now lands on **/orders** (the toast's
  «تم إنشاء طلبين بنجاح» count + the newest-first list with codes/
  amounts) instead of order #1's receipt that never mentioned the
  siblings; 1-order keeps the receipt deep link. +2 tests (the
  previously-unpinned N=1 landing now pinned too).
- **Money honesty** (audit E#1, P2): the complete-failure branch
  fabricated «لم يتم خصم أي مبلغ» even when another tab had already
  charged/removed units mid-flight — the claim is now gated on
  `skippedByOtherTab === 0` via a `walletStateUnknown` banner prop.
- **The 640–1023.98px sticky band** (the R157 scope strand): the guest
  sticky bar renders to 1023 but all three clearance utilities were
  scoped `@media (max-width:639.98px)` — the bar never pinned in the
  band (no buy affordance mid-PDP) and the authed fixed bar stranded
  off-screen. Scopes widened, split at the nav boundary (<768 keeps
  the --mobile-nav-h term byte-identical; 768–1023.98 drops it);
  stale comments fixed; +5 scope pins in mobile-nav-clearance (16→21);
  pdp-band e2e hardened to assert the bar stays pinned in-viewport
  after scroll.
- **P4 pair**: CouponCard Enter re-entry guard (`!couponChecking`);
  the network catch now mirrors the try-side product/catalog cache
  invalidations.

## Coordinator — integration & shared surfaces

- **The P1 focus fix** (Lane F's headline defect): every ui/input +
  ui/select consumer focused to an invisible ~1.1:1 tint — the
  hand-written `.input-premium:focus` box-shadow clobbered the
  focus-visible ring utilities at equal specificity (cascade order).
  Now a composite: ring layers FIRST (1px background offset + 2px
  full-opacity ring — F3-01's AA recipe), calm halo OUTSIDE. Pinned in
  design-system-css (+1 test).
- **Navbar tooltip twins** (F #8): theme toggle, menu, cart (dynamic
  mirror) — the header trio joined the R160 completion.
- **The focus contract codified** (F #6): DESIGN.md now documents the
  two sanctioned treatments (global outline for non-form elements;
  ring-2 recipe for the Button/Input/Select/Textarea primitive
  family, protected by button-a11y) — replacing the falsified "only
  one" claim.
- **The raw-fetch gate repair**: Lane B's suggestions fetch was a raw
  `fetch(` (the R144 adoption gate failed loudly — by design);
  replaced with the generated imperative `listProducts(params,
  {signal})` — same URL, native AbortSignal, zero allowlist growth.
- **Static shell sweep**: index.html (comment + description + og) and
  manifest.json joined the taxonomy rename.

## Gates (all green, on the combined tree)

- lint: 0 errors / 15 baseline warnings
- typecheck: clean (libs + api-server + subnation + scripts)
- backend: **2,638** tests green, 4 sequential chunks
  (lib+services 1,193; routes 905; middlewares+root+size-gate 244;
  jobs 296) — +53 vs R160 (Lane A +45, Lane D +8)
- frontend: **283 files / 2,643** green — +3 files (suggestions,
  taxonomy net, admin sweep mirrored), +35 tests
- route parity 86 ops; error-code sync 55; header params 7/7
- codegen idempotent (re-run verified, no second diff)
- drizzle migration drift: none
- build green — eager **146,795 B gz** (+129 vs R160, budget 150 KiB)

## Production verification

Post-deploy (read-only): healthz, the Arabic acceptance matrix over
HTTPS, the rendered suggestions + Escape + focus ring + sticky band
via the real browser, and the deploy-race-safe e2e re-run (the named
skips must now pass). See the CHANGELOG entry for the verified CI run
and the SHA-verified deployment.

## Ledger (deferred with rationale)

1. **Operator-owned catalog content** (Lane E census items 21–37):
   product-description grammar (المحبين, خوادم واسعة, الفيدِليتي…),
   desc↔variant dialect drift (Sling/Hulu/cPanel), tier-dialect
   unification, the Netflix 4K/variants tier question, the
   Windows-8 EOL product decision — DB-owned copy the admin panel
   must edit (this round never mutates production data). The census
   table with exact proposed wording ships to the operator via this
   report.
2. **Multi-order batch id** (architectural): the /orders landing is
   the honest no-backend recovery; a true batch acknowledgment needs
   an additive orders-table concept + API design (M effort, next
   money-round candidate).
3. **Authed 640–767 bar live probe**: the CSS scope fix landed and is
   unit-pinned, but the authed fixed-bar geometry could not be
   live-verified read-only (login writes prohibited) — the guest twin
   was verified rendered at 640/768.
4. **Footer/breadcrumb secondary-nav hit areas** (F #5): documented
   as the 24px text-link floor exception (the R160 order-detail
   precedent) rather than churning the footer.
5. **SEO_PRODUCTS.json slug drift** vs live DB (netflix vs
   netflix-premium…): the importer's exact-name fallback covers it
   today; re-syncing the file is an operator decision (it would
   change importer behavior on next run).
6. **e2e heartbeat**: the weekly job needs E2E_BASE_URL set (repo
   variable) — the new deploy-race-safe specs ride it; the
   post-deploy manual re-run is the immediate verification.
