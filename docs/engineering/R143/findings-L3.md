# Lane L3 findings — Mobile, Arabic & RTL quality (R143, HEAD 528ef39)

Read-only audit @ HEAD `528ef39` (tree clean, investigation only — zero
modifications). Mandatory-first reads done: `.hermes.md`, R142
`findings-ledger.md`, lanes `findings-J.md` (a11y/RTL) + `findings-I.md`
(search). Sibling lanes L1/L2/L4/L5 checked for overlap — none of the
findings below duplicate theirs (L2's "tabular-nums — CLEAN" verdict at
`findings-L2.md:209` is directly corrected by L3-1 below, with font-level
evidence L2 did not collect).

**Method.** Static deep-read of the mobile/Arabic/RTL surface layer:
`frontend/index.html`, `frontend/vite.config.ts` (criticalPreloadInject),
`frontend/src/index.css` (1511 lines), `src/lib/{direction,utils}.ts`,
`src/components/layout/*` (MobileNav/Navbar/Footer/FlashSaleBanner/
NotificationBell), `src/components/{ProductCard,CopyButton,WhatsAppPhoneSignIn,
AppSplashScreen,SessionManager}.tsx`, `src/components/{ui,home,product,
checkout,wallet,loyalty,support}/*`, `src/pages/{home,product,category,orders,
order-detail,cart,checkout,wallet,loyalty,referrals,notifications,profile,
support,flash-sales,terms}.tsx`, `src/hooks/use-keyboard-visibility.ts`,
`src/app/{routes,route-shapes}.ts`, `e2e/` + `playwright.config.ts`.
**Plus a fontTools probe of the shipped woff2 subsets** (cmap coverage,
GSUB feature list, per-glyph advance widths, vertical metrics) — the
static evidence no prior round collected. No browser session, no live
probes, no test runs mutated anything.

**What r140/r141 actually verified (mobile-relevant), and the residual
gaps this lane closes:**
- r140 (140-b) verified the font story end-to-end: 6 self-hosted faces,
  `font-display: swap`, build-time hashed woff2 preloads for arabic
  400/600/700 + latin 400, byte-verified in dist AND on subnation.ly, and
  a headless-Chromium probe of per-codepoint subset resolution. **Residual
  found:** the preload *set* misses latin-700 which is above the fold on
  every route (L3-3), and nobody ever checked the `tabular-nums` feature
  the CSS contract claims — it does not exist in the font (L3-1).
- r140 (140-a/e) verified image intrinsics + the FlashSaleBanner
  per-digit-run `dir="ltr"` isolation; r140 (140-i) the 190-pair contrast
  sweep; r140 (140-j/k/l) keyboard/live-region/semantics. All re-verified
  clean on the mobile surfaces this lane touched.
- r141 verified the shell head anchors (comment-aware injection) —
  boot-order safe; no residual here.
- r96/r127's 320px/390px geometry passes were **manual one-off censuses**;
  the automated mobile net is e2e/mobile-390.spec.ts only → L3-6.

---

## Findings (ranked)

### L3-1 · P3 · The tabular-nums money-alignment contract is inert — Readex Pro ships no `tnum` feature and its digits are proportional

- **Evidence:** `frontend/src/index.css:457` — `font-variant-numeric: tabular-nums;` on `body`, inherited by every money number in the app; **202 `tabular-nums` class usages across 78 files**; the mechanism is asserted in code comments, e.g. `src/components/wallet/LedgerEntryRow.tsx:100-101` — *"dir="ltr": the sign must lead the number inside the RTL layout; tabular-nums aligns the column of amounts."* — and in the R142 J-lane localization inventory ("tabular-nums body-wide + Western digits"). FontTools probe of the shipped subsets (`node_modules/@fontsource/readex-pro/files/`):
  - `readex-pro-latin-400-normal.woff2` GSUB features = `['ccmp','dnom','frac','liga','locl','numr']` — **no `tnum`** (nor any numeric-spacing feature); `readex-pro-arabic-400` = `['calt','ccmp','fina','init','medi','rlig']` — same absence. 600/700 faces identical in kind.
  - Digit advance widths (units/1000 UPM): **400** — `1`=500, `3`=529, `2`=548, `7`=542, `6`=557, `9`=551, `5`=568, `8`=579, `0`=607, `4`=620 (a 120-unit = 12% spread; the `1` is 10.7% narrower than the `0`); **600** — 542–650; **700** — 548–672. Proportional figures throughout.
- **Root cause:** the typeface choice (Readex Pro) was never checked against the numeric contract the CSS and ~10 comments assert. `font-variant-numeric: tabular-nums` on a font without a `tnum` feature is a no-op — browsers perform no tabular synthesis.
- **User impact (honest scope):** no vertical line-box or layout breakage — flex edge-alignment carries most money columns, and the FlashSaleBanner segments' `min-w-[22px]` absorbs the digit-width deltas. What IS real: (a) every numeric run is width-unstable when its value changes — ticking numbers re-layout their inline context each second (`TopupWaitingModal.tsx:281`'s `text-2xl` bare countdown re-centers inside its progress ring at every tick; the wallet balance `num-pop` remount; cart badge); (b) digit columns inside multi-digit stacks (ledger amounts, statement "الرصيد بعدها" runs) never align digit-on-digit; (c) the documented mechanism is false — future rounds will keep stacking `tabular-nums` on money surfaces believing it does something (L2 already re-asserted it "CLEAN" this round).
- **Proposed fix (minimal, honest first step):** correct the false claims — amend the `LedgerEntryRow.tsx:101` comment (and the index.css:457 comment context) to state Readex Pro carries no `tnum` and the class is inert belt-and-suspenders; if stable money alignment is actually wanted, either (i) subset a `tnum`-capable companion for numeric runs, or (ii) give ledger amount cells a fixed-width digit grid (`inline-grid` + `ch` columns / `min-w`). A one-line test can pin the truth: assert the comment/contract docs name the no-tnum reality so it can't be "re-verified clean" again.
- **Test requirement:** none beyond the doc pin (or a rendered-width comparison test if the digit-grid route is taken).
- **Risk:** none — comment/doc-level. The digit-grid option touches the wallet/loyalty ledger rows (visual pin suites exist: `wallet-statement.test.tsx`, `loyalty-history.test.tsx`).

### L3-2 · P3 · R128-A4 (F-1)'s `dir="auto"`-on-truncated-Latin-names sweep missed 6 storefront sites — product names truncate from the wrong end on phone-width surfaces

- **Evidence (the fixed idiom vs. the stragglers).** The repo's own fix — `ProductCard.tsx:580-590` *"dir="auto" … text-right keeps dir="auto"'s bidi isolation but re-anchors the visual edge — pure-Latin names … truncate from the wrong end in an RTL block (the ellipsis eats the name's beginning)"* (same wording at `CartSummaryAside.tsx:156-166`, `cart.tsx:321-328`, `notifications.tsx:365-369`, `NotificationBell.tsx:676-683`, `ProductsGrid.tsx:97-109`, `ProductMediaSection.tsx:150-169`, `OrderSuccessScreen.tsx:170-174`, `TicketsList.tsx:76`). **Missed sites** (all `truncate` + Latin-by-design content, no `dir="auto"`):
  1. `src/pages/orders.tsx:590` — `<div className="font-bold text-sm leading-snug truncate group-hover:text-primary-text …">{order.product_name}</div>`
  2. `src/components/home/RecentOrdersStrip.tsx:123` — `<div className="text-xs font-bold truncate …">{order.product_name}</div>`
  3. `src/pages/flash-sales.tsx:204` — `<div className="font-bold text-sm leading-snug mb-2.5 truncate …">{product.name}</div>`
  4. `src/components/product/RecommendationsSection.tsx:135` — `<h3 className="text-sm font-bold truncate mb-1">{r.name}</h3>`
  5. `src/components/product/ProductBreadcrumbNav.tsx:53` — `<span className="text-foreground font-bold truncate" aria-current="page">{product.name}</span>`
  6. `src/pages/profile.tsx:351` — `<div className="text-sm font-bold mb-1.5 truncate">{user.display_name}</div>` (user content — Telegram/Google display names are frequently Latin)
- **Root cause:** the R128-A4 sweep fixed the surfaces its lanes touched; no repo-wide `truncate` × `product_name|display_name` census ever closed the class. Product names are English by design (lane I's map: "product names are English by design"), so this is not an edge case — it is every long catalog name on those six surfaces.
- **User impact (360px phone):** orders-row main column ≈116px after the 48px thumb, 42%-capped amount block and gaps — "Microsoft 365 Family (1 Year)" renders as `…oft 365 Family (1 Ye)` (ellipsis eats the brand head, the uniquely identifying token) on the money-history surface; same class on the home authed strip, PDP recommendations (2-col ≈150px cards), the PDP breadcrumb's "you are here" segment, and the profile identity row. Alignment is already correct (RTL flush-right); only the truncation end is wrong.
- **Proposed fix:** add `dir="auto"` (+ `text-right` where the RTL visual anchor must hold — the ProductCard F-1 recipe) at the six sites; one per line, zero geometry change for fitting names.
- **Test requirement:** a source-scan pin in the family idiom (e.g. `bidi-truncation-r143.test.ts`): every element rendering `product_name`/`product.name`/`r.name`/`display_name` together with `truncate` must carry `dir="auto"` — the exact class of pin the r140 suites use to freeze sweeps.
- **Risk:** minimal; Arabic names in the same slots are unaffected by `dir="auto"` (resolves rtl).

### L3-3 · P4 · latin-700 is above the fold on every route (Navbar wordmark) but deliberately excluded from the woff2 preload set — plus a stale font-weight prose claim in the same block

- **Evidence:** `frontend/vite.config.ts:565-566` — the criticalPreloadInject regex preloads only `readex-pro-arabic-(400|600|700)` + `readex-pro-latin-400`; `vite.config.ts:517-519` — *"Latin-700 is deliberately NOT preloaded: no Latin text above the fold renders heavier than 400 on the guest hero."* Reality: `src/components/layout/Navbar.tsx:446` renders `<Logo size="sm" />` on **every** storefront route (no hidden/breakpoint class on the brand link; the header row is the first thing above the fold on phones), and `src/components/layout/Logo.tsx:65` — `<span className="font-bold leading-none" …>Sub<span className="text-primary-text">Nation</span></span>` → **Latin 700** above the fold on every boot. Stale prose in the same block: `vite.config.ts:508-510` claims the guest hero h1 is *"text-fluid-3xl font-black — font-weight 900 … Readex Pro ships no 900 face"* — `GuestHero.tsx:122` is `font-bold`; zero `font-black` in src (J-lane verified; re-verified this round).
- **Root cause:** the preload-set rationale was scoped to the guest hero while the Navbar chrome (the true constant above-fold surface) rides the wordmark at 700.
- **User impact:** the brand wordmark pays the CSS-parse → @font-face-discovery → fetch RTT before its final paint on network-bound mobile visits (the same ~50–100ms class the A5-10 comment documents for arabic-600), plus a fallback→Readex width swap on the wordmark. Cosmetic-perf only; the preloaded 4 faces still cover all Arabic text and Latin 400.
- **Proposed fix:** add `readex-pro-latin-700` to the regex in `criticalPreloadInject` (one alternation), or drop the wordmark to 600 and preload latin-600 instead; fix the stale font-black prose while there. The `boot-critical-path-r140` pin suite counts preloads — extend its expectation.
- **Test requirement:** update/extend the r140 boot-critical-path preload-count pin.
- **Risk:** one extra ~14KB same-origin preload competing for first-paint bandwidth — the exact trade the comment already weighs; net-positive for the only Latin-700 element that is always above the fold.

### L3-4 · P4 · R126-L5's iPad focus-zoom guard is re-defeated at three storefront form fields via bare `md:text-sm`

- **Evidence:** `src/components/ui/input.tsx:36-43` — the shared Input's guard: *"The bare `md:text-sm` applied to TOUCH devices too — an iPad-class admin (≥768px CSS width) computed 14px and iOS Safari zooms the page on every focus … `[@media(min-width:48rem)_and_(pointer:fine)]:text-sm`."* Three storefront call sites still override with the bare form (twMerge keeps both — the variants differ, so the caller's `md:text-sm` wins on coarse-pointer ≥768px viewports):
  1. `src/components/product/CouponField.tsx:67` — `className="pr-9 h-11 text-base md:text-sm font-mono uppercase …"` (the shared Input — **money path**, PDP coupon; its own comment documents the R96 phone fix but re-applies the md: override A13-F7 later banned)
  2. `src/components/home/CatalogFiltersBar.tsx:190` — the sort `<select>`: `… text-base md:text-sm font-semibold …` (native element, never had the guard)
  3. `src/components/support/CreateTicketForm.tsx:160` — the ticket textarea: `… text-base md:text-sm …`
- **Root cause:** the R96-M03 fix pattern (`text-base md:text-sm`) predates the A13-F7 refinement; the sweep that moved the shared Input to the pointer:fine guard did not grep for the older pattern at call sites / native controls.
- **User impact:** iPad-class touch users (≥768px CSS width, coarse pointer) get the page-zoom-on-focus A13-F7 eliminated. Phones (<768px) are unaffected — the Libyan phone majority sees 16px everywhere.
- **Proposed fix:** swap `md:text-sm` → `[@media(min-width:48rem)_and_(pointer:fine)]:text-sm` at the three sites (or drop the override at CouponField and let the Input own it).
- **Test requirement:** source-scan pin: no storefront form control carries a bare `md:text-sm`/`md:text-xs` (the input.tsx comment already defines the rule; nothing enforces it).
- **Risk:** none — desktop fine-pointer rendering is byte-identical.

### L3-5 · P4 · The 11px micro-type scale is px-fixed, not rem — it never scales with user font-size preferences while the rest of the app does

- **Evidence:** `frontend/src/index.css:115-116` — `--text-2xs: 11px; --text-3xs: 11px;` (the R120-B1/R124-A3 documented Arabic floor, used by **233 `text-3xs`/`text-2xs` sites** — MobileNav labels, badges, timestamps, chips) while every other text size in the Tailwind scale is rem-based and therefore multiplied by the user's browser/OS font-size preference (Android Chrome "Font size", `font-size` scaling in accessibility settings).
- **Root cause:** the floor was pinned in absolute px to keep badge geometry stable; the scaling consequence wasn't part of the decision record.
- **User impact:** a user with elevated font preferences gets the whole UI scaled except the micro layer — nav labels, badges and timestamps stay 11px while surrounding prose grows, widening the legibility gap the floor exists to protect. Pinch-zoom is unaffected (page zoom scales px).
- **Proposed fix:** `--text-2xs: 0.6875rem; --text-3xs: 0.6875rem;` — exactly 11px at the default 16px root, scales with user preference. Geometry is pixel-identical at defaults; only preference-scaled users see a change.
- **Test requirement:** the existing micro-scale pins assert the token values — update them; add one assertion that the tokens are rem-unit (guards the class from being re-pinned in px).
- **Risk:** low — the R124-A3 "honest collapse" note documents both tokens already emit the same 11px, so no step is lost; at non-default user scales the ~150 documented 2xs badge surfaces grow with their text (the intended direction).

### L3-6 · P3 · The mobile e2e net never asserts phone-width safety on the money routes — and the one PDP overflow assertion is desktop-only

- **Evidence:** `frontend/e2e/mobile-390.spec.ts:8` — `for (const path of ["/", "/login"])` are the ONLY routes with an explicit `scrollWidth ≤ 390` assertion; the same spec's one tap-target test (lines 17-28) checks a single PDP CTA at `≥40px`, not the 44px floor the repo documents. `e2e/product-detail.spec.ts:6` — *"no overflow at 1280px"* (desktop width, not phone). `playwright.config.ts` defines exactly two projects (`desktop-chromium`, `mobile-390`) — **no 360px or 320px project** exists despite 320px-specific geometry decisions living in code (Navbar.tsx:627-633 "R96-M01's 320px row math"; CtaBlock.tsx:144-150 "a flex child's automatic minimum width grows the bar past the viewport at 320px"; ProductCard.tsx:562-564 "at ≤320px the widest badge (112px) exceeds its own wrapped line"). Auth-gated money routes (`/wallet`, `/orders`, `/orders/:code`, `/support`, `/notifications`, `/referrals`, `/loyalty`, `/profile`) appear in no spec at any mobile width; `/cart` + `/checkout` appear only via cart-gate's redirect assertion.
- **Root cause:** r96/r127's phone-geometry passes were manual censuses; the automated mobile net covers guest browse only. Every round since adds mobile geometry decisions with source-scan pins but no rendered-width regression net.
- **User impact:** none today (this is a seam, not a live defect) — but the money funnel is exactly where this repo's own comments document the tightest 320-360px geometry, and a future class change (a wider badge, a longer Arabic status label, a new chip) regresses horizontal overflow on phones with zero failing tests, reaching production through green CI (the M-2 class the R142 ledger itself records for the boot seam).
- **Proposed fix:** extend `mobile-390.spec.ts`'s path list with the guest-reachable set (`/product/:slug` on the real catalog, `/category/streaming`, `/cart`, `/flash-sales`, `/support`, `/terms`, `/register`) asserting `scrollWidth ≤ 390`; add a second mobile project at **360px** (and ideally 320px) so the widths the code reasons about are the widths tested; optionally add a session-scoped auth spec for `/wallet` + `/orders` at 390 in the cart-gate idiom.
- **Test requirement:** the spec IS the requirement; E2E_ENABLED-gated like its siblings.
- **Risk:** CI minutes (public repo — free); one more flake surface, mitigated by `networkidle` + the existing retry policy.

### L3-7 · P4 · ListShell skeleton rows (68px) under-reserve the real orders/cart rows (~90px) — a chunk-swap CLS drift in the skeleton-parity contract

- **Evidence:** `src/components/ui/route-skeleton.tsx:174` — `h-[68px]` rows ×5 fronts `/orders`, `/cart`, `/support`, `/notifications` (ROUTE_SHAPES "list", `route-shapes.ts:27,38,39,47`). Real orders rows (`orders.tsx:536-660`): `p-4` (32) + name line (~20) + variant chip row (~22) + meta row (~18) ≈ **92px** minimum; cart rows similar or taller (thumb 56px + two-line text + stepper 44px).
- **Root cause:** the R136 parity round fixed order-detail's per-block skeletons ("the section trio's heights differ… each block's geometry rides className verbatim") but the generic ListShell was never re-measured against the row archetype it fronts.
- **User impact:** on a slow chunk load (the exact scenario the shell exists for), the skeleton→content swap shifts the page down ~24px × visible rows on the money-history surfaces. Bounded, mobile-visible, one-shot per load.
- **Proposed fix:** raise the row height to `h-[88px]` (or `min-h-[88px]`) — one class in ListShell; the R139 parity notes in that file show the intended method (measure the real row, mirror it).
- **Test requirement:** the skeleton parity suites are source-scan based — extend the ListShell pin to the new height with a comment stating the measured real-row floor.
- **Risk:** none — placeholders only.

---

## Verified clean (mobile / Arabic / RTL — no finding)

1. **Viewport & zoom (exemplary):** `index.html:14-18` — `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`; **no `user-scalable`/`maximum-scale` cap anywhere** (grep-verified) — pinch zoom stays enabled; the interactive-widget choice (96-F5) protects focused money fields inside Radix-locked dialogs from the Android keyboard.
2. **Font loading:** 6 faces via @fontsource (`index.css:18-23`), `font-display: swap` baked in each; build-time hashed preloads with `crossorigin` + `type="font/woff2"` (`vite.config.ts:570-573`) for the 4 critical faces; R-141's comment-aware `indexOfOutsideComments` injection is unit-pinned. **Vertical metrics are identical across all 6 subsets** (fontTools: hhea 1000/-250/0, typo 1000/-250/0 on every face) — no mixed-subset line-height drift; **zero px-based `leading-*` utilities in src** (grep-verified) and body/h1-h4 ride unitless 1.7/1.3 — line boxes are font-swap-invariant, so the absent metric-matched fallback (`size-adjust`) cannot cause vertical CLS; horizontal wrap-count reflow during swap is bounded by the preloaded critical faces (residual only on latin-700 → L3-3).
3. **Subset resolution:** the two subsets' cmaps are complementary-disjoint (fontTools: arabic-400 has **no** ASCII digits/`.`/`,` — latin-400 has them; arabic has `٪` U+066A + all Arabic-Indic digits ٠-٩, latin doesn't) — the intra-family per-codepoint walk r140's headless probe verified is genuinely load-bearing and correctly ordered (arabic declared first, latin last).
4. **Bidirectional text:** 138 `dir="ltr"` islands cover every Latin/code/numeric run a Libyan user meets — order codes (`orders.tsx:604`, `order-detail.tsx:410` with a 44px hit box), IBAN/USSD/account numbers (`LyPayFlow.tsx:94,163,188`, `TransferCodePanel.tsx:97` with `break-all` + `min-h-[44px]`), OTP codes (`WhatsAppPhoneSignIn.tsx:653,669` + `inputMode="numeric"`), referral/coupon codes (`profile.tsx:420`, `CouponField.tsx:109`, `CouponCard.tsx:90`), phones (`profile.tsx:376`), signed ledger amounts (`LedgerEntryRow.tsx:103`, `LedgerHistoryCard.tsx:114,137` — the ± sign leads inside the LTR run). Countdowns are isolated at the digit-run level on all three surfaces (`FlashSaleBanner.tsx:290-295` per-segment, `flash-sales.tsx:192` whole-run, OTP TTL `WhatsAppPhoneSignIn.tsx:709`) — the r140 isolation survives re-review. Mixed parenthesized Arabic+digit runs (e.g. `(${cooldown} ث)` at `WhatsAppPhoneSignIn.tsx:733`) rely on native bidi mirroring — correct. `dir="auto"` present on 10 user/catalog content sites (the six stragglers → L3-2). Zero `<bdi>` — the dir-attribute idiom is the repo's equivalent and is pinned by tests.
5. **Numerals:** one Latin-digit regime end-to-end — `formatCurrency` (en-US grouping + hand-written «د.ل»), `formatCount`, and every Intl date/relative/chart call pinned `ar-LY-u-nu-latn` (`utils.ts:79`, `chart-data.ts:21`) against the root-`ar` Arabic-Indic fallback (96-F7 class); zero Arabic-Indic digits rendered anywhere in src (the only ٠-٩ literals are input-folding code — `WhatsAppPhoneSignIn.tsx:72-78`, `topup-meta.tsx:112-113` — which *convert* pasted Arabic-Indic/Persian input, the right behavior for Arabic keyboards); no bare `toLocaleString`/`toLocaleDateString` on storefront.
6. **Touch targets (full enumeration):** the storefront 44px floor holds everywhere it renders on phones — MobileNav tabs (72×60 per tab at 360px), Navbar cart/profile/hamburger (`touch-target` + `h-9 w-9` → renders 44×44), mobile wallet chip `min-h-11` (Navbar.tsx:670), FlashSaleBanner dismiss `h-11 w-11` + title link `min-h-11` (FlashSaleBanner.tsx:247,320), cart steppers/remove `min-h-11 min-w-11` (cart.tsx:439,464,477), CtaBlock compact CTAs `h-12` + add-to-cart `h-12 w-12`, CopyButton `min-h-11` unconditionally (the only copy affordance), coupon fields/buttons `h-11`/`min-h-11` (CouponField, CouponCard), catalog chips + متوفر فقط + search-history rows + مسح `min-h-11` (CatalogFiltersBar:148,166,235,254), notifications row/actions `min-h-11` (notifications.tsx:387,399), ticket send `w-11 h-11` (TicketThread.tsx:230), terms tabs `min-h-11`, MethodTabs/preset chips `min-h-11` (LyPayFlow:130), transfer CTA `h-11`, hero chips `min-h-11` (GuestHero:225), orders retry `min-h-11`. Remaining sub-44 interactive elements are all documented-decision surfaces: Footer legal links (`min-h-6` = the WCAG 2.5.8 24px AA floor, Footer.tsx:141-142), admin console chips/select-checkboxes (operator-side, ≥24px, `MobileOrderCard.tsx:49` rides the documented p-2/-m-1 hit-area idiom), Navbar logout/profile (h-9, `hidden md:flex` desktop-only), Button default/sm sizes (call sites own the floor — the documented scale).
7. **Responsive chrome:** single-source `--mobile-nav-h` (60px) + guard test; `mobile-nav-safe-pad` (authed main) + `mobile-nav-footer-pad` (guest clearance — the documented split, Footer.tsx:24-35); `:has()`-scoped extra `scroll-padding-bottom` when the PDP sticky bar rides; drawers internally scroll-capped (R135) with Esc/Tab-trap + focus return; the admin console has a real mobile story (drawer + MobileOrdersList/MobileUserCard/MobileOrderCard/RiskEventsMobileList).
8. **Safe areas (complete):** Navbar top inset (Navbar.tsx:389), MobileNav bottom inset (MobileNav.tsx:107), PDP sticky bar (`mobile-sticky-above-nav` + env), scroll-padding top/bottom with env() (index.css:432-451), sonner `mobileOffset` object form (sonner.tsx:92-93 — the B13 F-1 fix, R127), app-dialog sheet `max-sm:pb-[calc(1rem+_env(…))]` (app-dialog.tsx:158,196), admin shell top/bottom insets, bell panel env-aware max-h (Navbar.tsx:87).
9. **Orientation & keyboard:** one shared `useKeyboardVisibility` with the R117-F7 orientationchange re-anchor (use-keyboard-visibility.ts:49-53); no-JS CSS fallback `[@media(max-height:480px)]:hidden` on MobileNav, PDP sticky bar, and the authed-landscape drawer coverage (R135 FE-1) closes the stranding the MobileNav hide creates. PWA manifest locks `orientation: "portrait-primary"` (deliberate; browser/iPad rotation still covered by the machinery above).
10. **Skeleton parity (beyond L3-7):** ProductCardShell mirrors the real card including the mobile `md:hidden min-h-11` CTA slot (route-skeleton.tsx:155-161, the 96-F4 CLS fix); ProductShell mirrors the R116-S2 lg split, recommendations rail and sticky-bar slot; CheckoutShell mirrors the `md:grid-cols-[1fr_360px]` money geometry; FormShell's `rounded-3xl` deliberately mirrors onboarding's B-12 tail. The `cv-card` `contain-intrinsic-size: auto 320px` R120-B1 fix present.
11. **Long-content stress:** 3-line names → `line-clamp-2` <sm / `sm:line-clamp-1` with `min-w-0` + wrapped badge row (ProductCard:566-590, the R127 B3-K1 fix); 4-digit prices → compact-bar `min-w-0 truncate` (CtaBlock B13 §7.1) + Navbar chip `max-w-[96px] truncate` (96-F5); long usernames → display_name truncates (wrong-end → L3-2); hero prose collapses to 2 lines with a full-width `min-h-11` expander (GuestHero:180-184, the R123-E4b fix); 320px chip/badge clipping analyzed in-code at every tight row.
12. **Numerals' Arabic-Indic leak paths:** closed (see 5) — including the OTP paste converter and the topup-amount input folder.

## Not checked / out of lane

- Live runtime rendering (all findings verified against source at 528ef39 + fontTools probes of the exact shipped woff2 files; no browser session, per charter).
- Admin console polish beyond the mobile-list spot-checks (L2's lane owns the design-system debt there).
- Recharts canvas behavior (chart-theme is index.css's declared co-truth; axis fontSize:10 adjudicated sanctioned, admin-only).
- The r140 headless per-codepoint subset-resolution probe was NOT re-run — taken as verified (L3-1's fontTools evidence corroborates its prerequisites: disjoint complementary cmaps).

**Verdict:** the mobile/Arabic/RTL layer is the most mature surface this
reviewer has audited — viewport, safe areas, bidi isolation, numerals,
touch floors and skeleton parity are all contract-driven and test-pinned
from twelve prior rounds. The residuals are a falsified typographic
mechanism nobody ever checked at the font level (L3-1), a half-finished
bidi sweep class (L3-2), a preload-set rationale contradicted by the
always-above-fold wordmark (L3-3), three stragglers of the iPad-zoom
guard (L3-4), a px-vs-rem scaling seam in the micro type (L3-5), and the
missing phone-width regression net over the money routes (L3-6) plus one
skeleton height drift (L3-7). Zero P0/P1/P2 — nothing on a Libyan phone
is broken; L3-2 is the one users will actually see.
