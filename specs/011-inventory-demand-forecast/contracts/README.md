# Contracts — Inventory Demand Forecasting

**Feature**: 011-inventory-demand-forecast
**Companion**: [openapi.forecast.yaml](./openapi.forecast.yaml), [../data-model.md](../data-model.md)

This directory holds the API contracts for 011. Two surfaces are defined:

1. **HTTP admin endpoints** (`openapi.forecast.yaml`) — consumed by the React admin panel. Generated into Zod schemas (`shared/api-zod/src/forecast/`) and React Query hooks (`shared/api-client-react/`) by the existing orval pipeline.
2. **Copilot tool** — the `forecast_demand` LLM-callable tool. Lives in code (`backend/src/services/copilot/tools/read.ts`) per the existing 010 convention; its argument schema is documented inline below.

## HTTP endpoints (full schema in `openapi.forecast.yaml`)

| Method | Path                                | Auth                                | Purpose                                                      |
| ------ | ----------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/admin/forecast/at-risk`       | `requireAdmin` + `inventory` scope | Top-N products at risk of stockout (panel data source)        |
| GET    | `/api/admin/forecast/products/:id`  | `requireAdmin` + `inventory` scope | Single-product forecast + explanation (drawer data source)    |

Both endpoints are read-only. There is no `POST /api/admin/forecast/run` — the cron is the only writer (FR-FORECAST-005). Operators trigger an on-demand recompute via the existing manual-cron mechanism in dev/staging only.

## Copilot tool — `forecast_demand`

Read-only LLM-callable tool. Lives in `backend/src/services/copilot/tools/read.ts` and is added to `READ_TOOLS` next to the existing `query_risk_events` bridge. Required scope: `inventory`.

**Tool spec** (the schema the LLM sees):

```jsonc
{
  "type": "function",
  "function": {
    "name": "forecast_demand",
    "description": "Read pre-computed demand forecasts. Use to answer questions like 'which products will run out next week?'. Cite product IDs verbatim — never invent.",
    "parameters": {
      "type": "object",
      "properties": {
        "horizon_days": {
          "type": "integer",
          "enum": [7, 30],
          "description": "Forecast horizon. Default 7."
        },
        "at_risk_only": {
          "type": "boolean",
          "description": "Filter to products with predicted_runout_at <= today + 30 days. Default true."
        },
        "product_id": {
          "type": "integer",
          "description": "Single-product lookup. When set, ignores at_risk_only."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Max rows. Default 10."
        }
      },
      "additionalProperties": false
    }
  }
}
```

**Handler return shape** (the JSON the LLM relays):

```jsonc
{
  "data_freshness_hours": 2,
  "pipeline_state": "fresh",
  "rows": [
    {
      "product_id": 42,
      "product_name": "Premium Tier",
      "current_stock_on_hand": 3,
      "predicted_demand_7d": 8,
      "predicted_demand_30d": 35,
      "predicted_runout_at": "2026-06-08",
      "recommended_reorder_qty": 39,
      "confidence": "high",
      "panel_url": "/admin/products?highlight=42"
    }
  ]
}
```

**No-op responses**:

- Pipeline never ran successfully → `{ "pipeline_state": "uninitialized", "rows": [], "reason": "forecast_disabled" }`.
- Pipeline ran but is stale (> 24h) → `{ "pipeline_state": "stale", "data_freshness_hours": 36, "rows": [...], "warning": "data is more than 24 hours old" }`.
- Single-product lookup with no row → `{ "rows": [], "reason": "no forecast available — insufficient data" }`.
