# R98-A3 — Financial Chain Full-Chain Audit (money path)

**Agent:** R98-A3 · **Scope:** cart → checkout → pricing → coupon → wallet → order → inventory → refund, plus order-state machine, rounding, order codes, frontend mirrors.
**Method:** static code reading only (no tests, no DB). Every file:line claim below was re-verified against the working tree in this session.
**Context:** pre-launch (7 orders, 17 users, zero inventory). Prior-round fixes (3-layer idempotency, single-purchase/topup keys, unsold-only inventory counts) are treated as landed and are **not** re-reported; they are re-verified below as guards.

**Verdict up front:** no P0 found. The purchase transaction is a single atomically-committed unit with race-free inventory claim (FOR UPDATE SKIP LOCKED + conditional claim), optimistic-CAS wallet debit over the full write set, atomic-with-check coupon increment, and an atomic ledger + idempotency-key claim. Client payloads cannot influence any price. The real findings are an order-state machine hole in the admin bulk route, coupon refund/restock accounting, and a frontend/backend coupon-preview divergence that can deterministically fail a checkout that just passed its own pre-flight.

---

## 1. The complete money flow (file:line)

| # | Step | Where (file:line) |
|---|------|-------------------|
| 1 | Cart state = **localStorage only** (`subnation_cart_v2`), per-line price snapshot (priceLYD/salePriceLYD captured at add-to-cart time), qty ≤ 99 | `frontend/src/lib/cart.tsx:19-20,38,50,54-56,105-137,186` |
| 2 | Checkout page: balance probe `/api/auth/me` (no-store), coupon pre-validate `/api/coupons/validate` with `order_amount = totalLYD` (display + button gate only) | `frontend/src/pages/checkout.tsx:196-241,259-261,268-305,370-403` |
| 3 | Confirm = **per-unit sequential loop** (qty N ⇒ N independent `POST /api/orders`), each body `{product_id, variant_id?, coupon_code?}` + stable per-unit `Idempotency-Key` from sessionStorage | `checkout.tsx:405-474` (body 411-417, key 431-436, helpers 115-143) |
| 4 | Route: `requireUser` → risk-soft-block → Redis idempotency middleware (subject=userId, routeKey `orders.create`) → zod `CreateOrderBody` (**only** product_id/variant_id; coupon_code read from raw body) → `CheckoutService.purchase` | `backend/src/routes/orders.ts:115-143` (zod 123-126, coupon 127-130) |
| 5 | Service pre-tx: durable idempotency replay lookup (scoped `u{userId}:{key}`) | `backend/src/services/checkout.service.ts:148-159`, `backend/src/lib/idempotency.ts:103-136` |
| 6 | Price computed **server-side only**: product row (active, not archived) 161-172 → variant resolution (explicit must match; legacy defaults to cheapest active) 183-202 → `computePricing` (flash sale → coupon) 210-213 (`backend/src/lib/pricing.ts:204-223`) → money-integrity gate (finite, >0, discount ≥0) 231-238 |
| 7 | Wallet pre-check: user read + `currentBalance < finalPrice` → 400 | `checkout.service.ts:240-244` |
| 8 | Inventory fast-fail (cheap, outside tx) | `checkout.service.ts:246-262` |
| 9 | **Transaction** (`db.transaction`, 284): in-tx clock 297 → product freshness 314-330 → variant freshness 337-353 → flash-sale freshness 366-383 → inventory claim `FOR UPDATE SKIP LOCKED` (variant pool then generic pool) 397-428 → deliverability gate (GCM decrypt test) 446-459 → **conditional claim** `UPDATE … WHERE is_sold = false` 461-467 → **wallet CAS debit** (predicate on walletBalance + loyaltyPoints + lifetimeSpend) 469-499 → **coupon atomic-with-check increment** (`WHERE used_count < max_uses AND is_active AND (expires_at IS NULL OR > now)`) 501-549 → **order INSERT** (status `completed`, immutable delivered_* snapshot, walletBefore/After, amount, discountAmount) 551-584 → **ledger INSERT** (`purchase`) 588-602 → **idempotency-key claim INSERT** 612-614 |
| 10 | Catch → classified failures (INVENTORY_CLAIMED / COUPON_EXHAUSTED / OUT_OF_STOCK / CONCURRENCY_ERROR / STALE_FLASH_SALE / PRODUCT_STALE / VARIANT_STALE / IDEMPOTENT_CLAIM_CONFLICT / INVENTORY_CORRUPT) 618-682; coupon-maxed operator notify strictly post-commit 728-735 |
| 11 | Route success: 201 + `formatOrder` (credentials only while status=`completed`), Telegram notify + stock sweep; replay: 200 + `Idempotent-Replayed` | `routes/orders.ts:53,273-301` |
| 12 | Fulfillment = instant at commit: delivered credentials stored encrypted on the order row (there is no separate fulfillment step) | `checkout.service.ts:568-580` |
| 13 | Refund (admin): `PATCH /api/admin/orders/bulk-status` `status=refunded` → per-order `RefundService.refundOrder` — tx: status guard (completed→refunded, terminal) → wallet CAS credit (+ points reversal floored at 0, lifetimeSpend decrement) → null delivered credentials → ledger `refund` row | `backend/src/routes/admin/orders.ts:182-269`, `backend/src/services/refund.service.ts:83-291` |
| 14 | Wallet funding: manual topup (`POST /api/wallet/topups` → operator approve) or gateway (`createApprovedTopup`) — both: advisory-xact-lock per payment_reference + in-tx dup check + partial unique index + status-guarded flip + CAS credit + ledger `topup` | `backend/src/routes/wallet.ts:131-362`, `backend/src/services/topup.service.ts:57-190,192-504` |
| 15 | Points→LYD conversion: `POST /api/loyalty/convert-points` — strict int validation, in-tx read, CAS on points+balance, ledger `adjustment`/`loyalty_conversion` | `backend/src/routes/loyalty.ts:65-192` |

There is **no shipping cost model anywhere** (digital-credentials store; `grep -i shipping backend/src` = 0 hits). The prior-round "shipping idempotency keys" = wallet top-up (شحن المحفظة) submission replay guard, verified mounted at `routes/wallet.ts:135`.

### Text sequence diagram of checkout

```
 Buyer(B)                 Frontend checkout.tsx        Backend routes/orders.ts       checkout.service.ts / DB
   │  add to cart              │                              │                              │
   │──────────────────────────>| localStorage subnation_cart_v2│                              │
   │  open /checkout           │                              │                              │
   │──────────────────────────>| GET /api/auth/me (no-store)  │--> balance B₀                │
   │  coupon "تحقق"            │ POST /api/coupons/validate   │                              │
   │──────────────────────────>|  {code, order_amount=totalLYD} (DISPLAY ONLY)               │
   │  confirm                  │ for each line, for each unit │                              │
   │──────────────────────────>| POST /api/orders             │                              │
   │                           |  Idempotency-Key: K(unit)    │ Redis replay/in-flight       │
   │                           |  {product_id, variant_id,    │──requireUser──risksoft─────>│
   │                           |   coupon_code?}              │  zod (no price/qty)          │
   │                           │                              │                              │ pre-tx: replay lookup(u{B}:K)
   │                           │                              │                              │ read product/variant/user
   │                           │                              │                              │ computePricing (flash→coupon)
   │                           │                              │                              │ finalPrice>0 gate, balance pre-check
   │                           │                              │                              │ ┌─ BEGIN TX ────────────────┐
   │                           │                              │                              │ │ re-check product/variant/ │
   │                           │                              │                              │ │ sale freshness (stale→409)│
   │                           │                              │                              │ │ SELECT … FOR UPDATE       │
   │                           │                              │                              │ │  SKIP LOCKED (variant 1st)│
   │                           │                              │                              │ │ deliverable? (else 503)   │
   │                           │                              │                              │ │ UPDATE inventory          │
   │                           │                              │                              │ │  SET is_sold=true         │
   │                           │                              │                              │ │  WHERE is_sold=false      │
   │                           │                              │                              │ │ UPDATE users SET balance  │
   │                           │                              │                              │ │  … WHERE balance=B₀ AND   │
   │                           │                              │                              │ │  points=… AND spend=…     │
   │                           │                              │                              │ │ UPDATE coupons SET        │
   │                           │                              │                              │ │  used_count=used_count+1  │
   │                           │                              │                              │ │  WHERE used<max AND alive │
   │                           │                              │ 201 (or replay 200)          │ │ INSERT orders(completed)  │
   │                           │                              │                              │ │ INSERT wallet_ledger      │
   │                           │                              │                              │ │ INSERT idempotency_keys   │
   │                           │                              │                              │ └─ COMMIT ──────────────────┘
   │                           |<──────────────── 201 {order, delivered credentials}          │
   │  next unit … (sequential) │ cart synced to charged units; keys cleared at sync point     │
   │  (partial failure: banner + cart keeps un-bought remainder)                               │
   │  refund (operator)        │ PATCH /api/admin/orders/bulk-status {ids, status:"refunded"} │
   │──────────────────────────────────────────────────────────────────────>│ per order:
   │                                                                       │ refundOrder tx: completed→refunded
   │                                                                       │ wallet +amount (CAS), points−⌊amt⌋,
   │                                                                       │ credentials nulled, ledger refund
   │<── socket: order-updated / wallet-updated ───────────────────────────│
```

---

## 2. Concurrency: two simultaneous checkouts, same item, qty 1, stock 1

**Verdict: double-sale is NOT possible.** Walk:

- Both requests pass the cheap pre-tx stock probe (`checkout.service.ts:257-262`, both see the 1 unsold row — this probe is explicitly non-authoritative).
- Both open transactions. Buyer A's claim select `… ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED` (`397-427`) locks the row. Buyer B's SKIP LOCKED select **skips the locked row**, finds no other → `throw OUT_OF_STOCK` (line 428) → 404/409, no mutation.
- If B arrives after A commits: the claim select's `is_sold = false` predicate matches nothing → same OUT_OF_STOCK.
- Belt-and-braces: the claim is a **conditional update**, not read-then-write — `462-467`:
  ```ts
  const [inv] = await tx.update(inventoryTable)
    .set({ isSold: true, soldAt: now })
    .where(and(eq(inventoryTable.id, inventoryItem.id), eq(inventoryTable.isSold, false)))
    .returning();
  if (!inv) throw new Error("INVENTORY_CLAIMED");
  ```
- Quantity is always 1 per order (unit-credential model); a qty-N cart line is N sequential unit orders (`checkout.tsx:405-410`), so no `stock >= qty` decrement exists or is needed. There is no `updateMany` read-then-update anywhere on the money path.
- Wallet debit is optimistic CAS over the **full write set** (`470-499`): `WHERE id = userId AND wallet_balance = B₀ AND loyalty_points = P₀ AND lifetime_spend = S₀` — a concurrent same-user purchase/topup forces `CONCURRENCY_ERROR` (retryable 409) instead of a lost update or negative balance (the pre-tx balance check at 243-244 uses the same stale read the CAS pins, so a balance that dropped concurrently cannot yield a negative new balance — the CAS fails first).
- Same-key double-fire: Redis in-flight sentinel → 409 (`middlewares/idempotency.ts:160-170`); Redis absent → the in-tx `idempotency_keys` claim collides as SQLSTATE 23505 and rolls the whole tx back, then replays the winner (`checkout.service.ts:612-614,658-664,706-721`). Different-key duplicates are separate intents (each is a legitimate unit purchase).

## 3. Price re-validation — client trust check

**Prices are 100% server-authoritative.** `CreateOrderBody` accepts only `product_id`, `variant_id`, `coupon_code` (`shared/api-zod/src/generated/api.ts:439-448`). A tampered client cannot send `price=1`, a quantity, or an amount — there is no field to abuse. The charged `finalPrice` is computed from DB rows read in `checkout.service.ts:161-213` and re-validated in-tx for product/variant/flash-sale staleness (`314-383`, throwing `PRODUCT_STALE`/`VARIANT_STALE`/`STALE_FLASH_SALE` → 409 retryable). Coupon type/value/min/maxUses/expiry/active all come from the DB (`pricing.ts:137-189`) and are re-asserted at redemption time inside the tx (`checkout.service.ts:524-534`). Wallet balance is re-read from DB (line 240) and CAS-pinned (490-497). Shipping: no such field. The client's only money inputs are *which* product/variant/coupon — never *how much*.

## 4. Coupon redemption atomicity

- **Global usage-limit race (10 users, limit-10, simultaneous):** safe. The increment is atomic-with-check inside the purchase tx — `528-540`:
  ```ts
  const couponWhere = and(
    eq(couponsTable.id, appliedCoupon.id),
    couponStillValid, // is_active AND (expires_at IS NULL OR > now)  — captured in-tx (now = line 297)
    ...(appliedCoupon.maxUses === null ? [] : [sql`${couponsTable.usedCount} < ${appliedCoupon.maxUses}`]),
  );
  … .set({ usedCount: sql`${couponsTable.usedCount} + 1` }) …
  if (!updatedCoupon) throw new Error("COUPON_EXHAUSTED"); // rolls back debit+claim
  ```
  The 11th concurrent redeemer gets 0 rows → COUPON_EXHAUSTED → full rollback. Max=11 total redemptions is impossible.
- **Expiry:** validated pre-tx (`pricing.ts:154-157`) and re-asserted in-tx against the in-transaction clock (B2-05) — residual window is only the in-tx statements.
- **Stacking:** flash sale → coupon stacks *by design* (coupon computed on post-flash basePrice, `pricing.ts:204-212`); **multiple coupons do not stack** (one `couponCode` per order, `orders.ts:127-130`). Flash sales are site-global (no product scoping, `flash_sales.ts:14-34`) with an at-most-one-active partial unique index.
- **Coupon-on-top-of-wallet:** coupon reduces `finalPrice` before the wallet comparison — no partial-payment mode exists (all-or-nothing per unit).
- Gaps → findings F6 (per-user limits), F1 (preview vs per-unit application), F3 (refund burns the slot).

## 5. Wallet & ledger

- **Deduction atomicity:** CAS UPDATE in the purchase tx (`checkout.service.ts:469-499`) — never read-then-write. Negative balance: impossible via checkout (finalPrice > 0 gate + CAS); adjustments reject negative results (`adjustment.service.ts:177-179`); setBalance rejects negative targets (129-131).
- **Refund double-credit:** impossible. Refund is status-guarded (`refund.service.ts:109-111` early + `191-198` guarded flip `WHERE status='completed'`). Two concurrent admin refunds: the loser's guarded flip matches 0 rows → whole tx (including its wallet credit) rolls back → ALREADY_REFUNDED. The route is additionally behind the admin idempotency middleware (`admin/orders.ts:146`).
- **Ledger completeness:** every `wallet_balance` mutation found in the backend writes a ledger row in the same tx: purchase (`checkout.service.ts:588-602`), refund (`refund.service.ts:243-255`), topup approve (`topup.service.ts:380-392`), automated topup (`146-158`), admin adjust/setBalance (`adjustment.service.ts:204-216`), points→LYD conversion (`loyalty.ts:156-167`), referral signup 5 LYD (`ledger.ts:55-69`, called at `firebase-auth.service.ts:481`, `whatsapp-otp.service.ts:514`, `auth-settings.ts:448-450` — all guarded by `grantInstantReferralBonus`). Loyalty *points* awards (referral +50) carry no ledger row, but points are not wallet balance until converted, and the conversion itself is ledgered — acceptable.
- **Topup credit:** 4 layers (in-tx re-check + `pg_advisory_xact_lock(hashtextextended(ref))` + status-guarded flip + V1-M9 partial unique index on approved references, `topup.service.ts:229-266,331-338`) plus a composite (user, amount, network, sender, 24h) soft-dedup for typo'd references (`296-323`).

## 6. Order state machine

States (`schema/orders.ts:19-24`): `pending | completed | failed | refunded`.

Transitions actually written by production code:
- `∅ → completed` — purchase tx only (`checkout.service.ts:567`).
- `completed → refunded` — RefundService only, terminal.
- Admin bulk (`admin/orders.ts:294-301`): to `completed`: only from `completed` (no-op re-affirm, F3 guard); to `pending`/`failed`: from **anything not refunded — including `completed`**; `refunded` is terminal everywhere.
- No code writes `pending`/`failed` at creation; no cancel state exists; **no restock path exists anywhere** (`is_sold` is only ever set true — grep across backend/src: `checkout.service.ts:464` is the sole writer).

→ Finding F2 (illegal `completed→failed/pending` via admin), F4 (no restock, by design but worth pinning), F3 (refund side-effects).

## 7. Rounding / currency

Money lives in PG `numeric(10,2)` columns and is handled in JS as float via `parseFloat`/`toNumber` with `toFixed(2)` at every write (`numeric.ts:17-26`, `pricing.ts:214,231,241-242`, `checkout.service.ts:265,464-475`, `refund.service.ts:140`, `topup.service.ts:133,365`, `adjustment.service.ts:114,137,202`, `loyalty.ts:110,135`). Rounding points: flash price per unit (2dp), coupon amount per unit (2dp), final per unit (2dp), wallet before/after (2dp). No per-total rounding exists (each unit is its own order). Multi-quantity line totals are client-display only. `toFixed` rounds half-up-ish (float-repr quirks); the coupon amount is rounded *then* subtracted, so the customer never gets a double-favorable round at checkout. Retail LYD = cost×2×10 enforced at write time (`pricing-config.ts:68-70`, `computeRetailLYD`). Frontend mirrors `roundToCents` = `Math.round(x*100)/100` (`cart.tsx:64-66`). → F7 (float idiom, P3, acceptable at this scale but a standing hazard).

## 8. Order number / receipt

`generateOrderCode()` = `"SN" + randomBytes(6).toString("hex").toUpperCase()` (`crypto.ts:45-55`) — 48 bits CSPRNG, non-sequential, non-guessable (order enumeration impossible), backed by `orders.order_code` UNIQUE (`schema/orders.ts:30`). Collision → 23505 → raw 500 (money-safe rollback; probability negligible at 2⁴⁸). No receipt numbering beyond the order code.

## 9. Frontend mirrors

- Cart total (`cart.tsx:186`) and the coupon pre-validate result (`checkout.tsx:274-298`) are **display + button-gating only** — the wallet is charged by the server-computed per-unit `finalPrice`; the local total never reaches the charge. The `insufficient` gate (259-261) is advisory; the server re-checks balance (`checkout.service.ts:244`).
- The server cart (`routes/cart.ts`) is a documented-dead parallel surface for the storefront (`cart.tsx:55-59` comment; only a best-effort `DELETE /api/cart` remains) — the money path never reads it.
- Divergence risks → F1 (coupon preview math), F5 (stale price snapshots).

---

## Findings

### F1 — [P1] Coupon pre-flight (basket math) vs per-unit backend application diverge — deterministic checkout failure after a passing pre-flight
**Where:** `frontend/src/pages/checkout.tsx:274-298` (and 370-403 pre-flight) vs `backend/src/lib/pricing.ts:137-189` + `backend/src/services/checkout.service.ts:210-213,501-549`, loop at `checkout.tsx:405-417` (`if (couponCode) body.coupon_code = couponCode` on **every** unit).
**Evidence:** validate is called once with the basket total —
```ts
body: JSON.stringify({ code, order_amount: totalLYD }),   // checkout.tsx:281 / 383
```
while the backend resolves the coupon **per unit** against that unit's `basePrice` —
```ts
if (input.basePrice < minOrder) { … reason: "below_min_order" }   // pricing.ts:168-176
const appliedAmount = computeCouponDiscount(row.type, value, input.basePrice); // per-unit
```
**Scenario A (guaranteed full failure):** coupon with `min_order_amount = 30`, product 25 LYD, qty 3 (basket 75). Pre-flight: `75 ≥ 30` → "valid" ✅ → confirm → every unit order: `basePrice 25 < 30` → `INVALID_COUPON` 400 → loop breaks on unit 1 → banner "complete failure" — for a checkout the UI itself just green-lit. **Scenario B (fixed-coupon mis-charge vs label):** fixed 10 LYD coupon, product 25, qty 3 → label shows discount 10 / total 65; backend charges 3 × (25−10) = **45** and consumes 3 redemption slots; with `maxUses = 1` unit 1 succeeds (15) and units 2-3 fail COUPON_EXHAUSTED → partial purchase + forced full-price retry (15+50=65, but through a broken partial-failure path with a wrong intermediate label). Scenario B also skews the `insufficient` balance gate (comparisonTotal 65 blocks a balance-50 user whose real cost is 45).
**Fix:** make the pre-flight per-unit (validate each line's unit price, or add a `/api/orders/quote` endpoint that runs the exact per-unit pricing server-side for the whole basket) and render the label from the sum of per-unit finals; optionally cap coupon application to a single unit for fixed-type coupons (basket-level semantics) in `checkout.service.ts`.

### F2 — [P2] Admin bulk-status allows `completed → pending/failed`: irreversible, un-refundable, locks paid credentials
**Where:** `backend/src/routes/admin/orders.ts:294-301`.
**Evidence:**
```ts
const guard =
  status === "completed"
    ? and(inArray(ordersTable.id, numIds), eq(ordersTable.status, "completed"))
    : and(inArray(ordersTable.id, numIds), ne(ordersTable.status, "refunded"));
```
For target `pending`/`failed`, the only excluded source state is `refunded` — **`completed` is allowed**.
**Scenario:** an admin mis-picks "failed" for a paid+delivered order: (a) the buyer instantly loses access to their purchased credentials (`formatOrder` gates every delivered_* field on `status === "completed"`, `routes/orders.ts:53`); (b) the order can **never** be refunded — RefundService requires `completed` (`refund.service.ts:112-118`) and the F3 guard blocks re-entering `completed` — so the sanctioned money-return path is dead for that order; (c) no side effect fires (no wallet credit, no restock) → user paid, lost access, and support can only fix it by direct DB surgery. This is exactly the class the refunded/completed guards were added to close, one transition short.
**Fix:** restrict non-refund targets to source states `pending|failed` (`and(inArray(id,…), inArray(ordersTable.status, ["pending","failed"]))`), leaving `completed` reachable only from the purchase tx; keep `refunded` terminal.

### F3 — [P2] Refund permanently burns the coupon redemption slot (usedCount never returned)
**Where:** `backend/src/services/refund.service.ts:83-291` (no `couponsTable` write anywhere in the refund tx) vs the redemption increment `checkout.service.ts:535-540`; grep confirms `usedCount` is incremented in exactly one production statement and never decremented.
**Scenario:** a buyer uses the last slot of a `maxUses=1` coupon; the order is then refunded (bad delivery, goodwill). The coupon stays exhausted (`usedCount=1 = maxUses`) — the buyer who got their money back cannot use the coupon they "spent", and one unit of the campaign's budget is consumed by a sale that no longer exists. Repeated refund cycles on a `maxUses=10` campaign silently shrink the real budget to 0 while `used_count` says 10.
**Fix:** in the refund tx, when `order.couponCode` is set and status flips, run `UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE code = order.coupon_code AND used_count > 0` (same tx as the credit — exactly-once by the same status guard).

### F4 — [P3] No restock on refund/cancel anywhere (and no cancel state) — refunded units are permanently unsellable
**Where:** `refund.service.ts:203-236` (comment: *"the inventory row keeps its is_sold/sold_at history for reconciliation"*); repo-wide grep: `is_sold` is set `true` only at `checkout.service.ts:464` and never reset; admin inventory "set-count" only **deletes unsold surplus** (`admin/products.ts:414-429`).
**Scenario:** operator issues a goodwill refund on an order whose account is still perfectly good → that unit can never be resold; sellable stock monotonically decreases with every refund. (For INVENTORY_CORRUPT-class refunds not restocking is *correct* — the credential is dead.) Also answers the scope question directly: "restock on cancel exactly once" — there is no restock code at all, hence no double-restock risk either.
**Fix (policy, minimal):** add an explicit admin "re-list unit" action (single guarded `UPDATE inventory SET is_sold=false, sold_at=NULL WHERE id=? AND is_sold=true` keyed to a refunded order), or codify the never-restock policy in the ops runbook so operators reconcile stock manually.

### F5 — [P2] Cart price snapshots are never re-quoted at checkout — the confirmed label can be lower than the amount actually charged
**Where:** `frontend/src/lib/cart.tsx:19-20` (`priceLYD`, `salePriceLYD` captured at add time; refreshed only on re-add of the same line, 117-123), `totalLYD` at 186; `checkout.tsx` mounts with only a balance probe (196-241) — **no price refresh**; the backend charges from live DB rows (`checkout.service.ts:161-213`) with staleness guards that protect DB-read consistency, not display consistency.
**Scenario:** flash sale 20% active when the buyer adds a 100 LYD item (snapshot `salePriceLYD=80`); the sale ends; buyer confirms at the label "80.00 د.ل" → every unit charges the live list price 100 → user charged 20 more than the number they confirmed (opposite direction if a sale starts after add: charged less than label). Each unit's charge is internally correct, but the confirmation contract between label and charge is broken — a refund/complaint generator on the most sensitive screen.
**Fix:** on checkout mount, re-quote each line from the live catalog (products/variants + flash sale — the data `/api/cart` already assembles in `routes/cart.ts:58-100`) and show a "prices changed" reconciliation before enabling confirm.

### F6 — [P3] No per-user coupon redemption limit — one user can consume the whole global budget
**Where:** `shared/db/src/schema/coupons.ts:14-28` (only global `max_uses`/`used_count`; no per-user column, no redemption table); `checkout.service.ts:501-549` guards only the global counter.
**Scenario:** operator publishes a "first-order 20% off, 100 uses" coupon; a single scripted user with wallet balance buys 100 units (100 sequential unit orders, each +1 `used_count`) and exhausts the entire campaign; 99 other legit buyers see "تم استنفاد الكوبون". The atomicity is sound (F-006), but the *distribution* is unbounded per user.
**Fix (if the business wants per-user caps):** add `coupon_redemptions(coupon_id, user_id, order_id unique)` with `UNIQUE(coupon_id, user_id)` and an insert-with-check in the purchase tx mirroring the usedCount guard.

### F7 — [P3] Float money arithmetic end-to-end (parseFloat + toFixed) instead of integer cents/Decimal
**Where:** `backend/src/lib/numeric.ts:17-26`; all write points: `pricing.ts:214,231,241-242`, `checkout.service.ts:265,464-475`, `refund.service.ts:139-150`, `topup.service.ts:70,133,363-365`, `adjustment.service.ts:114,137,174,202`, `loyalty.ts:110,133-135`; frontend `cart.tsx:64-66`.
**Scenario:** every stage bounds error to <0.005 and ledger `balanceBefore/After` are written by the same arithmetic that computes the UPDATE, so reconstruction stays self-consistent at the current scale — but sub-cent drift between a long ledger sum and the stored balance is possible in principle, and `toFixed` half-rounding is float-repr-dependent (e.g. `(0.615).toFixed(2) === "0.61"`). Not a live money-loss vector today (verified: all comparisons happen on 2dp-rounded values).
**Fix (hardening):** convert at the boundaries — parse numeric strings to integer cents (`Math.round(parseFloat(s)*100)`), compute in cents, format on output; keep the numeric(10,2) columns as-is.

### F8 — [P3] Legacy percentage coupons with value ≥ 100% still 500 the checkout (fail-closed) — create/validate sides are already bounded
**Where:** bound added at create (`routes/coupons.ts:208-216`, rejects `value >= 100`) and at validate (`150-166`, rejects `final <= 0`), but `computeCouponDiscount` (`pricing.ts:239-243`) does not clamp percentage discounts to basePrice, so a legacy row with `value = 150` yields `discountAmount > basePrice` → negative `finalPrice` → checkout `INVALID_PRICE` → 500 (`routes/orders.ts:186-196`) with a "contact support" message.
**Scenario:** pre-bound seeded coupon (DB has legacy rows by the code's own admission — "legacy 100% coupons (created before the create-side bound)") applied at checkout → every attempt 500s; the operator has no admin surface to fix the *value* (PatchCouponBody only edits is_active/max_uses/expires_at/description, `coupons.ts:43-56`) — the coupon must be archived.
**Fix:** clamp in `computeCouponDiscount` percentage branch (`Math.min(appliedAmount, basePrice)` is NOT desired — instead reject `value > 100` in `resolveCoupon` like validate does) so the failure is a clean 400 INVALID_COUPON, consistent with /validate.

### F9 — [P3] `POINTS_PER_LYD` naming trap: purchase awards 1 pt/LYD hardcoded while the constant (100) means "points per LYD of value"
**Where:** `backend/src/services/checkout.service.ts:475` — `loyaltyPoints: user.loyaltyPoints + Math.floor(finalPrice)` (1 pt per LYD = 1% cashback at the 100:1 conversion) vs `backend/src/lib/loyalty-tiers.ts:9` — `export const POINTS_PER_LYD = 100` (used for conversion, `loyalty.ts:110`, and surfaced as `points_rate.points_per_lyd` in `loyalty.ts:61`).
**Scenario:** no user-visible lie today (the loyalty page's earn row says only "نقاط تلقائية", `loyalty.tsx:162-163`, and the conversion display "كل 100 نقطة = 1 د.ل" is correct) — but a future maintainer "fixing" the award to use the constant (`Math.floor(finalPrice * POINTS_PER_LYD)`) converts the program into **100% cashback** (award 100 pt/LYD, redeemable 1:1) — a silent money-loss vector waiting one refactor away.
**Fix:** rename the constant to `POINTS_PER_LYD_VALUE` (or introduce `EARN_POINTS_PER_LYD_SPENT = 1` and use it at `checkout.service.ts:475`), and assert the earn rate in a unit test so the two rates can never be conflated.

---

## Verified-safe summary (guards confirmed in code, not findings)

| Concern | Verdict | Anchor |
|---|---|---|
| Double-sale (2 buyers, stock 1) | Safe — FOR UPDATE SKIP LOCKED + conditional claim | `checkout.service.ts:397-428,461-467` |
| Client price tampering | Impossible — body has no price/qty/amount | `api-zod api.ts:439-448`, `orders.ts:123-130` |
| Price staleness at commit | Guarded in-tx (product/variant/flash) | `checkout.service.ts:314-383` |
| Coupon usage-limit race | Atomic-with-check increment + rollback | `checkout.service.ts:524-540` |
| Coupon expiry at redemption | Re-asserted in-tx against tx clock | `checkout.service.ts:297,524-527` |
| Wallet debit lost-update / negative balance | CAS on full write set | `checkout.service.ts:469-499` |
| Refund double-credit / idempotency | Status-guarded tx + admin idempotency middleware | `refund.service.ts:109-118,191-198`, `admin/orders.ts:146` |
| Refund loyalty reversal | Points floored at 0, lifetimeSpend symmetric | `refund.service.ts:145-150` |
| Topup double-credit | Advisory lock + in-tx dup + partial unique + guarded flip + composite dedup | `topup.service.ts:229-266,296-338` |
| Ledger completeness (every wallet mutation) | All 7 mutation families ledgered in-tx | see §5 |
| Order-code uniqueness/guessability | 48-bit CSPRNG + UNIQUE | `crypto.ts:45-55`, `schema/orders.ts:30` |
| Frontend total influencing payment | Display-only; server re-computes | `checkout.tsx:259-261`, `checkout.service.ts:244` |
| Durable idempotency (checkout) | Pre-tx replay + in-tx claim + Redis layer | `lib/idempotency.ts`, `checkout.service.ts:148-159,612-614` |
| Retail ×20 rule | Enforced at write time, single formula | `pricing-config.ts:68-70` |

## Counts

**P0: 0 · P1: 1 · P2: 3 · P3: 5 — total 9 findings.**

## Files audited (25 primary)

Backend: `services/checkout.service.ts` (full), `services/refund.service.ts` (full), `services/topup.service.ts` (full), `services/adjustment.service.ts` (full), `lib/pricing.ts` (full), `lib/numeric.ts` (full), `lib/idempotency.ts` (full), `lib/ledger.ts` (full), `lib/crypto.ts` (order code), `lib/pricing-config.ts`, `lib/loyalty-tiers.ts`, `middlewares/idempotency.ts` (full), `routes/orders.ts` (full), `routes/admin/orders.ts` (full), `routes/coupons.ts` (full), `routes/wallet.ts` (full), `routes/loyalty.ts` (full), `routes/cart.ts` (pricing half), `routes/auth-settings.ts` + `services/firebase-auth.service.ts` + `services/whatsapp-otp.service.ts` (ledger-parity spots), `routes/admin/products.ts` (inventory set-count).
Shared: `db/src/schema/{orders,coupons,flash_sales,inventory,users,wallet_ledger}.ts`, `api-zod/src/generated/api.ts` (CreateOrderBody).
Frontend: `lib/cart.tsx` (full), `pages/checkout.tsx` (full), `lib/idempotency.ts` (full), `lib/utils.ts` (formatCurrency), `pages/cart.tsx` + `pages/loyalty.tsx` + `pages/product.tsx` (relevant excerpts).

*Static audit only — no tests executed, no DB queried, no files modified except this report.*
