# PRICING ECONOMICS — the catalog money rules (R115)

> Companion to `docs/loyalty/FINAL_LOYALTY_POLICY.md`. Code truth:
> `backend/src/lib/pricing-config.ts` (rule engine) + `backend/src/lib/pricing.ts`
> (discount stack) + `backend/src/routes/admin/pricing-config.ts` (settings
> API + recompute).
>
> **R181 note:** the read-only admin calculator simulator (POST
> `/api/admin/pricing/calculate`, the SAFE/WATCH/THIN/LOSS margin states)
> was permanently retired in Round R181. This document now describes the
> pricing engine and its settings only.

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

The sellable unit of every pricing decision is the VARIANT (exact
`variant_id`); a product-level lookup resolves to its cheapest active
variant. The product-level cost column exists for legacy tooling only.

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
  every quote path (checkout and the live re-quote paths alike).
- Loyalty/referral/welcome are program costs, NOT transactional discounts — deliberately
  outside the cap and accounted separately: the loyalty reward liability accrues at 1%
  of the paid amount, and a referred buyer's first order carries the referral credit
  cost (5.50 LYD) — both per `docs/loyalty/FINAL_LOYALTY_POLICY.md`.
- Flash sales are GLOBAL by construction (single active row, ≤95%); coupons are global
  codes with min-order/max-uses/expiry guards. No per-product exclusions exist.

## 4. The live engine contract (never-regress)

Checkout, the cart re-quote, and the coupon preview all call the SAME
`computePricing()` (lib/pricing.ts) with the SAME list price source
(variant.price_lyd). Pinned by `economic-golden-matrix.test.ts` (P6).
If any quote path forks from the engine, that is a P0.

## 5. Refund economics

Refund credits `orders.amount` (the frozen final price) to the wallet, decrements the
coupon's used_count (budget restored), nulls delivered credentials, reverses the award's
unspent remainder precisely, and records `refunded_at/refund_amount/refunded_by_admin_id`
on the order (V1-M22). Net-zero round trip; no partial refunds yet (column-sized for them).

## 6. Operator guardrail checklist

1. Before any flash sale: check flash% against the cap — at ≥ cap%
   every coupon dies at checkout (`pricing.max_total_discount_pct`, default 50).
2. Before any coupon: percentage < 100 (create-side bound), and flash+coupon vs the cap.
3. Before recompute: run the dry-run; review the BEFORE→AFTER sample; the confirm shows
   the drift counts.
4. Manual price overrides: recorded on the variant (audit) but NOT flagged in schema —
   the amber drift badge in the variants dialog is the visible trace; recompute wipes
   drifted prices (disclosed in the confirm).
