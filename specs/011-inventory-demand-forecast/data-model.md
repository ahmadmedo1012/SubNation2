# Phase 1 Data Model — Inventory Demand Forecasting

**Feature**: 011-inventory-demand-forecast
**Date**: 2026-06-04
**Status**: complete
**Companion**: [research.md](./research.md), [contracts/openapi.forecast.yaml](./contracts/openapi.forecast.yaml)

This document is the source of truth for the persistence layer. Every field, index, and constraint here MUST appear in `shared/db/src/schema/`; every Drizzle migration MUST be auditable against this document.

---

## 1. Tables

### 1.1 `inventory_forecast_runs`

One row per execution of the daily forecast job. Powers the "last successful run" timestamp on the admin panel (FR-PANEL-005), the copilot's `data_freshness_hours` field (FR-COPILOT-004), and the calibration analysis (R-8).

| Column                    | Type                       | Null | Default       | Notes                                                                                |
| ------------------------- | -------------------------- | ---- | ------------- | ------------------------------------------------------------------------------------ |
| `id`                      | `serial PRIMARY KEY`       | NO   | (sequence)    | Stable opaque id; referenced by every forecast row in the run.                        |
| `started_at`              | `timestamptz`              | NO   | `now()`       | Worker-tier wall-clock at job start.                                                 |
| `completed_at`            | `timestamptz`              | YES  | NULL          | NULL means in-flight or crashed; set on graceful completion.                          |
| `outcome`                 | `varchar(20)`              | NO   | `'in_flight'` | One of `in_flight`, `success`, `failure`. Mutates exactly once per row's lifetime.    |
| `products_predicted`      | `integer`                  | NO   | `0`           | Count of forecasted (non-insufficient-data) products in this run.                    |
| `products_skipped`        | `jsonb`                    | NO   | `'{}'`        | Per-reason counts: `{insufficient_data: N, archived: M, inactive: K, error: P}`.    |
| `alerts_emitted`          | `integer`                  | NO   | `0`           | Number of `admin_alerts` rows the run wrote (≤ 50 by FR-ALERT-005).                   |
| `alerts_capped`           | `boolean`                  | NO   | `false`       | True iff the run hit the per-run alert volume cap (FR-ALERT-005).                     |
| `capture_rate_14d`        | `numeric(4,3)`             | YES  | NULL          | Last computed rolling 14-day capture rate (R-8). Null on first runs.                  |
| `worker_tier`             | `varchar(50)`              | YES  | NULL          | Tier identifier captured from `process.env.WORKER_TIER_ID` for forensic tracing.       |
| `failure_reason`          | `text`                     | YES  | NULL          | Free-text capture when `outcome='failure'`.                                          |

**Indexes**:

- `idx_forecast_runs_started_at` on `(started_at DESC)` — supports the "last run" query.
- `idx_forecast_runs_outcome` on `(outcome, started_at DESC)` — supports "last successful run" filter.

**Lifecycle**:

```text
created (in_flight) → success
                   → failure
                   → (orphaned in_flight) — reaped by retention job after 24h with reason "abandoned"
```

The `outcome` field never reverts. A failed run is followed by a fresh row on the next schedule; we do NOT retry mid-flight.

---

### 1.2 `inventory_forecasts`

One row per (product, run). The authoritative snapshot consumed by the admin panel, the copilot tool, and the alert dispatcher.

| Column                       | Type                                           | Null | Default    | Notes                                                                                                                               |
| ---------------------------- | ---------------------------------------------- | ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | `serial PRIMARY KEY`                           | NO   | (sequence) | Stable opaque id.                                                                                                                  |
| `run_id`                     | `integer NOT NULL REFERENCES inventory_forecast_runs(id) ON DELETE CASCADE` | NO | — | Forecasts have no value once the parent run is purged.                                                                              |
| `product_id`                 | `integer NOT NULL REFERENCES products(id) ON DELETE CASCADE`                | NO | — | Cascade: forecasts for a deleted product are immediately invalid.                                                                   |
| `forecast_date`              | `date`                                         | NO   | (run UTC date) | Calendar date the forecast represents. Used by the panel ("today's forecast") and back-testing joins.                               |
| `current_stock_on_hand`      | `integer`                                      | NO   | —          | Snapshot of `COUNT(inventory.is_sold = false)` at run time. Captured for explainability + back-testing.                              |
| `avg_daily_sales`            | `numeric(8,4)`                                 | YES  | NULL       | Trailing-14-day mean daily sales. Null when `confidence='insufficient_data'`.                                                       |
| `dow_blend_7d`               | `numeric(8,4)`                                 | YES  | NULL       | Average DoW multiplier across the next 7 days. Null when insufficient data.                                                          |
| `predicted_demand_7d`        | `integer`                                      | YES  | NULL       | Rounded predicted units sold over the next 7 days. Null when insufficient data.                                                     |
| `predicted_demand_30d`       | `integer`                                      | YES  | NULL       | Rounded predicted units sold over the next 30 days. Null when insufficient data.                                                    |
| `predicted_runout_at`        | `date`                                         | YES  | NULL       | `forecast_date + floor(current_stock / max(avg_daily_sales, 0.1))`, clamped to `[forecast_date, forecast_date + 90]`. Null when insufficient data. |
| `recommended_reorder_qty`    | `integer`                                      | YES  | NULL       | `max(0, predicted_demand_30d * 1.2 - current_stock_on_hand)`. Null when insufficient data.                                          |
| `confidence`                 | `varchar(20)`                                  | NO   | —          | One of `high`, `medium`, `low`, `insufficient_data`. The confidence band controls alert eligibility (R-3).                          |
| `at_risk`                    | `boolean`                                      | NO   | `false`    | True iff `predicted_runout_at <= forecast_date + 30 days` AND `confidence != insufficient_data`. Computed at write time, indexed.    |
| `created_at`                 | `timestamptz`                                  | NO   | `now()`    |                                                                                                                                    |

**Constraints**:

- `UNIQUE (product_id, forecast_date)` — one forecast per product per calendar day. Re-running the daily job upserts on this key (FR-FORECAST-006).
- `CHECK (confidence IN ('high','medium','low','insufficient_data'))` — explicit enum guard.
- `CHECK ((confidence = 'insufficient_data') = (avg_daily_sales IS NULL))` — internal consistency: insufficient_data ↔ NULL inputs.

**Indexes**:

- `idx_forecasts_at_risk_runout` on `(at_risk, predicted_runout_at) WHERE at_risk = true` — supports the panel's "top 10 at-risk" query.
- `idx_forecasts_product_date` on `(product_id, forecast_date DESC)` — supports the copilot tool's per-product lookup.
- `idx_forecasts_run` on `(run_id)` — supports retention purge.

**Why a denormalized `at_risk` column instead of computing the predicate at read time**: the panel query is the hot path; a partial index on `at_risk = true` keeps it constant-time regardless of catalog size, and the predicate is stable for the lifetime of the row.

---

### 1.3 `admin_alerts` extension (existing table)

No schema change. The existing `admin_alerts` table accepts a new `type` literal `forecast_stockout`. If the column is enforced as a Postgres enum (verified at migration-time against `shared/db/src/schema/admin_alerts.ts`), a one-line `ALTER TYPE … ADD VALUE` migration extends it; otherwise it's a free-form string and no migration is required.

The alert row's `metadata` JSONB carries:

```jsonc
{
  "kind": "forecast_stockout",
  "product_id": 42,
  "product_name": "Premium Tier",
  "predicted_runout_at": "2026-06-08",
  "current_stock_on_hand": 3,
  "confidence": "high",
  "forecast_id": 17821,
  "investigation_url": "/admin/products?highlight=42"
}
```

The dedupe key (Redis) is `forecast_alert:<product_id>` with a 7-day TTL (R-3).

---

## 2. State machines

### 2.1 Forecast run lifecycle

```text
                 INSERT
                   |
                   v
            ┌──────────────┐
            │  in_flight   │── crash ──▶ (orphaned; reaped after 24h with outcome='failure', reason='abandoned')
            └──────┬───────┘
                   │ COMMIT
                   v
            ┌──────────────┐
            │   success    │   (terminal)
            └──────────────┘
                   │
                   │ on rule-engine throw or audit-write fail
                   v
            ┌──────────────┐
            │   failure    │   (terminal — alerting service notified, audit log written)
            └──────────────┘
```

**Transition rules**:

- `in_flight → success` requires: zero unhandled exceptions during the math+write pass AND audit_log + run row both committed.
- `in_flight → failure` is set by the runner's top-level catch; `failure_reason` MUST be populated.
- Once `success`/`failure`, no further mutation on the row is permitted (enforced by application code; no DB-level CHECK because the runner is the only writer).

### 2.2 Forecast row staleness (computed at read time, no state mutation)

The runtime uses `forecast_date` + the parent run's `completed_at` to compute staleness:

- **fresh**: parent run `completed_at` within the last 24 hours.
- **stale**: parent run `completed_at` ≥ 24 hours old → panel surfaces degraded-mode banner, copilot tool sets `data_freshness_hours` accordingly.
- **purged**: row no longer exists (retention purge ran) → panel falls back to "no forecast available".

---

## 3. Reconciliation queries

The retention cron (R-7) runs these once daily at 03:30 UTC. Any non-zero result fires the existing `alerting.service.ts` webhook with rule `forecast_invariant_violation`.

### Invariant 1 — every executed forecast row has a parent run

```sql
SELECT COUNT(*) FROM inventory_forecasts f
LEFT JOIN inventory_forecast_runs r ON r.id = f.run_id
WHERE r.id IS NULL;
-- expected: 0 (cascade FK guarantees this; the query is a paranoia check)
```

### Invariant 2 — uniqueness on (product_id, forecast_date)

```sql
SELECT product_id, forecast_date, COUNT(*) AS n
FROM inventory_forecasts
GROUP BY product_id, forecast_date
HAVING COUNT(*) > 1;
-- expected: empty (UNIQUE constraint guarantees this; query is a paranoia check)
```

### Invariant 3 — `at_risk` matches the predicate

```sql
SELECT id FROM inventory_forecasts
WHERE confidence != 'insufficient_data'
  AND at_risk != (predicted_runout_at <= forecast_date + INTERVAL '30 days');
-- expected: 0 — divergence means a code regression around the at_risk write path
```

### Invariant 4 — capture rate (14-day rolling, kill criterion)

```sql
WITH window_forecasts AS (
  SELECT product_id,
         predicted_runout_at,
         forecast_date,
         confidence
  FROM inventory_forecasts
  WHERE at_risk = true
    AND confidence IN ('high', 'medium')
    AND forecast_date >= CURRENT_DATE - INTERVAL '14 days'
    AND predicted_runout_at <= forecast_date + INTERVAL '3 days'
),
actual_stockouts AS (
  -- a "stockout" = product with zero unsold inventory rows on a given calendar day
  SELECT i.product_id, DATE(NOW()) AS stockout_date
  FROM products p
  LEFT JOIN inventory i ON i.product_id = p.id AND i.is_sold = false
  WHERE p.is_archived = false AND p.is_active = true
  GROUP BY i.product_id
  HAVING COUNT(i.id) = 0
)
SELECT
  CASE WHEN (SELECT COUNT(*) FROM actual_stockouts) = 0 THEN NULL
       ELSE 1.0 * (
         SELECT COUNT(DISTINCT s.product_id)
         FROM actual_stockouts s
         JOIN window_forecasts w ON w.product_id = s.product_id
       ) / (SELECT COUNT(*) FROM actual_stockouts)
  END AS capture_rate;
-- writes capture_rate into the latest inventory_forecast_runs.capture_rate_14d
-- if capture_rate < 0.5, the runner sets the Redis flag forecast:alerts:paused
```

### Invariant 5 — alert volume cap held

```sql
SELECT id, alerts_emitted FROM inventory_forecast_runs
WHERE alerts_emitted > 50;
-- expected: 0 — runner enforces the cap; non-zero means the cap was bypassed
```

---

## 4. Migration plan

Single migration: `shared/db/drizzle/<NNNN>_inventory_forecasts.sql`.

```sql
-- T1: forecast runs table
CREATE TABLE IF NOT EXISTS inventory_forecast_runs (
  id              SERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  outcome         VARCHAR(20)  NOT NULL DEFAULT 'in_flight',
  products_predicted INTEGER   NOT NULL DEFAULT 0,
  products_skipped   JSONB     NOT NULL DEFAULT '{}'::jsonb,
  alerts_emitted     INTEGER   NOT NULL DEFAULT 0,
  alerts_capped      BOOLEAN   NOT NULL DEFAULT false,
  capture_rate_14d   NUMERIC(4,3),
  worker_tier        VARCHAR(50),
  failure_reason     TEXT
);
CREATE INDEX IF NOT EXISTS idx_forecast_runs_started_at  ON inventory_forecast_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_runs_outcome     ON inventory_forecast_runs (outcome, started_at DESC);

-- T2: per-product forecasts
CREATE TABLE IF NOT EXISTS inventory_forecasts (
  id                       SERIAL PRIMARY KEY,
  run_id                   INTEGER NOT NULL REFERENCES inventory_forecast_runs(id) ON DELETE CASCADE,
  product_id               INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  forecast_date            DATE     NOT NULL,
  current_stock_on_hand    INTEGER  NOT NULL,
  avg_daily_sales          NUMERIC(8,4),
  dow_blend_7d             NUMERIC(8,4),
  predicted_demand_7d      INTEGER,
  predicted_demand_30d     INTEGER,
  predicted_runout_at      DATE,
  recommended_reorder_qty  INTEGER,
  confidence               VARCHAR(20) NOT NULL,
  at_risk                  BOOLEAN     NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_forecast_confidence
    CHECK (confidence IN ('high','medium','low','insufficient_data')),
  CONSTRAINT chk_forecast_insufficient_consistency
    CHECK ((confidence = 'insufficient_data') = (avg_daily_sales IS NULL)),
  CONSTRAINT uq_forecast_product_date UNIQUE (product_id, forecast_date)
);
CREATE INDEX IF NOT EXISTS idx_forecasts_at_risk_runout
  ON inventory_forecasts (at_risk, predicted_runout_at)
  WHERE at_risk = true;
CREATE INDEX IF NOT EXISTS idx_forecasts_product_date
  ON inventory_forecasts (product_id, forecast_date DESC);
CREATE INDEX IF NOT EXISTS idx_forecasts_run
  ON inventory_forecasts (run_id);

-- T3: extend admin_alerts.type if it's a Postgres enum
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'admin_alert_type'
  ) THEN
    BEGIN
      ALTER TYPE admin_alert_type ADD VALUE IF NOT EXISTS 'forecast_stockout';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END$$;
```

Every statement uses `IF NOT EXISTS` (constitution §V boot-migration rule). The migration is wrapped by the existing Redis-NX lock.

---

## 5. Read-path overview (for cross-reference with contracts)

| Endpoint / consumer                              | Reads                                                                 | Filters                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET /api/admin/forecast/at-risk` (panel)        | latest `inventory_forecasts` per product where `at_risk = true`       | `confidence != 'insufficient_data'`, `LIMIT 10` (configurable) |
| `GET /api/admin/forecast/products/:id` (drawer)  | latest row for the given product, plus the parent `_runs` row         | none                                                           |
| `forecast_demand` (copilot tool)                 | same as `at-risk` with optional product filter, optional horizon      | optional `product_id`, optional `horizon_days ∈ {7, 30}`       |
| Alert dispatcher (cron, in-process)              | rows from the just-completed run where `at_risk = true` AND `confidence IN ('high','medium')` AND `predicted_runout_at <= forecast_date + 3 days` | filtered to the current run only                              |
| Retention cron                                   | `inventory_forecasts WHERE forecast_date < CURRENT_DATE - 90`         | none — pure delete                                             |
| Capture-rate cron                                | invariant-4 query (above)                                             | rolling 14-day window                                          |

The read path NEVER touches `wallet_ledger`, `wallet_topups`, `orders` (write-side), or any table that the customer purchase critical path mutates. The forecast cron's only read against `orders` is a SELECT-only aggregate over the trailing 14 days.

---

**Status**: data model complete. Phase 1 contracts come next.
