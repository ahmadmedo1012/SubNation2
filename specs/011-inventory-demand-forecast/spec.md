# Feature Specification: Inventory Demand Forecasting

**Feature Branch**: `011-inventory-demand-forecast`

**Created**: 2026-06-04

**Status**: Draft

**Input**: AI Opportunity Assessment §7.1, opportunity A4 — operator-facing, batched statistical forecasting layered on the existing orders/inventory/products tables. Goal: predict which products will run out and when so admins can restock before customers see a stockout.

---

## User Scenarios & Testing _(mandatory)_

> All "users" in this spec are SubNation operators (the founder + core admins). The customer-facing surface is intentionally untouched — legitimate buyers see no forecast, no "only N left" UI; the existing storefront keeps its authoritative `inventory.is_sold = false` count behavior.

### User Story 1 — Spot products at risk of stockout (Priority: P1) 🎯 MVP

An admin opens `/admin/products` and within five seconds can answer: which products are most at risk of running out, and when. A "خطر النفاد" (stockout risk) panel above the existing product table lists the top N products with the predicted runout date, the recommended reorder quantity, and a direct link to the product's inventory page.

**Why this priority**: Stockouts are a known operational gap (PROJECT_OVERVIEW §8). Without this view, restock decisions are reactive — admins find out only after customers fail to check out, by which point revenue and trust are already lost. The list view is the smallest possible slice that delivers the predictive value.

**Independent Test**: Run the daily forecast against a fixture catalog with three obvious patterns (a fast-mover with 10 stock, a slow-mover with 100 stock, a brand-new product with no history). Open `/admin/products`. The fast-mover ranks at the top of the risk panel with a runout date inside the next 7 days; the slow-mover does not appear; the new product surfaces with a "بيانات غير كافية" (insufficient data) badge instead of a prediction.

**Acceptance Scenarios**:

1. **Given** the daily forecast has run today, **When** an admin opens `/admin/products`, **Then** the risk panel shows up to 10 products ordered by predicted-days-until-stockout ascending, each row carrying product name, current stock count, predicted runout date, recommended reorder quantity, and a "آخر تحديث" (last updated) timestamp.
2. **Given** a product has fewer than 14 days of order history, **When** the forecast runs, **Then** the row is rendered with an "insufficient data" indicator and no runout date — never an unconditioned guess.
3. **Given** the worker tier has not run the forecast for more than 24 hours (cron failure), **When** an admin opens the panel, **Then** a degraded-mode banner explains the data is stale and shows the last successful run timestamp.
4. **Given** an admin clicks a product row in the risk panel, **When** the page transitions, **Then** they land on the existing product-edit / inventory page for that product with no new admin route added.

---

### User Story 2 — Ask the copilot in natural language (Priority: P2)

An admin asks the AI Admin Copilot in Arabic ("أي منتجات على وشك أن تنفد الأسبوع القادم؟" / "what products will run out next week?"). The copilot calls a `forecast_demand` read tool, returns a grounded answer citing product IDs verbatim from the `inventory_forecasts` table, and offers to open the relevant rows. No fabrication: every product mentioned by the model must come from the tool output.

**Why this priority**: The copilot is already the place admins ask operational questions. Wiring forecasting in there means admins don't need to remember a new dashboard exists — they just ask. Lower priority than US1 because the panel itself is the authoritative surface; the copilot is discoverability + Arabic-language convenience.

**Independent Test**: Phase 1 copilot enabled. Admin asks "show me products at risk of running out". Copilot calls `forecast_demand`, gets back a list, and replies with product IDs + names + runout dates that match a direct query against `inventory_forecasts`. Asking for a non-existent product returns "no forecast available" rather than an invented row.

**Acceptance Scenarios**:

1. **Given** the copilot has the `inventory` scope and the daily forecast has run, **When** the admin asks "what's at risk of stockout this week?", **Then** the copilot calls `forecast_demand`, replies with rows where `predicted_runout_at` is within 7 days, and never invents a product.
2. **Given** the copilot is asked about a specific product by name, **When** it calls `forecast_demand` with a filter, **Then** it returns the latest forecast row for that product or the literal "no forecast available — insufficient data" string.
3. **Given** an admin without the `inventory` scope opens the copilot, **When** they try to ask about forecasts, **Then** the tool is excluded from the model's catalog and the copilot answers with "you do not have inventory access".

---

### User Story 3 — Get alerted before the stockout, not after (Priority: P2)

The forecast feeds the existing low-stock alert path. When a forecast predicts a product will run out within 3 days AND the prediction confidence clears the alerting threshold, an `admin_alerts` row is created and the existing Discord/Telegram dispatch fires — same channel the existing reactive low-stock cron uses.

**Why this priority**: Without alerting, the admin has to remember to check the panel. The alert closes the loop on "predict early enough that an admin can act". P2 because US1's panel already lets a vigilant admin catch most cases; the alert is the safety net for the day they don't open the panel.

**Independent Test**: Insert a fixture product whose forecast predicts a 2-day runout. Run the forecast. Verify exactly one `admin_alerts` row is created with type `forecast_stockout`, with the existing alerting service logging a Discord/Telegram dispatch (same code path, same dedupe — second forecast run within 24h does not double-alert).

**Acceptance Scenarios**:

1. **Given** a product's forecast predicts runout within 3 days at confidence ≥ 0.7, **When** the daily job completes, **Then** exactly one new `admin_alerts` row is created and the existing alerting webhook is called once.
2. **Given** the same product is forecast as at-risk on consecutive days, **When** the second day's job runs, **Then** no duplicate alert is sent (dedupe key is `forecast_stockout|<productId>` with a 7-day TTL).
3. **Given** `ALERTING_ENABLED=false`, **When** the job decides an alert should fire, **Then** the `admin_alerts` row is still written but no webhook is called — matches existing alerting infrastructure semantics.

---

### User Story 4 — Explainability (Priority: P3)

For each forecasted product, an admin can see what drove the prediction: the rolling daily-sales average used, the day-of-week multiplier, and the current stock-on-hand the model assumed. The goal is "if I don't trust this, I can audit it" — never a black box.

**Why this priority**: Builds calibration trust during the 14-day pilot. P3 because admins can usually act on the headline number; the breakdown is a deeper audit affordance, not the primary surface.

**Independent Test**: Click a row in the risk panel; expand a "ما الذي أنتج هذا التوقع؟" details section. Visible numbers add up to the predicted demand: avg-daily-sales × dow-multiplier × horizon = expected_demand_next_7_days, and current_stock / avg-daily-sales ≈ predicted-days-until-stockout (within rounding).

**Acceptance Scenarios**:

1. **Given** a forecasted product, **When** the admin expands the explanation panel, **Then** the displayed components reproduce the headline numbers within ±1 unit.
2. **Given** the forecast used "insufficient data" path, **When** the admin opens the explanation, **Then** the panel says "needs at least 14 days of order history" and shows how many days are currently available.

---

### Edge Cases

- **Brand-new product (< 14 days of order history)**: marked "insufficient data". Never a hallucinated forecast.
- **Archived / inactive product**: skipped entirely — not listed in the risk panel and not surfaced by the copilot tool.
- **Zero-sales window (e.g., a flash-sale product after the sale ends)**: forecast predicts effectively infinite days-to-stockout; row is filtered out of the at-risk panel by an upper threshold (e.g., > 90 days).
- **Stock-spike / restock between forecast runs**: the next day's forecast sees the new stock level and updates accordingly. Mid-day stale data is acceptable; the panel surfaces a "last updated" timestamp so the admin knows the granularity.
- **Worker tier outage**: the daily job didn't run. The admin panel detects staleness > 24h and shows a degraded-mode banner with the last-successful-run timestamp. The copilot tool returns "forecast data is stale" instead of yesterday's numbers as if they were today's.
- **Catalog with > 10k products**: forecasting all of them in one batch must complete inside the worker tier's existing job-time budget. The job is idempotent — re-running mid-batch picks up where it stopped.
- **Persistent under-prediction during pilot** (catches < 50% of stockouts ≥3 days early): kill criterion fires; the feature falls back to the existing reactive low-stock cron and the admin panel surfaces a "calibrating" state.
- **Forecast says "0 days left" but stock is actually positive**: clamp the displayed runout date to "today" rather than show a negative number; an admin always knows it's time to restock.

---

## Requirements _(mandatory)_

### Functional Requirements

#### FR-FORECAST: forecast generation

- **FR-FORECAST-001**: System MUST run the demand-forecasting job once per day on the existing worker tier (subnation-worker), at a time that does not overlap the existing low-stock-alert cron.
- **FR-FORECAST-002**: System MUST produce, per active non-archived product with ≥ 14 days of order history, a forecast row containing: predicted demand for the next 7 days, predicted demand for the next 30 days, predicted runout date, confidence band (low/medium/high), recommended reorder quantity, and the input snapshot (avg-daily-sales, dow-multiplier, current stock-on-hand).
- **FR-FORECAST-003**: System MUST mark products with < 14 days of order history as "insufficient data" rather than emit a forecast.
- **FR-FORECAST-004**: System MUST exclude archived (`isArchived = true`) and inactive (`isActive = false`) products from forecasting.
- **FR-FORECAST-005**: System MUST never call the forecast pipeline on the customer purchase critical path (no synchronous calls from order-create, checkout, or inventory-decrement code).
- **FR-FORECAST-006**: System MUST be idempotent — re-running the daily job within the same calendar day overwrites the existing day's forecasts rather than appending duplicates (uniqueness on `(product_id, forecast_date)`).
- **FR-FORECAST-007**: System MUST log a structured Pino entry per run with: run id, products forecasted count, products skipped count (with reason buckets), elapsed milliseconds.
- **FR-FORECAST-008**: System MUST emit Prometheus metrics for: forecast runs total (success / failure), forecast products predicted total, forecast products skipped total (labelled by reason), forecast run duration histogram.
- **FR-FORECAST-009**: System MUST write an `audit_logs` row per successful run with `action="forecast.run"` and metadata containing the per-bucket counts so admins see runs in the existing audit views.

#### FR-DATA: storage and retention

- **FR-DATA-001**: System MUST store every forecast in a dedicated `inventory_forecasts` table; rows MUST NOT mutate inventory or product columns directly.
- **FR-DATA-002**: System MUST retain forecast rows for at least 90 days for back-testing; the calibration analysis (US3 success metric) reads this history.
- **FR-DATA-003**: System MUST cascade-delete forecast rows when their parent product is deleted (forecasts have no value without the product context).

#### FR-PANEL: admin dashboard surface

- **FR-PANEL-001**: System MUST expose a read-only "stockout risk" panel above the existing product list at `/admin/products`, gated on the existing `inventory` permission scope.
- **FR-PANEL-002**: Panel MUST list up to 10 products ordered by predicted-days-until-stockout ascending, filtered to those with predicted runout within 30 days.
- **FR-PANEL-003**: Each row MUST display: product name + image thumbnail (using existing product-table conventions), current stock count, predicted runout date in admin's locale (Arabic-LY default), recommended reorder quantity, last forecast timestamp.
- **FR-PANEL-004**: Each row MUST link to the existing product-edit page; no new admin route is added.
- **FR-PANEL-005**: Panel MUST surface a degraded-mode banner when the latest successful forecast run completed more than 24 hours ago.
- **FR-PANEL-006**: Panel MUST be authored Arabic-first, RTL, matching the existing admin layout tokens.
- **FR-PANEL-007**: Panel MUST gracefully render "no products at risk" with a positive empty-state when zero products meet the threshold.

#### FR-COPILOT: AI admin copilot integration

- **FR-COPILOT-001**: System MUST expose a `forecast_demand` read-only tool to the AI Admin Copilot, gated on the `inventory` scope (matches the panel's gate).
- **FR-COPILOT-002**: Tool MUST accept optional filters: `horizon_days` (7 or 30; default 7), `at_risk_only` (boolean; default true), `product_id` (single-product lookup), and `limit` (default 10, max 50).
- **FR-COPILOT-003**: Tool MUST return only rows from `inventory_forecasts` — never an inferred or generated row. The copilot system prompt MUST instruct the model to cite product IDs verbatim from this output.
- **FR-COPILOT-004**: Tool MUST include a `data_freshness_hours` field per response so the model can warn the admin when results are stale.
- **FR-COPILOT-005**: Tool MUST surface a deep-link `panel_url` per row pointing at `/admin/products` with the product highlighted, mirroring the existing `query_risk_events` bridge convention.
- **FR-COPILOT-006**: Tool MUST be a no-op (returns an empty list and a "forecast_disabled" reason) when the cron has never run successfully — admins should not see a stale empty answer.

#### FR-ALERT: alert pipeline

- **FR-ALERT-001**: System MUST create an `admin_alerts` row of a new type `forecast_stockout` for each product whose latest forecast predicts runout within 3 days at confidence ≥ 0.7.
- **FR-ALERT-002**: System MUST fire the existing alerting service for those rows so the existing Discord webhook + Telegram bot dispatch fires — no new alert channel is introduced.
- **FR-ALERT-003**: System MUST dedupe alerts per product with a 7-day TTL keyed on `forecast_stockout|<product_id>` so a forecast at-risk three days running fires once, not three times.
- **FR-ALERT-004**: System MUST honor the existing `ALERTING_ENABLED=false` flag — when disabled, the row is still written but no webhook fires.
- **FR-ALERT-005**: System MUST cap forecast-driven alert volume at 50 rows per run as a runaway-protection backstop; the cap is logged and audit-stamped.

#### FR-SAFETY: scope boundaries

- **FR-SAFETY-001**: System MUST NOT auto-purchase, auto-restock, or call any external supplier API. It is read-only inference; admins make all reorder decisions.
- **FR-SAFETY-002**: System MUST NOT expose forecast data on the customer-facing storefront. No "only N left" UI, no "selling fast" badges; forecasts live behind admin auth only.
- **FR-SAFETY-003**: System MUST NOT modify the existing `inventory.is_sold` purchase decrement path. The customer flow is unchanged at the byte level.
- **FR-SAFETY-004**: System MUST surface a "calibrating" state and stop firing alerts when the rolling stockout-capture rate over the trailing 14 days falls below 50% (kill-criterion fail-safe). Forecasts continue to populate the table for back-testing; alerts pause until an admin re-enables.

### Key Entities _(include if feature involves data)_

- **Forecast Run**: One row per daily job execution. Captures: run id, started-at, completed-at, products predicted count, products skipped count (per reason), worker tier identifier, success/failure outcome. Powers the "last updated" surface and the calibration analysis.
- **Inventory Forecast**: One row per (product, forecast date). Carries: product reference, predicted demand 7d, predicted demand 30d, predicted runout date, confidence band, recommended reorder quantity, input snapshot (avg-daily-sales, dow-multiplier, stock-on-hand at run time), parent run reference. Read by the panel + copilot tool. Cascades on product delete.
- **Stockout Alert** (extension of existing `admin_alerts`): existing entity with a new `type` literal `forecast_stockout`. No schema change to `admin_alerts`; only the type enum gets a new member if one is enforced server-side.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001 (capture rate)**: During the 14-day pilot window, the forecasting feature flags ≥ 70% of products that actually go to zero-stock at least 3 days before the stockout occurs. Measured by joining the daily `inventory_forecasts` snapshot to actual `inventory.is_sold` history.
- **SC-002 (false-positive rate)**: ≤ 25% of products flagged as "at risk" do NOT stock out within the predicted window. Measured the same way as SC-001 but inverted.
- **SC-003 (admin response time)**: Median time from a critical-confidence at-risk forecast to an admin restock action drops by ≥ 50% versus the prior 30-day baseline (where "restock action" is detected as a sustained increase in `inventory` row count for that product).
- **SC-004 (panel latency)**: The risk panel renders within 500ms p95 alongside the existing product list — never noticeably slower than today's `/admin/products` page.
- **SC-005 (job duration)**: Daily forecast run completes inside the existing worker tier's 5-minute idle budget for catalogs up to 10k products.
- **SC-006 (zero customer regression)**: Customer purchase critical path latency p95 is unchanged within ±1% of the baseline measured the week before launch.
- **SC-007 (no fabrication)**: 100% of products mentioned by the copilot when answering forecast questions match an `inventory_forecasts` row from the same calendar day.
- **SC-008 (kill criterion)**: If SC-001 capture rate falls below 50% on a rolling 14-day basis, alerts MUST automatically pause within one worker run and the panel MUST surface the "calibrating" state.

---

## Assumptions

- The existing single-warehouse inventory model (no multi-region, no per-vendor splits) is the schema we plan against. Multi-region is out of scope.
- The catalog stays under 10k active products through the pilot — matches PROJECT_OVERVIEW estimates and the constitution's scale targets.
- The existing `admin_alerts` table accepts a new `type` literal without schema migration. If the type column is enforced via a Postgres enum, a separate one-line migration adds `forecast_stockout` to the enum; otherwise no migration is required.
- The existing AI Admin Copilot panel and `inventory` permission scope are the only admin surface for the forecast — no new top-level navigation entry is added.
- The existing `subnation-worker` tier remains the cron host; the web tier MUST NOT run the forecast.
- 14 days of order history is sufficient for the v1 statistical baseline (moving average + day-of-week multiplier). If pilot calibration shows the threshold is too short for sparse-sales products, the threshold is tuned via configuration in a follow-up release; the feature does NOT introduce a small-model variant in v1.
- "Recommended reorder quantity" uses a simple safety-stock formula (predicted 30-day demand minus current stock, floored at zero). A more sophisticated cost-based model is a follow-up if pilot signals demand it.
- Admin permission `inventory` is the right gate. No new permission scope is introduced.
- The Phase-1 forecast is rule-based / statistical — no LLM inference is on this path. The copilot tool only reads pre-computed rows, so there is no per-event inference cost (matches Constitution §I "Financial Integrity": no money-mutating action; no per-order inference cost).
