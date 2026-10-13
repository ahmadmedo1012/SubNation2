# Lane G findings — R142 money / wallet / checkout / stock / variants / fulfillment

Task ID: 142-G1 · read-only audit · HEAD `a9f5e83` (production-live SHA).
Scope: frontend checkout/wallet/loyalty/topup surfaces (+ their tests) as primary
owner; cross-cut reviewer on the backend money services, routes, libs and
shared/db money schemas. ~42 inventory files + 12 cross-cut backend files
(~6,900 cross-cut lines). Nothing was edited.

## r140 flag verification (current code status)

| # | r140 flag | Status | Proof |
|---|---|---|---|
| 1 | loyalty `handleConvert` re-entry guard (`if (converting) return`) | **FIXED** | `frontend/src/pages/loyalty.tsx:205` (comment 196-204 documents the R-140-o central fix) |
| 2 | loyalty convert raw fetch, no customFetch timeout | **OPEN** → G-1 | `frontend/src/pages/loyalty.tsx:230-238` — plain `fetch`, no `AbortSignal`, no 20 s bound; the GET queries (79-102, 116-132) do carry react-query's `signal` |
| 3 | wallet submit-time normalization key timing (render-time header capture) | **OPEN** → G-2 | `frontend/src/pages/wallet.tsx:440-449` (render-time `"Idempotency-Key": topupKeyRef.current`) vs `528-537` (mid-handler `resetTopupKey`) + `574` (`mutate()`), all in one synchronous handler |
| 4 | checkout mount re-quote late-remove (remove-then-re-add same line) | **OPEN** → G-3 | `frontend/src/pages/checkout.tsx:220-244` — the drop loop iterates the effect's STALE `items` closure and calls `removeItem(productId, line.variantId)`, which matches the re-added live line by key |
| 5 | TopupWaitingModal invalidates `/api/wallet` only (poll-only path) | **OPEN (optional)** → G-4 | `frontend/src/components/TopupWaitingModal.tsx:176-180`; socket side now covers me+ledger (`frontend/src/hooks/use-socket.ts:132-133`) |

## Findings

### G-1 — P2 — loyalty convert POST can hang the money CTA indefinitely (no timeout / no abort)

- **Where:** `frontend/src/pages/loyalty.tsx:230-238` (the money mutation), against the
  app-wide 20 s `customFetch` contract every other money path rides
  (checkout `createOrder`, wallet `useCreateTopup`, product buy).
- **Concrete case:** user taps «تحويل» on a stalled link (dead NAT / cold-start).
  The raw `fetch` never settles on the app's clock; `setConverting(true)` at
  line 220 stays armed, the CTA stays disabled, and the idempotent retry
  contract — key survives, retry replays — can never be exercised because the
  handler never returns. The browser's own ~300 s timeout is the only bound.
  Money integrity is not at risk (the durable key + backend claim hold; a
  late-arriving success still resolves correctly), but a money screen locks up
  and the documented retry UX is unreachable in exactly the failure mode it
  was built for.
- **Minimal fix:** switch the POST to the generated client (customFetch, 20 s
  abort) like wallet/checkout/product — or pass
  `signal: AbortSignal.timeout(20_000)` to the existing fetch. One call site.
- **Evidence:** the two GET queries on the same page already use react-query's
  `signal` (lines 84-87, 120-122); only the POST lacks any bound.

### G-2 — P3 — wallet submit-time normalization sends the PRE-normalization Idempotency-Key with the normalized body

- **Where:** `frontend/src/pages/wallet.tsx:440-449` (orval hook captures
  `"Idempotency-Key": topupKeyRef.current` at RENDER time) vs `:528-537`
  (`resetTopupKey(topupIntentFingerprint(String(normalizedAmount), …))` inside
  `handleSubmit`) + `:574` (`topupMutation.mutate({data:{amount: normalizedAmount,…}})`
  in the same synchronous tick).
- **Concrete case:** user types `25.5`, submits. `normalizedAmount = 26 ≠ 25.5`
  → the handler rotates the key to a fresh one bound to fingerprint
  `26|…` — but `mutate()` sends the header captured at the last render, i.e.
  the OLD key minted for the fractional intent, with body `amount: 26`.
  Residual double-spend window (r140's own analysis, still accurate): that
  request commits, the response is lost, the user retries → the re-render has
  now captured the NEW key → the retry creates a SECOND pending topup.
  Backstops: mobile_transfer requires `payment_reference` (M3) so the
  creation dedup (`routes/wallet.ts:496-522`) + approval battery answer
  same-receipt duplicates; **lypay without a reference has NO DB dedup**
  (`routes/wallet.ts:500-503` — the guard subquery is a literal SQL `null`),
  so two pendings can both be approved → double credit. Also a smaller
  side-effect: the sessionStorage entry now holds a key that was never sent,
  so the refresh-restore contract degrades to fresh-key on the next visit.
- **Minimal fix (page-level, one line of intent):** pass the key per-call —
  `createTopup(data, { headers: { "Idempotency-Key": topupKeyRef.current } })`
  (checkout's `createOrder` idiom, `checkout.tsx:610-612`) — or rotate the key
  in an effect that runs before the submit re-render reads it. Keep the
  rotation semantics; only change WHERE the header is read.
- **Test blind spot:** `wallet-submit.test.tsx:345-451` pins the render-time
  capture as a contract and `wallet-money-gates.test.tsx:264-289` pins the
  `1.6 → 2` snap on the *data* payload only — no test asserts which key
  accompanies a submit-time-normalized body.

### G-3 — P3 — checkout mount re-quote can remove a RE-ADDED cart line (stale-closure drop)

- **Where:** `frontend/src/pages/checkout.tsx:194-294` (the re-quote effect);
  the drop branches at `:220-231` (404/410), `:234-244` (is_active false) and
  `:249-252` (variant unavailable) iterate the effect's captured `items`
  snapshot and call `removeItem(productId, line.variantId)` — a KEY-targeted
  remove that matches whatever line currently occupies that key in the live
  cart.
- **Concrete case:** shopper lands on /checkout with product 5 / variant 101;
  the re-quote request is in flight (bounded 20 s, at-most-once per visit).
  While it flies, the user removes the line and re-adds the same
  (productId, variantId) — e.g. via the cart tab or a back-and-forth. The
  (possibly transient) 404 / deactivated / unavailable response lands; the
  loop matches the RE-ADDED line by key and removes it, showing
  «…لم يعد متاحاً للشراء — أُزيل من الطلب» for a line the shopper just
  re-added and possibly resurrecting a stale verdict (a transient 404 kills a
  live line). No wrong charge is possible (the server re-validates every
  unit), but the money funnel silently mutates the user's live cart on stale
  data.
- **Minimal fix:** before `removeItem` in each drop branch, re-read
  `readLiveCartItems()` and only remove when the live line is the SAME intent
  (same key AND the snapshot quantity not superseded) — or gate the drop on a
  generation counter bumped by cart mutations (the `couponGenerationRef`
  idiom at `:164-169`). Cart.tsx owns the lane; the fix belongs with it or in
  this effect.
- **Evidence:** `checkout-pricing-reconcile.test.tsx` pins the drop behavior
  only against a stable snapshot — no test drives remove+re-add mid-flight.

### G-4 — P4 — TopupWaitingModal poll-only decision path refreshes the balance but not me/ledger

- **Where:** `frontend/src/components/TopupWaitingModal.tsx:176-180` — the
  status-flip effect invalidates only `getGetWalletQueryKey()`.
- **Concrete case:** socket dead (capped connection / network partition) →
  the 3 s poll catches the approval flip → the modal shows the new balance,
  but the Navbar `me` chip and the wallet statement (`/api/wallet/ledger`)
  keep the pre-approval figures for up to their 60 s staleTime — the same
  on-screen contradiction r140 fixed on the socket path
  (`use-socket.ts:132-133`). Optional defense-in-depth (r140 called it that);
  one-line addition of the two keys to the same invalidation.
- **If we skip it:** cosmetic staleness ≤60 s on two surfaces when the socket
  is down; money is correct.

### G-5 — P4 — checkout cart-sync can discard cart edits made in another tab mid-charge

- **Where:** `frontend/src/pages/checkout.tsx:690-705` — `orderedUnitsByLine`
  sync looks the line up in the STALE render `items` and writes
  `updateQuantity(productId, line.quantity - units, variantId)`
  (absolute-set semantics, `lib/cart.tsx:501-515`) or `removeItem` when
  `units >= line.quantity`.
- **Concrete case:** cart line qty 2 when the confirm loop starts; while the
  N sequential POSTs fly, the user raises the same line to 3 in another tab.
  The multi-tab guard at `:563-573` only skips when the live quantity no
  longer COVERS the unit index — a raise never trips it, the loop correctly
  buys 2 units, then the sync sets the live line to `2 − 2 = 0` /
  removeItem → the 1 unit the user just added is silently dropped. Charges
  stay exactly-what-was-charged; only the un-purchased edit is lost.
- **Minimal fix:** compute the remainder from the LIVE cart read
  (`readLiveCartItems()`) instead of the stale snapshot in the same forEach.
- **Evidence:** `checkout-idempotency-keys.test.tsx` covers quantity
  DECREASES mid-flight (skip logic) but no test covers a mid-flight raise.

### G-6 — P4 — one LYD display misses the en-US grouping canon (M17 residual)

- **Where:** `backend/src/routes/loyalty.ts:326` — the convert success message
  string interpolates `lydValue.toFixed(2)` instead of `formatLyd(...)`
  (the R128 B8-D3 canon used 6 lines up at `:616` and at `:631` for the
  sibling notifications).
- **Concrete case:** converting 150,000 points → `1,500.00 د.ل` renders as
  «1500.00 د.ل» in the success toast (frontend shows `result.message`
  verbatim, `loyalty.tsx:254`). Same class as the pre-R128 Telegram/bell
  drift; one-word fix (`formatLyd(lydValue)`), zero behavior change below
  1,000.

## M1–M17 verification table (code truth, not docs)

| # | Invariant | Status | Proof (file:line at HEAD a9f5e83) |
|---|---|---|---|
| M1 | Topup approval atomic | **VERIFIED** | `topup.service.ts:273-568` one tx: in-tx status re-check 286-291, advisory lock 281-283, guarded status flip 383-397 (`WHERE status='pending'`), wallet CAS 431-442, ledger 445-457, referral guarded flip 478-525, welcome bonus guarded 536-565. Two-approvers race → 409, single credit |
| M2 | Topup creation dedup in-tx | **VERIFIED** | `routes/wallet.ts:464-586` creation tx under per-user advisory lock (465-467); duplicate-ref probe is a scalar subquery INSIDE the tx (495-503); `MAX_PENDING=3` at 463; suites `wallet-topups-idempotency.test.ts` (5, names verified) + `topup-composite-dedup` |
| M3 | mobile_transfer requires payment_reference | **VERIFIED** | `routes/wallet.ts:377-387` rejects null reference with 400; suite `wallet-topups-payment-reference.test.ts:101/114` (whitespace-only AND omitted both 400) |
| M4 | Purchase one atomic tx | **VERIFIED** | `checkout.service.ts:434-765` single `.transaction()`; pre-tx `INSUFFICIENT_BALANCE` 407; in-tx claim via provider 544-548 → `manual.provider.ts:50-79` `FOR UPDATE SKIP LOCKED`; coupon atomic-with-check 601-649; order+ledger+points same tx 651-744; wallet CAS on 3 columns 570-599 |
| M5 | Durable idempotency replay-safe | **VERIFIED** | `middlewares/idempotency.ts:324-342` (SET NX EX 60) + `:372-378` (SET EX 86400) — both EXs asserted by `middlewares/__tests__/idempotency.test.ts:430,569,608`; durable claim `lib/idempotency.ts:299-310`; body-hash reuse predicate wired at `checkout.service.ts:212-225`, `routes/wallet.ts:414-428`, `routes/loyalty.ts:189-204` |
| M6 | Checkout retry after paid order replays ownership | **VERIFIED** | `checkout.service.ts:190-236` pre-tx replay (short-circuits BEFORE balance check), `:865-899` claim-conflict replay; `replayOriginalOrder` 928-959 is read-only + user-scoped; suite `checkout-idempotency.test.ts:119,154` |
| M7 | Refunds transactional + points-race safe, events post-commit | **VERIFIED** | `refund.service.ts:127-395` one tx (status-guarded flip 268-280, CAS on 3 columns 238-261, coupon slot return 297-302, credential revoke 324-340); emissions strictly post-commit 396-440 |
| M8 | Admin adjustments intent-keyed | **VERIFIED** | `adjustment.service.ts:247-266` — durable claim INSIDE the adjustment tx with admin-scoped key + bodyHash; suites `adjustment.service.test.ts`, `admin-adjustment-idempotency.test.ts` |
| M9 | Negative balance unreachable | **VERIFIED** | checkout CAS `checkout.service.ts:590-599`; topup CAS `topup.service.ts:436-442`; adjustment `NEGATIVE_BALANCE` gate 199-201; DB last line `shared/db/src/schema/users.ts:90` `chk_users_wallet_balance_nonneg` — proven live by `wallet-never-negative.test.ts:173`; ledger arithmetic CHECK `wallet_ledger.ts:90-93` |
| M10 | Orders freeze their price | **VERIFIED** | grep `update(ordersTable` → only status/refund/credential writers (`refund.service.ts:269,330`, `admin/orders.ts:648`); `orders.amount` has exactly one INSERT-time writer (`checkout.service.ts:664`); `price-snapshot-immutability.test.ts:74` re-prices post-purchase and asserts frozen amount + exact refund |
| M11 | Inventory claims single-writer | **VERIFIED** | `manual.provider.ts:63,78` (`FOR UPDATE SKIP LOCKED`, scoped-then-generic ordered pools) + guarded claim UPDATE `:114-119` (`WHERE is_sold=false` under row lock); suite `checkout-claim-race.test.ts:59` |
| M12 | Topup path cannot hit the historical FK failure | **VERIFIED** | `backend/src/migrate.ts:1115-1160` `applyIdempotencyDropOrderFkStage` (V1-M20: canonical-name DROP IF EXISTS + any-name DO-block sweep); drizzle twin `shared/db/src/schema/idempotency-keys.ts` carries no `.references()` |
| M13 | Loyalty convert idempotent-durable | **VERIFIED** | `routes/loyalty.ts:189-214` pre-tx existence check (any-intent), `:295-309` in-tx claim (null order_id, `loyalty.convert`, bodyHash); frontend durable key + IN_FLIGHT keep-key (`loyalty.tsx:224-256`); suites `loyalty-durable-idempotency.test.ts` (3) + `loyalty-convert-journey.test.tsx` |
| M14 | Duplicate-claim prevention on credentials | **VERIFIED** | Guarded claim + `INVENTORY_CORRUPT` fail-closed deliverability gate BEFORE any mutation (`manual.provider.ts:97-110`); product/variant/flash-sale in-tx freshness re-checks (`checkout.service.ts:464-533`); suites `checkout-inventory-corrupt`, `checkout-product-stale` |
| M15 | Schema guards in all mirrors | **VERIFIED** | TS twins read: `orders.ts:37,40,137-147` (RESTRICT FKs + `chk_orders_amount_pos` + refund range), `wallet_ledger.ts:35,78,90-93`, `wallet_topups.ts:30,69-78` (partial unique), `users.ts:90-91`; runtime stages located in `migrate.ts` (V1-M25/M26/M28/M29 blocks at 1490-1837 — cross-cut owner, spot-verified); suites = the 7 migrate suites + `checkout-invariant-order.test.ts` |
| M16 | Money events only after commit | **VERIFIED** | checkout signal-object `couponMaxedSignal` declared `checkout.service.ts:429-432`, fired `:906-913`; topup notifications `topup.service.ts:586-641`; refund `refund.service.ts:396-440` |
| M17 | One LYD formatting idiom | **VERIFIED** (one P4 residual → G-6) | frontend `formatCurrency` `frontend/src/lib/utils.ts:22-26` (en-US, 2dp, «د.ل») used on every surface read this round (CartSummaryAside, CheckoutCta, PaymentMethodCard, TopupWaitingModal, wallet extracts); backend `formatLyd` `backend/src/lib/money.ts:59-66`; residual: `routes/loyalty.ts:326` toFixed(2) in the convert success message |

## Money-journey trace (cross-layer, condensed)

browse → variant select (PDP sends `variant_id` on every unit order,
`checkout.tsx:583`) → add-to-cart snapshot → mount re-quote
(`checkout.tsx:194-294`, displayed==charged enforced by CTA gate
`canSubmit` 419-434) → per-line coupon pre-flight (`coupon-quote.ts`,
per-unit-honest math) → per-unit `createOrder` with durable per-unit
Idempotency-Key (`checkout.tsx:599-612` + `checkout-unit-key.ts`) →
`routes/orders.ts:264-384` (risk sandwich → Redis idempotency →
`CheckoutService.purchase`) → single tx claim+debit+coupon+order+ledger+points
→ post-commit signals → wallet ledger readable via `/api/wallet/ledger`
(`routes/wallet.ts:190-223`) → socket `topup-updated`/`order-updated`
invalidations (`use-socket.ts:104-157`) → topup submit
(`routes/wallet.ts:244-718`: allowlist, M3 reference, in-tx dedup battery,
auto-reject heuristic, operator card) → approve (`topup.service.ts:219-644`:
advisory lock + status re-check + exact-ref + composite soft-dedup + CAS +
ledger + referral + welcome) → live invalidation me/wallet/topups/ledger.
Every leg re-verified at code level; the four open findings above are the
only deviations found (none is a wrong-charge path — all are UX/lockup/
cart-state/staleness class, with G-2's lypay residual being the only
double-credit *window*, and it needs operator approval of both pendings).

## Mutation-test reasoning (do the money suites fail when invariants break?)

1. **Break M4's wallet CAS** (delete the `eq(usersTable.walletBalance, String(currentBalance))`
   predicate at `checkout.service.ts:590-597`): `backend/src/services/__tests__/wallet-never-negative.test.ts:80`
   ("a concurrent committed debit inside the read→write window →
   CONCURRENCY_ERROR, never a negative balance, zero money movement") goes
   RED — the test commits a concurrent debit inside the window and asserts
   the purchase resolves as CONCURRENCY_ERROR with the balance intact.
2. **Break M1's double-approve guard** (delete the guarded status flip
   `WHERE status='pending'` at `topup.service.ts:383-394`, or the in-tx
   re-check at 286-291): `backend/src/services/__tests__/topup.service.test.ts:110`
   ("double-approve does NOT double-credit: second approve fails, balance
   unchanged") goes RED — the second approve would flip the row again and
   credit twice under the still-passing CAS (balance re-read fresh), so the
   balance assertion catches it.
3. **Break M5's EX** (delete `EX: IN_FLIGHT_TTL_SECONDS` from the sentinel
   SET at `middlewares/idempotency.ts:324-329`, or `EX: IDEMPOTENCY_TTL_SECONDS`
   from the cache write at `:372-375`): `backend/src/middlewares/__tests__/idempotency.test.ts:430`
   ("first keyed request: in-flight sentinel SET NX EX 60, response cached
   with EX 86400") goes RED — the Redis double records every SET's TTL
   argument and asserts it explicitly (the r111 dangerous-green gap), and
   `:569`/`:608` (sentinel/cached TTL expiry) also fail because the
   double's expiry then honors the injected clock.

Bonus (M10): introduce any `orders.amount` UPDATE site →
`price-snapshot-immutability.test.ts:74` re-prices the product post-purchase
and asserts the order row + refund credit stay at the paid amount → RED.

## Not checked / limits

- `migrate.ts` V1-M25/M26/M28/M29 runtime stage *bodies* were located and
  spot-read (FK RESTRICT + CHECK stages around lines 1490-1837), not
  line-by-line deep-read — primary ownership is the backend lane; the drizzle
  twins and the migrate test suites were verified instead.
- Live DB introspection (4 RESTRICT FKs + 11 CHECKs) was NOT re-run this
  round (read-only audit, no DB credentials assumed); R128-B4's live
  verification is the last on-record proof, and the schema twins + suites
  pin parity.
- Frontend wallet extract files (`components/wallet/*.tsx` presentationals)
  were verified through their pin suites + page reads, not individually
  deep-read (they are stateless by contract — pinned by
  `wallet-decomposition-r136.test.ts:142-161`).
