# Quickstart — Inventory Demand Forecasting

**Feature**: 011-inventory-demand-forecast
**Audience**: operator running the pilot, on-call engineer, future maintainer
**Companions**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md)

This file is the operator's playbook for turning the feature on, watching it run, and turning it off cleanly. It mirrors the structure of `010-ai-admin-copilot/quickstart.md` so the on-call rotation only learns one shape.

---

## 1. Verify the pipeline ran today

The forecast cron is scheduled at **02:15 UTC daily** on the **`subnation-worker`** tier.

**SQL — last successful run**:

```sql
SELECT id, started_at, completed_at, outcome, products_predicted,
       products_skipped, alerts_emitted, alerts_capped, capture_rate_14d
FROM inventory_forecast_runs
ORDER BY started_at DESC
LIMIT 5;
```

A healthy run looks like:

```
 id |       started_at       |     completed_at      | outcome | products_predicted |          products_skipped          | alerts_emitted | alerts_capped | capture_rate_14d
----+------------------------+-----------------------+---------+--------------------+------------------------------------+----------------+---------------+------------------
  3 | 2026-06-04 02:15:01+00 | 2026-06-04 02:15:04+00 | success |                812 | {"insufficient_data":47,"archived":3} |             12 | f             |            0.733
```

Three things to glance at:

- `outcome = success`.
- `completed_at - started_at` < 60 seconds for catalogs ≤ 10k products (SC-005 budget).
- `capture_rate_14d ≥ 0.7` once the pilot has been running ≥ 14 days. Below 0.5 trips the kill criterion.

---

## 2. US1 — risk panel on the admin dashboard

Open `/admin/products`. Above the existing product list, the **خطر النفاد** panel should show up to 10 products ordered by predicted-days-until-stockout ascending.

Expected states:

- **Fresh + at-risk products exist**: top-10 list with predicted runout dates and recommended reorder quantities.
- **Fresh + zero at-risk products**: positive empty state — "لا توجد منتجات معرضة لخطر النفاد".
- **Stale (last successful run > 24h ago)**: degraded-mode banner above the list — "البيانات قديمة. آخر تحديث ناجح: ⟨timestamp⟩".
- **Uninitialized (no run yet)**: panel is collapsed; an "info" hint tells the admin the pipeline hasn't run yet.
- **Calibrating (kill criterion tripped)**: yellow banner — "خط الأنابيب في وضع المعايرة — التنبيهات معطلة مؤقتاً".

Click a row → existing `/admin/products/:id` edit page (no new admin route).

Click the "ما الذي أنتج هذا التوقع؟" expander → shows: avg-daily-sales (last 14 days), DoW blend, current stock-on-hand, and the predicted-demand math. Numbers should reproduce the headline within ±1 unit (FR-explainability acceptance scenario).

---

## 3. US2 — copilot natural-language access

Open the AI Admin Copilot panel. Ask in Arabic or English:

- "أي منتجات على وشك أن تنفد الأسبوع القادم؟"
- "what products will run out in the next week?"
- "show me products at risk of stockout"

The copilot calls `forecast_demand` and replies with grounded rows. Verify:

1. Every product the copilot mentions matches a `inventory_forecasts` row with `forecast_date = CURRENT_DATE`.
2. Each row in the copilot's reply carries a `panel_url` deep-link to `/admin/products?highlight=<id>`.
3. Asking about a non-existent product surfaces "no forecast available" rather than an invented row (no fabrication).
4. An admin without the `inventory` scope sees the tool absent from the model's catalog — copilot replies "you do not have inventory access".

---

## 4. US3 — alert pipeline

When a forecast predicts runout within 3 days at confidence ≥ 0.7, the runner writes an `admin_alerts` row of type `forecast_stockout` and dispatches via the existing `alerting.service.ts`.

**SQL — recent forecast alerts**:

```sql
SELECT id, type, title, message, created_at
FROM admin_alerts
WHERE type = 'forecast_stockout'
ORDER BY created_at DESC
LIMIT 10;
```

`message` is JSON with `{ kind, product_id, product_name, predicted_runout_at, current_stock_on_hand, confidence, forecast_id, investigation_url }`.

**Dedupe**: the same product won't fire two alerts within 7 days. Verify by checking the Redis key `forecast_alert:<product_id>` (TTL ~ 7 days).

**Volume cap**: if a run would emit > 50 alerts, it stops at 50 and sets `alerts_capped = true` on the run row. Watch for that flag — a hit usually means a catalog-wide event (data ingestion bug, supplier failure) rather than 50 independent stockouts.

**Alerting disabled**: when `ALERTING_ENABLED=false`, the `admin_alerts` row is still written but no Discord/Telegram dispatch fires. Matches existing alerting infrastructure semantics.

---

## 5. Pilot calibration (the SC-001 / SC-008 measurement)

The retention cron at **03:30 UTC daily** runs the capture-rate query (`data-model.md` §3 invariant 4) and writes the result back to the latest `inventory_forecast_runs.capture_rate_14d`.

**Healthy posture** (post-pilot): `capture_rate_14d ≥ 0.7` sustained.

**Kill criterion** (SC-008): if `capture_rate_14d < 0.5` for the latest run, the runner sets `forecast:alerts:paused` in Redis (no TTL); the panel surfaces the calibrating state; alerts pause until an admin manually clears the flag with:

```bash
redis-cli DEL forecast:alerts:paused
```

The flag is intentionally manual-clear — calibration regressions deserve a human signal, not auto-resume.

---

## 6. Operating shortcuts

| Need to…                                          | Run                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Force a forecast run now (dev/staging only)       | `pnpm --filter @workspace/api-server tsx src/jobs/forecast-runner.ts`                      |
| List the last 5 runs                              | See §1 SQL.                                                                               |
| Check whether the kill criterion is active        | `redis-cli EXISTS forecast:alerts:paused` → `1` means paused.                              |
| Clear a calibration pause (after re-tuning)       | `redis-cli DEL forecast:alerts:paused`.                                                   |
| See which products were skipped today and why     | `SELECT products_skipped FROM inventory_forecast_runs ORDER BY id DESC LIMIT 1;`           |
| Inspect alerts emitted in the last 24h            | See §4 SQL.                                                                               |
| Verify the cron host                              | `kubectl logs deployment/subnation-worker | grep forecast-runner` (or Render equivalent). |
| Roll the feature back                             | Set `FORECAST_RUNNER_ENABLED=false` in worker env. The cron's first action is the env check. |

---

## 7. Failure modes & runbook

| Symptom                                                 | Likely cause                                            | Action                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Panel shows degraded-mode banner                        | Worker tier missed the 02:15 schedule                   | Check worker logs; re-run via §6 dev shortcut; investigate cron-tier health.                  |
| Capture rate < 0.5 for two consecutive days             | Algorithm under-predicting; pilot signal                | Review the calibration query output; consider tuning DoW blend window or raising confidence threshold. |
| `alerts_capped = true` on multiple runs                 | Either real catalog-wide event or rule regression        | Investigate `products_skipped` + the `at_risk` distribution; decide whether the cap protected against a false flood or a real one. |
| Customer purchase latency p95 jumps                     | Forecast cron accidentally on the web tier               | Check `WORKER_TIER` env on the web deploy; the cron's first action is to short-circuit if not "true". |
| `outcome = failure` repeatedly                          | Pinned in `failure_reason`                              | Read `inventory_forecast_runs.failure_reason`; decide whether to roll back or fix forward.    |
| Copilot fabricates a product not in `inventory_forecasts` | LLM regression — system-prompt cite-IDs-verbatim broke | Treat as P0; add a synthetic test fixture to `backend/src/test/forecast/copilot-tool.test.ts`. |

---

## 8. Decommission checklist

If the pilot fails (SC-001 capture rate stays < 50% after re-tuning) and the team decides to retire the feature:

- [ ] Set `FORECAST_RUNNER_ENABLED=false` in worker env. Cron stops scheduling new runs.
- [ ] Clear `forecast:alerts:paused` in Redis if set.
- [ ] Hide the `StockoutRiskPanel` mount in `frontend/src/pages/admin/products.tsx` (one-line conditional on a feature flag).
- [ ] Remove `forecast_demand` from the copilot's `READ_TOOLS` array (one-line edit).
- [ ] Leave `inventory_forecasts` and `inventory_forecast_runs` in place for back-testing analysis; drop the tables only after a 30-day cool-down.

The schema is purely additive — there's no migration to roll back. Removing the feature is a deploy-flag flip, not a data migration.

---

**Status**: quickstart complete. Plan deliverables: plan.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅. Ready for `/speckit-tasks`.
