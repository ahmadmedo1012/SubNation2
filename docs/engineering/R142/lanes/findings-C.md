# Lane C findings — R142 (storefront design & customer journeys)

Audit: 142-C1 @ a9f5e83 (read-only). Scope: the customer-facing spine —
18 non-test pages + components/home + components/layout + ProductCard +
lib/cart + lib/format(=utils) deep-read; product/* buy components deep-read;
wallet/loyalty/support component trees + all `__tests__` verified
structurally (subject-existence scan over 496 test files: **0 missing
subjects**; 5 representative suites re-run **green, 73 tests**). Live
probes on https://subnation.ly: home, category, PDP, add-to-cart, cart,
search deep-link, checkout login gate, OOS states. No code changed.

Load assumed: a shopper on a low-end Android phone, RTL Arabic, mostly
guest, occasionally two tabs open. Money authority is always the server
(client verdicts are advisory) — findings are graded against that.

---

## Must fix

None. No P0/P1/P2. The journey spine is honest at every state checked:
loading, empty, error and recovery paths exist and are distinct on every
deep-read page; no dead-end journeys, no lying spinners on the spine
(telegram-callback even carries a 12 s hang escape), no buttons without
handlers, and the money at-most-once discipline (generation guards, seq
guards, AbortControllers, optimistic-with-rollback) extends well beyond
the money pages.

## Should fix

### C-1 — P3 — PDP coupon validation rides a raw `fetch` with no timeout and an unguarded `r.json()`

- **Where:** `frontend/src/pages/product.tsx:439-471` (`validateCoupon`),
  same class at `frontend/src/pages/support.tsx:202-208` (`handleCreate`)
  and `:235-241` (`handleReply`).
- **What this is:** the coupon "تحقق" POST on the product page is the one
  money-adjacent request on the spine that does not go through
  customFetch (the repo client's 20 s abort + ApiError normalization).
- **Concrete case 1 (spinner that never resolves):** the connection stalls
  mid-POST (Libyan mobile networks do this) — `couponValidating` stays
  true until the OS-level TCP timeout (minutes); the «تحقق» button shows
  a Loader2 spinner and the input stays disabled the whole time. Every
  other fetch on this page rides the orval client with a 20 s abort.
- **Concrete case 2 (English error in an Arabic toast):** a proxy/CDN 502
  returns an HTML error page — `await r.json()` throws a `SyntaxError`
  before the `!r.ok` check, the catch shows `err.message`
  ("Unexpected token '<'...") inside the destructive Arabic toast
  («تعذّر تطبيق الكوبون»). support.tsx's create/reply twins have the
  identical gap (`d.error` on a failed parse → English TypeError text).
- **Minimal fix:** swap to `customFetch` (or pass
  `AbortSignal.timeout(20_000)`), and use the repo's own hardening idiom
  already shipped in NotificationBell/notifications/orders:
  `const data = await r.json().catch(() => null); if (!r.ok ||
  !data?.error) throw new Error("تعذّر التحقق من الكوبون — حاول مرة
  أخرى")`. Three call sites, ~6 lines total.
- **Evidence:** grep of the tier-1/2 surface: only NotificationBell,
  orders.tsx, notifications.tsx use the `.json().catch(() => null)`
  guard; product.tsx:444 and support.tsx:207/240 do not. No test mocks a
  hanging or non-JSON `/api/coupons/validate` response.
- **If we skip it:** a stalled network leaves a money-path button
  spinning for minutes and outages surface as English stack text in an
  Arabic-only UI.

## Nice to have (lean / truthfulness)

### C-2 — P4 — the low-stock threshold exists twice; the "single definition" comment is stale

- **Where:** `frontend/src/lib/cart.tsx:119-122`
  (`LOW_STOCK_THRESHOLD = 3`, commented "the storefront's single
  definition of «متبقٍ N فقط»") vs `frontend/src/components/ProductCard.tsx:224`
  (`product.stock_count <= 3` inline).
- **Concrete case:** an operator raises the whisper threshold to 5 in
  cart.tsx — cart lines start whispering at 5 while the grid badge and
  the PDP-adjacent quick-add ceiling toast still whisper at 3. The two
  surfaces the comment explicitly promises will "agree" silently
  disagree, exactly the drift class R122 fixed for plural forms.
- **Fix:** ProductCard already imports `useCartCommands` from
  `@/lib/cart` — import `LOW_STOCK_THRESHOLD` and use it at line 224.
  One line, deletes a duplicate constant.

### C-3 — P4 — ProductCard's memo comparator forgot `variant_count` (the list projection's only count source)

- **Where:** `frontend/src/components/ProductCard.tsx:803-830` (the
  `memo` comparator) vs `:267-269` (`variantCount = product.variants?.
  length ?? product.variant_count ?? 0`).
- **Concrete case:** home and category ride the `?fields=list`
  projection where `variants` is absent (so `prev.product.variants ===
  next.product.variants` is `undefined === undefined` — always true) and
  `variant_count` is the badge's only data. A background refetch
  (staleTime 3 min) whose only change is `variant_count` 4→5 (admin adds
  a pricier variant; price/`price_from`/other compared fields unchanged)
  re-renders nothing — the card keeps showing «4 باقات» until remount.
  Same defect class the R124 A2-F8 fix closed for `variants`.
- **Fix:** add
  `prev.product.variant_count === next.product.variant_count &&` to the
  comparator. One line.

### C-4 — P4 — cross-tab concurrent cart writes are last-write-wins (provider-level residual of G-5)

- **Where:** `frontend/src/lib/cart.tsx:401-409` (storage re-sync) +
  `:446-482` (addItem writes from this tab's React state).
- **Concrete case:** two tabs both hold line qty 1; each tab's user taps
  «+» within the same second — each `setItems` writes the full cart from
  its own `prev`, the second localStorage write wins, both tabs converge
  on 2. One increment is silently lost (the user finds out at the cart).
  The storage listener prevents divergence-at-rest (its documented
  scope), but nothing arbitrates concurrent writes.
- **Money impact:** none — checkout re-reads the live cart and the
  server re-checks stock/charge; G-5 already flagged the checkout-side
  instance of this class. This record verifies the provider-level truth:
  **confirmed still present**, inherent to the localStorage model.
- **Fix (cheapest honest option):** a `shortcut:` comment on the storage
  listener naming the limit (concurrent writes lose one update; upgrade
  to per-line merge or a BroadcastChannel arbiter if it ever matters).
  No behavioral change warranted for the expected load.

### C-5 — P4 — the cart page recomputes its money total with a second rounding idiom

- **Where:** `frontend/src/pages/cart.tsx:86-88`
  (`+items.reduce(...).toFixed(2)`) vs the context's exported
  `totalLYD` (`lib/cart.tsx:590`, `roundToCents`).
- **Concrete case:** the same items get two "the total"s: the page's
  `toFixed(2)` and the context's `Math.round(x*100)/100` — on an x.xx5
  float boundary (fractional flash-sale prices like 2.675) the two
  roundings can disagree by 0.01, and any future consumer of
  `useCart().totalLYD` (Navbar, a future header chip) contradicts the
  number the shopper just approved on the cart page.
- **Fix:** `const { totalLYD: total } = useCart()` — deletes the
  duplicate money math instead of adding a third rounding. One line.

---

## Customer-journey map (state-quality verdicts)

Live-verified legs marked **[L]**; others verified in code at a9f5e83.

| Journey leg | Loading | Empty | Error | Recovery | Verdict |
|---|---|---|---|---|---|
| Home (guest) **[L]** | 8-card skeleton; keepPreviousData on filter change | filter-aware empty + category escape routes | FetchErrorCard + retry (≠ empty) | «مسح (n)», chips, hero CTAs | **Honest** |
| Home (authed) | height-reserved hero skeleton; stats chips skeleton; /me error → guest hero (no infinite skeleton) | orders strip tri-state | strip error row + retry | — | **Honest** |
| Search | debounced commit (320 ms), trimmed, history dropdown with listbox a11y | «لا توجد منتجات تطابق بحثك» + category links **[L]** (`/?search=cpanel` → «نتائج البحث: cpanel», 1 منتج) | shared FetchErrorCard | Enter/Escape/blur-guard | **Honest** |
| Category **[L]** | 8 skeletons; sibling-nav keeps previous grid | icon-less empty + «تصفّح كل المنتجات» | FetchErrorCard + retry | sibling chips, breadcrumb, escape chip | **Honest** |
| Product (PDP) **[L]** | RouteSkeleton shape-matched (CLS) | 404 card (noindex) | outage card ≠ 404 card; 404 re-quote fail-closed | retry / home / بدائل link | **Honest** (variant-OOS edge = J-7, cross-ref) |
| Variant select **[L]** | — | disabled + «نفد» pills | selection-void on product change | cheapest-available fallback | **Honest**; fallback logic untested (see census) |
| Add-to-cart **[L]** | 500 ms double-tap lock; honest refused-raise toast | — | localStorage try/catch (degrades) | toast + badge + sr-only announcer «أُضيف إلى السلة — 1 منتج» **[L]** | **Honest** |
| Cart **[L]** | isLoaded skeleton | EmptyHero + «متابعة التسوق» | wallet chip omits on failure (never fabricates 0.00) | undo (6 s), stepper ceiling disabled+aria «الحد الأقصى المتاح 1» **[L]** | **Honest** (C-5 total dup) |
| Checkout gate (guest) **[L]** | — | — | — | «سجّل دخولك للشراء» → `/login?redirect=/checkout` **[L]**; login honors sanitized redirect; register tab threads it | **Honest** |
| Order tracking | per-block skeletons | 404 ≠ outage split; decrypt-failed card; «قيد الإعداد» with unified SLA copy | error card with two recoveries | back to /orders, support links with ?ref= | **Honest** |
| Orders list | SkeletonCard ×4 | EmptyHero + bucket-aware empties (load-more hint when hasNextPage) | FetchErrorCard | filter chips, load-more | **Honest** |
| Notifications page | SkeletonText | EmptyHero | FetchErrorCard | mark-read optimistic + exact rollback | **Honest** |
| Support | 3-row skeleton; reply skeleton | EmptyState + public FAQ for guests | list error card ≠ «no tickets»; openTicket shape-guarded toast | create form, ?ref prefill, ?ticket deep-link (consumed-once, holds on failed load) | **Honest** (C-1 JSON-parse edge) |
| Account (profile) | identity-card skeleton | — | /me error card; providers error row + retry (≠ «link your account» false advice) | unlink confirm (destructive), logout | **Honest** |
| Referrals | skeleton rows + code skeleton | «لا توجد إحالات بعد» | FetchErrorCard (error ≠ empty, both queries) | copy/share with failure feedback | **Honest** |
| Flash sales | shape-matched skeletons | EmptyHero «لا عرض نشط» | FetchErrorCard | «انتهى هذا العرض» honest expiry replaces fake urgency | **Honest** |
| Login/Register **[L]** | optimistic boot (R127-L10), splash threshold | — | AuthErrorBanner reason codes; probe 10 s abort | redirect honored + threaded; telegram-callback 12 s hang escape | **Honest** |
| Notifications bell | skeleton chip fallback | «لا توجد إشعارات» | silent poll retry; mark-read rollback | seq-guarded refetch, socket event + 60 s fallback | **Honest** |

**Cross-file plumbing verified:** ProductCard quick-add targets the
cheapest *available* variant and captures `stock_count` — the same
number the badge renders, so cart-line verdicts agree with the grid
(R129-A1 wiring holds). Cart persistence = localStorage v2 + v1
migration + storage-event re-sync with the same parse guards (C-4
residual above). The orders-page raw queryKey `["/api/orders",
"load-more"]` prefix-matches the orval `getListOrdersQueryKey()` =
`["/api/orders"]` — the product-page post-purchase invalidation really
does refresh the list (comment truthful). The bell's paramless
`/api/notifications` array shape is preserved deliberately by the
backend's `queryString` gate (routes/notifications.ts:66-84) — the N-5
dual-shape concern does not blank the bell. `formatCurrency`
(en-US grouping, LYD suffix) is used on every money display read this
round; dates ride the latn-pinned ar-LY spine.

**Stale-async hunt:** coupon generation guard (product.tsx:92,243-247,
432,449), notification fetch seq guard, support silent-refresh
functional-set drop, profile AbortController+cancelled — the money-lane
at-most-once pattern is present on non-money surfaces too. The one gap
is C-1's un-timed coupon fetch.

## Missing tests — the 5 riskiest journey branches with no failing test

1. **PDP selected-variant fallback** (`product.tsx:214-223`): when the
   explicitly-selected variant disappears/flips OOS on refetch, the
   `?? find(is_available) ?? sortedVariants[0]` chain decides which
   price the whole page (price block, CTA, coupon math, buy-intent
   fingerprint) keys off. No test pins it (grep of
   product-r117-contracts + product-variants-decomposition: zero hits
   on `selectedVariant`). A silent regression to "first variant always"
   re-prices the PDP with nothing red.
2. **Coupon validate hang / non-JSON body** (C-1): no test mocks a
   never-settling or HTML-500 `/api/coupons/validate`.
3. **Cross-tab concurrent cart writes** (C-4): cart-sync-hardening pins
   single-writer storage events only; no test drives two near-
   simultaneous mutations.
4. **Cart undo vs. refreshed stock snapshot**: `removeWithUndo`'s
   «تراجع» re-adds `{...item}` with the *captured* quantity and stock
   snapshot; after an external stock drop the line lands in
   «insufficient» silently. cart-undo-clear covers plain undo only.
5. **Login success → checkout redirect thread**: the rendered gate href
   is pinned (`cart-undo-clear:242`), and the register tab's forwarding
   is pinned — but no vitest drives `handleLoginSuccess` and asserts
   navigation to the sanitized `/checkout` target (the primary guest
   conversion thread; only the weekly Playwright leg exercises it live).

## Not checked (exact list — another wave)

Deep-read was spent on the journey spine. BLOCKED (17 files, enumerated
in C.coverage.jsonl): `pages/onboarding.tsx`, `pages/terms.tsx`,
`lib/{admin-session,analytics,api-config,auth-token-holder,boot-sentry,
chart-theme,csv,firebase-auth,firebase,inventory-parser,sentry-replay,
socket-resync,transfer-code,user-session,validation,web-vitals}.ts` and
`lib/admin/user-display.ts` (socket.ts cross-covered by lane L).
Wallet/loyalty/support component trees and unread product extracts were
verified structurally (import surface, risk-pattern grep: zero raw-fetch
sites outside the spine; two formatting effects total) — not read
line-by-line. No real orders, payments, or logins were performed during
live probes.

**Verdict:** the customer-journey surface is **healthy** — every leg
carries distinct, honest loading/empty/error/recovery states, live-
verified end to end, with disciplined at-most-once async patterns well
beyond the money lane. Five cheap fixes: C-1 (the only P3 — three call
sites without the repo's own fetch-hardening idiom), then four one-line
lean/truthfulness nits (C-2..C-5).
