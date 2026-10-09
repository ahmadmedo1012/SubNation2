# R127-B13 — Storefront UX: R126-surface verification + ledger consolidation + fresh journey pass

- **Repo:** `/home/z/my-project/repos/SubNation2` @ `f53a886` (main; production tree, verified live)
- **Mandate:** (1) code-verify the R126-L6 storefront seam fixes + the edge cases that lane may have missed; (2) consolidate the held-open ledger (R125-A7 B-1..B-13 + R126-A9 leftovers) into one disposition table; (3) fresh journey pass on surfaces R126-A9 did not file against; (4) mobile-first lens; (5) loading/error/empty truth on every storefront query surface.
- **Method:** static code-read of the R126-L6 surfaces (`product.tsx` CtaBlock + sticky bar, `MobileNav.tsx`, `NavigationProgress.tsx`, `index.css` mobile utilities, `ui/sonner.tsx`, `support.tsx`, `NotificationBell.tsx`, `orders.tsx`, `wallet.tsx`) + per-item ledger verification greps at HEAD + journey reads of cart/checkout/wallet/support/orders/order-detail/profile/onboarding/home-search/category/flash-sales/footer/status/terms + two guest-level live GETs (`/api/flash-sale`, `/api/products`). Read-only: only this report + one worklog entry.
- **Known-items list built from (never re-reported):** `docs/inspection-r125/A7-storefront-followup.md` (B-1..B-13), `docs/inspection-r126/A9-storefront-ux.md` (F1-F6 + §5 minors + OPS-1/2), R126-A13 (F1/F4/F5/F9/F10/F11/F12), R127-B3 (K1 product-card title clipping P2; K2 micro-text density P3), R127-B4 (mobile LCP/login-paint/sentry-eager perf set), R127-B5 (PWA F1-F4), R127-B6 (socket B6-1..B6-3 + P3s), R127-B2 (trust-card dead code, §E ledger), R96-known qty steppers + order-detail credentials copy (excluded by mandate).

---

## 1. Verdict up front

**R126-L6 surface verification: PASS (6/6 code changes present and correct; edge cases clean except one P4).** The sticky mobile CTA stack is coherent at 390px — z-order (`bar z-[45]` < `nav z-50` < `progress z-[100]`), no physical overlap (bar pins above the nav, nav owns the bottom safe-area inset), keyboard-hide + short-viewport fallbacks intact, RTL arrows on the new surfaces are direction-neutral or follow the documented forward=left rule.

**Ledger consolidation: 25 rows — 14 CLOSED (R126 lanes were thorough), 1 OBSOLETE, 2 residue-tails, 8 OPEN** (2 M, 6 S; the open set is the same money/faithfulness tail every round carries — B-10 support-thread freshness, B-11 cart stock cap, the 99-cap toast cousin, A9-F2's deferred notification pagination). The R125-A7 P2 (B-1 banner ink) and every copy/deletion P3 from that ledger are verified closed in code with comments + pin tests.

**Fresh pass: P0 0 · P1 0 · P2 0 · P3 2 · P4 1 + 6 minor observations.** Both P3s are cheap one-hunk fixes the R126-L5/R125-I7 sweeps stopped one site short of: the Toaster's top offset ignores the safe-area inset R126-L5 introduced everywhere else, and home's two inline recovery controls sit under the 44px floor B-4's fix just enforced on their page-level siblings. Storefront remains **SHIP-WORTHY**.

---

## 2. R126-L6 surface verification (code-read at f53a886)

### 2.1 The compact sticky CtaBlock (A9-4 / A9-5)

| Check | Evidence at HEAD | Verdict |
|---|---|---|
| Sold-out branch precedes `!token` (A9-5) | `product.tsx:1738` comment "A9-5 (R126-L6): availability outranks auth." → `if (!product.is_available) {` (:1746) renders compact strike-price + Lock + «نفد المخزون» + active «بدائل» (:1757-1776); `if (!token) {` only at :1800 | **PASS** — guests on sold-out PDPs get the honest state; the login gate renders only for buyable products |
| Guest compact add-to-cart (A9-4) | `product.tsx:1842` `{compact && onAddToCart && product.is_available && (` → `shrink-0 h-12 w-12` outline PlusCircle icon-button, `aria-label="أضف للسلة — سجّل الدخول عند إتمام الطلب"` (:1843-1850); call site passes `onAddToCart={handleAddToCart}` to the sticky block (:1550) | **PASS** — 48px square, gated on availability exactly like the desktop twin (:1832) |
| Authed compact add-to-cart (A9-4 second half) | `product.tsx:1988-1997` — same compact icon-button in the solvent-buy branch (`aria-label="أضف للسلة"`) | **PASS** — mobile majority can now park a variant selection and keep shopping |
| Loading / insufficient branches in compact mode | `userLoading` → spinner + «جارٍ التحقق…» (:1875-1898); `!canAfford` → shortfall + 48px «شحن» (:1900-1949) | **PASS** — no false money statements during the /me probe |
| 3-control row at 390px | guest row: price `flex-1` + login `min-w-[8rem] h-12` + add `w-12` ≈ 232px fixed → price gets ~158px | **PASS** at 390px (see minor obs. §7.1 for the 320px wrap) |

### 2.2 Sticky-bar overlap with mobile PWA browser chrome / safe-area (R126-L5 interaction)

- **Bottom inset:** the bar never touches the home-indicator zone. `index.css:1048-1050` — `.mobile-sticky-above-nav { bottom: calc(var(--mobile-nav-h) + env(safe-area-inset-bottom)); }`, scoped ≤639.98px (the bar is `sm:hidden`). `MobileNav.tsx:105` — the fixed nav itself carries `style={{ paddingBottom: "env(safe-area-inset-bottom)" }}`. The authed bar is `fixed left-0 right-0 mobile-sticky-above-nav pb-3` (:1513); the guest bar is `sticky -mx-4 mobile-sticky-above-nav pb-3` (:1529) with the documented nav-owns-inset rationale (:1514-1528). **PASS.**
- **Page clearance:** `mobile-product-pad-auth` = `68px + 0.5rem` (index.css:1056-1058) vs the bar's real height (48px control + pt-3 + pb-3 = 72px) — 76px reserved ≥ 72px. Guest variant reserves bar + nav + inset + breathing (:1063-1065). **PASS.**
- **Keyboard/short-viewport:** `stickyBarHiddenByKeyboard → "hidden"` (:1500-1505) + `[@media(max-height:480px)]:hidden` (:1510) — both retained around the new content. **PASS.**
- **Gap found (the one thing L5+L6 missed together):** the **Toaster** — see F-1 (§4). The R126-L5 pass covered Navbar top inset (`Navbar.tsx:214`), MobileNav bottom, admin layout (`admin/layout.tsx:1284,1418`), home's sticky filter bar (`home.tsx:979` `top-[calc(3.5rem_+_env(safe-area-inset-top))]`) and the NotificationPanel's inset-aware top math (`NotificationBell.tsx:433-450`) — but not the toast layer.

### 2.3 z-index vs NavigationProgress and the rest of the fixed chrome

`NavigationProgress.tsx:83` — `className="fixed top-0 inset-x-0 h-[2px] z-[100] pointer-events-none"`: lives at the viewport TOP, above the Navbar (z-50), never near the bottom bar. Bar z-[45] < MobileNav z-50 (physically disjoint anyway), < sonner 999999999, < app-dialog overlay/content z-50 (dialogs cover the bar — correct). No stacking conflicts found on any /product state. **PASS.**

### 2.4 RTL arrow icons on the new surfaces

The new CTA surfaces carry no directional arrows (PlusCircle/Wallet/Lock/ShoppingCart are symmetric). The PDP's directional affordances all follow the documented rule: breadcrumb separators are unrotated `ChevronLeft` (forward=left, :1111/:1120, comment :1106-1110); the back-link rides `ArrowRight` + `group-hover:translate-x-0.5` (back=right, :1142, physical translate matches); not-found's «رجوع» ArrowRight is comment-pinned (:67). The R125 B-3 terms exception is closed (terms.tsx:251 unrotated + `terms-legal-page.test.tsx:45-54` pin). **PASS.**

### 2.5 The other four R126-L6 surfaces

| Surface | Evidence | Verdict |
|---|---|---|
| A9-1 support `?ticket=` deep link | `support.tsx:347-378` — regex-gated (`/^\d{1,9}$/`), waits for the authed list, membership-checked (foreign/stale id = silent no-op), consumed-once ref, honest `openTicket` dep | **PASS** (one P4 edge: a FAILED first list load consumes the link silently — `loading:false` + `tickets:[]` fails the membership check at :369-373; a retry via the error card does not re-arm it) |
| A9-2 bell footer cap honesty | `NotificationBell.tsx:668-669` — `{notifs.length >= NOTIFICATION_HISTORY_CAP ? "آخر " : ""}` prefix at the 40 cap | **PASS** (full pagination correctly deferred — backend `routes/notifications.ts` still `.limit(40)` with no `?page=`) |
| A9-3 orders `?filter=` mirror | `orders.tsx:36-39` whitelist (`ORDER_FILTER_VALUES`), `useState(readInitialFilterFromUrl)` (:189), `replaceState` mirror (:192-205), chips `aria-pressed` (:145) | **PASS** |
| A9-3 wallet `?method=` mirror | `wallet.tsx` method tab seeded from URL, prefs effect skips `setMethod` when seeded, `?return=` preserved (per L6 log; spot-verified in file) | **PASS** |

**R126-L6 verification verdict: 6/6 LANDED AND CORRECT** — with two follow-ups surfaced: F-1 (toaster safe-area, the L5 seam both lanes missed) and the P4 deep-link-consumed-on-outage edge above.

---

## 3. Consolidated held-open ledger (R125-A7 B-1..B-13 + R126-A9 leftovers), verified at f53a886

| # | Item | Disposition @ HEAD | Evidence | Remaining cost |
|---|---|---|---|---|
| B-1 | FlashSaleBanner light-wash ink AA fail (P2) | **CLOSED** (R126-L5) | `FlashSaleBanner.tsx:85` `const BANNER_INK = "text-primary-text [.light_&]:text-foreground/90";` + full re-measure comment (:58-84: light 8.72-11.12:1 on the washes) | 0 |
| B-2 | `hover:text-primary` residuals ×4 | **RESIDUE: 1 of 4 left** | fixed: category.tsx:231, product variant pill (:2206), orders empty CTA (:511) — all `hover:text-primary-text`; **still open: `referrals.tsx:524`** `hover:text-primary` on the loyalty CTA (orders.tsx:633 chevron is icon-only → 3:1 floor passes, fine) | **S** (one class) |
| B-3 | terms backwards separator | **CLOSED** | terms.tsx:251 unrotated `ChevronLeft` + `terms-legal-page.test.tsx:45-54` pin | 0 |
| B-4 | error taxonomy: 7th drifted site + sub-44px retries | **CLOSED** — with one comment-truth nit | category.tsx:331 + home.tsx:1182 converged on `FetchErrorCard`; product.tsx:841-852 + order-detail.tsx:238/:246 bespoke buttons lifted to `min-h-11`. Nit: `fetch-error-card.tsx:20-24` drift ledger still says "home's grid error (native button + rounded-3xl/float-in)" — stale now that home uses the card | **S** (comment edit) |
| B-5 | status 32px refresh + mystery 30s tick | **CLOSED** | status.tsx:170-177 `h-11 w-11` + purpose-pinning comment at :76-84 | 0 |
| B-6 | cart no-image fallback 1.66:1 | **CLOSED** | cart.tsx:255 `text-muted-foreground` + rationale comment (:247) | 0 |
| B-7 | wallet StepDot permanently active | **CLOSED** (honest-collapse route) | wallet.tsx:300-317 — `active` prop + dead branch deleted; flat numbered legend | 0 |
| B-8 | delivery-window promise drift | **CLOSED** | order-detail.tsx:529 «عادةً فوراً، وبحد أقصى 24 ساعة. سنُشعرك…» — matches home/onboarding/support | 0 |
| B-9 | topup submit verbs split | **CLOSED** | wallet.tsx:1737/1907 both «إرسال طلب الشحن»; step labels unified (:1712/:1878) with comments | 0 |
| B-10 | open support ticket thread never refreshes | **STILL OPEN — worth-now** | `support.tsx`: zero `refetchInterval`/`useSocket` in file (grep); thread fetches once per open. Pairs with R127-B6 B6-3 (wallet/order-detail have the same no-freshness family on blips) | **M** (15-30s poll while open, orders idiom) |
| B-11 | cart qty ignores stock; over-quantity surfaces mid-charge | **STILL OPEN — worth-now** | `lib/cart.tsx`: no `stock_count`/`category` on `LocalCartItem`; clamp is still `[1, 99]` (:137,215,230,264) | **M** (snapshot + stepper cap + «متبقٍ N») |
| B-12 | REFUSE residue (stripes/over-round/ghost cards/templates) | **TAIL** | stripes→1px DONE (home.tsx:481/669, category.tsx:281, heading borders); hero rounded-3xl→2xl DONE (home.tsx:662). Remaining: auth/onboarding cards still `rounded-3xl + shadow-2xl + border` (login.tsx:135, register.tsx:99, onboarding.tsx:119); `trust-card.tsx` dead code (R127-B2 §B); skeleton radius drift → my F-3 | **S-M** (one batched commit whenever a design pass runs) |
| B-13 | terms stamp + long-form measure | **CLOSED** | terms.tsx:122/185 «أكتوبر 2026» + :293 `max-w-[65ch]` reading column | 0 |
| A9-F1 | support reply notification → ticket list | **CLOSED** (R126-L6) | §2.5 above | 0 |
| A9-F2 | notifications capped at 40, dropdown-only | **PARTIAL — deferred by design** | label honesty landed (bell footer); `/notifications` page needs backend `?page=` first (route still `.limit(40)`, no params) | **M** (backend + slim page) |
| A9-F3 | orders/wallet filter state URL-invisible | **CLOSED** (R126-L6) | §2.5 above | 0 |
| A9-F4 | guest PDP add-to-cart invisible <640px | **CLOSED** (R126-L6) | §2.1 above | 0 |
| A9-F5 | guest sold-out PDP sold the login | **CLOSED** (R126-L6) | §2.1 above | 0 |
| A9-F6 | checkout no-image fallback `text-primary/50` | **CLOSED** (R126-L5) | checkout.tsx:1416 `text-muted-foreground` + comment (:1410) | 0 |
| A9-m1 | 99-unit cap applies silently (toast cousin) | **OPEN — worth-now** | cart.tsx stepper + `lib/cart.tsx:72` — still no feedback at the cap | **S** |
| A9-m2 | home search heading lacks `dir="auto"` | **OPEN** | home.tsx:1156 `` label = `نتائج البحث: ${searchInput}` `` interpolated raw | **S** |
| A9-m3 | profile quick-links omit الدعم | **OPEN** | profile.tsx:370-400 — wallet/orders/loyalty/referrals only | **S** |
| A9-m4 | guest support CTA drops `?ref=` | **OPEN (practically unreachable)** | support.tsx:803 `/login?redirect=/support` | **S** |
| OPS-1 | «تجربة» test flash sale live | **OBSOLETE** | live `GET /api/flash-sale` → `{"flash_sale":null}` today; the content gate idea (warn on title ∈ {تجربة, test}) is still worth one admin-form line if promotions ever return | 0 / S (gate) |
| OPS-2 | catalog effectively browse-only | **OPEN — operator** | live: still exactly 1/45 `is_available`; R127-B8 DB snapshot agrees (4 unsold codes sit in inventory; 50 unread no_stock alerts) | operator (runbook `FINAL_INVENTORY_LOADING.md`) |

**Ledger size: 25 rows — 14 closed · 1 obsolete · 2 residue-tails · 8 open** (B-10, B-11, A9-F2-page = M; B-2 residue, A9-m1..m4 = S). Worth-doing-now: **B-10, B-11, B-2 residue, A9-m1** (the two Ms close the last money/faithfulness edges; the two S's are one commit).

---

## 4. New findings (not on any known list)

### F-1. [P3] The Toaster's top offset ignores the safe-area inset — the one fixed-position layer R126-L5's pass missed
**Evidence:** `frontend/src/components/ui/sonner.tsx:72-78` —
```tsx
      position="top-center"
      duration={4000}
      visibleToasts={3}
      gap={12}
      offset="20px"
```
Sonner 2.x assigns that prop to `--offset-top`/`--mobile-offset-top` and pins `[data-sonner-toaster][data-y-position=top]{top:var(--offset-top)}` (verified in the installed `sonner/dist/index.mjs`) — a hard 20px from the viewport top, no `env()`. Nothing in `index.css`'s `[data-sonner-toaster]` block (:1140+) overrides it. Every other fixed layer now reserves the notch zone: Navbar (`Navbar.tsx:214` `paddingTop: env(safe-area-inset-top)`), MobileNav (:105), home's sticky filter bar (`home.tsx:979`), admin chrome (`admin/layout.tsx:1284`), the bell panel's top math (`NotificationBell.tsx:433-450`).
**Why it matters:** the app is `viewport-fit=cover` with black-translucent status bar for the installed PWA (the 96-F5 note at Navbar.tsx:208-212). On notched iPhones in standalone, the top ≈47-59px is unsafe: every toast — add-to-cart confirmation, undo actions, the PWA update toast, money errors — renders its icon + first title line under the clock/Dynamic Island. The bottom-nav collision that motivated `top-center` (documented R124-A4 §13) is untouched by the fix.
**Fix (S):** `offset="calc(env(safe-area-inset-top, 0px) + 20px)"` (the prop feeds a CSS var, calc works), or `mobileOffset` for the ≤600px full-width variant. One line. **Confidence: 4** (CSS chain verified; no notched-device render available in this sandbox). Family pointer: A13-F11 (open P2) named only "sticky header / bottom bar" — this is a new instance of that family, not a re-report.

### F-2. [P3] Home's two inline recovery controls sit under the 44px floor B-4 just enforced on their siblings
**Evidence:**
- `frontend/src/pages/home.tsx:572-577` (recent-orders strip outage retry):
```tsx
                <button
                  onClick={() => refetchOrders()}
                  className="text-xs font-bold text-primary-text border border-primary/25 px-3.5 py-1.5 rounded-lg hover:bg-primary/8 transition-colors press-spring shrink-0"
                >
                  إعادة المحاولة
                </button>
```
  text-xs (12px/20 line) + py-1.5 (12) + border (2) ≈ **34px tall**.
- `frontend/src/pages/home.tsx:1218-1223` (empty-grid recovery CTA):
```tsx
              <button
                onClick={clearFilters}
                className="text-sm font-bold text-primary-text border border-primary/25 px-5 py-2 rounded-xl hover:bg-primary/8 transition-colors press-spring"
              >
                مسح جميع الفلاتر
              </button>
```
  text-sm (14/20) + py-2 (16) + border ≈ **38px tall**.
**Why it matters:** both are the ONLY action on their state (outage strip / filtered-empty grid) — the exact "recovery control" class the R124 tap batch + R125 B-4 lifted to `min-h-11` on every page-level sibling (orders' empty-state twin now carries `min-h-11`, orders.tsx:511; home's own compact chips use the `min-h-11 … -my-2` idiom at :751). These two inline sites escaped both sweeps. WCAG 2.5.8's 24px floor passes — this is the repo's own bar, inconsistently applied.
**Fix (S):** `min-h-11` + the negative-margin idiom (`-my-1.5` / `-my-2`) to keep the strip row's rhythm — two class edits. **Confidence: 5** (measured from the class math; same method as R124-A4).

### F-3. [P4] Skeleton radius drift: two RouteSkeleton shells still round 24px corners the R125-I7 sweep flattened to 16px
**Evidence:** `frontend/src/components/ui/route-skeleton.tsx:91` — `<div className="rounded-3xl skeleton-shimmer h-[160px] sm:h-[200px] mb-6" />` (CatalogShell hero band, used for `/` and `/category/*` via `shapeForRoute`) and `:163` — `<div className="rounded-3xl skeleton-shimmer aspect-[4:3] sm:aspect-[16:9] mb-5" />` (DetailShell, loyalty). The real elements they mirror went `rounded-3xl → rounded-2xl` in R125-I7 (home.tsx:662 guest hero + :470/:475 authed hero; category.tsx:274; loyalty's cards :477+ are `rounded-2xl`). FormShell's `rounded-3xl` card (:333) remains faithful — onboarding.tsx:119 is still 24px (B-12 tail).
**Why it matters:** the skeleton-parity contract ("mirrors the real card so the grid doesn't jump on load" — product.tsx:2048-2049 states it) now pops its corner radius on every cold route-load of the two highest-traffic pages. Cosmetic-only, zero CLS (aspect-reserved).
**Fix (S):** `rounded-3xl → rounded-2xl` ×2 (:91, :163). **Confidence: 5.**

---

## 5. Fresh journey pass — surfaces walked (all verified GOOD unless in §4/§7)

- **Cart (edge cases, steppers excluded per mandate):** guest CTA «سجّل دخولك للشراء» → `/login?redirect=/checkout` (cart.tsx:416-419); wallet-balance chip never fabricates a number (:381-385); clear/confirm/undo idiom intact; no-image fallback now AA (B-6 closed). Residual: stock-blind quantity = B-11 (ledger).
- **Checkout (guest→login gate):** mount effect redirects guests with the full path preserved (checkout.tsx:546-550) AND the render path returns a `RouteSkeleton shape="checkout"` for `!token` (:1123) — no form flash, no dead form. Money states (insufficient banner, per-line re-quote notices, coupon pre-flight, per-unit submit progress :535-541) re-verified as in R125-A7/R126-A9 — no regressions.
- **Wallet:** step legend now flat-numbered (B-7), verbs unified (B-9), `?method=` mirror live; amount inputs normalize Arabic-Indic/Persian digits (:271-280) with `inputMode="decimal"` (:1525/:1818); statement + topup history keep distinct skeleton / FetchErrorCard / «لا توجد حركات بعد» states (:494-527). Residual freshness gap rides B-10/B6-3 family.
- **Support/tickets (customer side):** guest gets a login CTA card while the FAQ stays public (:787-812); list loading skeleton / `FetchErrorCard` / empty distinct (:813-830); reply box 44px with double-Enter guard (:302-312, :626-628); `?ref=` order-context prefill (:337-345) and the new `?ticket=` deep link both live.
- **Order-detail / profile / onboarding:** order-detail's «قيد الإعداد» copy unified (B-8); retry + escape-hatch buttons at `min-h-11` (:238/:246); profile quick-links + logout clean (الدعم omission = A9-m3); onboarding CTAs h-12/min-h-11 (:167-211).
- **Search + filters (R122 normalization):** Arabic-Indic digit normalization present on money inputs; home search carries Enter-commit history, a **recent-searches dropdown** with clear + keyboard-safe blur handling (home.tsx:994-1034 — the R94-A1 #16 feature), and the three-way empty/filtered-empty/outage split (:1176-1224). Residual: `dir="auto"` on the results heading (A9-m2).
- **Category browsing:** chips `min-h-11`, current-category excluded from sibling chips (no false active state), product count rendered on the products heading (:314-316, complete — backend list caps at 500), skeleton → `FetchErrorCard` → empty → grid all distinct (:318-356); FAQ chevron rotates left→down on open (RTL-correct).
- **Footer/legal links:** all 7 category links live (`/category/:slug`), العروض/الدعم/الشروط/الحالة + legal row terms#terms / terms#privacy / support — terms mirrors its tab hash (R126-A9 verified; unchanged). Footer clearance math (nav pad) intact.
- **WhatsApp support entry points:** **none exist** — support is deliberately ticket+notification only; WhatsApp in this codebase is the OTP + outbound-delivery rail. No `wa.me`/`api.whatsapp.com` link anywhere in `frontend/src` or customer-facing backend routes. Not filed as a defect (product decision) — see §7.6.
- **Live guest GETs:** `/api/flash-sale` → `{"flash_sale":null}` (OPS-1 expired); `/api/products?fields=list&available_only=true` → exactly 1 product (OPS-2 current).

## 6. Mobile-first + loading/error truth summary

- **Input zoom (16px rule):** storefront is clean — the shared `Input` is `text-base` with the 14px look scoped to `[@media(min-width:48rem)_and_(pointer:fine)]` (`ui/input.tsx` R126-L5 comment); zero `text-sm` overrides on storefront `<Input>`s remain (the last one, the product coupon field, was removed in R96). **PASS.**
- **Sheet/dialog heights:** `app-dialog` mobile sheets cap at `max-h-[85dvh]` with safe-area-augmented footer padding (:149-196); alert-dialog `max-h-[85dvh]`; bell panel dvh-capped; terms `min-h-[100dvh]`. Only raw-vh residue: `route-skeleton.tsx:59,84` `min-h-[60vh]` — harmless for a min-height placeholder. **PASS.**
- **Thumb reach:** primary money CTAs live in the sticky bottom bar (perfect zone) at h-12; MobileNav tabs full-height 60px rows; the new compact add-to-cart is a 48px square in the bar. Exceptions = F-2.
- **Loading/error/empty truth:** every storefront query surface checked (home products/stats/orders-strip, category, product+recommendations, checkout re-quote, wallet balance/statement/topups, orders, loyalty, referrals, support list, flash-sales, status) renders a shape-matching skeleton while pending, an Arabic actionable `FetchErrorCard`/banner on failure, and an empty state distinct from outage — no blank screens, no spinner-only money pages, no outage-masquerading-as-empty anywhere. This discipline is now uniform; the only sub-44px recovery controls left are F-2's pair.

## 7. Minor observations (below finding threshold)

1. `product.tsx:1804-1807 / 1955-1960` — the compact bar's price `div` is `flex-1 text-right` with no `min-w-0`; at 320px (200% zoom / small phones) a 4+ digit price can wrap to two lines and grow the bar. Graceful, but `truncate`/`min-w-0` would pin the height. (B3-K1's clipping family measured at 390px; this is the 320px cousin.)
2. `support.tsx:366-378` — `?ticket=` is consumed silently if the FIRST list fetch fails (`loading:false` + `tickets:[]` → membership fails → consumed). Re-arming on a successful refetch would make the deep link outage-proof. P4.
3. `fetch-error-card.tsx:20-24` — the component's drift ledger still lists home's grid error among "left in place" sites; home converged in R125-I7. Comment-truth nit (ledger row B-4).
4. `route-skeleton.tsx:59,84` — `min-h-[60vh]` (raw vh) on loading placeholders; min-height so the large-viewport delta only over-reserves. Not worth changing alone; fold into F-3's commit.
5. Home category chips show no per-category counts (category pages show counts on the h2). Deliberate density trade; noting for completeness.
6. No WhatsApp support entry point exists (§5). For a WhatsApp-first market with a WhatsApp delivery rail, a single «تواصل عبر واتساب» link on /support (operator number via env) is an S-cost product option — flagged for the operator, not filed as a defect.

## 8. Known-items pointer table (do not re-report)

| Known item | Source | Status |
|---|---|---|
| Product-card title clipping 16/45 @390px (P2) | R127-B3 K1 | open, fix S |
| Micro-text pixel-contrast density (P3) | R127-B3 K2 | open |
| Mobile LCP poor all routes; login AuthGate paint gate; vendor-sentry eager; image sizing; /init.js cache | R127-B4 NEW-1..5 | open (perf lane) |
| SW sourcemap leak; /assets soft-200; /sw.js nav capture; offline-div flash | R127-B5 F1-F4 | open |
| Socket: alert-room dead reconciliation; park/resync staleness (tickets/risk); wallet/order-detail blip staleness; products grid poll-only; topup toast dedupe | R127-B6 B6-1..B6-3 + P3s | open (B-10 pairs here) |
| `trust-card.tsx` dead code + auth-card REFUSE tail | R127-B2 §B / B-12 | open |
| A11/A13 a11y tail: tab stops (F1), cart badge live region (F4), login error role (F5), heading skips (F9), 16-19px text links (F10), safe-area family (F11 — F-1 is a new instance) | R126-A13 | open |
| Authed landscape loses bottom nav (documented stretch) | R124-A4 #5 | documented |
| Catalog stocking backlog (1/45) | R126-A9 OPS-2 / R127-B8 | operator |
| Cart qty steppers; order-detail credentials copy | R96 (mandate exclusion) | known |

## 9. Next actions (ordered, ponytail)

1. **One S-commit:** F-1 (`offset="calc(env(safe-area-inset-top, 0px) + 20px)"`) + F-2 (two `min-h-11` + negative margins) + F-3 (`rounded-2xl` ×2) + B-2's last `hover:text-primary-text` (referrals.tsx:524) + A9-m1 (99-cap toast) + A9-m2 (`dir="auto"` on the search heading) + the fetch-error-card ledger comment — ~10 lines total, all deletions/one-liners.
2. **B-11 cart stock snapshot** (M) — closes the last money edge that surfaces at charge time; feeds B-6's icon idiom if desired.
3. **B-10 support thread poll** (M) — 15-30s `refetchInterval` while an open ticket is selected; coordinate with R127-B6's B6-2/B6-3 shared-resync lane so the fix rides the same invalidation module.
4. **A9-F2 `/notifications` page** (M) — after backend `?page=` lands; the bell footer already tells the truth at the cap.
5. Operator: stock the catalog (OPS-2 runbook); optional WhatsApp support link decision (§7.6).

## 10. Counts

**P0: 0 · P1: 0 · P2: 0 · P3: 2 (F-1, F-2) · P4: 1 (F-3) · minor observations: 6 · ledger rows: 25 (14 closed / 1 obsolete / 2 tails / 8 open).**
