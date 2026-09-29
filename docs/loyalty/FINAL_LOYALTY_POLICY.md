# FINAL LOYALTY POLICY — the single source of truth (R115)

> Status: ACTIVE POLICY. Implementation: `backend/src/lib/loyalty-policy.ts` (code), this
> document (policy). If they disagree, the CODE wins and this document is a bug.
> Live-catalog model grounding: `LOYALTY_ECONOMICS.md` (same directory).

## 1. Constants (single-sourced in lib/loyalty-policy.ts)

| Constant | Value | Meaning |
|---|---|---|
| `POINTS_PER_LYD` | 100 | points required for 1.00 LYD wallet credit (redemption rate) |
| `POINTS_PER_REFERRAL` | 50 | referrer reward per credited referral (0.50 LYD value) |
| `WELCOME_BONUS_LYD` | 5.00 | referred user's wallet credit (granted on first approved topup) |
| `TIER_THRESHOLDS` | silver 500 · gold 2,000 · platinum 5,000 LYD | net qualifying spend ladder |

## 2. Earn — exact formula

```
points_awarded = floor(final_paid_price)        // 1 point per 1 LYD paid
```

- Applied at checkout (`checkout.service.ts`) to the FINAL paid price — flash-sale and
  coupon discounts reduce the paid price and therefore the award. Rounding DOWN is the
  house-favorable side.
- Attributed: one `points_ledger` row (`purchase_award`, reference = the order id) in the
  SAME transaction as the balance write. The partial UNIQUE `(type, reference_id)` makes a
  double award for one order structurally impossible.
- Nominal cashback: **1% of paid** (100 points → 1.00 LYD via conversion).

## 3. Redeem — exact formula

```
convertible     = points ≥ 100 AND points ≡ 0 (mod 100)   // whole bundles only
lyd_credited    = points / 100
```

- Route: `POST /api/loyalty/convert-points` (idempotent — middleware + durable claim).
- Attributed: `points_ledger` `conversion_out` row, `lyd_credited` pins the rate IN-ROW
  (a future rate change never rewrites history), linked to the `wallet_ledger` row it
  produced (reference = that row's id).

## 4. Referral — exact policy (R115 policy B, all channels unified)

```
signup (Google / WhatsApp / Telegram):
    referred_by recorded + referral_events row (status 'pending')
    NOTHING granted            // no instant credit on ANY channel

first APPROVED topup (manual admin approval = the fraud gate):
    referee  → +5.00 LYD wallet  (wallet_ledger referral_credit, ref welcome_bonus)
    referrer → +50 points        (points_ledger referral_credit, ref the referral_event)
    both in ONE transaction; users.welcome_bonus_granted is the exactly-once guard
```

Why: the pre-R115 split (Google/WhatsApp instant + Telegram never) was simultaneously a
farming vector (free spendable credit per free account) and a broken promise. Policy B
makes every referral credit ride a manually-approved payment. The trigger is stated
honestly in the UI («عند اعتماد أول شحن»).

## 5. Tiers — exact rules

- **Strictly derived** from `lifetimeSpend` (net qualifying spend): thresholds 500 /
  2,000 / 5,000 LYD. `computeTier()` is the only writer path; the admin manual tier edit
  is REJECTED (400) — a manual value was silently clobbered by the next purchase/refund.
- Benefits: none implemented (progress markers). The UI never promises unimplemented perks.
- Refunds recompute the tier from the reduced spend (downgrades are expected behavior).

## 6. Lifetime spend semantics

`lifetimeSpend` = **net qualifying spend** = Σ completed order amounts − Σ refunded
amounts (floored at 0). Writers: checkout (+finalPrice), refund service (−amount).

## 7. Refund — exact reversal policy (Part 9)

```
awarded        = the order's purchase_award ledger row
                 (pre-ledger orders: floor(orders.amount) — the frozen formula)
alreadyRevoked = prior refund_reversal for this order (unique per order)
remaining      = FIFO replay: conversions consumed the OLDEST points first;
                 the order's award remainder = what is still in the pool
revoke         = min(remaining, current balance)      // floored at 0
```

- **Unrelated points are untouchable**: referral/welcome/admin points can never be
  revoked for another order's refund (the FIFO remainder only counts the order's own award).
- **Converted value is NOT clawed back from the wallet** — documented, admin-gated
  business cost (bounded by 1% of the refunded amount in the worst convert-then-refund cycle).
- Attribution: `refund_reversal` row (negative delta) + `orders.refunded_at`,
  `refund_amount`, `refunded_by_admin_id` (V1-M22) — all in the same transaction.
- Degradation: after an `admin_set` rebalance the per-source FIFO is no longer provable →
  bounded-cap fallback (revoke at most awarded − alreadyRevoked). Opening-balance
  `correction` rows (V1-M21) stay FIFO-transparent (they are inflows).

## 8. Attribution ledger (Part 8)

`points_ledger` (V1-M21) — append-only, NEVER deleted (excluded from all retention):
`purchase_award · refund_reversal · referral_credit · conversion_out · admin_set ·
correction` with `points_before/after/delta` (DB CHECKs: after = before + delta,
balances ≥ 0, delta ≠ 0), `reason` mandatory for admin_set/correction, and the
structural exactly-once partial UNIQUE `(type, reference_id) WHERE reference_id IS NOT
NULL`. `users.loyalty_points` remains the cached balance (CHECK ≥ 0); reconciliation:
balance = latest row's `points_after` = Σ deltas. User-facing views:
`GET /api/loyalty/ledger` (history), `GET /api/wallet/ledger` (statement).

## 9. Rounding, minimums, maximums

- Awards: `floor` (down). Redemption: whole hundreds only, min 100. Conversion credit:
  2-dp half-up (`round2`) — the money-pipeline idiom.
- Admin-set bounds: 0–10,000,000 points; reason (note) ≥ 3 chars MANDATORY; finance
  scope required. Wallet adjustments: AdjustmentService (caps + ledger + CAS).

## 10. Abuse limits (layered)

1. Welcome bonus + referrer credit: both gated on a manually-approved PAID topup
   (per-referee once — `referral_events.refereeId` UNIQUE + `welcome_bonus_granted` flag).
2. Conversion: whole-bundle, balance-checked, CAS + durable idempotency.
3. Checkout award: idempotency-keyed (durable claim) + per-order ledger unique.
4. Admin grants: finance scope + mandatory reason + attributed ledger row + audit values.
5. Promo stacking: see `PRICING_ECONOMICS.md` (combined-discount cap).

## 11. Policy comparison (the Part 6 model, for the record)

| Policy | Earn | Liability | Verdict |
|---|---|---|---|
| **A (adopted)** | 1 pt/LYD (1% cashback) | 1% of revenue = 2% of gross profit (50% margin) | simple, sustainable, tested, honest |
| B lower (0.5%) | ~1% of gross | marginal saving, worse customer clarity | rejected |
| C higher (2%) | 4% of gross | still safe today, halves margin headroom under promos | rejected |
| D tiered earn | varies | complexity + refund asymmetry + UI confusion | rejected |
| E points-only perks | 0 LYD | zero liability but a loyalty program that lies | rejected |
| F hybrid | mixed | double accounting surface, no added goal | rejected |

Chosen for: customer clarity + sustainable economics + simple accounting + abuse
resistance + refund safety (the spec's five criteria). The live model (263 variants,
uniform 50% margin) proves A's worst-case stack stays contribution-positive even with a
referred first purchase.
