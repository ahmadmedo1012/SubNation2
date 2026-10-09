# R124-A1 — Storefront UX Critique (customer-facing surface)

- **Repo:** `/home/z/my-project/repos/SubNation2` @ `c736d13` (main)
- **Scope:** All 16 storefront pages (`frontend/src/pages/{home,product,category,cart,checkout,flash-sales,login,register,wallet,orders,order-detail,profile,support,loyalty,referrals,onboarding}.tsx`), `App.tsx` router, `components/layout/*` (Navbar, MobileNav, Footer, FlashSaleBanner, NotificationBell, Logo), `ProductCard.tsx`, `TopupWaitingModal.tsx`, plus `lib/cart.tsx` / `lib/utils.ts` where the pages' behavior is defined. ~16.8k lines read in full.
- **Method:** Impeccable-critique heuristic review (Nielsen 10 heuristics, cognitive-load checklist, persona walk-throughs), every claim verified against source before writing; live read-only GET probes of `https://subnation.ly` used only to correlate context (catalog state, flash-sale state).
- **Verdict up front:** This is an unusually mature storefront — 20+ rounds of prior UX passes are visible in the code (skeleton-per-shape, error≠empty discipline, idempotency-key UX, return-path threading, RTL icon conventions, iOS keyboard handling). No P0/P1 found. 1×P2 + 12×P3 remain, concentrated in the wallet topup form's sequencing, cross-surface terminology drift, and guest-capability asymmetry.

---

## ⚠️ Operational observations first (live data, not code — inventory/promotions out of audit scope)

These are user-visible **today** on production and matter more than any finding below, but they are content/state, not storefront code:

1. **A test flash sale is live on production.** `GET /api/flash-sale` → `{"flash_sale":{"id":1,"title":"تجربة","discount_percent":20,"ends_at":"2026-10-09T09:51:00Z"}}`. Every storefront page renders the site-wide banner (`FlashSaleBanner.tsx:181-197`) with the literal word **«تجربة»** («experiment/test») + «خصم 20%». A shopper sees `عرض محدود — تجربة — خصم 20%` above the navbar. **Action:** delete/rename the promotion row (admin → promotions). No code change.
2. **Catalog is still effectively browse-only:** live `/api/products` returns 45 active products, **1** `is_available` (improved from R117's 0, still ~2%). The home grid's sold-out-first reordering (`home.tsx:391-399`) and the «متوفر فقط» funnel are doing their job with what exists. Loading stock is the operator runbook (`docs/operations/FINAL_INVENTORY_LOADING.md`), out of scope here.

---

## Design Health Score (Nielsen heuristics)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 4 | Per-route skeletons (`App.tsx:117-152`), per-unit submit progress `جارٍ المعالجة… 2/3` (`checkout.tsx:1487-1496`), topup countdown + live-region announcements (`TopupWaitingModal.tsx:180-260`), socket-backed flips. |
| 2 | Match system / real world | 3 | Full Arabic pluralization via `formatCount` everywhere; but one pending state = two words on one screen (F3), topup submit verbs drift (F11), delivery-window copy drift (F10). |
| 3 | User control & freedom | 3 | Undo on cart line removal (`cart.tsx:81-95`), confirm on destructive actions, redirect-preserving guards everywhere; no in-page cancel during a long multi-unit submit (F8, deliberate). |
| 4 | Consistency & standards | 3 | Strong in-house conventions (RTL icon decision, CTA recipe, error-card idiom); leftovers: breadcrumb separator contradicts own forward=left rule (F6), guest add-to-cart asymmetry (F4). |
| 5 | Error prevention | 4 | Pre-buy live re-quote (`product.tsx:480-511`), per-line coupon pre-flight (`checkout.tsx:310-412`), stable idempotency keys w/ TTL+fingerprint, double-tap locks, USSD integer snap (`wallet.tsx:1055-1080`). |
| 6 | Recognition rather than recall | 3 | Search history, saved sender phones, labeled icons; but the topup receipt field appears before the transfer that produces it (F1) — forced scroll-back/memory on the money-in path. |
| 7 | Flexibility & efficiency | 3 | Presets, quick-add, saved phones, deep links, Enter-commits; no keyboard shortcuts (fine for this audience). |
| 8 | Aesthetic & minimalist design | 3 | Disciplined density; the 5-step wallet form is long and its step states never change (F2). |
| 9 | Error recovery | 4 | Distinct retry cards on every page, outage≠empty everywhere, partial-failure accounting with «راجع طلباتك المنشأة», honest decrypt-failure cards with support links. |
| 10 | Help & documentation | 3 | Public per-category FAQs + support FAQ (JSON-LD-backed), contextual hints inline; no in-flow help on the topup form itself. |
| **Total** | | **33/40** | **Good** (28–35 band) — address weak areas; foundation solid |

### Cognitive-load checklist (8 items)
Failures: **2** (moderate — address soon)
- ❌ **One thing at a time**: wallet form step 2 asks for a required receipt number whose data only exists after step 3's transfer (F1).
- ❌ **Working memory**: the user must hold the receipt number (or remember to scroll back up) across the transfer → phone steps before submit (F1).
All others pass (single focus per page, ≤4 primary actions, grouping, hierarchy, progressive disclosure, minimal choices, no cross-screen memory elsewhere).

### Persona red flags (e-commerce set: Casey / Riley / Jordan)

**Casey (distracted mobile user):** Well served overall — 44px floors everywhere, sticky buy bar that hides under the keyboard (`product.tsx:1425-1466` + `use-keyboard-visibility`), thumb-zone CTAs, `enterKeyHint`, 16px inputs. Red flags: the single-page 5-step topup form is a long scroll; the receipt field before the transfer code panel (F1) forces a scroll dance exactly when a thumbs-only user is juggling a dialer app + WhatsApp receipt; the required `رمز التحويل` label sits ~1,000px above the USSD button that generates the receipt.

**Riley (stress tester):** Best-in-class handling — idempotent retries across tab death (`checkout.tsx:96-107` docblock), cross-tab live-cart guard (`checkout.tsx:855-880`), partial-failure cart sync to exact charged units, coupon void on variant change, 404-vs-outage split on product/order pages. Red flags: cart quantity can exceed stock and is only discovered mid-charge as a partial failure (F9); the open support ticket thread doesn't refresh when a reply lands while it's open (F12).

**Jordan (first-timer):** Value-prop banners, intent-aware login («سجّل دخولك لإكمال شراء «X»», `login.tsx:150-160`), 2-step skippable onboarding, public FAQs. Red flags: two different words for the same pending topup status on one screen (F3); delivery timing stated three different ways across surfaces (F10); after browsing a category, the product page's only back affordance dumps them on home, not the category they came from (F5).

### Design specificity verdict
Authored for this product, not category-interchangeable: Libyan-network USSD transfer codes with live `tel:` dial + copy fallback (`wallet.tsx:544-641`), Libyan phone validation (091–094), Arabic dual/plural counts on every noun, brand chips wired to live stock, LYD `د.ل` money formatting via one helper, RTL-native icon language. This is a localized storefront, not a translated template.

---

## Findings

### 1. [P2] Wallet topup asks for the transfer receipt BEFORE the step that produces it
**Evidence:** `frontend/src/pages/wallet.tsx:1486-1493` — the required `PaymentReferenceField` («رمز التحويل … رقم إيصال التحويل كما ورد في رسالة التحويل») renders inside **Step 2 (المبلغ)**, while **Step 3 (نفّذ التحويل / the USSD dial button)** is below it at `:1499-1505`. The instructions panel confirms the intended order: «۱. قم بتحويل الرصيد باستخدام الزر … ۲. بعد نجاح التحويل قم بإرسال الطلب» (`wallet.tsx:497-501`). The receipt number only exists after the transfer. A first-time topup customer reading top-to-bottom meets a required field they cannot fill, must skip it, complete step 3, then scroll back up hunting for it — or enter junk (which pollutes the reviewer's dedup key, the field's stated purpose at `:676-678`). This is the **only payment-in path** in the store.
**Why it matters:** The wallet topup is the money-in funnel for every customer; this is the highest-attention friction point in the storefront, on a 5-step mobile form.
**Fix (minimal):** Move the mobile-flow `PaymentReferenceField` render from step 2 down to immediately after `TransferCodePanel` (still inside the same `<form>`; the lypay flow keeps its current placement — its "transfer" happens in a bank app before the page anyway). One JSX block move, zero logic change.
**Effort:** S.

### 2. [P3] All wallet step indicators are permanently "active" — no progression semantics
**Evidence:** `frontend/src/pages/wallet.tsx:1388,1443,1499,1512,1633` (mobile flow) and `:1667,1796` (lypay) — every `<StepDot … active />` hardcodes `active={true}`; the component itself supports an inactive style (`wallet.tsx:288-317`, muted dot/label). The numbered steps therefore render as decoration; the user gets no sense of where they are in the 5-step flow.
**Fix:** Derive `active` cheaply: step 2 active when `amount` is empty-or-invalid (guide), steps 3+ active when the prior steps are satisfied (`amount` valid; phone valid for step 5). Or, simpler and fully honest: delete the `active` prop and the inactive branch, presenting the dots as a flat numbered legend.
**Effort:** S.

### 3. [P3] One pending state, two words, same screen (wallet)
**Evidence:** The form card's chip says «طلب/طلبان/طلبات قيد المراجعة» (`wallet.tsx:1317-1325`) and the block banner says «لديك طلبات قيد المراجعة…» (`:1033`), but the topup **rows** right beside/below render `statusLabel("pending")` = «قيد الانتظار» (`wallet.tsx:1937`, `lib/utils.ts:165`), and the waiting modal says «قيد المراجعة من الإدارة» (`TopupWaitingModal.tsx:246`). The R123-E4a comment at `:1308-1316` acknowledges the row badges were left on the old word. Orders/referrals use «قيد الانتظار» for *their* pending concepts (correct there — order pending is not admin review), so the shared `statusLabel` map cannot simply be changed globally.
**Fix:** In the wallet topup list (and `TopupWaitingModal`'s footer line is already fine), pass a topup-specific label: `t.status === "pending" ? "قيد المراجعة" : statusLabel(t.status)`. One ternary at `wallet.tsx:1937`.
**Effort:** S.

### 4. [P3] Guests can add to cart from grid cards but not from the product page
**Evidence:** `ProductCard.tsx:252-281` — `handleAddToCart` has no auth gate; the mobile CTA «أضف للسلة» (`:558-563`), the desktop persistent quick-add (`:587-600`) and hover panel all work for guests (cart is local). But on the product page, `CtaBlock`'s `!token` early-return (`product.tsx:1647-1699`) renders only «تسجيل الدخول للشراء» — the add-to-cart secondary (`product.tsx:1849-1858`) is unreachable for guests. A guest who quick-adds from the grid, then opens the product to pick a **variant**, loses the equivalent affordance (and variant choice) until they sign in.
**Fix:** In `CtaBlock`'s `!token` branch, also render the add-to-cart button (`onAddToCart` is already passed) under the login button, labeled «أضف للسلة — سجّل الدخول عند إتمام الطلب» (cart page already funnels guests through `/login?redirect=/checkout`, `cart.tsx:390-399`). Alternatively gate the card CTA for guests — but adding is the better funnel.
**Effort:** S.

### 5. [P3] Product page's only back affordance always goes home; no visible breadcrumb
**Evidence:** `product.tsx:1050-1055` — `<button onClick={() => navigate("/")}>العودة للكتالوج</button>`. A shopper who arrived via Home → `/category/streaming` → product (or via a category chip on the product's own recommendations) is returned to home, not the category they were browsing. The breadcrumb exists only as JSON-LD (`product.tsx:773-785`, `buildBreadcrumbLd`), invisible to users; the category badge on the hero (`:1157-1160`) is not a link. The category page itself *does* have a visible breadcrumb (`category.tsx:252-258`), so the pattern exists in-house.
**Fix:** Render the same visible breadcrumb row (الرئيسية / فئة / المنتج) above the card using `KNOWN_CATEGORIES` (already imported `product.tsx:87-90`), and/or make the back button `window.history.length > 1 && document.referrer internal ? history.back() : navigate("/")`. Breadcrumb row is the more predictable option.
**Effort:** S.

### 6. [P3] Category breadcrumb separator points backwards, contradicting the app's own RTL icon convention
**Evidence:** `category.tsx:256` — `<ChevronLeft className="w-3 h-3 rotate-180 opacity-50" />` between الرئيسية and the current category. The codebase's documented decision is **back = points right, forward = points left** (see `category.tsx:238` back-link comment «RTL: "back" points right», `referrals.tsx:236-244` same idiom, and forward affordances like `category.tsx:330` and `home.tsx:580` using unrotated `ChevronLeft`). A breadcrumb separator denotes traversal **forward** (parent → current), so in RTL it should point left; the rotate-180 makes it point right (back at the parent) — the opposite of every other chevron on the same page. (The `:238` back-link rotation is correct; only `:256` is the separator.)
**Fix:** Remove `rotate-180` from `:256` (keep the `opacity-50`).
**Effort:** S.

### 7. [P3] Topup rejection tells the user to contact support — with no link — and strands the return-to-product flow
**Evidence:** `TopupWaitingModal.tsx:389` — RejectedBody copy: «تواصل مع الدعم إذا كنت ترى أن هذا خطأ.» but the only control is «إغلاق» (`:400-407`). Contrast: the approval body gets a contextual primary («متابعة الشراء» via `onApprovedContinue`, `:311-337,366-389`) and order-detail's failure card embeds a real support Link with `?ref=` context (`order-detail.tsx:545-553`). A user who came from a product CTA (`?return=`) and gets rejected has neither a support path nor a way back to the product.
**Fix:** In `RejectedBody`, replace the bare copy with the order-detail idiom: a `<Link href="/support">تواصل مع الدعم</Link>` button (optionally passing the topup context), and reuse the neutral «البقاء في المحفظة» secondary.
**Effort:** S.

### 8. [P3] Multi-unit checkout submit: no in-page cancel, sequential POSTs (documented trade-off)
**Evidence:** `checkout.tsx:683-687` — the comment admits «There is no in-page cancel affordance today (the confirm button turns into a spinner; the nav stays interactive)». The unit loop is sequential per unit (`:924-1005`), honestly surfaced by the `جارٍ المعالجة… N/M` label (`:1487-1496`); abandoning the page mid-loop is respected (`abandonedRef`, `:670-677` — no forced redirect) and the completion toast still fires. The main residual UX cost: a 5-unit basket on 3G holds a disabled CTA for several seconds with no explicit permission to leave.
**Fix (minimal, copy only):** One muted line under the submitting CTA: «يمكنك مغادرة الصفحة — سنُكمل الطلب ونُشعرك عند الانتهاء». (A true cancel would need server-side intent cancellation — not worth it at current basket sizes.)
**Effort:** S.

### 9. [P3] Cart quantity ignores stock; over-quantity is only discovered as a mid-charge partial failure
**Evidence:** `lib/cart.tsx:262-267` — `updateQuantity` clamps to `[1, 99]` with no stock knowledge (the line schema `:11-25` carries no stock field); `ProductCard`'s add uses no stock cap either. Checkout's mount re-quote (`checkout.tsx:576-665`) drops archived/deactivated lines and fixes prices, but never caps a line's quantity to live stock — the over-quantity units fail one-by-one inside the charge loop and surface as the partial banner («تم إنشاء طلب واحد بنجاح قبل توقف العملية…», `:1013-1030`). Honest, but the user learns about the limit at the worst moment, after authorizing money.
**Fix:** Snapshot `stock_count` onto the cart line at add time (it's on the product DTO at both add sites — `ProductCard.tsx:30-46`, `product.tsx:736-750`), cap the stepper in `cart.tsx` and show «متبقٍ N فقط» on the line (ProductCard already has the low-stock vocabulary, `ProductCard.tsx:510-524`).
**Effort:** M.

### 10. [P3] Delivery-window promise drifts across three surfaces
**Evidence:** order-detail pending card: «عادةً خلال 5 إلى 15 دقيقة. ستصلك إشعار» (`order-detail.tsx:505-509`); home + onboarding trust cards: «فور تأكيد الدفع، وخلال 24 ساعة كحد أقصى» (`home.tsx:1257-1259`, `onboarding.tsx:136-139`); support FAQ: «التسليم فوري في أغلب الحالات» (`support.tsx:49-53`). Three different typical-windows for the same SLA; the 5–15 min figure appears nowhere else and the pending card's «ستصلك إشعار» presumes a notification that only exists if the order stays `pending` (a `completed` order delivers inline).
**Fix:** Standardize the two-part claim (فوري عادةً / حد أقصى 24 ساعة) in the pending card too: «طلبك قيد الإعداد — التسليم فوري عادةً، وبحد أقصى 24 ساعة. سنُشعرك عند الجاهزية.»
**Effort:** S.

### 11. [P3] Two verb families for the same topup submit action
**Evidence:** mobile tab CTA: «إرسال طلب الشحن» + step label «أرسل الطلب» (`wallet.tsx:1656`, `:1633`); lypay tab CTA: «تأكيد طلب الشحن» + step label «تأكيد الإرسال» (`:1819`, `:1796`). Same action (submit a topup request for admin review), two verb pairs — the exact drift class the R111-F2 N1 pass eliminated for checkout («إتمام الطلب»).
**Fix:** Pick one pair (إرسال طلب الشحن fits the admin-review reality on both tabs) and use it for both CTAs and step labels.
**Effort:** S.

### 12. [P3] Open support ticket doesn't refresh when a reply lands
**Evidence:** `support.tsx:207-242` — `openTicket` fetches once per open; the thread has no poll and no socket (the wallet/order pages do have page-scoped `useSocket`, `wallet.tsx:740-749`, `order-detail.tsx:156-170`). If the admin replies while the user is staring at the thread, nothing changes until they back out and reopen (NotificationBell will toast a `support` notification, but the visible conversation stays stale).
**Fix:** Minimal — a 15–30s `refetchInterval` while `selectedTicket && status !== "closed"` (the orders/topup polling idiom), or refetch the open ticket when the bell's new-notification toast is a support type.
**Effort:** M.

### 13. [P3] Account creation never surfaces the terms — the auth pages have no legal link at all
**Evidence:** `Footer.tsx:9-10` returns `null` on `/login` and `/register` (deliberate chrome-free auth), and neither auth page carries any terms/privacy link (`login.tsx`, `register.tsx` — verified in full). The only consent moment in the funnel is checkout's «بالنقر على «إتمام الطلب» فإنك توافق على الشروط والأحكام» (`checkout.tsx:1500-1511`). Registration — the moment an account (wallet, points, referral balance) is created — happens with no reference to the governing terms.
**Fix:** One muted line under the register card's provider buttons, reusing the checkout idiom: «بإنشاء حسابك فإنك توافق على <Link href="/terms">الشروط والأحكام</Link>».
**Effort:** S.

---

## What's working (verified clusters)

- **Error ≠ empty, everywhere.** Every list page distinguishes outage (WifiOff card + إعادة المحاولة) from emptiness (icon + next action) from filtered-emptiness (مسح الفلاتر): `home.tsx:1168-1210`, `category.tsx:330-358`, `flash-sales.tsx:226-252`, `orders.tsx:379-460`, `wallet.tsx` (balance card `:1230-1250`, topups `:1885-1920`, ledger `:414-446`), `loyalty.tsx:478-505`, `referrals.tsx:258-274`, `support.tsx:760-790`, `profile.tsx:246-268`. Home even splits filter-empty vs catalog-empty (`home.tsx:1177-1199`).
- **Money feedback.** Buy receipt shows charged amount + post-charge remaining balance (`product.tsx:895-930`), per-unit submit progress, partial-failure accounting naming exactly what was charged (`checkout.tsx:1013-1030`), refund receipts with amounts (`order-detail.tsx:522-556`, `orders.tsx:522-530`), wallet statement with signed directional amounts (`wallet.tsx:302-345`). LYD is always `formatCurrency` (`utils.ts:22-25`, en-US 2-decimals + «د.ل»), including the backend's `points_value_lyd` string.
- **Return-path preservation.** `?redirect=` honored and sanitized (`sanitizeInternalPath`, `utils.ts:105-115`) across login/register tabs, and threaded by wallet/orders/profile/loyalty/referrals/order-detail/checkout guards; product → wallet `?return=` → approved-topup «متابعة الشراء» round-trip (`wallet.tsx:806-830`, `TopupWaitingModal.tsx:31-43`).
- **Double-charge defense as UX.** Stable idempotency keys with TTL + intent fingerprints on buy (`product.tsx:97-228`), per-unit checkout (`checkout.tsx:96-107,918-941`), topup (`wallet.tsx:96-180`), loyalty conversion (`loyalty.tsx:60-130`) — with IDEMPOTENCY_IN_FLIGHT kept replayable.
- **Honest price integrity.** Live re-quote before the buy tap (`product.tsx:480-511`) and at checkout mount (`checkout.tsx:576-665`) with visible «تم تحديث الأسعار» notices and dropped-line explanations hoisted above the empty branch (`checkout.tsx:1316-1341`); per-line coupon math matching the server's per-unit charging (`checkout.tsx:310-412`).
- **RTL discipline.** Unified back=right/forward=left icon language, mirrored Send glyphs (`support.tsx:584,713`), `dir="ltr"` isolation for codes/credentials/amounts, `dir="auto"` for mixed-direction delivery text (`product.tsx:988-995`), `lang="en"` on Latin brand names, `tracking-[0.2em]` only on LTR mono runs.
- **Mobile realities.** 44px tap floors enforced (with the app's own negative-margin idiom), keyboard-visibility hiding for sticky bars + bottom nav, iOS 16px inputs, viewport `interactive-widget` guard (`Navbar.tsx:105-118`), 100dvh conventions, sold-out cards still navigable with honest alternates (`product.tsx:1690-1721`).
- **Recovery affordances.** Out-of-stock → «تصفّح بدائل في نفس الفئة» (`product.tsx:1715-1721`), decrypt-failure → support with context (`order-detail.tsx:496-527`), failed order → support `?ref=` prefill that auto-opens the ticket form with the order code in the title (`support.tsx:327-335`).

## Minor observations (below finding threshold)

- `profile.tsx:543-552` — logout button `h-10` (40px), under the app's own 44px floor it enforces elsewhere; it's a destructive-ish account action on a mobile-visible page.
- `ProductCard.tsx:587-600` — desktop quick-add is 32px; acceptable for pointer (≥24px WCAG 2.5.8) but the only control below the in-house floor.
- Empty-state CTAs use three phrasings for "go browse": «متابعة التسوق» (cart) / «تصفح الكتالوج» (orders, flash) / «تصفّح المزيد» (product success) — contextually fine, but a candidate for the next terminology pass.
- `home.tsx:1123-1130` — «مسح (N)» counts `sort` as an active filter; a user who only changed sort sees a "clear (1)" affordance that does something subtle. Harmless.
- `checkout.tsx:362-366` — the insufficient-balance banner link goes to `/wallet?return=/checkout`; after topup approval the user lands back on checkout with the cart intact — good; note the rejection branch (F7) breaks this loop.

## Smoke evidence (read-only, 2026-10-06)
- `GET /` → 200 (1.02s); `GET /api/products?limit=100` → 45 products, 1 available; `GET /api/flash-sale` → active test sale «تجربة» 20% (see ops note above). No login, no form submissions, no writes.

## Counts
**P0: 0 · P1: 0 · P2: 1 · P3: 12 — total 13 findings** (all fixes ≤ S except two M).
