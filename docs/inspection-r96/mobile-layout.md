# R96-A1 — Mobile Responsive Layout Audit (Storefront)

Agent: R96-A1 (diagnostic specialist, research-only — no source modified)
Date: 2026-09-11
Scope: `frontend/` storefront shell + all customer pages + shared UI components, evaluated at 320 / 360 / 390 / 414 / 430 px wide and 568 / 667 px tall, RTL Arabic, iOS Safari + Android Chrome, browser + installed-PWA modes.
Method: full read of App.tsx, index.css, all layout components, all storefront pages, shared ui/\*, plus targeted sweeps (raw form controls, fixed widths, grid densities, 100vh usage, physical left/right classes, translate-x transforms). Admin pages spot-checked for the checklist items (tables, inputs).

---

## Summary table

| Severity  | Count  | Meaning                             |
| --------- | ------ | ----------------------------------- |
| **P0**    | 1      | Usability-breaking on common phones |
| **P1**    | 7      | Broken on 320px / specific but real |
| **P2**    | 6      | Polish / degraded experience        |
| **P3**    | 8      | Nits                                |
| **Total** | **22** |                                     |

---

## P0 — critical

### R96-M01 · Authed Navbar overflows at ≤390px — cart icon clipped off-screen at 320/360px

**File:** `frontend/src/components/layout/Navbar.tsx:87, 105–231` (+ `MobileNav.tsx:5–11`, `index.css:351–352`)
**Evidence:**

```tsx
<div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">   // line 87
  <Link href="/"><Logo size="sm" /></Link>                                              // ≈123px min ("SubNation" is one unbreakable word, text-base font-black)
  <div className="flex items-center gap-1">                                             // line 105
    … theme toggle (touch-target → 44px) … NotificationBell (44px)
    <div className="… px-2.5 py-1.5 … min-w-[60px]">  {/* mobile wallet chip, line 195 */}
      <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>  // "145.50 د.ل" ≈ 80–102px real width
    … cart (w-9 + touch-target min 44px, line 222)
```

**Why it breaks:** At 320px the row has 288px of usable width. Minimum content for a logged-in user ≈ logo 123 + gap 12 + theme 44 + bell 44 + wallet chip ≥60 (content floor ~80–102 with any real balance) + cart 44 + inner gaps 12 ≈ **337–381px**. Flexbox pushes the overflow past the inline-end (left) edge, and `html/body { overflow-x: clip }` (index.css:351/362) **clips it instead of scrolling** — the cart icon is the last item in the cluster, so on iPhone SE (320px) the cart is almost fully cut off and at 360px partially cut. The only other cart entry point, MobileNav, has **no cart tab** (`TABS` = الرئيسية/المحفظة/طلباتي/الولاء/حسابي — MobileNav.tsx:5–11), so the whole cart funnel is unreachable on small phones for authed users. Guests (theme + menu + cart = ~275px) still fit.
**Fix direction:** (a) drop the mobile wallet chip from the Navbar (balance already visible on /wallet and in the home hero) or cap it with `max-w-[90px] truncate`; (b) shrink the Logo's text (`showText={false}` below `xs` or a shorter lockup); (c) add a cart tab to MobileNav or a floating cart affordance; (d) `flex-wrap` is not enough — remove fixed 44px minimums from decorative (non-interactive-critical) cluster items or hide the theme toggle below `xs`.

---

## P1 — broken on 320px or specific but real

### R96-M02 · NotificationPanel (mobile) has no height cap — long lists run past the viewport

**File:** `frontend/src/components/layout/NotificationBell.tsx:353–360` (mobile branch) vs `361–381` (desktop branch)
**Evidence:**

```tsx
const panelStyle = isMobile
  ? { position: "fixed", top: 56, left: 8, right: 8, zIndex: 70 }   // ← no maxHeight
  : (() => { … maxHeight: `calc(100vh - ${top + 16}px)`, … })();     // desktop only
```

The body is `flex-1 min-h-0 overflow-y-auto` (line 452) — but a flex child only scrolls when the container has a bounded height. With no `maxHeight` on mobile, the panel grows to content height (e.g. 20 notifications ≈ 2000px+); rows below the fold are unreachable on a 568–844px phone (the panel is `position: fixed`, so page scrolling doesn't help).
**Fix:** add `maxHeight: calc(100dvh - 56px - 16px)` (or `env`-aware) to the mobile branch, mirroring the desktop one.

### R96-M03 · iOS focus-zoom: home search input + sort select are 14px

**File:** `frontend/src/pages/home.tsx:620` (Input override) and `653–665` (raw select)
**Evidence:**

```tsx
<Input … className="pr-9 h-10 text-sm bg-card …" />                 // twMerge: text-sm beats the Input base "text-base md:text-sm"
<select … className="h-10 appearance-none … text-sm font-medium …">  // raw select, 14px at every breakpoint
```

The shared `Input` deliberately ships `text-base md:text-sm` (input.tsx:17) to prevent iOS zoom; these two overrides on the **most-visited page** re-introduce it. On iOS Safari, focusing the search field (or opening the sort dropdown) zooms the page ~1.14× and never zooms back out — disorienting on the catalog landing.
**Fix:** delete `text-sm` from both (keep it in an `md:text-sm` if a smaller desktop look is wanted).

### R96-M04 · iOS focus-zoom: WhatsApp OTP phone + code inputs are 14px

**File:** `frontend/src/components/WhatsAppPhoneSignIn.tsx:265` (phone) and `334` (OTP)
**Evidence:**

```tsx
<input type="tel" … className="flex-1 h-11 … text-left text-sm …" />
<input … inputMode="numeric" … className="flex-1 h-11 … tracking-widest text-sm …" />
```

WhatsApp OTP is the **primary sign-in path in Libya** — every phone-first user hits the zoom jump on both steps of the funnel.
**Fix:** `text-base` (16px) on both inputs.

### R96-M05 · iOS focus-zoom: support ticket textarea + product coupon input

**File:** `frontend/src/pages/support.tsx:623` (textarea `text-sm`), `frontend/src/pages/product.tsx:938` (coupon `Input className="pr-9 h-9 text-sm font-mono …"`)
**Why:** same mechanism — a 14px focused control triggers the iOS page zoom. The support form is the recovery path for failed orders; the coupon field is on the money path.
**Fix:** `text-base` (or drop the override so the shared Input default applies).

### R96-M06 · Checkout confirm CTA text overflows the button at ≤390px when a coupon is applied

**File:** `frontend/src/pages/checkout.tsx:747–762` + `frontend/src/components/ui/button.tsx:8`
**Evidence:**

```tsx
// buttonVariants base includes: "whitespace-nowrap"
<Button … className="w-full … h-12">
  {appliedCoupon ? <>تأكيد الطلب — الإجمالي بعد الكوبون ({formatCurrency(comparisonTotal)})</> : …}
</Button>
```

At 320–390px the nowrap label ("تأكيد الطلب — الإجمالي بعد الكوبون (1,234.50 د.ل)" ≈ 300–330px of Arabic + tabular digits) exceeds the button's inner width (~256–296px). `inline-flex justify-center` centers the overflow, so the label bleeds symmetrically outside the rounded button into the card. The "جارٍ المعالجة… (…)" pending state is shorter and survives; the plain "تأكيد الطلب (…)" fits. Only the coupon state breaks — the exact moment the user has committed to a discounted total.
**Fix:** drop `whitespace-nowrap` for this instance (or add a `text-wrap`/`whitespace-normal` + `text-balance`), or shorten the label to "تأكيد — 100.00 د.ل".

### R96-M07 · AppDialog mobile bottom-sheet ignores the iOS home-indicator safe area

**File:** `frontend/src/components/ui/app-dialog.tsx:106–119` (content) and `148–152` (footer)
**Evidence:**

```tsx
"fixed inset-x-0 bottom-0 z-50 flex w-full flex-col gap-0",
"rounded-t-2xl border bg-card …", "max-h-[85vh]",
…
<div className="flex shrink-0 flex-wrap justify-end gap-2.5 border-t border-border px-5 py-4">  // footer — flush to bottom:0
```

`viewport-fit=cover` is on (index.html:8), so on Face-ID iPhones the sheet's footer buttons (confirm/cancel on the account-link consent modal, and every future AppDialog footer) sit **under the 34px home-indicator zone** — the exact strip where iOS interprets taps as home-gestures. MobileNav and the product sticky bar both handle `env(safe-area-inset-bottom)`; this sheet doesn't.
**Fix:** add `padding-bottom: env(safe-area-inset-bottom)` (or `pb-safe`) to the sheet's footer/last row.

### R96-M08 · No top safe-area anywhere — installed PWA renders the Navbar under the status bar

**File:** `frontend/src/components/layout/Navbar.tsx:77–87` (no top inset); `frontend/src/index.css:1150–1152` (`.pt-safe` defined, **never used** — verified: zero consumers); `frontend/index.html:42–43`
**Evidence:**

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

```css
.pt-safe {
  padding-top: env(safe-area-inset-top, 20px);
} /* orphaned utility */
```

With `black-translucent`, standalone/installed PWA sessions draw page content **behind the clock/notch**. The sticky Navbar (`sticky top-0 z-50 h-14`) has no `pt-safe`/top inset, so the logo and the top action row are partially obscured on every notch/Dynamic-Island phone that installs the PWA (the manifest makes it installable). The NotificationPanel's hard-coded `top: 56` (NotificationBell.tsx:356) compounds this in PWA mode.
**Fix:** `padding-top: env(safe-area-inset-top)` on the Navbar header (and derive the panel offset from the header's real bottom).

---

## P2 — polish / degraded experience

### R96-M09 · dialog.tsx / alert-dialog.tsx: full-bleed edge-to-edge on mobile, no max-height/scroll

**Files:** `frontend/src/components/ui/dialog.tsx:39` (used by `TopupWaitingModal.tsx:132`), `frontend/src/components/ui/alert-dialog.tsx:37` (used by `hooks/use-confirm.tsx:88` — every destructive confirm)
**Evidence:**

```tsx
"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] … p-6 … sm:rounded-lg";
```

On phones: `w-full` + no horizontal margin → the card touches both screen edges; rounding only applies `sm:` → sharp corners at 320px; and there is **no max-height or internal scroll** — a long `adminNote` in TopupWaitingModal's RejectedBody or a long confirm description pushes the footer buttons below the 568px fold with no way to reach them (body scroll is locked by Radix). The app's own canonical shell (AppDialog) already solved all of this (bottom sheet + `max-h-[85vh]` + scrolling body) — these two legacy shells never got the treatment.
**Fix:** migrate TopupWaitingModal + useConfirm onto `AppDialog`, or add `max-h-[85dvh] overflow-y-auto` + `sm:max-w-lg max-w-[calc(100vw-2rem)] rounded-2xl` to both legacy contents.

### R96-M10 · AppDialog height cap uses `vh`, not `dvh`

**File:** `frontend/src/components/ui/app-dialog.tsx:116` (`"max-h-[85vh]"`)
**Why:** on iOS Safari with the URL bar visible, `85vh` is computed against the _large_ viewport — a long sheet anchored at `bottom-0` can extend its header above the visible top edge until the toolbars collapse. Every other full-height surface in the app already migrated to `dvh` (login/register/onboarding/splash/status).
**Fix:** `max-h-[85dvh]` (with a `vh` fallback for old browsers if needed).

### R96-M11 · Guest product page: sticky buy bar covers the Footer's legal row at scroll end

**Files:** `frontend/src/pages/product.tsx:843–886` (sticky bar), `frontend/src/components/layout/Footer.tsx:22` (`token ? "mobile-nav-footer-pad" : ""`), `frontend/src/App.tsx:356` (`mobile-nav-safe-pad` only when `token`)
**Why:** for guests the fixed `sm:hidden` buy bar (`mobile-sticky-bottom-safe` → `bottom:0`, ~68px + inset) is always on screen, but nothing reserves space **below the footer** for guests (both clearance utilities are auth-gated). Scrolling a guest (SEO landing) product page to the end overlays the bar directly on the copyright/legal-links row. Authed users are safe (76px page pad + 60px footer pad ≥ bar 68px + nav 60px).
**Fix:** give the guest variant of the footer (or the product page root) a `mobile-sticky-bottom-safe`-aware clearance, or hide the bar once the footer is in view.

### R96-M12 · Home skeleton cards are ~58px shorter than real cards on mobile (CLS)

**Files:** `frontend/src/components/ui/route-skeleton.tsx:97–115` (`ProductCardShell`) vs `frontend/src/components/ProductCard.tsx:358–380`
**Why:** every real ProductCard renders an always-visible mobile CTA (`md:hidden min-h-11` button or "نفد المخزون" bar, ≈44px + `mx-3.5 mb-3.5` ≈ 58px total) below the details block; the skeleton mirrors the image + text rows but **not the CTA**. With the 8-card `grid-cols-2` mobile grid, the skeleton→content swap grows each row ~58px → a visible content jump on the highest-traffic page on first paint (exactly the CLS class the route-skeleton system was built to eliminate).
**Fix:** add a `md:hidden min-h-11 mx-3.5 mb-3.5` placeholder block to `ProductCardShell`.

### R96-M13 · cart.tsx item row collapses at 320px — price cluster wraps into ragged lines

**File:** `frontend/src/pages/cart.tsx:171–246`
**Why:** fixed pieces per row: thumb 56 + gap 14 + quantity stepper (26+28+26=80) + trash 26 + gap 6 + gap 14 ≈ 196px, leaving **~92px** for the `min-w-0` middle column. The price row (`flex items-baseline gap-2`, no wrap): "49.00 د.ل" (bold) + strikethrough "75.00 د.ل" + "خصم 20%" badge ≈ 170px of content in 92px → wraps into 2–3 ugly lines (no horizontal scroll thanks to the global clip, but the money info degrades badly exactly where users verify totals). 360px+ is fine.
**Fix:** at `xs` stack the stepper/trash under the title (grid rows) or shrink the stepper (32px buttons, `min-w-[22px]` count) and let the price row sit on its own line.

### R96-M14 · Admin form controls at 14px/12px — iOS zoom for admins on phones

**Files (examples):** `pages/admin/settings.tsx:666,678,689`; `admins.tsx:388,400`; `products.tsx:714`; `users.tsx:726`; `topups.tsx:183`; `risk-event.tsx:254` (`text-xs`!); `security.tsx:273,288`; `enrichment.tsx:246,369`; `pricing.tsx:262`
**Why:** every raw `input/textarea/select` styled `text-sm` (one even `text-xs`) reproduces the iOS zoom jump for operators reviewing topups/tickets from a phone. Secondary surface (admin is desktop-first) but a real, repetitive annoyance.
**Fix:** bulk bump to `text-base md:text-sm` (mirroring the shared Input contract).

---

## P3 — nits

### R96-M15 · Footer legal row has zero slack at 320px and no flex-wrap

**File:** `frontend/src/components/layout/Footer.tsx:42–62` — "الشروط والأحكام · سياسة الخصوصية · الدعم" ≈ 271px of `text-xs` + `gap-4` + 2 separators vs 288px available. Any wider glyph run (font fallback, longer labels) clips the last link under `overflow-x: clip`. Add `flex-wrap` / reduce `gap-4`→`gap-2` at `xs`.

### R96-M16 · NotificationPanel hard-coded `top: 56` overlaps the FlashSaleBanner

**File:** `NotificationBell.tsx:356` — the panel opens at the Navbar's bottom edge; while a flash sale is active the 44px banner sits exactly there and is covered by the panel. Cosmetic layering, self-heals on scroll.

### R96-M17 · referrals.tsx referral code can overflow its card if codes reach 16 chars

**File:** `referrals.tsx:350–356` — `text-2xl tracking-[0.2em] font-mono`, no truncate/break. Current codes are short; at 16 chars (~300px) it would exceed the card's 248px inner width. Add `truncate` (the loyalty-page variant already truncates its link/code rows).

### R96-M18 · Legacy `100vh` / `min-h-screen` remnants

**Files:** `pages/auth-callback.tsx:72`, `App.tsx:246`, `pages/not-found.tsx:21` (`calc(100vh-4rem)`), `components/ErrorBoundary.tsx:54`, `pages/terms.tsx:214`, `pages/home.tsx:274` — all min-height only (benign on iOS), but inconsistent with the app's `dvh` policy; convert for uniformity.

### R96-M19 · Support message panel height math uses `100vh`

**File:** `pages/support.tsx:440,456` — `maxHeight: min(460px, calc(100vh - 260px))`. On iOS with toolbars visible the thread area can be ~60–100px taller than the visible viewport, pushing the reply box below the fold until the page is scrolled. Use `100dvh`.

### R96-M20 · Navbar cart badge corner inconsistent with the bell badge in RTL

**File:** `Navbar.tsx:225` (`-top-0.5 -right-0.5`) vs `NotificationBell.tsx:293` (`-top-0.5 -left-0.5`) — the two unread badges sit on opposite physical corners of their icons. Pick one convention (inline-end corner) for both.

### R96-M21 · `.cv-card` intrinsic size underestimates real mobile card height

**File:** `index.css:1256–1260` — `contain-intrinsic-size: 280px`; real mobile cards (aspect-square + text + mobile CTA) run ~330px, so scrollbar-length estimation wobbles during fast fling scrolls. Consider `contain-intrinsic-size: auto 330px`.

### R96-M22 · FlashSaleBanner is functionally cramped at 320px

**File:** `components/layout/FlashSaleBanner.tsx:158–235` — fixed clusters (icon ~28 + countdown ~128 + dismiss 44 + gaps) leave ~116px for the title + "— خصم N%" → the sale title truncates to near-zero on the smallest phones. No overflow (parent has `truncate`), but the message is effectively invisible at 320px. Consider hiding the countdown unit labels (`س/د/ث`) below `xs` or stacking.

---

## Verified-good (audited, no action)

- **Viewport meta**: `width=device-width, initial-scale=1, viewport-fit=cover`; `user-scalable` NOT disabled (zoom stays accessible). `html { -webkit-text-size-adjust: 100% }`.
- **Global overflow guard**: `html, body { overflow-x: clip }` + `body { min-width: 320px }` (+ `@supports not (overflow: clip)` fallback) — no page-level horizontal scrollbar anywhere in the storefront.
- **MobileNav contract**: `MOBILE_NAV_HEIGHT = 60` (ts) ≡ `--mobile-nav-h: 60px` (css), guard test `mobile-nav-clearance.test.tsx` keeps them equal; nav itself has `env(safe-area-inset-bottom)` padding, `z-50`, 5-column grid with `min-w-0` labels; clearance utilities (`mobile-nav-safe-pad`, `mobile-nav-footer-pad`, `mobile-sticky-above-nav`, `mobile-product-pad-auth/guest`, `mobile-sticky-bottom-safe`) are all breakpoint-scoped to their companion elements' render ranges (no phantom desktop pads).
- **Shared `Input`**: `text-base md:text-sm` — the correct iOS-zoom-safe baseline (the P1s above are all _overriders_).
- **Product sticky bar layering**: `z-[45]` sits below MobileNav (`z-50`); authed bar offset above the nav; guest bar carries its own `env(safe-area-inset-bottom)` padding.
- **`dvh` adoption** on all full-viewport chromeless/auth pages (login, register, onboarding, telegram-callback, status, splash, admin login) and the AuthGate placeholder.
- **Sonner toasts**: `dir="rtl"`, `position="top-center"` (clear of the bottom nav), and sonner's own `@media (max-width: 600px)` constrains toast width to `100% - offsets` — no 356px overflow at 320px; the premium-toast CSS uses logical insets (`inset-inline-start/end`) for the accent strip and close button.
- **Admin tables**: every wide table is either `hidden md:block` + card fallback (risk.tsx:275) or wrapped in `overflow-x-auto` (users.tsx:812, orders.tsx:892); filter chip rows scroll horizontally with `scrollbar-none`.
- **Long-string handling**: order codes `dir="ltr" font-mono` with hyphen break opportunities (orders.tsx:357–361); credentials use `break-all` (order-detail.tsx:62) or `max-w-[160px] truncate` (product.tsx:133); IBAN `break-all` + copy (wallet.tsx:1029); USSD transfer code `break-all min-h-[44px]` (wallet.tsx:280); coupon codes always `dir="ltr"` + `font-mono`.
- **RTL iconography**: unified conventions — forward = `ChevronLeft`/`ArrowLeft`, back = `ChevronLeft rotate-180`/`ArrowRight` (category, terms, referrals, not-found); `Send` mirrored via `-scale-x-100` (support.tsx:562,654); `NavigationProgress` bar grows from `origin-right`; `.scroll-fade-rtl*` masks fade the correct (left/inline-end) edge for RTL horizontal scrollers; `Switch` thumb uses `rtl:-translate-x-4` (with a regression test); status accent bars use one system (`border-r-[3px]` + `border-r-status-*`, orders.tsx:45–56 documents the earlier logical/physical mixup and the fix); dialog close buttons sit at the inline-end corner (`left-4` in RTL, dialog.tsx:49).
- **Grids**: product grids are `grid-cols-2` at every mobile width (home/category/flash-sales/route-skeleton — consistent 2-up at 320px with `gap-3`); the 3-col mobile strips (home stats, product trust signals, login value chips, loyalty how-it-works) wrap text within ~90px cells without overflow.
- **Images**: `aspect-square` / `aspect-[16/9]` / `aspect-[4/3]` ratio boxes with `object-contain` and `max-w-[74%]` inner images — no fixed pixel heights that crop on narrow screens; dead image URLs fall back to category-icon tiles without reflow (onError display swap).
- **Skeleton route map**: `ROUTE_SHAPES` covers every storefront route incl. the dedicated checkout geometry (max-w-5xl + `md:grid-cols-[1fr_360px]`), first-match-wins ordering is tested (`route-shapes.test.ts`).
- **No `transform: scale()` containers** that would break `position: fixed` children; `user-scalable` not disabled; touch targets ≥44px on all money-path controls (bell, close buttons, steppers are the remaining small ones but wrapped in `touch-target` where it matters).

---

## Suggested fix order

1. R96-M01 (P0, cart funnel unreachable at 320–360px authed)
2. R96-M02 + R96-M07 + R96-M08 (overlay/safe-area family — one PR)
3. R96-M03/M04/M05 (iOS zoom — mechanical `text-base` bumps, one PR)
4. R96-M06 (checkout CTA overflow)
5. R96-M09/M10 (dialog shells — AppDialog migration)
6. Remaining P2s, then P3s.
