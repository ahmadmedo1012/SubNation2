# LOYALTY ECONOMICS — the financial model behind the policy (R115)

> Companion to `FINAL_LOYALTY_POLICY.md`. Grounded in the LIVE read-only reconciliation
> of 2026-09-29 (263 active variants, 17 users, 7 orders, uniform 100% markup × rate 10).

## 1. The five cost classes — never confuse them

| Class | What it is | When it costs |
|---|---|---|
| TRANSACTIONAL DISCOUNT | flash + coupon off the list price | at the sale, reduces revenue |
| LOYALTY LIABILITY | earned points' full-redemption value | at conversion (accrues at sale) |
| CUSTOMER ACQUISITION COST | welcome 5 + referrer 0.50 per referred first topup | once per referred customer |
| EXPECTED REALIZED COST | discounts + liability × redemption rate + acquisition | planning number |
| ACCOUNTING LIABILITY | Σ unconverted points / 100 | the balance-sheet number |

Redemption-rate assumption: until real data exists, model CONSERVATIVELY at 100%
(full redemption) — the liability is small enough that the assumption is safe.

## 2. Live baseline (2026-09-29)

- 263 active variants, ALL exactly `cost × 2 × 10` (zero overrides) → **uniform 50% gross
  margin**; cheapest 59.80 LYD retail / 29.90 LYD cost; widest spread 1,380 → 39,980 LYD.
- Points liability: 240 points total = **2.28 LYD** (17 users, all bronze).
- No referral events ever; max active coupon 10%; no active flash sale.
- Orders to date: 5 completed (241.49 LYD) + 2 refunded (160.00 LYD).

## 3. Per-variant economics (the Part 5 matrix, live-verified)

For EVERY variant (uniform by construction at 100% markup):
```
list        = cost_USD × (1 + markup) × rate     // = 2 × cost_LYD
gross       = list − cost_LYD                     = cost_LYD        (50%)
reward      = floor(list)/100                     ≈ 1% of list
contribution(gross − reward)                      ≈ 49% of list
```
Worst ALLOWED stack (cap 50%): price = cost → gross 0 → contribution = −reward (−0.29 on
the cheapest item) → flagged LOSS in the calculator, never silent (the cap makes deeper
stacks structurally impossible at checkout).

## 4. The 10 scenarios (live numbers, cheapest variant 59.80 / cost 29.90)

| # | Scenario | Final | Gross | Reward liab. | Referral cost | Contribution | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Normal sale | 59.80 | 29.90 | 0.59 | — | 29.31 | SAFE |
| 2 | Flash at cap (50%) | 29.90 | 0 | 0.29 | — | −0.29 | LOSS-flagged, cap-bounded |
| 3 | Coupon 10% (live max) | 53.82 | 23.92 | 0.53 | — | 23.39 | SAFE |
| 4 | Flash + coupon at cap | 29.90 | 0 | 0.29 | — | −0.29 | LOSS-flagged, cap-bounded |
| 5 | Normal + liability | 59.80 | 29.90 | 0.59 | — | 29.31 | SAFE |
| 6 | Promo + liability | 53.82 | 23.92 | 0.53 | — | 23.39 | SAFE |
| 7 | Referred acquisition | 59.80 | 29.90 | 0.59 | 5.50 | 23.81 | SAFE |
| 8 | Referred + coupon | 53.82 | 23.92 | 0.53 | 5.50 | 17.89 | SAFE |
| 9 | Referred + promo at cap | 29.90 | 0 | 0.29 | 5.50 | −5.79 | LOSS-flagged, cap-bounded |
| 10 | Refund after reward | — | — | −(unspent remainder) | — | exact unwind | neutral |

"Does this remain financially safe?" — YES everywhere the guardrails allow; the only
negative-contribution shapes are at the CAP ITSELF (a deliberate, surfaced, bounded
operator choice — a 50% stack sells at cost and eats only the reward liability).

## 5. Break-even + safe ceilings (formulas)

```
break_even_price        = cost_LYD
safe_min_price_incl_program:
    p × (1−f) × (1−c) × (1 − 1/POINTS_PER_LYD) = cost_LYD + referral_cost
    → p = (29.90 + 5.50) / (0.5 × 0.99) ≈ 71.52 LYD for the cheapest variant
max_safe_discount_pct   = (1 − cost/list) × 100 = 50% at uniform markup
```
All three are computed per-variant by the admin calculator (`guardrails` block).

## 6. Program-level budget view

- Reward liability ≈ 1% of revenue (2% of gross). At the current scale this is noise
  (2.28 LYD outstanding). At 10,000 LYD/month revenue: ~100 LYD liability, ~200 LYD
  program cost against ~5,000 LYD gross — sustainable.
- Acquisition: 5.50 LYD per referred customer, paid ONLY after their first approved
  topup (a paid, fraud-gated event) — self-liquidating against any first purchase's
  gross (minimum gross at allowed prices ≈ cost, e.g. 29.90 LYD > 5.50).
