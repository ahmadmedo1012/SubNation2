# R124-A5 — Accessibility (a11y) audit — storefront + shared UI

- **Repo**: SubNation2 @ `c736d13` (main). Production: https://subnation.ly
- **Scope**: `frontend/src/components/ui/*` (all), `components/{ErrorBoundary, TopupWaitingModal, LinkConsentModal, WhatsAppPhoneSignIn, AuthProviders, TelegramLoginButton, AuthErrorBanner, CopyButton, ProductCard, sonner toast surface, splash, NavigationProgress}`, `components/layout/*` (Navbar, MobileNav, Footer, NotificationBell, FlashSaleBanner, Logo), `frontend/index.html`, `App.tsx` chrome (skip link, `<main>`, RouteAnnouncer), `index.css` (focus/motion/tokens), and the forms in `pages/{login, register, checkout, support, wallet, profile}.tsx` (+ `terms.tsx` tab switcher, `product.tsx`/`home.tsx` cross-checks).
- **Method**: static read-only code audit against WCAG 2.1 AA. Contrast ratios computed from the live HSL tokens in `index.css` (dark = default: `--primary 348 80% 48%` = #dc1840, `--surface-base 220 22% 5%` → 3.93:1; light theme passes at 4.84:1, so every dark-mode contrast finding below is theme-specific). Radix behavior verified against the installed `@radix-ui/react-dialog@1.1.15` / `react-alert-dialog@1.1.15` dist, sonner behavior against the installed `sonner@2.x` dist.

## Verdict

This codebase is in the **top tier of a11y maturity** for its size. Eleven prior fix rounds (R96–R123) have visibly baked WCAG thinking into the primitives: a real skip link, route-change focus + title announcements, Radix-only dialogs with guarded dismiss + focus restore, a wallet form that is a textbook `htmlFor`/`aria-invalid`/`aria-describedby` implementation, `aria-pressed` on catalog/variant filters, `aria-current` on mobile nav, tab-nums money rendering inside accessible names, and a globally considered `prefers-reduced-motion` kill-switch. **0 P0, 0 P1.** The 11 findings below are two systematic P2s (dark-mode contrast of raw `--primary` text; selection/disclosure state not programmatically exposed on the money path) plus 9 P3 polish items.

## Findings

### 1. [P2] Raw `text-primary` small text ≈3.9:1 on dark background — WCAG 1.4.3 AA fail (default theme)
- **Evidence** (dark default: #dc1840 on `--surface-base` = **3.93:1** < 4.5:1 for normal text; light theme = 4.84:1 passes):
  - `pages/login.tsx:207` — «إنشاء حساب جديد» link: `text-primary font-bold hover:text-primary/80` (text-sm).
  - `pages/register.tsx:198` — «تسجيل الدخول» link: same class string.
  - `pages/checkout.tsx:1542` — the checkout **consent link** «الشروط والأحكام» — `text-primary font-bold` at **11px** (`text-2xs`), on the money screen.
  - `pages/profile.tsx:331` (wallet balance value, `text-sm font-bold` on `bg-background/35` tint), `:526` («حماية حسابك», text-xs bold).
  - `pages/loyalty.tsx:651` (full CTA link in `text-primary` on `bg-primary/8`), `:672` («1 د.ل» inline value), `:782` (points value, text-xs bold).
  - `pages/wallet.tsx:1538` — selected saved-phone chip: `bg-primary/15 … text-primary` (text-xs mono).
  - Hover variants make it worse: `hover:text-primary/80` drops the alpha below the resting 3.9:1 (`login.tsx:207`, `register.tsx:198`, `checkout.tsx:1542`, `order-detail.tsx:621`, `support.tsx:821/859` via `group-hover:text-primary`).
- **Why it matters**: the repo already settled this — `components/ui/button.tsx:25-28` documents that raw `text-primary` is the *surface* variant (~3.9:1) and the `link` variant deliberately rides `text-primary-text` (348 80% 65%, ≈6.9:1). These ~10 hand-rolled sites predate/escaped that convention, including the login↔register switcher links and the checkout consent link.
- **Minimal fix**: swap `text-primary` → `text-primary-text` (and `hover:text-primary/80` → `hover:text-primary-text`) at the listed sites; keep icons on `text-primary` (decorative/large-text only).
- **WCAG**: 1.4.3 Contrast (Minimum). **Effort**: S (one-class sweep, ~10 lines).

### 2. [P2] Selection / disclosure state not programmatically exposed on the money path and remaining tab groups — WCAG 4.1.2
- **Evidence** — toggle-style buttons whose *checked/selected* state is conveyed only by class changes (no `aria-pressed`/`aria-checked`/`role=radiogroup`):
  - `pages/wallet.tsx:1343-1378` — payment-method tabs («تحويل رصيد» / «تحويل مصرفي»).
  - `pages/wallet.tsx:1391-1412` — network selector (ليبيانا/مدار).
  - `pages/wallet.tsx:1430-1443` and `:1711-1724` — amount preset chips (mobile + lypay flows).
  - `pages/wallet.tsx:1522-1544` — saved-phone chips.
  - `pages/support.tsx:622-638` — ticket category pills (the group is correctly labelled via `role=group` + `aria-labelledby` at `:611-619`, but the selected pill is `bg-primary text-white` only).
  - `pages/terms.tsx:245-261` — terms/privacy tab switcher (state = `bg-card font-bold` only).
  - `pages/support.tsx:395-403` — «تذكرة جديدة» disclosure button: no `aria-expanded`/`aria-controls` (contrast: Navbar's hamburger does both, `Navbar.tsx:275-278`).
- **Why it matters**: a screen-reader user filling the top-up form (the app's money path) cannot tell which method/network/amount preset is active. The in-repo fix pattern already exists and is regression-tested: `home.tsx:1075`, `product.tsx:2046/2080` (variant pills, with the comment explaining the deliberate `aria-pressed` toggle-button choice over `role=radio`), `orders.tsx:132`, `admin/orders.tsx:243`.
- **Minimal fix**: add `aria-pressed={method === m.id}` (and equivalents) to the wallet/support/terms groups + `aria-expanded={showCreate}` on the support create toggle. No DOM restructure needed.
- **WCAG**: 4.1.2 Name, Role, Value. **Effort**: S–M (mechanical, ~11 buttons + 1 disclosure).

### 3. [P3] Desktop Navbar active route lacks `aria-current` (mobile nav has it)
- **Evidence**: `components/layout/Navbar.tsx:107-128` — `navLink()` marks the active link with `text-primary-text font-bold` + an underline div only; no `aria-current="page"`. `components/layout/MobileNav.tsx:146` correctly sets `aria-current={active ? "page" : undefined}`.
- **Fix**: add `aria-current={active ? "page" : undefined}` to the desktop `navLink`'s `<Link>`. **WCAG**: 2.4.8 (Location, AAA) / 1.3.1. **Effort**: S.

### 4. [P3] Guest hamburger drawer: no Escape close, no focus management
- **Evidence**: `components/layout/Navbar.tsx:350-397` — the drawer opens with `aria-expanded`/`aria-controls` ✓ and locks body scroll ✓ (`:57-67`), closes on route change ✓ and on the toggle ✓, but there is **no Escape handler** and focus is never moved into or returned from the panel. Contrast: NotificationBell implements Escape for its panel (`NotificationBell.tsx:313-320`).
- **Fix**: add the same document-level Escape-close effect used by NotificationBell; (optional) move focus to the drawer heading on open and back to the toggle on close. **WCAG**: 2.1.2 / 2.4.3 (adjacent). **Effort**: S.

### 5. [P3] NotificationBell panel: focus not trapped / not returned; unread state is color-only
- **Evidence**: `components/layout/NotificationBell.tsx` — the panel is `role="dialog"` + `aria-haspopup="dialog"` (`:355`, `:494`) and moves focus in on mount ✓ (`:478-481`), Escape ✓ (`:313-320`), outside-click ✓ (`:297-310`), but: (a) Tab escapes the portal'd panel into the page behind (no FocusScope trap), (b) focus is not returned to the bell button on close, (c) background scroll is not locked, and (d) read/unread is conveyed only by the primary edge bar + pulsing dot + row tint (`:556-562`, `:593-595`) — no SR-exposed state per row.
- **Fix**: cheapest honest fix — return focus to `buttonRef` on close (the `useConfirm` invoker idiom, `use-confirm.tsx:55-90`) and add visually-hidden «غير مقروء» text (or `aria-label` suffix) on unread rows; a full trap is optional since the panel is non-modal by design (no `aria-modal`). **WCAG**: 2.4.3 / 1.4.1 / 4.1.2. **Effort**: M.

### 6. [P3] Toast live region and close buttons labeled in English inside an all-Arabic UI
- **Evidence**: `components/ui/sonner.tsx:68-97` mounts Sonner without `containerAriaLabel` / `closeButtonAriaLabel`. Sonner's defaults are English — `containerAriaLabel = 'Notifications'` (sonner dist :920) on the `aria-live` section, and `closeButtonAriaLabel = 'Close toast'` (dist :442) on **every** toast's close button (`closeButton: true`). A VoiceOver/TalkBack Arabic user hears «Notifications 4 — Close toast».
- **Fix**: pass `containerAriaLabel="الإشعارات"` and `closeButtonAriaLabel="إغلاق"` on the `<Sonner>` in the wrapper. **WCAG**: 1.1.1 / 3.1.2 (adjacent — component labels in the page language). **Effort**: S (two props).

### 7. [P3] `useConfirm` AlertDialog lacks `aria-modal="true"`
- **Evidence**: installed `@radix-ui/react-dialog@1.1.15` / `react-alert-dialog@1.1.15` dists set `role` + `aria-labelledby/describedby` but **do not set `aria-modal`** (verified: zero `aria-modal` occurrences in both dists). The shared `AppDialog` compensates explicitly (`components/ui/app-dialog.tsx:125-127` with a comment), but the raw `AlertDialogContent` wrapper (`components/ui/alert-dialog.tsx:34-47`) does not — so every `useConfirm()` confirm (the money/destructive confirmations: order actions, provider unlink, session revoke) is a role=`alertdialog` with a real focus trap but no `aria-modal`, letting browse-mode SR users wander into background content.
- **Fix**: add `aria-modal="true"` to `AlertDialogContent` (one line, mirrors app-dialog.tsx). **WCAG**: 4.1.2 / ARIA dialog pattern. **Effort**: S.

### 8. [P3] Home page renders two `<h1>` elements for authed users
- **Evidence**: `pages/home.tsx:486` («اشترِ اشتراكك المفضل اليوم» — welcome-back card, rendered when `token && user`, `:472`) **and** `:678` («سوق الاشتراكات الرقمية في ليبيا» — the SEO hero, always rendered). Guests see one h1; authed users see two in the same DOM. (All other pages are clean: exactly one h1 each, correct h1→h2 ladders in checkout/wallet/support/profile; `category.tsx`/`product.tsx` pairs are mutually-exclusive branches.)
- **Fix**: demote the welcome-card heading to `<h2>` (or `<p>` — it is a greeting, not the page's topic). **WCAG**: heading-structure best practice (1.3.1/2.4.6 adjacent). **Effort**: S.

### 9. [P3] OTP expiry countdown silent; WhatsApp/coupon field errors not associated with their inputs
- **Evidence**:
  - `components/WhatsAppPhoneSignIn.tsx:638-650` — the OTP TTL countdown («ينتهي خلال 5:00») and its expiry message are plain `<p>`s (no `aria-live`), while the waiting-modal countdown in the same money flow *is* a live region (`TopupWaitingModal.tsx:255-261`).
  - `WhatsAppPhoneSignIn.tsx:721-728` — the OTP/phone error is a `role="alert"` block but is not tied to the inputs via `aria-describedby`/`aria-invalid`; `pages/checkout.tsx:1282-1286` — coupon error likewise. The wallet sender-phone field is the in-repo model to copy (`wallet.tsx:1583-1588` + `:1607-1613`).
- **Fix**: add `aria-live="polite"` to the expiry line; wire `aria-invalid` + `aria-describedby` (or `aria-errormessage`) on the OTP/phone/coupon inputs. Errors are already announced via `role=alert`, so impact is small (field-anchored re-reads on focus). **WCAG**: 4.1.3 / 3.3.1 (adjacent). **Effort**: S.

### 10. [P3] Some link clusters are distinguishable by color alone
- **Evidence**: `components/layout/Footer.tsx:117-137` — the legal-row links («الشروط والأحكام» / «سياسة الخصوصية» / «الدعم») rest in the *same* `text-muted-foreground` as the surrounding copyright text with no underline (hover color only). Same class of issue in the category band (`:50-69`) where links match the muted body color. The inline auth links (`login.tsx:201-210`, `register.tsx:194-201`) use bold+color, no underline. Positive contrast: the checkout money-error links already use the correct idiom — `checkout.tsx:1210` / `:1461` (`underline underline-offset-2`).
- **Fix**: apply the existing underline-offset idiom (or a visible `text-foreground` resting color) to footer/inline links. **WCAG**: 1.4.1 Use of Color. **Effort**: S.

### 11. [P3] «د.ل» currency abbreviation may be announced letter-wise by Arabic screen readers on money actions
- **Evidence**: `lib/utils.ts:22-25` — `formatCurrency()` renders `25.00 د.ل` and this string is reused verbatim inside accessible names and money CTAs: Navbar wallet chip (`Navbar.tsx:212-213` «المحفظة، الرصيد 25.00 د.ل»), wallet balance hero (`wallet.tsx:1191-1192`), checkout CTA totals (`checkout.tsx:1528-1530`), topup amounts (`TopupWaitingModal.tsx:280/330`). Arabic SRs commonly read the abbreviation «د.ل» letter-by-letter («دال لام») or drop it, weakening the money announcement.
- **Fix**: keep the visual string; on the 3–4 key money surfaces (wallet balance, checkout CTA, topup modal amount) add an `aria-label` with the full unit («25.00 دينار ليبي»), or a single `formatCurrencyA11y()` helper. Verify with one Arabic VoiceOver/TalkBack pass. **WCAG**: 1.3.1 (adjacent). **Effort**: M.

## Verified-OK clusters (no action needed)

1. **App shell / landmarks**: `lang="ar" dir="rtl"` on `<html>` (index.html:2); skip-to-content link visible on focus (App.tsx:690-697); `<main id="main-content" tabIndex={-1}>` focused on navigation with stale-announcement guards (App.tsx:551, route-change-focus tests); `RouteAnnouncer` (sr-only polite page-title announcements, single-utterance logic, App.tsx:587-630); three distinguished `<nav>` labels («التنقل الرئيسي» / «التنقل السفلي» / «الفئات»); static no-JS fallback carries `role="status"`.
2. **Dialog system (Radix)**: AppDialog = focus trap + ESC + scroll-lock + focus return + explicit `aria-modal` + Arabic close-button label at 44px + guarded `dismissable` for in-flight money mutations; useConfirm restores invoker focus (A4-F3) with Title/Description wiring; virtual-keyboard scroll-into-view inside sheets.
3. **Focus visibility**: global `:focus-visible` 2px solid `--ring` outline (index.css:851-859), `Input` ring with documented ≥3:1 (1.4.11) measurements, Button/Alert/Notification-row focus-visible rings; `:focus:not(:focus-visible)` suppression is keyboard-safe.
4. **Reduced motion**: global kill-switch *completes* entrance animations (0.01ms + iteration-count 1 → final frame visible) and pins infinite loops, plus targeted blocks for cta-glow and sonner; splash/blobs pause off-screen (use-on-screen). This is the "intentional alternative" shape, not a destructive kill.
5. **Forms (wallet is exemplary)**: `StepDot htmlFor` real `<label>`s; `aria-invalid` + `aria-describedby` → id'd error text; `(مطلوب)/(اختياري)` textual required markers; `type="text" inputMode="decimal"` + `enterKeyHint` + `dir="ltr"` + `autoComplete` correctness; support page uses `Label htmlFor` + `role=group`/`aria-labelledby` for the pill group; login/register carry sr-only `<h1>` + `aria-current` tabs.
6. **Async status / toasts**: sonner 2.x live region + focus handling verified in dist; premium toast wrapper adds theme/dir/RTL; `CopyButton` is `aria-live="polite"` with honest failure branch; skeletons are `role="status" aria-live="polite"` with Arabic label; TopupWaitingModal announces approved (`role=status`) and rejected (`role=alert`) states at the money moment; AuthErrorBanner/WhatsApp errors are `role=alert` with Arabic close labels.
7. **Images / icon buttons**: ProductCard builds one collapsed accessible name (name + category + price + variants + stock state) *and* descriptive alt text with graceful fallbacks; decorative overlays/shine/gradient layers `aria-hidden`; icon-only buttons across Navbar/bell/cart/dialog-close/paste-button all carry Arabic `aria-label`s (cart label includes Arabic-pluralized count).
8. **Language correctness**: Latin brand tokens wrapped `<span lang="en">` (WhatsApp/Google/Telegram/Firebase) at every auth surface; numeric/mono runs `dir="ltr"`; RTL mirroring handled for switch thumbs, badge corners, send icons.
9. **Motor / tap targets (A4 coordination)**: pervasive `min-h-11`/`h-11`/`touch-target` (44×44) on money paths — dialogs, alerts, coupon pair, presets, chips, close buttons — with negative-margin tricks to preserve visual density; the only 32px controls (`Button size="sm"` = min-h-8) still clear the WCAG 2.2 AA 2.5.8 24px floor and sit on non-critical surfaces. No new tap-target violations found beyond what R116/R117 already fixed.
10. **Money semantics**: `tabular-nums` on every amount; totals embedded in the primary CTA label («إتمام الطلب (…)»); top-up amount echoed in the USSD transfer panel; insufficient-balance and dropped-line money errors are persistent `role=alert` blocks with icon + text (non-color) and underlined recovery links.

## Recommended fix order

1. **#1 + #10 together** (one contrast/underline sweep of hand-rolled link styles — S).
2. **#2** (`aria-pressed`/`aria-expanded` sweep, wallet first — S/M).
3. **#6 + #7** (two one-liners on the toast wrapper and AlertDialogContent — S).
4. **#3, #4, #8, #9** (small, isolated — S).
5. **#5, #11** (M — focus-return + unread labeling; SR money-unit pass).

*Read-only audit: no code was modified. Only this report file was written.*
