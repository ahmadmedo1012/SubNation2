# Contracts — Inventory Demand Forecasting

**Feature**: 011-inventory-demand-forecast
**Companion**: [openapi.forecast.yaml](./openapi.forecast.yaml), [../data-model.md](../data-model.md)

This directory holds the API contracts for 011. One surface is defined:

1. **HTTP admin endpoints** (`openapi.forecast.yaml`) — consumed by the React admin panel. Generated into Zod schemas (`shared/api-zod/src/forecast/`) and React Query hooks (`shared/api-client-react/`) by the existing orval pipeline.

(The second historical surface — the `forecast_demand` copilot tool that lived in `backend/src/services/copilot/tools/read.ts` — was retired in R181 with the AI Admin Copilot; the tool and its host directory no longer exist, and its contract section was removed from this file.)

## HTTP endpoints (full schema in `openapi.forecast.yaml`)

| Method | Path                                | Auth                                | Purpose                                                      |
| ------ | ----------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/admin/forecast/at-risk`       | `requireAdmin` + `inventory` scope | Top-N products at risk of stockout (panel data source)        |
| GET    | `/api/admin/forecast/products/:id`  | `requireAdmin` + `inventory` scope | Single-product forecast + explanation (drawer data source)    |

Both endpoints are read-only. There is no `POST /api/admin/forecast/run` — the cron is the only writer (FR-FORECAST-005). Operators trigger an on-demand recompute via the existing manual-cron mechanism in dev/staging only.
