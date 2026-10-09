# R124-A4 — Mobile & Responsive Experience Audit (Storefront)

- **Repo**: `SubNation2` @ `c736d13` (main) — READ-ONLY audit; this file is the only write.
- **Scope**: `frontend/index.html`, `frontend/src/index.css`, `frontend/src/components/layout/*`, `frontend/src/components/{ProductCard,WhatsAppPhoneSignIn,CopyButton,TopupWaitingModal,LinkConsentModal,AuthProviders,TelegramLoginButton}.tsx`, `frontend/src/components/ui/{input,button,app-dialog,sonner}.tsx`, and all 16 customer pages (`home, product, category, cart, checkout, wallet, orders, order-detail, profile, login, register, support, loyalty, referrals, flash-sales, onboarding`) + status/terms spot-checks.
- **Method**: static code audit per `skills/impeccable-repo/skill/reference/adapt.md` (content-driven breakpoints, 44×44 touch floor, hover-none rules, safe-area/env(), zoom-on-focus rules). Evidence = `file:line` + class strings. **Untested (reported gap, not a blocker)**: no physical device / synthesized-touch run — real-device keyboard behavior, iOS zoom, gesture drags and 320 px rendering were verified at the code/contract level only (emulated-viewport render was not available in this sandbox). All sizing verdicts below are computed from Tailwind class geometry (rem scale: 44px = `min-h-11`/`h-11`, 36px = `h-9`, 40px = `h-10`).
- **Context**: Arabic RTL, `dir="rtl"` at the document root, mobile-first market (Libya). Six prior mobile-focused rounds (R96, R116, R117, R118, R120, R122, R123) have already hardened most of the surface — this audit hunted the residue.

---

## Findings

### 1. [P2] Sub-44px interactive controls cluster on money/recovery paths (9 sites)

The app's own documented tap-target floor is 44×44 (`index.css:996-999` `.touch-target`, dozens of `min-h-11` fixes citing it, e.g. `orders.tsx:454`, `cart.tsx:170-172`). A residual class of **error-state retry buttons and secondary form/destructive controls** ships below it — all mobile-visible, several on the money funnel where they are the *only* recovery action:

| Site | Element | Effective size | Evidence |
|---|---|---|---|
| `orders.tsx:435-451` | «تحميل المزيد» in the loaded-pages-empty state (`size="sm"` + **fixed `h-9`**) | **36px** (the `h-9` even caps Button's `min-h-8`) | ironic sibling comment `orders.tsx:454` claims this button "already follows" the 44px floor — it doesn't |
| `wallet.tsx:480-486` | wallet-ledger error retry «إعادة المحاولة» (`size="sm"` + `h-9`) | 36px | wallet money page |
| `wallet.tsx:1881-1887` | topup-history error retry (`size="sm"` + `h-9`) | 36px | wallet money page |
| `loyalty.tsx:842-848` | points-ledger error retry (`size="sm"` + `h-9`) | 36px | |
| `support.tsx:688-717` | new-ticket **إلغاء / إرسال التذكرة** pair (`h-10`) | 40px | the ticket form's only submit |
| `profile.tsx:578-587` | **تسجيل الخروج** (`w-full h-10`) — destructive | 40px | sibling above it was fixed to h-11 in R122 (`profile.tsx:544`) |
| `referrals.tsx:366-372` | «مشاركة الرابط» share CTA (`py-2.5` ≈ 40px) | ~40px | the page's primary action |
| `checkout.tsx:1208-1213` | **insufficient-balance recovery link** «اشحن المحفظة ثم عُد لإتمام الطلب» (bare `inline-flex` text-xs link, no min-height) | **~20px tall** | the *only* path from a failed checkout to the topup flow — also below the WCAG 2.5.8 AA 24px floor |

Everything else on these pages already rides `min-h-11`/`h-11`/`h-12`, so the cluster reads as an internal inconsistency, not a convention.

**Fix (ponytail)**: one-line class bumps — `h-9`→`min-h-11`, `h-10`→`h-11` (or `min-h-11`), `py-2.5`→`py-3`+`min-h-11`; for the checkout recovery link add `min-h-11 -my-2 py-2` (the `FlashSaleBanner.tsx:217` negative-margin idiom keeps the banner geometry unchanged). **Effort: S** (9 one-liners).

### 2. [P2] Footer/legal link lists below the WCAG 2.5.8 AA 24×24 floor

Footer links are `text-2xs` (11px) bare `<Link>`s in wrapped list rows (~14px tall targets). WCAG 2.5.8's inline-in-sentence exception does **not** apply — these are standalone links in `<ul>` lists / separated rows, and the store ran a dedicated WCAG-AA pass (R111 F3-xx), so this is a conformance gap, not just polish:

- `Footer.tsx:53-59` — 7 category links «بث مباشر … تعليم» (`text-2xs`)
- `Footer.tsx:62-68` — «العروض» (`text-2xs`)
- `Footer.tsx:75-97` — support cluster «الدعم الفني / الشروط والأحكام / حالة الخدمة» (`text-2xs`) — **no 44px alternative exists anywhere for سياسة الخصوصية / حالة الخدمة** (footer-only destinations)
- `Footer.tsx:118-136` — legal row (three `text-xs` links + separators, `gap-2` below sm) — ~17px targets
- Same class, lower stakes: `category.tsx:253` breadcrumb «الرئيسية» (`text-xs`, ~17px), `onboarding.tsx:213-220` skip word «هنا» (`text-2xs`, ~14px), `checkout.tsx:1540-1545` consent «الشروط والأحكام» (inline, exempt but ~17px).

**Fix**: give list-level links `inline-flex min-h-6 items-center` (24px AA floor) — e.g. `className="inline-flex min-h-6 items-center text-2xs …"` on the 4 footer groups; the inline-in-sentence ones (checkout consent, onboarding «هنا») can stay or gain `py-1`. **Effort: S**.

### 3. [P3] Loyalty points-convert input is the storefront's last `type="number"` — misses the house keyboard contract

`loyalty.tsx:711-723`: `type="number"` with **no** `inputMode`, **no** `enterKeyHint`, **no** `autoComplete="off"`. The wallet fixed this exact class in R96 (96-F6, `wallet.tsx:1447-1462`: `type="text"` + `inputMode="decimal"` + `autoComplete="off"` + `enterKeyHint="done"`, with a comment explaining Arabic-locale iOS keypad quirks of `type=number`). Integers make the decimal-key half moot, but `type=number` still accepts `e`/`+` on desktop, fires no sensible mobile Enter label, and invites browser autofill into a points field. Test coverage exists for the wallet fields (`pages/__tests__/wallet-submit.test.tsx:260-262`) but not this one.

**Fix**: `type="text"` + `inputMode="numeric"` + `autoComplete="off"` + `enterKeyHint="done"` (4 props, keep `dir="ltr"`, guard the existing `min/step` validation in `handleConvert`). **Effort: S**.

### 4. [P3] Tablet-touch (≥768px, `hover: none`): quick-add is a 32px icon and the richer CTA panel is hover-only

`ProductCard.tsx:595` — persistent quick-add is `hidden md:flex … h-8 w-8` (32×32); `ProductCard.tsx:611-616` — the full «أضف للسلة» slide-up is `hidden md:block … group-hover:translate-y-0 group-focus-within:translate-y-0`. On an iPad/Android tablet (viewport ≥768, coarse pointer) the mobile CTA (`md:hidden`, `ProductCard.tsx:558`) is gone, the hover panel can never reveal (no hover, no keyboard), and the only card-level add affordance is the 32px icon — under the app's 44px floor and the audit's touch rule (passes the 24px AA floor). The adapt.md guidance "detect input method, not just screen size" (`@media (hover: none)`) is already used in `index.css:1260` (sonner close button) but not here.

**Fix**: add `[@media(hover:none)]:h-11 [@media(hover:none)]:w-11` to the quick-add button (or bump to `h-9 w-9`→`size-11` for all ≥md). **Effort: S**.

### 5. [P3] Authed users on phones in landscape lose every primary navigation

`MobileNav.tsx:92` — bottom nav is `[@media(max-height:480px)]:hidden` (deliberate, to save vertical space on short viewports — comment at `MobileNav.tsx:70-72`). But the hamburger is **guest-only** (`Navbar.tsx:271` `{!token && …}`), so an authed user rotating to landscape (<480px height) has: no bottom nav, no drawer, and a Navbar row with only theme/bell/cart. «المحفظة / طلباتي / حسابي» become unreachable except via in-content links (home hero wallet CTA, profile tiles — the latter itself needs the nav to reach). Portrait phones (the Libya majority) are unaffected.

**Fix (ponytail)**: mount the hamburger for authed users too below md (drawer variant with wallet/orders/profile/loyalty/support links), or relax the landscape hide to `max-height:420px` and shrink the nav to icons-only. **Effort: M** (drawer content variant + authed state).

### 6. [P3] «العروض» (/flash-sales) has no authed mobile entry except the footer

The only Navbar entry to `/flash-sales` is inside the guest drawer (`Navbar.tsx:366-371`, `!token && open`); desktop nav doesn't list it either. Home hero chips link to categories only (`home.tsx:758-802`). Authed mobile users reach flash sales only by (a) scrolling to the footer link (`Footer.tsx:62-68`) or (b) the site-wide `FlashSaleBanner` — which renders **only while a sale is active**. When no sale runs, a discount-curious authed shopper has no short path.

**Fix**: add «العروض» to the home sticky chip row (`home.tsx:1068` row, one more `min-h-11` pill linking `/flash-sales`) — it already exists in the guest drawer, so copy that pill. **Effort: S**.

### 7. [P3] ProductCard title flex child lacks `min-w-0` — a single long unbreakable token squeezes the row

`ProductCard.tsx:443-463` — the name row is `flex items-start gap-2` with `h3.flex-1` (`line-clamp-2`) beside a `shrink-0` category badge, but no `min-w-0` on the h3. A flex item's automatic minimum size is its min-content (longest unbroken token); a catalog name with one long Latin token (e.g. a concatenation like `Microsoft365FamilyYear`) cannot shrink below it, squeezing/pushing the badge and clipping inside the card (`overflow-hidden` at `ProductCard.tsx:312` contains it — no page overflow). Current live names are space-separated Arabic/Latin so this is latent, but the sibling price row and every other flex text chain in the app carries `min-w-0` (e.g. `checkout.tsx:1397`, `orders.tsx:520`, `cart.tsx:252`).

**Fix**: add `min-w-0` to the h3 class list. **Effort: S** (one word).

---

## Verified-OK clusters (no action needed)

1. **Viewport & zoom** — `index.html:14-18`: `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`; **no `user-scalable`/`maximum-scale`** (pinch-zoom stays available — a11y ✓); `-webkit-text-size-adjust: 100%` (`index.css:348`); the `interactive-widget` key survives MetaTags re-upserts via a MutationObserver guard (`Navbar.tsx:77-89`).
2. **iOS zoom-on-focus** — every storefront input/select/textarea is 16px below md: shared `Input` `text-base md:text-sm` (`ui/input.tsx:23,36`); home search + sort (`home.tsx:1003,1046` — the R96-M03 fix comments are still accurate); support textarea (`support.tsx:682`); WhatsApp phone/OTP (`WhatsAppPhoneSignIn.tsx:520,609`). Money inputs also ride `h-11` (wallet `wallet.tsx:1483`, `1751`, `1789`).
3. **Mobile keyboard UX** — `type="tel"`+`enterKeyHint` (WhatsApp phone `WhatsAppPhoneSignIn.tsx:504-511`), `inputMode="numeric"`+`autoComplete="one-time-code"`+smart-paste (OTP `:577-593`), wallet amount `inputMode="decimal"`+`autoComplete="off"`+`enterKeyHint="done"` + sender phone `autoComplete="tel"` (`wallet.tsx:1460-1462,1551-1554`), coupon fields `autoComplete="off"`+`enterKeyHint="send"`+`dir="ltr"` (`checkout.tsx:1252-1255`, `product.tsx:1528-1529`), support reply `enterKeyHint="send"` (`support.tsx:562`). All forms single-column below sm (`checkout.tsx:1150`, `support.tsx:687`, `wallet.tsx:1669`). Regression-tested (`components/__tests__/whatsapp-phone-sign-in.test.tsx:198-212`, `pages/__tests__/wallet-submit.test.tsx:260-300`).
4. **Mobile navigation** — fixed bottom nav (`MobileNav.tsx`): 5 authed / 4 guest tabs, 60px grid (every tab ≥44×44), `env(safe-area-inset-bottom)` padding, cart badge with count, `aria-current`, hides under keyboard (shared `use-keyboard-visibility` + `[@media(max-height:480px)]:hidden` no-JS fallback) and on auth pages; guest hamburger drawer carries all 7 categories + العروض + support + login/register at `min-h-[44-48px]` (`Navbar.tsx:350-396`) with body scroll-lock. Cart is reachable from every viewport (R96-M01 P0 fix intact: `Navbar.tsx:148-160,284-312`).
5. **Fixed-chrome clearance contract** — single source `MOBILE_NAV_HEIGHT=60` ↔ `--mobile-nav-h` (guard-tested per `MobileNav.tsx:33-50`); `mobile-nav-safe-pad` main clearance (authed) + `mobile-nav-footer-pad` (guest, padding-can't-collapse) + `mobile-sticky-above-nav` for the product buy bar; `scroll-padding-top/bottom` incl. `env()` insets and the `html:has(.mobile-sticky-above-nav)` 68px reservation (`index.css:352-379,1018-1064`). Product sticky buy bar: fixed for authed / sticky-above-nav for guests, keyboard-hidden, short-viewport-hidden (`product.tsx:1407-1440`).
6. **Modals / bottom sheets** — `AppDialog` (`ui/app-dialog.tsx`): bottom-sheet `<sm` → centered ≥sm, `max-h-[85dvh]` (dvh, R96-M10), body is the only scroll region (`min-h-0 flex-1 overflow-y-auto`), 44px close, safe-area footer (`max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]`) and footer-less variant, guarded dismiss during mutations, focus scroll-into-view for fields under the keyboard. `TopupWaitingModal` + `LinkConsentModal` ride it. Notification panel: mobile-aware fixed geometry derived from the real header bottom, `100dvh` max-height cap, internal scroll, 44px actions (`NotificationBell.tsx:407-471,510-631`).
7. **Horizontal overflow defense** — `html`/`body` `overflow-x: clip` + `body min-width: 320px` + `@supports not (overflow:clip)` fallback (`index.css:351,394-395,1081-1086`); **zero `<table>` elements in the storefront** (orders/topups/ledger are card lists); LTR runs isolated with `dir="ltr"` + `font-mono` + `break-all`/`truncate` for order codes (`orders.tsx:534-539`, `order-detail.tsx:68-69`), credentials (`order-detail.tsx:61-69`), phones, referral code/link (`referrals.tsx:338-360`); wallet balance `break-words` (`wallet.tsx:1191`); orders price cluster `max-w-[42%]` (`orders.tsx:566`); cart rows `flex-wrap`+`min-w-[10rem]` so money info never ragged-wraps at 320px (`cart.tsx:221-252`); checkout CTA `whitespace-normal text-balance min-h-12` for the long coupon-state label (`checkout.tsx:1489-1504`); Toaster is `top-center offset-20px` so toasts never collide with the bottom nav (`ui/sonner.tsx:72-76`).
8. **Safe areas** — `viewport-fit=cover`; top inset: Navbar `paddingTop env(safe-area-inset-top)` (installed-PWA status bar, `Navbar.tsx:131-138`) and home sticky search tracks it (`home.tsx:969`); bottom inset: MobileNav, AppDialog, sticky-bar clearance chain (all above); `apple-mobile-web-app-capable` + `black-translucent` + theme-color present (`index.html:79-96`).
9. **Touch vs hover** — global `touch-action: manipulation` on all interactive elements (`index.css:420-428`); `press-spring :active` feedback; `card-spring`/`shine-trigger` hover effects disabled below 768 (`index.css:1067-1079`); sonner close button forced visible under `@media (hover: none)` (`index.css:1260-1264`); mobile always gets an always-on CTA wherever desktop uses hover-reveal (ProductCard `md:hidden` button; product page sticky bar). (Residue = finding 4, tablets only.)
10. **RTL** — forward chevrons/arrows point **left** consistently (`Navbar.tsx:394`, `category.tsx:330,363`, `orders.tsx:594`, home hero); back points right (`category.tsx:238` rotate-180); `Send` mirrored (`support.tsx:584,713`); scroll-fade masks are RTL-correct/symmetric (`index.css:643-662`); no swipe carousels (chip rows are native `overflow-x-auto`, whose scroll direction follows `dir` in all engines); bottom-sheet animations are direction-neutral; Latin digit/mono runs use `dir="ltr"` + `tracking-[0.2em]` (the named tracking utilities are zeroed by the Arabic letter-join guard `index.css:917`).
11. **Breakpoint coverage** — content-driven and consistent: product grid 2/2/3/4 (`home.tsx:1160`, `category.tsx:335`), product page `max-lg:contents` single-column → 2-col at lg (`product.tsx:1060-1213`), checkout 1-col → `[1fr_360px]` at md (`checkout.tsx:1150`), wallet 1-col → 5-col at lg (`wallet.tsx:1145`), sticky search bar mobile-only (`sm:static`, `home.tsx:969`), FlashSaleBanner unit labels drop at ≤359px so the sale title survives 320px (`FlashSaleBanner.tsx:251-258`), checkout CTA label wraps at ≤390px. No cramped ranges found beyond the items above.

---

## Priority counts

| Priority | Count |
|---|---|
| **P0** | 0 |
| **P1** | 0 |
| **P2** | 2 (findings 1, 2) |
| **P3** | 5 (findings 3-7) |
| **Total** | **7** |

**Overall verdict**: the storefront is in the top tier of mobile maturity for an RTL market — viewport/zoom, keyboard UX, safe areas, fixed-chrome clearances, modal containment and overflow defense are all systematic and regression-tested. The residue is a cluster of sub-44px secondary controls on recovery paths (P2, 9 one-line fixes), footer/legal link lists under the WCAG 2.5.8 AA floor (P2, one class), and five P3 edge/consistency items (tablet quick-add, landscape nav, flash-sales reachability, `type=number` straggler, a missing `min-w-0`). All 7 fixes are ≤ S effort except the landscape-nav one (M).

*No code was modified. No secrets are included. No inventory/catalog/restock or WhatsApp-pairing surfaces touched.*
