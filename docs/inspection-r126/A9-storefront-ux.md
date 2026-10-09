# R126-A9 — Storefront Exhaustive UX Audit (what R124-A1 + R125-A7 missed)

- **Repo:** `/home/z/my-project/repos/SubNation2` @ `186b131` (main)
- **Mandate:** exhaustive customer-surface audit of every storefront page/flow, explicitly skipping (a) R124 findings and known-open deferred items, (b) A11's CSP/inline-preload P1, (c) A13's accessibility journeys.
- **Method:** targeted reads of all 22 page components + 6 layout components + `lib/cart.tsx`/`lib/utils.ts`/`lib/user-session.ts` + the PWA config (`vite.config.ts` workbox block, `main.tsx`), cross-checked against backend projection/notification routes where the truth lives; live guest-level verification of https://subnation.ly (GETs + headless-browser navigation at 390px, nothing mutating). No source modifications, no test runs (no finding was test-contested; all are file:line + DOM verified).
- **Prior coverage read first:** `docs/inspection-r124/A1-storefront-ux.md` (13 findings), `CHANGELOG.md` R124 §Storefront, `docs/inspection-r125/A7-storefront-followup.md` (B-1..B-13 + held-open ledger). Everything below is **new** — deferred-but-known items are referenced only as context, never re-reported.

---

## Verdict up front

The storefront remains unusually mature — 25+ rounds of UX passes show. R124/R125 took the heuristic surface; this pass went after **journey seams**: notification→destination continuation, state-vs-URL asymmetry, branch ordering on the money CTA, and cross-page rendering of the same data. Result: **0 P0 · 0 P1 · 0 P2 · 6 P3 + 2 live ops re-flags**. The strongest new-positive evidence: the PWA offline story **verified live** (offline reload at 390px serves the full 45-card home from SW cache; offline deep-nav to a visited product page works), and the SPA-shell SEO rewriter verified correct across 10 live paths.

---

## 1. Live verification (guest-level, 2026-10-09 ~09:20–09:40 UTC)

| Check | Result |
|---|---|
| `GET /` at 390px | 200, no horizontal overflow (`scrollWidth == 390`), correct title |
| `/category/streaming` at 390px | no overflow; visible breadcrumb الرئيسية › البث المباشر; 17 product links |
| `/product/netflix-premium` (sold out) at 390px | no overflow; hero chip «نفد المخزون»; sticky CTA «سجّل دخولك للشراء» → see F-5 |
| `/product/lifetime-cloud-storage` (the 1 available) | guest add-to-cart present in DOM but **not visible below 640px** → F-4 |
| **PWA offline reload** (home, 390px) | **full page renders offline** — 45 product cards from SW cache, title intact, no white screen |
| Offline deep-nav → `/product/netflix-premium` | works (route chunk + product cached from the online visit) |
| Offline `/wallet` (guest) | clean redirect to `/login` |
| SPA shell rewriter (10 paths) | per-product/category/flash-sales/support/terms unique titles + `index,follow`; `/orders` `/wallet` `/cart` `/checkout` `/login` `/register` `/profile` `/loyalty` `/referrals` `/status` + unknown path all `noindex,follow` — robots.txt map matches exactly |
| Guest drawer (mobile) | 7 categories + العروض + الدعم + دخول + حساب — all live links, body scroll-locked |
| Flash-sale banner | **«تجربة — خصم 20%» still live** (see OPS-1) |
| Catalog | 45 active products, **1 available** (see OPS-2) |

---

## 2. Findings (all new; file:line at HEAD `186b131`)

### A9-F1. [P3] A support-reply notification lands on the ticket LIST, not the ticket — no `?ticket=` continuation
**Evidence:** the backend writes the reply notification with a bare destination — `backend/src/routes/admin/tickets.ts:244-249` (`createNotification(userId, "support", "رد جديد على تذكرتك", …, "/support")`); the bell's fallback for the type is the same (`frontend/src/components/layout/NotificationBell.tsx:81-84`, `actionHref: "/support"`, consumed at `:555` as `n.link ?? cfg.actionHref`); `frontend/src/pages/support.tsx:339` reads only `?ref=` from the URL — there is no ticket-param handling anywhere in the file (`openTicket(id)` at `:207-242` is pure client state).
**Why it matters:** every admin reply fires one of these. The user taps «التذكرة» in the bell (or the row) and must then FIND the right ticket in the list — extra taps + visual search on the store's primary support surface for a WhatsApp-first market. Contrast the in-house idiom two lines away in the same backend file family: order-status notifications deep-link to `/orders/:orderCode` (`backend/src/routes/admin/orders.ts`, `notifyOrderStatusChanged`) and topup notifications link `/wallet`. The deep-link pattern exists everywhere except the highest-frequency one.
**Fix (S):** backend sends `/support?ticket=${id}`; `support.tsx` reads `?ticket=` on mount (same pattern as its existing `?ref=` effect at `:342-345`) and calls `openTicket(Number(id))` once the tickets list resolves (no-op if absent/foreign). No API shape change.
**Effort:** S.

### A9-F2. [P3] Notification history is hard-capped at 40 with no full-page surface — and the dropdown footer count reads as the total
**Evidence:** `backend/src/routes/notifications.ts:17-25` — `GET /api/notifications` is `.limit(40)`, no pagination params; the bell fetches it verbatim (`NotificationBell.tsx:155-173`, no params, no load-more) and renders every row it gets; the panel footer presents `formatCount(notifs.length, …)` (`NotificationBell.tsx:650-662`) — e.g. «40 إشعاراً» — which reads as the user's lifetime total but is the cap; there is **no `/notifications` route** (`App.tsx:838-857`) and no «عرض الكل» affordance. The dropdown (mobile: full-width, dvh-capped with internal scroll, `:435-471`) is the only surface.
**Why it matters:** an active customer crosses 40 rows quickly (every order status change, topup decision, referral credit, and admin reply creates one). Older notification rows become unreachable — the underlying entities (orders/topups/tickets) all have pages, but the notification's own message content (e.g. the first 100 chars of an admin reply, `admin/tickets.ts:248`) is lost to the user. The count label overstates certainty at exactly the boundary.
**Fix (M):** either (a) minimal honesty: footer copy «آخر 40 إشعار» when `notifs.length === 40`; or (b) a slim `/notifications` route reusing the panel's row component over the same endpoint with `?page=` (the orders-page infinite-query idiom), linked from the footer «عرض كل الإشعارات» + from profile quick-links.
**Effort:** S (a) / M (b).

### A9-F3. [P3] Filter/tab state is still URL-invisible on two authed pages — asymmetric with the app's own (home + admin + terms) idiom
**Evidence:** orders bucket chips are local state only — `frontend/src/pages/orders.tsx:173` `useState<OrderFilter>("all")`, no `searchParams` read/write anywhere in the file; the wallet topup method tab (تحويل موبايل / lypay) likewise — `frontend/src/pages/wallet.tsx:743` `useState<Method>("mobile_transfer")`. The in-house idiom these miss: home mirrors all four catalog filters into the querystring (`home.tsx:287-307`, R98-04, pinned by `home-filters-url.test.tsx`), admin orders/users/tickets/settings/topups all mirror (`replaceState`, no history spam), and terms mirrors its tab hash (`terms.tsx:209-211`).
**Why it matters:** refresh, share, or back-navigation onto `/orders?…`/`/wallet?…` loses where the user was: a user filtered to «قيد الانتظار» who pulls-to-refresh (a habitual PWA gesture on the installed Android build) lands back on «الكل»; a lypay user who reloads mid-form is reset to the mobile-transfer tab (the amount/reference fields survive only until reload anyway, but the method choice silently resets). Deep-linking «your pending orders» into a WhatsApp support conversation is impossible.
**Fix (S):** mirror both via the home idiom — `?filter=pending|completed|refunded` on orders, `?method=lypay` on wallet — read-on-mount (whitelist), `history.replaceState` on change.
**Effort:** S.

### A9-F4. [P3] The guest add-to-cart on the product page is a desktop-only control (≥640px) — the mobile majority still hits R124-A1 F4's original asymmetry
**Evidence:** the R124-A1 F4 fix (guest add-to-cart on the PDP, «أضف للسلة — سجّل الدخول عند إتمام الطلب») lives exclusively inside the desktop CTA block — `frontend/src/pages/product.tsx:1456` wraps it in `hidden sm:block`, and the render gate is `!compact && onAddToCart && product.is_available` (`:1765-1773`); the mobile sticky bar "never receives `onAddToCart`" by its own comment (`:1761-1764`). **Verified live at 390px:** on the one available product the button exists in the DOM but inside the `display:none` container; the only visible guest CTA is the sticky bar's «سجّل دخولك للشراء». R125-A7's held-open ledger records this fix as "HELD" without the breakpoint caveat.
**Why it matters:** Libya is mobile-majority; the original F4 complaint (a guest who quick-adds from the grid, then opens the PDP to pick a **variant**, loses the affordance) is still true on phones — precisely the device the funnel optimizes for elsewhere (44px floors, sticky bars, keyboard handling). The guest must sign in mid-browse to keep a variant selection.
**Fix (S):** pass `onAddToCart` to the sticky bar's guest branch and render a compact secondary — either a full-width second row under «سجّل دخولك للشراء» or an outline icon-button beside it (`PlusCircle`), gated on `product.is_available` exactly like the desktop twin.
**Effort:** S.

### A9-F5. [P3] Guest on a sold-out product page is sold the login («تسجيل الدخول للشراء») — branch order puts `!token` ahead of `!is_available`
**Evidence:** `frontend/src/pages/product.tsx:1737-1756` — the CtaBlock's first branch is `if (!token)` and renders the login CTA (both compact/sticky and desktop forms) with no availability check; the sold-out branch (`:1779+`, «نفد المخزون» + «بدائل») only runs for authed users. Meanwhile the product info area renders the honest «نفد المخزون» chip to everyone (`:1342-1366`). **Verified live:** `/product/netflix-premium` (stock 0) at 390px shows the chip *and* a sticky CTA promising purchase after login.
**Why it matters:** mixed signals on the money page's primary action: the page simultaneously says "out of stock" and "log in to buy". Under the current live catalog (44/45 sold out — see OPS-2) nearly every guest PDP landing from Google hits this: the user signs in, then watches the CTA flip to «نفد المخزون». R124-A1's own fix note documents the state ("sold-out products keep the login-only state via the is_available gate") — deliberate, but the contradiction was never assessed.
**Fix (S):** reorder the branches — `!product.is_available` before `!token` (the sold-out card already carries the «بدائل» recovery link, which is the better answer for guests too), or at minimum relabel the guest CTA on sold-out products to «سجّل دخولك لعرض البدائل».
**Effort:** S.

### A9-F6. [P3] Checkout's no-image fallback still ships the 1.65:1 `text-primary/50` glyph — the exact class R125-A7 B-6 measured and fixed in its two twins
**Evidence:** `frontend/src/pages/checkout.tsx:1409` — `<span className="text-xs font-bold text-primary/50 select-none">` for the product-initial fallback in the order summary. R125-A7 B-6 measured this class at **1.65:1 (dark) / 2.35:1 (light)** on the muted tile and fixed `cart.tsx:255` + `orders.tsx:511` to `text-muted-foreground` (7.44:1 / 6.09:1) — the checkout summary's twin was missed. The same data point (a cart line with no image) now renders **two different ways on the three money pages**.
**Why it matters:** cross-page coherence on the checkout screen (the mandate's same-data-different-rendering axis) + a known-bad contrast class surviving a sweep that claimed the family.
**Fix (S):** one class change to `text-muted-foreground` (match the fixed twins). Optionally pin with the cart-undo-clear test's sibling assertion.
**Effort:** S.

---

## 3. Live ops re-flags (data, not code — but user-visible today)

### OPS-1. The «تجربة» test flash sale is STILL live — R124 ops #1, one round later
`GET /api/flash-sale` at 09:34Z → `{"title":"تجربة","discount_percent":20,"ends_at":"2026-10-09T09:51:00Z"}`. Every visitor sees «عرض محدود — تجربة — خصم 20%» above the navbar and a struck-through price on every product (e.g. Netflix 79.80 → 63.84 د.ل). R124-A1 §ops flagged it for deletion; one full round later it is still running (it ends 09:51Z today — after which grids may show stale sale badges up to ~60s edge + 3min staleTime; checkout's live re-quote protects the money either way). If it expires before an operator reads this, the action is moot — but promotions named «تجربة» should never ship to production; consider a content gate in the admin promotions form (warn on title ∈ {تجربة, test, …}).

### OPS-2. Catalog still effectively browse-only
45 active products, **1** `is_available` (2.2%, was ~2% at R124). Loading stock is the operator runbook (`docs/operations/FINAL_INVENTORY_LOADING.md`). Noted here only because it amplifies A9-F5 (the sold-out guest CTA is currently the *dominant* PDP experience).

---

## 4. Verified good (new evidence this round — not re-listing R124's clusters)

- **PWA offline + update flow (live-proven):** offline reload at 390px serves the full home (45 cards, correct title) from the SW stack — precached shell + `assets-js` CacheFirst + 7-day SWR catalog (`vite.config.ts:637-741`, the R96/R98/R124 cache ladder); offline deep-navigation to a previously-visited product page works; `/wallet` guest-offline degrades to the login redirect, not a dead screen. Update honesty: `controllerchange` → one Arabic toast with a reload action, first-install suppressed (`main.tsx:99-124`).
- **Notification plumbing quality:** race-hardened polling (sequence guard + visibility gating + socket push, `NotificationBell.tsx:134-293`), optimistic mark-read with exact rollback (`:227-247`), per-type deep links for order/topup/loyalty, focus-managed portal dialog with real row buttons. (The gaps are F-1/F-2, not the machinery.)
- **Return-path + mid-flow session loss:** first non-auth 401 → one deduped toast, full TanStack cache wipe (no next-user money leak), socket teardown, `/login?redirect=<current>` soft-nav preserving cart/checkout localStorage state (`lib/user-session.ts` header comment + implementation). Cart survives logout (local storage, v1→v2 migration + cross-tab storage-event resync with load-time guards, `lib/cart.tsx:174-211`).
- **Deep-linkability inventory (what DOES capture state):** home filters ↔ `?search/?category/?sort/?available_only` (whitelisted read + replaceState mirror); terms tab ↔ hash; product numeric-id → canonical-slug replaceState; buy-intent `?intent=buy&product=` threading through login with `?redirect=`; product → wallet `?return=` round-trip with sessionStorage indirection across polls (`wallet.tsx:766-792`); orders/wallet/loyalty/referrals/profile/checkout guest guards all preserve the full path+query in the login redirect.
- **Checkout money-UX edge audit:** per-line coupon pre-flight with per-unit post-coupon finals rendered per line (`checkout.tsx:1382-1450`); `insufficient` is loading- and error-guarded (`:706`) so it can never flash a false «رصيد غير كافٍ» during the wallet probe; `canSubmit` blocks on insufficiency + in-flight re-quote (`:767-776`); balance-probe failure fails OPEN with an honest banner (`:1185-1195`); the 99-quantity cap is enforced at load/add/update (`lib/cart.tsx:137,215,264`).
- **Money formatting coherence:** one `formatCurrency` (en-US grouping + «د.ل», `utils.ts:17-25`) across every surface checked; signed ledger amounts isolated `dir="ltr"` so the sign leads (`wallet.tsx:339-354,406-411`); Arabic-Indic input digits normalized; dates/rel-times pinned `-u-nu-latn`.
- **Search (home-embedded, deliberately no /search route):** debounce-committed filter + Enter-only history (no fragment pollution, `home.tsx:218-241`), distinct empty-vs-filtered-empty-vs-outage states, sold-out-first default ordering preserved under no-sort, brand chips stock-ranked and honest under any membership-changing filter (`:384-402`).
- **Mobile spot-audit (390px, live):** zero horizontal overflow on home/category/product; guest drawer complete + scroll-locked; sticky buy bar pins above the bottom nav; NotificationPanel dvh-capped with internal scroll.

## 5. Minor observations (below finding threshold)

- `cart.tsx:318-347` + `lib/cart.tsx:72` — the 99-unit cap applies silently: a user tapping + at 99 gets no feedback. One-time toast «الحد الأقصى 99 وحدة لكل منتج» would close it. (Cousin of the deferred stock-cap issue R124 F9.)
- `orders.tsx:569-575` — the discount strikethrough reconstructs `amount + coupon_discount` (the post-flash pre-coupon price). Coherent with the checkout summary the buyer consented to; only diverges from the PDP's list-price strikethrough under a stacked flash+coupon, which cannot co-occur with the 50% combined cap in practice.
- `support.tsx:770` — the guest login CTA links `/login?redirect=/support`, dropping a `?ref=` order-code context if present. Practically unreachable today (ref links are emitted from authed surfaces only), so noted, not filed.
- `home.tsx:1156` — the «نتائج البحث: X» heading interpolates raw user input without `dir="auto"`; correct for the common Arabic/Latin cases, can mis-order trailing punctuation in mixed-direction queries.
- `profile.tsx:370-400` — quick-links omit الدعم (the Footer link covers it; consistency nicety only).

## 6. Counts + lanes

**P0: 0 · P1: 0 · P2: 0 · P3: 6 · ops re-flags: 2** (all fixes S except F-2's full-page option).

| # | Sev | One-liner | Effort |
|---|---|---|---|
| A9-F1 | P3 | support notification → `/support` not `/support?ticket=` (backend `admin/tickets.ts:249` + no param reader in `support.tsx`) | S |
| A9-F2 | P3 | notifications capped at 40, dropdown-only, footer count reads as total (`notifications.ts:25`, `NotificationBell.tsx:650`) | S/M |
| A9-F3 | P3 | orders filter chips + wallet method tab not URL-mirrored (`orders.tsx:173`, `wallet.tsx:743`) | S |
| A9-F4 | P3 | guest PDP add-to-cart invisible <640px — sticky bar never gets it (`product.tsx:1456,1761-1773`) | S |
| A9-F5 | P3 | guest on sold-out PDP sold the login CTA — `!token` branch precedes `!is_available` (`product.tsx:1737` vs `:1779`) | S |
| A9-F6 | P3 | checkout no-image fallback still `text-primary/50` 1.65:1 (`checkout.tsx:1409`) — R125 B-6 twin missed | S |

**Suggested fix lanes (all one lane, ~half-day):** F-5 + F-4 together (same component, same branch region — reorder + pass `onAddToCart` to the sticky guest bar) → F-6 (one class) → F-1 (backend link + 6-line reader) → F-3 (two mirror effects, copy home's) → F-2 (footer honesty now; full page as follow-up). OPS-1/OPS-2 are operator actions, zero code.

## 7. Verdict

**SHIP-WORTHY.** No P0/P1/P2 in storefront code at HEAD. The six P3s are seam-level (continuation, coherence, branch order) and all S-effort; none blocks the browse→cart→checkout→history, topup→wallet, referral, or ticket journeys, all of which were walked end-to-end in source and spot-verified live as a guest. The two live ops items (test flash sale still running; 97.8% sold-out catalog) affect the shopper's *content* experience more than every code finding combined and need operator action, not code.
