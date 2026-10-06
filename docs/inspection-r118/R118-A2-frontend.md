# R118-A2 — Frontend Deep Audit (SubNation2)

- **Scope**: `frontend/` only — product correctness, a11y, RTL/Arabic, UX states, dead code, bundle/PWA. Backend/test-suite quality out of scope.
- **HEAD**: `ef3d0c3` on `main` (clean tree verified). R117 fix commit under review: `6538909`.
- **Method**: verified tree + `git show 6538909 --stat`; full read of App.tsx, product.tsx (2047 L), checkout.tsx (1537 L), wallet.tsx (1881 L), login.tsx, WhatsAppPhoneSignIn.tsx, app-dialog.tsx, ErrorBoundary.tsx, MetaTags/useSeo, use-toast.ts, use-keyboard-visibility.ts, navigation-quiet.ts, MobileNav.tsx, index.html, vite.config.ts, main.tsx, instrument.ts, cart.tsx, use-socket.ts, use-on-screen.ts, use-public-auth-providers.ts, utils.ts (formatters), admin/orders.tsx (reveal), admin/layout.tsx (nav); targeted greps for RTL physical utilities, aria-live, dead CSS/components, public-asset refs; ran 2 targeted test files (product-r117-contracts 4/4 ✓, route-change-focus 9/9 ✓); live GET probes of subnation.ly (index.html, sw.js, manifest.json).
- **Note on R117 verification**: all 9 items of commit `6538909` verified landed at HEAD (details in VERIFIED-OK). Findings below are NEW issues found during the sweep, plus two incompleteness notes on R117's own fixes.

---

## FINDINGS

### F-1. R117 F-6 sonner-options forwarding is only half-wired — `emit()` still drops unknown options [P3]
- **File**: `frontend/src/hooks/use-toast.ts:83-105` (emit) vs `:148-153` (helperInput)
- **Evidence**:
  ```ts
  // helperInput (R117 F-6) — rest IS captured into the ToastInput…
  const { description, duration, action, id, ...rest } = second as …;
  return { title, description, duration, action, id, ...(rest as object), variant };
  // …but emit() builds a CLOSED opts object — rest never reaches sonner:
  const opts: Parameters<typeof sonnerToast>[1] = {
    description: input.description ?? undefined,
    duration: input.duration ?? defaultDuration(input.variant),
    id: idOverride ?? input.id,
    action: input.action,
  };
  ```
- **Impact**: a sonner-idiomatic caller (`toast.error(t, { onDismiss, onAutoClose, position, closeButton, className, … })`) gets silent acceptance and silent dropping — the exact defect class R117 F-6 claimed to close ("toast-shim forwards remaining sonner options instead of dropping them" per commit message). Today zero production callers pass those keys (repo grep: `onDismiss|onAutoClose|closeButton|position` → only `ui/sonner.tsx` Toaster-level `closeButton`), so impact is latent — but the R117 claim is not delivered end-to-end.
- **Fix sketch**: change `emit()` to spread the remainder: `const { title, description, duration, id, action, variant, ...rest } = input;` then `opts = { description, duration, id, action, ...rest }`. Add a test asserting an `onDismiss`/`position` option survives to a sonner spy.
- **Effort**: S

### F-2. MobileNav still carries the unfixed pre-F-7 keyboard detector — fix not ported to the duplicate copy [P3]
- **File**: `frontend/src/components/layout/MobileNav.tsx:49-66` vs `frontend/src/hooks/use-keyboard-visibility.ts:48-58`
- **Evidence** (MobileNav — resize-only, no orientationchange re-anchor):
  ```ts
  const onResize = () => {
    if (vv.height >= baseline) { baseline = vv.height; setKeyboardHidden(false); return; }
    setKeyboardHidden(baseline - vv.height > 120);
  };
  vv.addEventListener("resize", onResize);
  // (no window orientationchange listener anywhere in the component)
  ```
  The extracted hook (R117 F-7) added `orientationchange` re-anchoring for exactly this latch (portrait→landscape shrink >120px is not a keyboard) — but only the product sticky bar consumes the hook; MobileNav's inline copy was knowingly left alone (`use-keyboard-visibility.ts:6-7`: "Same detection strategy as MobileNav (96-F5 / R96 P2-3 — do NOT edit that component)").
- **Impact**: on viewports <768px wide in BOTH orientations with landscape height >480px, rotating portrait→landscape latches `keyboardHidden=true` and the bottom nav stays hidden until rotated back. Practical reach is near-zero today (landscape width ≥768px hits `md:hidden`; landscape height ≤480px hits the `[@media(max-height:480px)]:hidden` CSS fallback — together these cover essentially all current phones), so this is a latent inconsistency: two copies of one detector, one fixed, one not, with a comment discouraging the merge.
- **Fix sketch**: replace MobileNav's inline effect with `useKeyboardVisibility()` (the hook was extracted for exactly this) and delete the inline copy + the "do NOT edit" note; the hook's contract is identical.
- **Effort**: S

### F-3. Five dead CSS classes in index.css (zero non-test consumers) [P3]
- **File**: `frontend/src/index.css` — `.card-enter` (:689-690 + keyframes :473), `.hover-elevate-2` (:967-987), `.pb-safe` (:1023), `.pt-safe` (:1026), `.text-fluid-xl` (:911)
- **Evidence**: exhaustive grep of every custom class defined in index.css against `src/**/*.{ts,tsx}` excluding `__tests__` — 57 of 62 classes have production consumers; these 5 have none (`card-enter` is fully self-contained: keyframes + class, no consumer; `hover-elevate-2` shadowed by the used `hover-elevate`).
- **Impact**: ~1-2 KB of dead CSS shipped in the 271 KB entry stylesheet (which is also precached); naming drift risk (`pb-safe`/`pt-safe` look like the live `mobile-sticky-bottom-safe` family and invite cargo-cult use).
- **Fix sketch**: delete the five blocks; optionally add a lint-time check (same grep) to CI.
- **Effort**: S

### F-4. Physical LTR/RTL utilities dominate over logical ones (~80 sites) — future-LTR hazard, current behavior correct [P3]
- **File**: repo-wide `frontend/src/pages/**` + `frontend/src/components/**`
- **Evidence** (counts at HEAD): `ml-*` 35 + `mr-*` 18 + `pl-*` 3 + `pr-*` 21 = **77 physical margin/padding sites vs 1 `ms-/me-` and 0 `ps-/pe-`**; `text-right` 64 + `text-left` 23 vs `text-start` 7. Examples: `product.tsx` icons (`ml-1.5/ml-2` inside Arabic buttons — correct in RTL, mirrored in LTR), `admin/copilot/CopilotPanel.tsx:901` (`fixed … left-0` left-docked drawer + `slide-in-from-left-8`), `SessionManager.tsx:120` (`mr-2`), `NotificationBell.tsx:587` (`mr-11`).
- **Impact**: none today — `dir` is hard-locked to RTL (index.html `<html dir="rtl">` + `main.tsx:35` `applyDocumentDirection("ar")` + `App.tsx` `useDocumentDirection("ar")`), and every `text-left` use audited sits on `dir="ltr"` content (codes, IBAN, phone numbers) where physical is CORRECT. But `lib/direction.ts` explicitly sketches a future language switcher ("call applyDocumentDirection(nextLang)"); flipping to LTR would silently mirror all ~80 sites.
- **Fix sketch**: no urgent action; for any future i18n effort, sweep `ml|mr|pl|pr|text-left|text-right` → `ms|me|ps|pe|text-start/end` (keep physical only inside `dir="ltr"` islands). Worth a one-line note in direction.ts's docblock.
- **Effort**: M (when i18n arrives)

### F-5. App chrome (Navbar / Footer / MobileNav / FlashSaleBanner / NotificationBell) renders outside every ErrorBoundary [P3]
- **File**: `frontend/src/App.tsx:687-691` (chrome) vs `:698` (boundary wraps only the `<main>` Switch) — admin twin at `:472`
- **Evidence**:
  ```tsx
  {!isAdmin && !isChromeless && <Navbar />}
  …
  <main id="main-content" tabIndex={-1} …>
    <ErrorBoundary resetKey={location}>
      <Suspense fallback={<RouteSuspenseFallback />}>
        <Switch> …
  ```
  Navbar (auth/balance chip, search, cart badge, NotificationBell polling) is the most data-driven chrome component and the only nontrivial one with no boundary above it (main.tsx's `onUncaughtError` only forwards to Sentry — no recovery UI).
- **Impact**: a render throw in Navbar → whole-app white screen (storefront AND route content), where the deliberate R97 route-boundary design would otherwise isolate the failure to one route. Low probability (all these components have been hardened over many rounds), but the blast radius is the entire app.
- **Fix sketch**: wrap `<Navbar/>` (and optionally Footer/MobileNav) in a slim `<ErrorBoundary resetKey={location}>` whose fallback renders `null`/a minimal nav row, so a chrome crash degrades to boundary-less navigation instead of a blank page.
- **Effort**: S

### F-6. `toast.success/error/warning/info` helper API has zero production callers [P3]
- **File**: `frontend/src/hooks/use-toast.ts:158-165`
- **Evidence**: repo grep for `toast.error(|toast.success(|toast.warning(|toast.info(` outside `use-toast.ts` and `__tests__` → 0 hits (the 22 production callsites all use `toast({ title, description, variant })`). The helpers exist for the A5-5 replay tests and the documented migration path.
- **Impact**: negligible (a few dozen bytes); listed for dead-code completeness — if kept as the intended migration target, fine; otherwise fold into F-1's rewrite.
- **Fix sketch**: keep (documented convenience API + test coverage) or delete with the tests switched to the object form.
- **Effort**: S

---

## Prioritized fix table

| # | Finding | Sev | Effort | Suggested round |
|---|---------|-----|--------|-----------------|
| F-1 | sonner options dropped at `emit()` (R117 F-6 half-wired) | P3 | S | next cleanup round |
| F-2 | MobileNav unfixed keyboard-detector duplicate (F-7 not ported) | P3 | S | next cleanup round |
| F-5 | Navbar/chrome outside ErrorBoundary (white-screen blast radius) | P3 | S | next hardening round |
| F-3 | 5 dead CSS classes | P3 | S | next cleanup round |
| F-4 | 77 physical vs 1 logical utility sites (future-LTR hazard) | P3 | M | only when i18n planned |
| F-6 | unused toast variant helpers | P3 | S | optional |

No P0/P1/P2 found this round: the money paths (checkout / product buy / wallet topup), the R117 changes, a11y core, and PWA wiring all verified sound at HEAD (evidence below).

---

## VERIFIED-OK (with evidence)

**R117 commit 6538909 — every item landed:**
1. **F-1 mobile gutters** — all twelve mobile blocks in product.tsx's buy panel carry `max-lg:px-5`/`max-lg:mx-5` (order-2 title :1107, order-3 desc-long :1127, order-4 features :1137, order-5 selector :1176, order-6 price `max-lg:mx-5` :1189, order-7 usage :1236, order-8 error :1245, order-9 trust :1254, order-10 FAQ :1280, order-11 coupon :1303, order-12 CTA :1318); contract test `product-r117-contracts.test.tsx` 4/4 green (run at HEAD).
2. **F-3 FAQ DOM order** — FAQ `order-10` now lives in the END column after trust (`order-9`), before the mobile coupon (`order-11`): DOM/Tab/reading order = visual order (product.tsx:1280-1301).
3. **F-2 keyboard-hide wiring** — `useKeyboardVisibility()` consumed for the sticky bar (product.tsx:402, class swap :1361-1376 incl. the `[@media(max-height:480px)]:hidden` CSS fallback).
4. **F-7 orientationchange re-anchor** — hook re-anchors on `orientationchange` with a rAF deferral (use-keyboard-visibility.ts:48-58). (Coverage gap on MobileNav = finding F-2 above.)
5. **F-4 ScrollToTop suppression** — one-shot flag armed only when the path actually changes (product.tsx:367-385, arm at :379), consumed in ScrollToTop (App.tsx:524-552, consume at :533); navigation-quiet.ts:16-30.
6. **F-5 RouteAnnouncer** — stale-title + double-announce fixed via `titleAtNavStart` guard + `announced` once-flag (App.tsx:605-640); route-change-focus tests 9/9 green (run at HEAD).
7. **Canonical static link** — index.html:63 `<link data-rh="true" rel="canonical" href="https://subnation.ly/">`; **verified live**: `curl https://subnation.ly/` → `rel="canonical" href="https://subnation.ly/"` present.
8. **Admin orders decrypt_failed honesty** — desktop row (orders.tsx:1267-1271) AND mobile card (:1438-1444), both `role="alert"`.
9. **44px coupon buttons** — product CouponField clear/apply `min-h-11` (product.tsx:1486, 1494); checkout coupon pair `h-11` (checkout.tsx:1262, 1272).

**A11y core (storefront + admin):**
10. Skip-to-content link visible-on-focus (App.tsx:681-690); `<main tabIndex={-1}>` focus on route change (ScrollToTop :524-552); sr-only page-title announcer (:629-636); login has sr-only h1 (login.tsx:104).
11. Radix-based dialogs everywhere (app-dialog.tsx — focus trap/restore/ESC/aria-modal included; TopupWaitingModal rides AppDialog with a dismiss-lock during the waiting window :179); mobile bottom-sheet → centered card with safe-area padding.
12. aria-live coverage on async money/auth surfaces: wallet submit errors `role="alert" aria-live="polite"` (wallet.tsx:1542-1544, 1702-1704), checkout orderError/couponNotice `role="alert"` (checkout.tsx:1279, orderError banner :1435), product buy error `role="alert"` (product.tsx:1245-1250), OTP errors `role="alert"` (WhatsAppPhoneSignIn.tsx:707-712), settling banner `role="status"` (:675), AuthErrorBanner `aria-live` (:111), transfer-code live region (wallet.tsx:566).
13. prefers-reduced-motion: global kill-switch wildcard (index.css:1113-1124) + cta-glow/sonner-specific blocks (:834-838, :1401-1406); ambient blob animations pause off-screen via useOnScreen.
14. Form labels: programmatic Label/htmlFor on wallet steps (StepDot htmlFor :252, topup-amount-mobile/lypay, topup-sender-phone with aria-invalid :1487 + aria-describedby error id, wallet.tsx:1400-1500), checkout coupon aria-label (checkout.tsx:1242), OTP fields aria-labels + `autoComplete="one-time-code"` (WhatsAppPhoneSignIn.tsx:502, 569).
15. Icon-only buttons carry Arabic aria-labels across chrome: Navbar (theme :157, profile :193, cart :274 with item count, menu :235), MobileNav tabs (:105), AppDialog close ("إغلاق" :174), CopyButton/CopyField reveal, admin layout (search :383, menu :896, theme :961), admin orders reveal buttons (:1234-1235, :1405-1406).
16. Contrast: theme tokens audited — light `--muted-foreground 220 14% 38%` on near-white, dark `215 16% 68%` on `220 22% 5%` (index.css:181-182, 311-312) — both well above 4.5:1; prior-round fixes (tier colors, WhatsApp ink, network labels) in place.
17. Alt text discipline: product hero alt composes name+category (product.tsx:1042-1052) with dead-URL fallback tile; recommendations/cart thumbs have alt or initial-tile fallback; decorative icons `aria-hidden`.

**RTL / Arabic:**
18. `dir` hard-locked RTL at three layers (index.html:2, main.tsx:35, App.tsx useDocumentDirection); `dir="auto"` on Latin-heavy user content (product h1 :1109, delivered_extra_details :961-965); `dir="ltr"` islands on codes/phones/IBAN/money signs (order_code :905-908, ledger amounts wallet.tsx:476-479, coupon codes, transfer code :584).
19. Digits/locale consistent: Latin digits everywhere — formatCurrency en-US grouping (utils.ts:17-27), dates `ar-LY-u-nu-latn` (:75), countdowns M:SS Latin (WhatsAppPhoneSignIn.tsx:104-108); Arabic-Indic input CONVERTED not deleted (sanitizeAmountInput wallet.tsx:237-250; toLatinDigits WhatsAppPhoneSignIn.tsx:75-80).
20. LYD display single-sourced via formatCurrency ("X.XX د.ل") — no ar-LY money formatter anywhere (explicitly documented utils.ts:66-69); Arabic pluralization via formatCount + Intl.PluralRules across wallet/checkout/orders.
21. Arabic string quality spot-check (home/wallet/checkout/product/login/orders): no hamza/typos found; brand names wrapped `lang="en"` (WhatsApp/Google/Telegram); quote style «…» consistent; one deliberate mixed family «سجّل دخولك للشراء / تسجيل الدخول للشراء» (product.tsx:1613) is contextual, not a bug.

**Hooks / data correctness:**
22. Money-path races closed: coupon validation generation counters void stale responses on variant/cart change (product.tsx:461-466, checkout.tsx:561, 763); checkout per-unit durable Idempotency-Keys with TTL + fingerprint + multi-tab live-cart guard (checkout.tsx:800-1110); product pre-buy live re-quote aborts on price drift (product.tsx:467-500); checkout mount-time live re-quote with drop notices hoisted above the empty branch (checkout.tsx:588-703, :1325-1340).
23. Query invalidation correct post-charge: me (no-store reseed), wallet, orders-list invalidated on product buy (product.tsx:578-592), checkout unit loop (checkout.tsx:1051-1057), and socket flips (use-socket.ts:72-77, 104-105); wallet invalidate on topup submit (wallet.tsx:929-934).
24. Unmount safety: abandonedRef skips the post-loop redirect (checkout.tsx:688-694); settling auto-retry timer cancelled on unmount (WhatsAppPhoneSignIn.tsx:199); use-socket guards listener attach behind `active` + singleton connect (use-socket.ts:48-55); AppDialog keyboard scroll-into-view guarded for jsdom.
25. Error-boundary coverage: storefront Switch AND admin Switch each wrapped with route-keyed reset (App.tsx:472-495, :703) — a crashed route shows the Arabic recovery screen and resets on navigation. (Chrome gap = F-5.)
26. Retry policy honest: only network/5xx retried, 4xx never (App.tsx:211-218 isRetryableQueryError); refetchOnReconnect disabled by design (documented pool-storm rationale).

**UX states completeness** (loading skeleton / error+retry / empty per audited page):
27. Product: skeleton (:710-733), outage-vs-404 split with retry (:735-766), out-of-stock recovery links, recommendations hidden-on-error by design; Wallet: balance card error+retry (wallet.tsx:1062-1086), topups error/empty/skeleton (:1746-1790), ledger distinct error≠empty (WalletStatementCard :365-500); Checkout: guest + cart-hydration checkout-shaped skeletons (:1119-1133), empty-cart CTA, unknown-balance "—" honesty, per-unit progress label; OTP login: channel-state honest hints (settling/failed/pairing), TTL countdown, cooldown-carrying resend, settling auto-retry; Orders/order-detail/home/flash-sales: all three states present with WifiOff + retry (grep-verified).

**Dead code / bundle / PWA:**
28. Dead-code sweep: every component/hook/lib module has production consumers (counts verified — incl. SessionManager, LinkConsentModal, use-confirm, use-dirty-guard, chart-theme, transfer-code, healthz, analytics, web-vitals via main.tsx); `statusColor()` fully removed; all public assets referenced (pwa-96 in manifest shortcuts, products/*.webp via DB, init.js in index.html:110, opengraph.jpg/subnation-logo.png in SEO builders). Only exceptions: F-3 CSS + F-6 helpers.
29. Lazy routing complete: all 21 storefront + 20 admin pages via lazyWithRetry (App.tsx:36-77); only Navbar/NotFound eager; route-shaped Suspense skeletons (ROUTE_SHAPES) avoid layout jumps.
30. vendor-charts (403 KB) isolated: recharts/d3 only imported by admin dashboard + system pages (grep-verified), both lazily routed — a storefront visitor never downloads it; manualChunks rules (vite.config.ts:489-516) additionally pin radix-slot/firebase/socket chunks off the critical path.
31. Fonts: 6 woff2 bundled via @fontsource, font-display swap, critical 4 preloaded via injected `<link rel=preload>` (vite.config.ts:100-170); all six precached (live sw.js confirms).
32. PWA: live `sw.js` HTTP 200 with exactly the designed 10-entry precache (index.html, manifest, css, 6 fonts, favicon.svg); autoUpdate (skipWaiting+clientsClaim) with a VISIBLE update path — controllerchange → Arabic toast + «إعادة التحميل» action (main.tsx:99-124); SPA offline routes via navigateFallback + `/api`/`/assets` denylist; runtime caching (catalog SWR 7d, images CacheFirst 30d, same-origin JS CacheFirst) covers repeat/offline visits; static no-JS offline message in index.html:132-163.

---

**Findings by severity: P0: 0 · P1: 0 · P2: 0 · P3: 6 (+32 VERIFIED-OK)**
