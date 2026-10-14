# Lane L5 findings — R143 client↔server purchase-path integrity audit

Task: R143-L5 (Cart, checkout, wallet & purchase integrity). Base: HEAD `528ef39`
(R142+ assurance round, production-live tree). Read-only audit — nothing was
modified, no commits, no production writes. Method: full deep-read of
`frontend/src/pages/{checkout,wallet,loyalty,cart,product,order-detail}.tsx`,
`frontend/src/lib/cart.tsx`, `frontend/src/lib/idempotency.ts`,
`frontend/src/components/{checkout,wallet}/*` money modules,
`frontend/src/components/TopupWaitingModal.tsx`, `frontend/src/hooks/use-socket.ts`,
`shared/api-client-react/src/custom-fetch.ts` + the generated
`{createOrder,createTopup,convertPoints,validateCoupon}` fetchers, plus targeted
vitest runs of the checkout/wallet/loyalty/cart/topup suites (all green — §"Test
evidence").

**Headline: zero P0/P1. No wrong-charge path found.** The four user money
mutations (checkout per-unit, PDP single-buy, wallet topup, loyalty convert)
all carry synchronous re-entry guards + durable per-intent Idempotency-Keys
with mint-replay-clear lifecycles, and every displayed==charged gate
(mount re-quote, per-line coupon math, CTA gating, server re-pricing) held
under re-walk. The findings below are hang-class / truthfulness / staleness
residuals and deferred-debt re-flags — the strongest being two P3s in the
checkout coupon pre-flight (raw fetch without the 20 s budget, and non-2xx
responses misclassified as a definitive «الكوبون غير صالح» verdict).

---

## R142 fix verification

| Fix | Status | Evidence at HEAD `528ef39` |
|-----|--------|---------------------------|
| **G-1** (P2) loyalty convert → generated client w/ 20 s timeout | **VERIFIED** | `frontend/src/pages/loyalty.tsx:236-253` — `convertPointsApi({points: pts}, {headers: {...headers, "Idempotency-Key": intentKey}})`; the generated `convertPoints` (`shared/api-client-react/src/generated/api.ts:4368-4397`) rides `customFetch`, whose default budget is `DEFAULT_REQUEST_TIMEOUT_MS = 20_000` (`custom-fetch.ts:367`, applied at `:531`). Re-entry guard `if (converting) return;` at `loyalty.tsx:211`; durable key keep-on-network/IN_FLIGHT at `:278-279`. Regression suites `loyalty-convert-journey.test.tsx` (8 tests) + `loyalty-error-state` — green this round. |
| **G-2** (P3) wallet per-intent key read at FETCH time | **VERIFIED** | `frontend/src/pages/wallet.tsx:161-194` — `topupRequestRef` STABLE request object + `syncTopupRequestKey()` synced at lazy init (:188), every `resetTopupKey` (:193), the mount restore (:331), and belt-and-suspenders pre-mutate (`:598`); `useCreateTopup({ request: topupRequestRef.current })` at `:464-469`; the submit-time normalization rotation at `:548-557` precedes `mutate()` (`:599`) in the same synchronous handler. Generated side reads headers at call time: `createTopup(data, requestOptions)` (`api.ts:3221`) → `getHeaders(options?.headers)` inside `createTopup` (`api.ts:3181-3185`). Pin: `money-races-r140.test.ts:295-323` (source-scan) + `wallet-submit.test.tsx:345-452` (hook-config observable) — green. Residual: no *behavioral* wire-level test of the normalized submit (→ L5-6). |
| **G-3** (P3) checkout mount re-quote line-identity guard | **VERIFIED** | `frontend/src/pages/checkout.tsx:226-235` — `removeIfStillSameIntent` re-reads `readLiveCartItems()` and only removes when the live line occupying the key carries THIS snapshot's quantity; wired into all three drop branches (:248 archived 404/410, :261 deactivated, :269 variant unavailable). New regression test `checkout-pricing-reconcile.test.tsx:264` ("a 404 landing after remove-then-re-ADD of the same key does NOT remove the re-added line") — green this round. |

R142 G-4 and G-5 were **recorded as deferred debt** (not FIX-R142) — both
re-verified still open at HEAD and re-flagged below as L5-5 / L5-4.

---

## Findings

### L5-1 · P3 · checkout coupon pre-flight rides a raw `fetch` with NO timeout — the confirm CTA can hang «جارٍ المعالجة… 0/N» for up to ~300 s (G-1/C-1 class residual on the checkout path itself)

- **Evidence:** `frontend/src/components/checkout/coupon-quote.ts:101-118` —
  `const res = await fetch("/api/coupons/validate", { method: "POST", headers: {...}, credentials: "include", body: JSON.stringify({...}) })`
  — no `signal`, no `AbortSignal.timeout`, no customFetch. Called from BOTH
  money-path sites: `checkout.tsx:360` (`applyCoupon` — the «تحقق» spinner via
  `couponChecking`) and `checkout.tsx:533` (the `handleConfirm` PRE-FLIGHT,
  running while `submitting=true` / CTA disabled). Contrast: the R142 C-1 fix
  already moved the PDP twin to the generated client —
  `product.tsx:440-450` (`validateCouponApi` "rides customFetch's 20 s budget
  … the loyalty convertPoints idiom from the same round") — the checkout twin
  was missed.
- **Root cause:** the C-1 sweep fixed the PDP coupon path and the support page
  but not the shared checkout module; `coupon-quote.ts` still hand-rolls the
  request. Two secondary consequences of bypassing customFetch: no transparent
  boot-gate 503 retry (custom-fetch.ts:639-653 — a cold-start 503 surfaces as
  a coupon failure instead of being retried side-effect-free), and no ApiError
  envelope normalization.
- **Concrete case:** shopper types a coupon code and presses «إتمام الطلب»
  directly (the pre-flight exists precisely for the un-applied code —
  `checkout.tsx:532` skips only when `appliedCoupon?.code === couponCode`). On
  a dead NAT / stalled link the raw fetch never settles on the app's clock; the
  CTA stays disabled with «جارٍ المعالجة… 0/N» for up to the browser's ~300 s
  TCP timeout; no cancel affordance. Money integrity is NOT at risk (the
  request is validation-only; the server re-validates the coupon on every unit
  order) — this is the same hang-class R142 graded P2 on the loyalty CTA,
  softened to P3 here because it is a read, not a mutation, and is
  browser-bounded.
- **Proposed fix:** swap the inner fetch to the generated
  `validateCoupon` (`api.ts:3735-3764`, customFetch + 20 s + ApiError),
  keeping the per-distinct-price dedupe and the `network` classification
  (catch → `{status:"network"}`). One module, ~10 lines; auth rides the shared
  bearer-token getter so the explicit `Authorization` header can be dropped.
- **Test requirement:** extend `checkout-coupon-perline.test.tsx` with a
  never-settling fetch stub + fake timers: assert the apply spinner clears and
  the confirm pre-flight fails OPEN within the 20 s budget (CTA re-enables /
  loop proceeds), not at 300 s.
- **Risk/dependency:** low — response shape `ValidatedCoupon` matches what the
  module already reads (`valid`, `final_amount`, `error`); the boot-gate retry
  is side-effect-free for this POST (gate rejects before routing).

### L5-2 · P3 · the coupon pre-flight classifies ANY non-2xx (429 rate-limit, 5xx, boot-gate 503, HTML proxy error) as a DEFINITIVE «الكوبون غير صالح» verdict — a transient failure aborts checkout and pushes the buyer to drop the coupon

- **Evidence:** `frontend/src/components/checkout/coupon-quote.ts:122` — only a
  fetch-level *rejection* is inconclusive (`if (responses.some((r) => r.res === null)) return { status: "network" }`);
  `:132-139` — every response that is not `res.ok && body.valid === true` maps
  to `{status:"invalid"}` with the fallback message «الكوبون غير صالح» (a 429
  text body or an HTML 502 body parses to `null` → the fallback fires). The
  consumer aborts the whole confirm on it: `checkout.tsx:534-546` —
  `setOrderError(\`الكوبون: ${message} — أزل الكوبون أو صحّحه ثم أعد المحاولة. لم يتم خصم أي مبلغ.\`)`
  + destructive toast + `return` (no charge). The 429 arm is genuinely
  reachable: `/api/coupons/validate` is rate-limited **10/min per user**
  (`backend/src/lib/rate-limits.ts:206-208`, mounted `backend/src/app.ts:273`)
  and the pre-flight itself fires one request per distinct unit price
  (`coupon-quote.ts:97-101`).
- **Root cause:** the trichotomy (valid / invalid / network) conflates
  "HTTP-level response arrived" with "the server rendered a definitive coupon
  verdict". Only a 200-with-`valid:false` (or a 4xx coupon-specific envelope)
  is definitive; 429/5xx/503-gate are transient and must be inconclusive.
- **Concrete case:** a buyer who tried several codes within a minute (or a
  mixed basket whose pre-flight fires 3 requests on top of earlier applies)
  trips the limiter on the confirm pre-flight → checkout aborts with
  «الكوبون: الكوبون غير صالح — …» for a coupon that is actually fine; the
  banner's own instruction («أزل الكوبون») converts a transient condition into
  a full-price payment. Fail-closed for money safety (no charge happens —
  good), but a false definitive verdict on a money screen.
- **Proposed fix:** in `coupon-quote.ts`, classify by status: `res.ok` → the
  current valid/invalid logic; `4xx` with a parsed `{error}` envelope →
  "invalid" with that message; **`429`/`5xx`/unparseable body → `{status:"network"}`**
  (the existing fail-open arm — the server re-validates every unit order
  anyway). ~6 lines.
- **Test requirement:** `checkout-coupon-perline.test.tsx` — stub a 429 (text
  body) and a 502 (HTML body) for `/api/coupons/validate`; assert
  applyCoupon surfaces the retryable «تعذّر التحقق من الكوبون» notice and the
  confirm pre-flight FAILS OPEN (the unit loop proceeds), never the invalid
  verdict.
- **Risk/dependency:** none — strictly widens the fail-open arm; the
  deterministic 4xx invalid paths stay as-is.

### L5-3 · P4 · a server-side INSUFFICIENT_BALANCE rejection never refreshes the me cache — the stale balance chip contradicts the server's verdict on screen

- **Evidence:** `frontend/src/pages/checkout.tsx:746-749` — the
  complete-failure branch (`failureMessage && created.length === 0`) only sets
  the banner + toast; `refreshMeBalance()` runs exclusively when
  `created.length > 0` (`:730-744` success/partial, `:787-791` network catch).
  The balance chip renders the 60 s-stale `me.wallet_balance`
  (`checkout.tsx:120-134` → `PaymentMethodCard.tsx:64-72`), and the client-side
  `insufficient` gate (`checkout.tsx:340-342`) keys off the same stale figure —
  so after the server's definitive rejection the page shows a
  sufficient-looking balance next to an error banner that says otherwise, with
  no client-side «الناقص» math (that banner needs the FRESH figure).
- **Root cause:** the post-charge refresh (`93-C5`) was wired for the
  money-moved case only; the definitive money-NOT-moved verdict (which proves
  the cached balance is wrong — stale-high) has no refresh path. Self-heals
  only after the 60 s staleTime + a remount (refetchOnWindowFocus is off
  app-wide).
- **Proposed fix:** one line in the complete-failure branch — when the failure
  is balance-class (`apiErrorData(e)?.code === ErrorCode.INSUFFICIENT_BALANCE`,
  or simply unconditionally on that branch), call `refreshMeBalance()` so the
  chip + gate recompute from the no-store probe.
- **Test requirement:** checkout suite — mock `/api/auth/me` returning a
  stale-high balance, `/api/orders` rejecting INSUFFICIENT_BALANCE; assert the
  me cache is reseeded and the client-side insufficient banner («الناقص … د.ل»
  + the topup link) appears after the failure.
- **Risk/dependency:** none (no-store GET already exists as
  `refreshMeBalance`).

### L5-4 · P4 · R142 G-5 debt re-flagged: the post-charge cart-sync writes quantities from the STALE render snapshot — a mid-flight quantity raise in another tab is silently discarded

- **Evidence:** `frontend/src/pages/checkout.tsx:708-714` —
  `orderedUnitsByLine.forEach(({productId, variantId, units}) => { const line = items.find(...); ... if (units >= line.quantity) removeItem(productId, variantId); else updateQuantity(productId, line.quantity - units, variantId); })`
  — `items` is the snapshot the loop started from; `updateQuantity` is
  absolute-set (`frontend/src/lib/cart.tsx:501-531`). Recorded as G-5 debt in
  R142 (`findings-G.md:114-131`); unchanged at HEAD.
- **Root cause:** the sync computes the remainder from the stale snapshot
  instead of `readLiveCartItems()` (the idiom the multi-tab unit guard at
  `:581-591` already uses). Charges stay exactly-what-was-charged; only the
  un-purchased raise (e.g. 2→3 mid-flight buys 2, then the sync sets the live
  line to 0/removes it) is lost.
- **Proposed fix:** read the LIVE line inside the same forEach
  (`readLiveCartItems()`) and compute `live.quantity - units` from it (guard
  null → keep current behavior). ~4 lines.
- **Test requirement:** `checkout-idempotency-keys.test.tsx` — drive a
  mid-flight raise (bump localStorage between unit POSTs); assert the line
  survives with the raised remainder.
- **Risk/dependency:** low; same module the G-3 fix already touched.

### L5-5 · P4 · R142 G-4 debt re-flagged: TopupWaitingModal's poll-only decision path invalidates ONLY the wallet key — the Navbar me chip and the ledger stay ≤60 s stale when the socket is dead

- **Evidence:** `frontend/src/components/TopupWaitingModal.tsx:176-180` — the
  status-flip effect invalidates only `getGetWalletQueryKey()`. The socket path
  covers all four surfaces (`frontend/src/hooks/use-socket.ts:111-133`:
  topups + wallet + me + ledger, the R-140-o fix). When the socket is down
  (capped connection / partition), the 3 s poll catches the approval flip →
  the modal shows the new balance, but the Navbar chip and the wallet
  statement keep pre-approval figures for up to their 60 s staleTime.
- **Root cause:** the poll fallback was never extended when the socket
  invalidation set grew in R-140-o.
- **Proposed fix:** add `getGetMeQueryKey()` +
  `getGetWalletLedgerQueryKey()` to the same invalidation (one line, two
  imports).
- **Test requirement:** extend `topup-waiting-modal-aria.test.tsx` (or a small
  query-client test) asserting all three keys invalidate on the approved flip.
- **Risk/dependency:** none — harmless extra refetch when data is unchanged.

### L5-6 · P4 · G-2's behavioral blind spot is still open: no test asserts WHICH Idempotency-Key accompanies a submit-time-normalized topup body

- **Evidence:** `wallet-money-gates.test.tsx:264-276` pins the `1.6 → 2` snap
  on the DATA payload only (`expect(mutateMock.mock.calls[0][0].data).toMatchObject({amount: 2})`);
  `money-races-r140.test.ts:295-323` pins the fix as SOURCE REGEXES
  (`request: topupRequestRef.current` / the `syncTopupRequestKey` body /
  the pre-mutate sync), not as rendered wire behavior; `wallet-submit.test.tsx`
  mocks the mutation, so nothing asserts the real `createTopup` request
  headers for the normalized submit. The R142 lane's own blind-spot note
  (`findings-G.md:67-70`) is therefore only structurally closed.
- **Root cause:** the G-2 fix was pinned with a source-scan (cheap, drift-safe)
  instead of a behavioral test through the real generated fetcher.
- **Proposed fix:** one test rendering the page with the real
  `createTopup`/customFetch wired to a stubbed global fetch (the
  `loyalty-convert-journey.test.tsx:37-103` idiom): type `25.5`, submit,
  assert the POST body is `amount: 26` AND the `Idempotency-Key` header equals
  the key rotated for the `26|…` fingerprint (not the pre-normalization key).
- **Test requirement:** the test above; keep the source pin as belt-and-suspenders.
- **Risk/dependency:** none.

### L5-7 · P4 · checkout drop/price notices persist for the whole visit — a re-added line keeps its «لم يعد متاحاً للشراء — أُزيل من الطلب» warning

- **Evidence:** `frontend/src/pages/checkout.tsx:110` (`droppedLineNotices`
  state) has exactly one write site (`:301`, inside the re-quote) and no
  clearing effect on cart change; `quotedProductIdsRef`
  (`checkout.tsx:193-200`) never re-quotes an already-quoted product, so a
  line dropped at mount and re-added later in the same visit keeps the stale
  warning while the line visibly sits in the summary
  (`CartSummaryAside.tsx:64-76` renders the notices above the items list).
- **Root cause:** the notices were designed as one-shot explanations of the
  mount re-quote; cart mutations after the quote don't invalidate them.
- **Proposed fix:** clear `droppedLineNotices`/`pricesUpdatedNotice` when the
  cart's line SET changes identity (e.g. in the same `couponGenerationRef`
  effect at `checkout.tsx:165-169`, or compare against the dropped lines'
  keys). ~3 lines.
- **Test requirement:** checkout suite — drop via 404, re-add the same
  product, assert the warning no longer renders while the line is present.
- **Risk/dependency:** low; purely presentational state.

### L5-8 · P4 · `lib/idempotency.ts` docblock still documents the G-2 window as OPEN — money-path documentation contradicts the R142 fix

- **Evidence:** `frontend/src/lib/idempotency.ts:80-92` — "THE ORVAL
  HEADER-TIMING CONTRACT (verified this round, page-level residual …): … A
  rotation performed synchronously INSIDE the submit handler (wallet.tsx's
  submit-time amount normalization) sends the PREVIOUS key with the normalized
  body … The backend's payment_reference battery is the backstop there." The
  G-2 fix (stable request object read at fetch time, `wallet.tsx:161-194`)
  closed exactly this window — the doc now misdescribes live behavior and
  would mislead a future auditor into re-opening a fixed issue (or "fixing"
  the already-fixed page).
- **Root cause:** the R142 implementation wave updated the page but not the
  canonical money-race map that describes it.
- **Proposed fix:** rewrite the paragraph to describe the stable-request-object
  contract (headers read at fetch time; rotations synced at every reset point
  + pre-mutate), noting the history (r140-o finding → R142 G-2 fix).
- **Test requirement:** none (comment-only); optionally extend the
  money-races source pin to assert the stale sentence is gone.
- **Risk/dependency:** none.

### L5-9 · P4 · loyalty's two GET queries ride raw `fetch` without the 20 s customFetch budget

- **Evidence:** `frontend/src/pages/loyalty.tsx:87-93` (GET `/api/loyalty`) and
  `:124-128` (GET `/api/loyalty/ledger`) — raw fetch with react-query's
  `signal` (unmount-cancellable) but no timeout. The R142 G-1 fix covered the
  convert POST only. A stalled link leaves the page on its skeleton until the
  browser's ~300 s timeout (react-query then renders the honest
  FetchErrorCard branches — no infinite spinner, recovery works).
- **Root cause:** same G-1 family; the GETs were judged acceptable in R142
  because of the unmount signal.
- **Proposed fix:** move both queries to the generated client (or add
  `signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)])`).
- **Test requirement:** none new (existing error-state suites cover the
  failure rendering).
- **Risk/dependency:** low.

---

## Verified clean (scope walkthrough — no findings)

1. **Cart state / persistence.** localStorage `subnation_cart_v2` with
   load-time guards shared by load/migration/cross-tab listener
   (`cart.tsx:307-335`), v1→v2 migration + legacy-key removal
   (`:372-390`), storage-event re-sync that re-parses `event.newValue` with
   the same guards and ignores null/corrupt writes (`:401-409`), quantity
   clamp [1,99] + stock-aware raise ceiling that never silently shrinks a line
   (`:257-259`, `:411-531`). **Guest→auth cart merge is a non-issue by
   design**: the cart is purely local and user-agnostic; the server cart
   (`backend/src/routes/cart.ts:120-391`) is vestigial from the frontend's
   perspective — its only live call is the best-effort fire-and-forget DELETE
   on «إفراغ السلة» (`cart.tsx:139-144`, `.catch(() => {})`), which cannot
   block the local clear.
2. **Displayed == charged.** Mount-time live re-quote per distinct product
   (`checkout.tsx:194-312`) with fail-open + try/finally CTA-gate clearing
   (`:302-308`); per-line coupon pre-flight computes the SAME per-unit math
   the server charges (`coupon-quote.ts:34-66`, `:140-161`); the CTA gate
   blocks on stale-total (pricingRecheckInFlight), blocking stock, and
   insufficient balance (`checkout.tsx:437-452`); cent-rounded comparisons
   (`:340-342`, `roundToCents`); M10 keeps `orders.amount` frozen and
   order-detail renders the server's figure (`order-detail.tsx:319-321`).
   PDP twin re-quotes before every single buy and ABORTS on drift before
   minting any key (`product.tsx:250-335`).
3. **Duplicate submissions.** Synchronous re-entry guards on all four money
   CTAs: checkout `checkout.tsx:481`, topup `wallet.tsx:520` (mirrors the
   disabled predicate — Enter can't double-fire), loyalty
   `loyalty.tsx:211`, single-buy `product.tsx:251`. Durable per-intent keys:
   checkout per-unit (`checkout-unit-key.ts` — line-scoped slots, 10 min TTL,
   fingerprint, mint-persist-POST, IN_FLIGHT keep-key at
   `checkout.tsx:661-666`), PDP (`buy-intent-key` via
   `product.tsx:350-357, 417-419`), topup (sessionStorage envelope +
   fetch-time header read — G-2), loyalty (localStorage envelope +
   `loyalty.tsx:232-234, 279`). Backend arm re-verified: `requireUser` →
   risk guard → `idempotency({routeKey: "orders.create"})` with key + body-hash
   passthrough (`backend/src/routes/orders.ts:264-299`).
4. **Retry consistency.** Network-level unit failure rethrows BEFORE the
   cart-sync so charged units' keys survive for replay
   (`checkout.tsx:638-645`); the sync is the only success-side key deletion
   (`:715-722`); partial failure keeps the honest remainder in the cart and
   reports `partialCount` (`:750-754`); coupon-family mid-loop failures clear
   the dead code with an explicit full-price explanation (`:686-701`); the
   other-tab-completed outcome navigates to /orders with an informative toast
   (`:755-764`). No permanently blocked states found: every spinner flag is
   cleared in a `finally` (`checkout.tsx:795-798`, `coupon-quote` callers,
   `loyalty.tsx:288-290`, wallet `onSettled` `wallet.tsx:506-508`); query
   errors retry exactly once for TypeError then render retryable error cards
   (`offline-pwa-r140.test.ts:247-252`).
5. **Stale money data / SW cache.** Money/auth APIs are NEVER runtime-cached:
   the workbox config pins exactly 3 runtime rules (catalog SWR / images /
  same-origin JS) and the count itself is test-pinned
   (`frontend/src/pages/__tests__/offline-pwa-r140.test.ts:180-189`); the
   navigation fallback denylist excludes `/api/` and `/assets/`
   (`:186-188`). Money-moved invalidations are complete on every path:
   checkout refreshes me (no-store seed) + wallet + orders + catalog
   (`checkout.tsx:730-744`), PDP mirrors it (`product.tsx:377-402`), loyalty
   converts invalidate me/wallet/overview/ledger (`loyalty.tsx:261-272`), the
   socket handler invalidates topups/wallet/me/ledger on every topup decision
   (`use-socket.ts:111-133`) and sweeps all `/api/orders*` keys on
   order-updated (`:77-82`). The residual cross-tab balance window is L5-3.
6. **Wallet balance vs ledger.** Balance card renders `/api/wallet` with
   honest unknown/error branches (`BalanceCard.tsx:36-48`); the statement is
   the server's `wallet_ledger` with a truncated-window caption
   (`WalletStatementCard.tsx:51-66`); balance validation before debit is
   server-authoritative (pre-tx `INSUFFICIENT_BALANCE` mapping
   `backend/src/routes/orders.ts:176-179` + in-tx CAS per M4/M9, re-verified
   R142); the client-side gate never blocks on an unknown balance
   (`checkout.tsx:331-342`, `PaymentMethodCard.tsx:64-88` — «—» marker +
   fail-open banner + topup return-link `/wallet?return=/checkout`).
7. **Order confirmation.** The success path navigates to the FIRST created
   order's server record (`checkout.tsx:778`); order-detail renders exactly
   what the server recorded — frozen `order.amount`, variant chip, status
   ladder, credentials with reveal/copy, honest `decrypt_failed` branch
   (`order-detail.tsx:304-321`), distinct 404 vs connection-error branches
   with working retry (`:236-302`), live status via page-scoped socket.

## Test evidence (targeted runs at HEAD `528ef39`, all green)

- Checkout suites: `checkout-idempotency-keys` · `checkout-pricing-reconcile`
  (incl. the G-3 regression at :264) · `checkout-coupon-perline` ·
  `checkout-variant-drain` · `checkout-hydration-guard` — **5 files / 27
  tests passed** (vitest, 6.74 s).
- Wallet / loyalty / cart suites: `wallet-submit` · `wallet-money-gates` ·
  `wallet-statement` · `wallet-method-url` · `loyalty-convert-journey` ·
  `loyalty-error-state` · `loyalty-history` · `cart` · `cart-sync-hardening` ·
  `cart-stock-snapshot` · `cart-add-honesty` · `cart-context-split` —
  **12 files / 104 tests passed** (15.68 s).
- Supporting: `topup-waiting-modal-aria` · `use-socket-topup-dedupe` ·
  `cart-undo-clear` · `offline-pwa-r140` — **4 files / 60 tests passed**
  (10.02 s).

Combined targeted slice: 21 files / 191 tests / 0 failures. No files were
modified; `git status` clean before and after.

## Severity counts

P0: 0 · P1: 0 · P2: 0 · **P3: 2** (L5-1, L5-2) · **P4: 7** (L5-3 … L5-9)
