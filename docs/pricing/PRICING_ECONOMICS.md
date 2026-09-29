# PRICING ECONOMICS — the catalog money rules (R115)

> Companion to `docs/loyalty/FINAL_LOYALTY_POLICY.md`. Code truth:
> `backend/src/lib/pricing-config.ts` (rule engine) + `backend/src/lib/pricing.ts`
> (discount stack) + `backend/src/routes/admin/pricing-calculator.ts` (simulator).

## 1. The retail rule (write-time enforced)

```
variant.price_lyd = cost_USD × (1 + markup_percent/100) × usd_to_lyd
defaults: markup 100% · rate 10  →  $1 → 20 LYD · $5 → 100 LYD
```

- Enforced at WRITE time (variant create/edit, bulk recompute). Reads (catalog,
  checkout) use the STORED price — the customer-facing number is stable and auditable.
- Overrides: `system_settings` (`pricing.usd_to_lyd`, `pricing.markup_percent`),
  60s in-process cache, validated bounds (rate 0.1–1000, markup 0–10,000%).
- A config change propagates ONLY when the operator runs the recompute — which now has
  a dry-run preview (counts + BEFORE→AFTER sample) and records per-variant before/after
  values on the audit row.

## 2. Price/cost truth map (Part 13 — never mix levels again)

| Level | Price | Cost |
|---|---|---|
| VARIANT (the sellable unit) | `price_lyd` (what checkout charges) | `cost_price` (USD) × rate |
| PRODUCT (denormalized display) | `price` = MIN(active variants) | `cost_price` — **NULL across the live catalog; do not use for economics** |

The admin calculator is VARIANT-aware: `variant_id` (exact) → `product_id` (cheapest
active variant, labeled) → manual sandbox (explicit LYD pair). The product-level cost
column exists for legacy tooling only.

## 3. The discount stack + the combined cap (Part 14)

```
basePrice  = list × (1 − flash%/100)                  // one active global flash max
coupon     = percentage: base × v/100 | fixed: min(v, base)
cap        = flash% + coupon%/list  ≤  max_total_discount_pct (default 50)
             → past the cap the COUPON is rejected: total_discount_cap (clean 400)
finalPrice = base − coupon                            (≥ 0 always)
```

- The cap is the mathematical no-loss line at the catalog's uniform 100% markup
  (list = 2×cost ⇒ half off = cost). Bounds 10–95, operator-settable
  (`pricing.max_total_discount_pct`), enforced at the single choke point shared by
  checkout AND the calculator.
- Loyalty/referral/welcome are program costs, NOT transactional discounts — deliberately
  outside the cap and modeled separately by the calculator.
- Flash sales are GLOBAL by construction (single active row, ≤95%); coupons are global
  codes with min-order/max-uses/expiry guards. No per-product exclusions exist.

## 4. Margin vocabulary (the calculator's risk states)

| State | Condition | Meaning |
|---|---|---|
| SAFE | gross% ≥ 15 | healthy |
| WATCH | 5 ≤ gross% < 15 | monitor |
| THIN | 0 < gross% < 5 | review pricing |
| LOSS | gross ≤ 0 | selling under cost |

`gross = finalPrice − cost_LYD` (variant cost × rate — currency-correct).
`contribution = gross − reward_liability(1% of paid) − referral_cost(5.50 when simulated)`.
The calculator also returns: worst-case (cap-bounded stack) price/gross/contribution,
break-even price, program-inclusive safe minimum, and max safe discount %.

## 5. Checkout ↔ calculator parity (a never-regress contract)

Both call the SAME `computePricing()` (lib/pricing.ts) with the SAME list price source
(variant.price_lyd). Pinned by `economic-golden-matrix.test.ts` (P6) and the calculator
suite. If either side forks, that is a P0.

## 6. Refund economics

Refund credits `orders.amount` (the frozen final price) to the wallet, decrements the
coupon's used_count (budget restored), nulls delivered credentials, reverses the award's
unspent remainder precisely, and records `refunded_at/refund_amount/refunded_by_admin_id`
on the order (V1-M22). Net-zero round trip; no partial refunds yet (column-sized for them).

## 7. Operator guardrail checklist

1. Before any flash sale: check the calculator's `flash_exhausts_cap` warning — at ≥ cap%
   every coupon dies at checkout.
2. Before any coupon: percentage < 100 (create-side bound), and flash+coupon vs the cap.
3. Before recompute: run the dry-run; review the BEFORE→AFTER sample; the confirm shows
   the drift counts.
4. Manual price overrides: recorded on the variant (audit) but NOT flagged in schema —
   the amber drift badge in the variants dialog is the visible trace; recompute wipes
   drifted prices (disclosed in the confirm).
