# Implementation Plan: Inventory Demand Forecasting

**Branch**: `main` (direct-to-main per user's standing workflow) | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-inventory-demand-forecast/spec.md`

## Summary

Add a daily statistical demand forecast that writes one row per active product per run to a new `inventory_forecasts` table, surfaces a "stockout risk" panel above the existing product list at `/admin/products`, exposes a `forecast_demand` read tool to the AI Admin Copilot (010), and feeds the existing `admin_alerts` + Discord/Telegram dispatch on at-risk products. v1 algorithm is a 14-day rolling daily-sales mean × day-of-week multiplier — no LLM, no per-event inference cost. The forecast pipeline never runs on the customer purchase path; admins make every reorder decision; no auto-purchasing.

## Technical Context

**Language/Version**: TypeScript ~5.9, Node.js ≥ 22 (constitution §Stack & Deployment Shape).

**Primary Dependencies**: Drizzle ORM, PostgreSQL (Neon), `node-cron` (existing scheduler), Pino, `prom-client`, React 19, TanStack Query, wouter. **No new runtime dependencies.** The forecast model is plain SQL + small TypeScript helpers — no `@tensorflow/tfjs`, no ONNX, no external ML library in v1.

**Storage**: One new Drizzle table `inventory_forecasts` (per-product per-run prediction) plus one optional `inventory_forecast_runs` row per daily job for the "last successful run" surface. Both live in `shared/db/src/schema/`. The existing `admin_alerts` table accepts a new `type` literal `forecast_stockout`; we treat the column as a free-form string consistent with how the existing seed values (`coupon_maxed`, `low_stock`, …) are written — verified against `shared/db/src/schema/admin_alerts.ts` before migration time. If the column is enforced as a Postgres enum, a one-line `ALTER TYPE … ADD VALUE` migration extends it; otherwise no migration is required for the alert path.

**Testing**: Vitest for unit + integration on backend (`backend/src/test/forecast/`) and frontend (`frontend/src/test/admin/forecast/`). Statistical correctness tests use deterministic order-history fixtures so the moving-average + day-of-week math is reproducible across CI runs.

**Target Platform**: Web admin dashboard only — same Node process serving API + built React on `$PORT` (constitution §Stack & Deployment Shape). The forecast cron runs on the existing `subnation-worker` tier (constitution §V scheduling rule).

**Project Type**: Web application (existing `backend/` + `frontend/` + `shared/` monorepo).

**Performance Goals**:

- Daily forecast job completes inside the existing worker tier's 5-minute idle budget for catalogs ≤ 10k active products (SC-005).
- Risk panel renders in p95 ≤ 500 ms alongside the existing product list (SC-004).
- Customer purchase critical path latency unchanged within ±1% (SC-006) — guaranteed by FR-FORECAST-005 (no synchronous calls from order/inventory paths).

**Constraints**:

- Read-only — forecasts NEVER auto-purchase, auto-restock, or auto-decrement inventory (FR-SAFETY-001).
- Admin-only surface — no customer-facing "only N left" UI; the storefront's authoritative `inventory.is_sold = false` count behavior is unchanged (FR-SAFETY-002).
- Cron tier discipline — the forecast job MUST refuse to run on the web tier (`process.env.WORKER_TIER !== "true"` short-circuits) per the existing copilot-reaper convention.
- Statistical-only v1; no LLM call on this path. The copilot integration only READS pre-computed rows.
- Forecast run window: a new product needs ≥ 14 days of order history before it gets a forecast (FR-FORECAST-003).
- Alert volume cap: 50 alerts per run as a runaway-protection backstop (FR-ALERT-005).
- Kill criterion: rolling 14-day capture rate < 50% pauses alerts automatically and surfaces "calibrating" state (SC-008).
- Defense in Depth (constitution §IV): the new admin surfaces sit behind `requireAdmin` + `requirePermission("inventory")` (matches the existing `/admin/products` route gate).

**Scale/Scope**:

- Catalog: ~10k active products in the steady state. Each daily run writes ≤ 10k rows — 90-day retention caps the table at ~900k rows, well within Postgres comfort.
- Pilot: 14-day calibration window. Success metric: ≥ 70% of stockouts flagged ≥ 3 days early (SC-001). Kill criterion below 50% (SC-008).
- One worker tier today (matches the existing scheduling rule); if the worker tier is duplicated later, the existing Redis-NX leader-lock pattern from boot migrations would carry over to this cron.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Mapped against `.specify/memory/constitution.md` v1.0.0:

| Principle                                    | Status        | Evidence in plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Financial Integrity (NON-NEGOTIABLE)**  | ✅ Pass       | Forecasting is read-only and lives entirely outside the wallet/order transactional path. FR-SAFETY-001 prohibits auto-purchase; FR-FORECAST-005 prohibits synchronous calls from order/inventory mutation paths. The existing transactional invariants (atomic purchase, optimistic-lock balance debit, append-only ledger) are unchanged at the byte level. SC-006 explicitly tracks customer-path p95 ≤ ±1% of pre-launch baseline.                                                                                                                                          |
| **II. Passwordless Customer Auth**           | ✅ Pass — N/A | Admin-only feature. The existing argon2 + TOTP 2FA admin auth is reused; the `inventory` permission scope is the gate. No customer-auth surface is added or modified.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **III. Shared Contracts (API-First)**        | ✅ Pass       | New endpoints (`GET /api/admin/forecast/at-risk`, `GET /api/admin/forecast/products/:id`) get Zod schemas in `shared/api-zod/src/forecast/`, OpenAPI paths in `shared/api-spec/openapi.yaml`, regenerated React Query hooks via the existing orval pipeline, and Drizzle schema in `shared/db/src/schema/inventory_forecasts.ts`. Phase 1 produces these contract files. The copilot tool catalog is code-level (matches the existing 010-ai-admin-copilot pattern) and is NOT in api-zod — tool catalog lives in `backend/src/services/copilot/tools/`.                          |
| **IV. Defense in Depth**                     | ✅ Pass       | Five independent layers: (1) `requireAdmin` (existing); (2) `requirePermission("inventory")` (existing); (3) cron tier guard (`WORKER_TIER !== "true"` refuses); (4) catalog filter to active+non-archived rows; (5) alert volume cap (50/run) as runaway-protection backstop. Logger redaction is unaffected — forecast rows contain no credential fields. Logger MUST log a structured Pino entry per run (FR-FORECAST-007).                                                                                                                                                |
| **V. Observability & Operational Readiness** | ✅ Pass       | New Prometheus counters `forecast_runs_total{outcome}`, `forecast_products_predicted_total`, `forecast_products_skipped_total{reason}`; histogram `forecast_run_seconds`. `audit_logs` row written per successful run with `action="forecast.run"` (FR-FORECAST-009). Reaper-style retention cron (90 days) bounds table growth. Schema migration follows the constitution's idempotent + Redis-NX-locked boot-migration pattern. The reaper runs on `subnation-worker` per §V scheduling rule. The existing alerting service handles dispatch — no new Discord/Telegram channel. |
| **§ Arabic-First (RTL) UX**                  | ✅ Pass       | The risk panel and explanation drawer are authored Arabic-first, RTL-aware, reusing the existing admin layout tokens. Strings are inline-Arabic at v1 (matches the existing 010 copilot panel pattern); a future i18n pass would centralize them.                                                                                                                                                                                                                                                                                                                             |
| **§ Stack & Deployment Shape**               | ✅ Pass       | Single Node process; one new schema file; no new runtime dependency; no Docker change; no deploy-shape change. The cron job lives on the existing `subnation-worker` tier per §V scheduling rule.                                                                                                                                                                                                                                                                                                                                                                            |

**Result**: All gates pass without justifying any complexity exceptions. No entry needed in Complexity Tracking.

### Post-design re-check (after Phase 1 artifacts written)

After producing `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`:

| Principle                                    | Re-check verdict                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Financial Integrity**                   | ✅ Holds. `data-model.md` confirms zero writes to `wallet_ledger` / `wallet_topups` / `orders`. The forecast is a pure read-aggregate-write into `inventory_forecasts`.                                                                                                          |
| **II. Passwordless Customer Auth**           | ✅ N/A.                                                                                                                                                                                                                                                                          |
| **III. Shared Contracts**                    | ✅ Holds. `contracts/openapi.forecast.yaml` is the single source of truth for the two admin endpoints; the copilot tool's argument schema mirrors the OpenAPI request shape so the LLM's tool catalog and the human admin's API call carry identical contracts.                  |
| **IV. Defense in Depth**                     | ✅ Holds. Five layers preserved; the alert volume cap is enforced inside the executor (research §R-3) so a runaway rule cannot exceed it.                                                                                                                                        |
| **V. Observability & Operational Readiness** | ✅ Holds. `data-model.md` §3 documents the daily reconciliation query (capture rate). `quickstart.md` covers operator shortcuts. The 90-day retention cron is documented to run on the worker tier. The pipeline-status flag is surfaced via the existing `/status` page.        |
| **§ Arabic-First (RTL) UX**                  | ✅ Holds. Frontend layout (research §R-5) and panel mock (quickstart §3) cover Arabic-first + RTL.                                                                                                                                                                                |
| **§ Stack & Deployment Shape**               | ✅ Holds. Single Node process; zero new env vars; no deploy-shape change; reaper on existing worker tier.                                                                                                                                                                        |

**Re-check result**: All gates still pass. Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/011-inventory-demand-forecast/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── README.md
│   └── openapi.forecast.yaml
├── checklists/
│   └── requirements.md  # produced by /speckit-specify, kept current
└── tasks.md             # /speckit-tasks output (NOT created by this command)
```

### Source Code (repository root)

```text
backend/src/
├── jobs/
│   └── forecast-runner.ts             # NEW — daily cron, runs on worker tier only
├── services/forecast/                 # NEW
│   ├── forecast.service.ts            #   the runner: gather → compute → write → alert
│   ├── statistical.ts                 #   moving-average + day-of-week multiplier
│   ├── reorder.ts                     #   recommended_reorder_qty formula
│   └── alerts.ts                      #   feeds existing admin_alerts + alerting service
├── routes/admin/
│   └── forecast.ts                    # NEW — GET /at-risk + GET /products/:id
└── services/copilot/tools/
    └── read.ts                        # MODIFY — add forecast_demand tool

frontend/src/
└── components/admin/forecast/         # NEW
    ├── StockoutRiskPanel.tsx          #   the panel rendered above the product list
    ├── RiskRow.tsx                    #   per-product row + explanation drawer
    └── api.ts                         #   small wrapper over the generated TanStack hooks

frontend/src/pages/admin/
└── products.tsx                       # MODIFY — mount <StockoutRiskPanel /> above existing list

shared/
├── db/src/schema/
│   ├── inventory_forecasts.ts         # NEW
│   ├── inventory_forecast_runs.ts     # NEW
│   └── index.ts                       # MODIFY — re-export the two new tables
├── api-zod/src/forecast/
│   ├── at-risk.ts                     # NEW (generated by orval)
│   ├── product.ts                     # NEW (generated by orval)
│   └── index.ts                       # NEW (generated barrel)
├── api-spec/openapi.yaml              # MODIFY — append /api/admin/forecast/* paths
└── api-client-react/                  # REGENERATED via existing orval pipeline
```

**Structure Decision**: Web application — existing `backend/` + `frontend/` + `shared/` monorepo (constitution §Stack & Deployment Shape). The forecast is a vertical slice across all three workspaces: schema in `shared/db`, contracts in `shared/api-zod` + `shared/api-spec`, hooks in `shared/api-client-react`, route handlers in `backend/src/routes/admin/forecast.ts`, services in `backend/src/services/forecast/`, cron in `backend/src/jobs/forecast-runner.ts`, UI in `frontend/src/components/admin/forecast/` + a small mount in `frontend/src/pages/admin/products.tsx`. The cron runs on the existing `subnation-worker` tier per the constitution's §V scheduling rule.

## Complexity Tracking

> No constitution gate violations. This section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| _(none)_  | _(none)_   | _(none)_                             |
