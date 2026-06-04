# Phase 0 Research — Inventory Demand Forecasting

**Feature**: 011-inventory-demand-forecast
**Date**: 2026-06-04
**Status**: complete

This document resolves every decision point that the spec deferred to design time. There are no `NEEDS CLARIFICATION` markers — each numbered research note (R-N) records a decision, the rationale, and the alternatives we rejected.

---

## R-1. Forecasting algorithm for v1

**Decision**: 14-day rolling daily-sales mean × day-of-week multiplier × seasonal envelope (none in v1; placeholder for v1.1).

For each product, on each daily run:

1. Pull the last 14 days of `orders` rows for that product (one order = one unit sold, matches the existing single-credential-per-order schema).
2. Compute `avg_daily_sales = (orders in last 14 days) / 14`.
3. Compute `dow_multiplier = (orders on this DoW in last 4 weeks) / (avg sales over the same 4 weeks per day)`. Default to 1.0 if either denominator is zero.
4. Compute `predicted_demand_7d = round(avg_daily_sales * dow_blend_7d * 7)` where `dow_blend_7d` averages multipliers across the next 7 days.
5. Compute `predicted_demand_30d` analogously over 30 days.
6. Compute `predicted_runout_at = today + floor(current_stock_on_hand / max(avg_daily_sales, 0.1))`. Clamp to today on the lower end and 90 days on the upper end.
7. Confidence band:
   - `high` if 14 days of history AND coefficient-of-variation of daily sales < 0.5
   - `medium` if 14 days but CV ≥ 0.5
   - `low` if 14 days but ≥ 7 zero-sales days

**Rationale**: The classical-stats baseline costs essentially nothing to compute (one query per product, plain arithmetic), is trivially auditable (FR-explainability), and gives admins a defensible "why" before we layer anything more complex on top. The 14-day window is short enough to react to recent demand shifts but long enough to dampen single-day noise; matches the spec's data-sufficiency floor. The DoW multiplier is the simplest seasonality control that addresses the obvious weekly pattern in subscription marketplace traffic without needing per-product seasonality models.

**Alternatives considered**:

- **ARIMA / exponential smoothing**: rejected for v1. Marginally more accurate on smooth time series but requires per-product parameter fitting, breaks down on sparse-sales products, and adds a non-trivial library dependency. Re-evaluate after pilot calibration.
- **LightGBM / small ML model (assessment §A4 alternative path)**: rejected for v1. Cost-band justified at the assessment layer, but requires ≥ 500 labeled stockout events to train responsibly; we don't have that history yet. The pilot generates the data; v2 may revisit.
- **Naive last-7-days-only mean**: rejected. Too noisy on weekend-heavy sales patterns; pilot would underperform SC-001's 70% capture target.
- **Constant default per category**: rejected. No statistical defensibility, can't pass FR-explainability.

---

## R-2. Recommended reorder quantity formula

**Decision**: `reorder_qty = max(0, predicted_demand_30d * 1.2 - current_stock_on_hand)`.

The 1.2 multiplier is a safety-stock factor; the 30-day horizon matches the typical supplier replenishment cadence the assessment cited.

**Rationale**: Cheap, defensible, surfaces a single number the admin can act on without a calculator. The 20% safety stock covers DoW variance over the next month and the typical ±1-day order-arrival jitter. Floored at zero so a well-stocked product surfaces "no reorder needed" instead of a negative number.

**Alternatives considered**:

- **Newsvendor-style stockout-cost optimization**: too much config (per-product margin, holding cost) for an admin to maintain in v1.
- **Lead-time-aware (Z-score safety stock = z * σ * √L)**: requires a per-supplier lead-time field that doesn't exist in the schema. Add when supplier data lands.

---

## R-3. Alert dispatch and dedupe

**Decision**: Reuse the existing `admin_alerts` table + `alerting.service.ts` dispatch (the same path the reactive low-stock cron and the new risk-events critical alerts use). Add a new `type` literal `forecast_stockout`. Dedupe on `forecast_stockout|<productId>` with a 7-day TTL via Redis NX (matches the existing dedupKey convention used by `sendCriticalRiskAlert`).

Per-run alert volume is hard-capped at 50 rows (FR-ALERT-005) — if the daily job would emit more, it logs the cap-hit, audits it, and stops emitting alerts for that run while still writing the forecast rows.

**Rationale**: Constitution §IV ("defense in depth via existing controls") + §V ("no new alert channel without operator buy-in"). Reusing the channel means admins already have notification routing, mute rules, and on-call awareness. The volume cap is the same backstop pattern as the constitution's rate-limit catalog.

**Alternatives considered**:

- **Direct Discord webhook from the forecast cron**: rejected. Bypasses the dedupe + audit infrastructure; violates §IV.
- **No dedupe (always alert)**: rejected. A product at-risk three days running would fire three identical alerts, drowning real signal.

---

## R-4. AI Admin Copilot integration shape

**Decision**: Add a `forecast_demand` read tool to the copilot's read-tool catalog (`backend/src/services/copilot/tools/read.ts`), gated on the existing `inventory` scope. Tool returns rows from `inventory_forecasts` only — never invents a forecast. The system prompt's existing no-fabrication discipline (010-ai-admin-copilot, R-3) extends to this tool by virtue of the same pattern: cite product IDs verbatim from tool output.

The tool exposes a `panel_url` per row pointing at `/admin/products?highlight=<id>` so the copilot's reply can deep-link the admin into the panel — the same convention the `query_risk_events` bridge tool established.

**Rationale**: Consistent with the existing copilot tool catalog convention. No new copilot subsystem needed. The tool is read-only by design (no draft variant, no execute path).

**Alternatives considered**:

- **A draft tool that lets the copilot suggest a reorder action**: out of scope per FR-SAFETY-001 — admins always decide.
- **A separate copilot endpoint outside the read-tool catalog**: rejected — would duplicate auth, scope, rate-limit infrastructure for no benefit.

---

## R-5. Admin panel layout & RTL

**Decision**: Mount a `StockoutRiskPanel` component above the existing product list at `frontend/src/pages/admin/products.tsx`. The panel collapses by default when zero products are at risk so it doesn't waste vertical space. RTL-aware: the explanation drawer slides from the appropriate edge based on the document direction; numeric content (predicted runout days, reorder quantity) is rendered LTR inside an inline-LTR span to avoid Arabic/Latin-numeral mixing artifacts.

**Rationale**: Constitution §Arabic-First UX. Matches the layout patterns the 003 risk module and 010 copilot already use.

**Alternatives considered**:

- **A dedicated `/admin/forecast` page**: rejected. Forces the admin to context-switch away from the product list to act on the prediction; the value of the forecast is greatest right where the products live.
- **A modal overlay**: rejected. Modals interrupt scanning; the panel-above-list pattern is the existing admin convention.

---

## R-6. Cron schedule and tier discipline

**Decision**: Daily at 02:15 UTC on the existing `subnation-worker` tier. The job short-circuits with a structured warn log if `process.env.WORKER_TIER !== "true"` so the web tier accidentally running it is impossible.

The existing `low_stock` cron fires at 00:00 UTC, the WhatsApp OTP cleanup at minute 15 hourly, the copilot reaper every 5 minutes; 02:15 is chosen to land outside all three so no two heavy jobs compete for DB resources at the same instant.

**Rationale**: Constitution §V scheduling rule. The existing cron registry in `backend/src/jobs/cron.ts` is the home; we add one new schedule entry that calls `runForecast()`.

**Alternatives considered**:

- **Triggered on each order**: rejected — violates FR-FORECAST-005.
- **Twice daily**: rejected for v1 — over-spends the worker tier's idle budget for a marginal recency improvement; revisit if pilot calibration argues for it.

---

## R-7. Retention & back-testing

**Decision**: Retain `inventory_forecasts` rows for 90 days. Daily cron at 03:30 UTC purges rows older than that; the job lives in `backend/src/jobs/forecast-retention.ts`. The 14-day pilot calibration analysis (SC-001 + SC-008) reads the retained history.

**Rationale**: Matches the 003 risk-events 90-day retention policy. 90 days of daily forecasts × 10k products = ~900k rows — comfortable Postgres scale, well below the kind of footprint that would warrant partitioning.

**Alternatives considered**:

- **30-day retention**: too short — the pilot itself spans 14 days, and we want at least one full month of comparison-baseline history.
- **Indefinite retention**: unnecessary — back-testing more than 90 days of stale forecasts adds nothing once the algorithm has stabilized.

---

## R-8. Capture-rate measurement (kill-criterion)

**Decision**: A daily reconciliation query (added to `backend/src/jobs/forecast-retention.ts` next to the purge) counts:

```text
captured = COUNT(DISTINCT product) where:
  - inventory_forecasts row from ≤14 days ago
  - that row predicted runout within 3 days at confidence ≥ 0.7
  - the product actually went to zero stock within the predicted window
total_stockouts = COUNT(DISTINCT product) that went to zero stock in the window
capture_rate = captured / total_stockouts
```

When `capture_rate < 0.5` over a rolling 14-day window, the job writes a flag in Redis (`forecast:alerts:paused`, no TTL) that the alert dispatcher consults at runtime; the panel surfaces a "calibrating — alerts paused" badge. An admin manually clears the flag once the algorithm is re-tuned (no auto-resume in v1 — calibration regressions deserve a human signal).

**Rationale**: SC-008 makes this a hard requirement. The Redis flag is the same shape as the 003 risk-pipeline degraded flag, so the operational pattern is already familiar.

**Alternatives considered**:

- **Email the admin instead of pausing alerts**: rejected — passes the responsibility to humans during the moment they're already losing trust in the system.
- **Rolling 7-day window**: too short — small sample sizes (a handful of stockouts) would falsely trip the kill criterion.

---

## R-9. Performance budget for the daily job

**Decision**: Single batched SQL query computes per-product daily-sales aggregates over the last 14 days; results are streamed into a plain JS map and fed to the per-product math. One bulk insert writes all forecast rows in one transaction (with a chunked fallback if the catalog ever exceeds Postgres's parameter limit).

Expected latency on 10k products: aggregate query ≤ 2s, math + bulk insert ≤ 1s. Total run < 5s — well under the 5-minute budget (SC-005).

**Rationale**: Single-query aggregate keeps DB round-trips constant. The math is O(N) in catalog size with tiny constants. Chunked insert is the standard idempotency pattern.

**Alternatives considered**:

- **N×SELECT-then-INSERT per product**: would multiply round-trips into the thousands and routinely blow the 5-minute budget on full catalogs.
- **Materialized view refresh**: more brittle (refresh-on-schedule semantics, lock-during-refresh) than the explicit job we already have.

---

## R-10. "Insufficient data" path

**Decision**: For products with < 14 days of order history (measured as: first `orders` row for the product is < 14 days old), write an `inventory_forecasts` row with `predicted_runout_at = NULL`, `predicted_demand_7d = NULL`, `predicted_demand_30d = NULL`, `confidence = 'insufficient_data'`, and `recommended_reorder_qty = NULL`.

Both the panel and the copilot tool render a "بيانات غير كافية" (insufficient data) badge for these rows and show how many days of history are currently available — never a guess.

**Rationale**: FR-FORECAST-003 requires no fabrication. Storing the row (with NULL forecasts) instead of skipping the product entirely lets the explanation drawer answer "why is this product not forecasted?" with audited data — without forcing the panel to re-query elsewhere.

**Alternatives considered**:

- **Skip the row entirely**: rejected. The panel would have to re-query `products` joined with `inventory_forecasts` to surface the explanation, and the copilot would need a separate "is this product forecasted?" code path.
- **Bootstrap with a category-average prediction**: rejected — this IS fabrication. The whole point of the floor is to refuse to guess.

---

**Status**: All decisions resolved. Ready for Phase 1 (data-model.md + contracts/).
