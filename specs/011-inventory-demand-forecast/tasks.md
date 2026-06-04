---
description: "Task list for Inventory Demand Forecasting implementation"
---

# Tasks: Inventory Demand Forecasting

**Input**: Design documents from `/specs/011-inventory-demand-forecast/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.forecast.yaml, contracts/README.md, quickstart.md

**Tests**: REQUIRED. Constitution §Quality Gates demands real-invariant assertions for new flows. The forecasting math (R-1) and the (product, forecast_date) idempotency constraint (FR-FORECAST-006) MUST be exercised, not assumed. Per-story Independent Tests in the spec are the integration-test acceptance gate.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different file, no dependency on incomplete tasks — safe to parallelize.
- **[Story]**: Maps the task to a user story (US1…US4) for traceability.
- File paths are absolute-from-repo-root; an LLM picking up a task should not need additional context to find or edit them.

## Path Conventions (Web Application)

- Backend: `backend/src/`
- Frontend: `frontend/src/`
- Shared (Drizzle, Zod, OpenAPI, generated React hooks): `shared/db/src/`, `shared/api-zod/src/`, `shared/api-spec/`, `shared/api-client-react/`
- Backend tests: `backend/src/test/forecast/`
- Frontend tests: `frontend/src/test/admin/forecast/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire the project to allow forecast work to begin. Reuse the constitution's substrate; add only what's missing.

- [ ] T001 Add `FORECAST_RUNNER_ENABLED` (default `false`) to `config/env.example` next to `RISK_PIPELINE_ENABLED`, document the worker-tier requirement, and read it in `backend/src/jobs/forecast-runner.ts` (T037) so a misconfigured cron is observably off rather than silently misfiring.
- [ ] T002 [P] Audit existing `shared/db/src/schema/admin_alerts.ts` and document in `specs/011-inventory-demand-forecast/notes-admin-alerts-type.md` whether the `type` column is a Postgres enum or a free-form `varchar`. If it is an enum, mark T010's `ALTER TYPE` step required; if it is varchar, mark it skipped.
- [ ] T003 [P] Audit existing `subnation-worker` cron registry in `backend/src/jobs/cron.ts` and confirm 02:15 UTC is free; if not, document the chosen alternative slot in `specs/011-inventory-demand-forecast/notes-cron-schedule.md` per research §R-6.

**Checkpoint**: Setup complete. Foundation can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, contracts, cron skeleton, and forecast-specific services that EVERY user story depends on. **No user-story implementation may start until this phase finishes.**

### Schema & migrations

- [ ] T004 Drizzle schema for `inventory_forecast_runs` in `shared/db/src/schema/inventory_forecast_runs.ts` — column set per `data-model.md` §1.1, indexes `idx_forecast_runs_started_at`, `idx_forecast_runs_outcome`.
- [ ] T005 Drizzle schema for `inventory_forecasts` in `shared/db/src/schema/inventory_forecasts.ts` — column set per `data-model.md` §1.2, FK to `inventory_forecast_runs(id) ON DELETE CASCADE`, FK to `products(id) ON DELETE CASCADE`, unique constraint `uq_forecast_product_date`, partial index `idx_forecasts_at_risk_runout WHERE at_risk = true`, indexes `idx_forecasts_product_date`, `idx_forecasts_run`, CHECK constraints per `data-model.md` §1.2 (depends on T004).
- [ ] T006 Re-export the two new tables from `shared/db/src/schema/index.ts`.
- [ ] T007 Boot migration `shared/db/drizzle/<NNNN>_inventory_forecasts.sql` per `data-model.md` §4: `CREATE TABLE IF NOT EXISTS` for both tables, all indexes, the `DO $$ ... ALTER TYPE admin_alert_type ADD VALUE IF NOT EXISTS 'forecast_stockout' ... $$` block. Statements must be idempotent per Constitution §V; integrates with the existing Redis-NX boot-migration lock.

### Shared contracts (Constitution §III)

- [ ] T008 Merge `specs/011-inventory-demand-forecast/contracts/openapi.forecast.yaml` paths and component schemas into `shared/api-spec/openapi.yaml` under the existing admin namespace (`tags: [admin/forecast]`).
- [ ] T009 Regenerate `shared/api-zod/src/generated/api.ts` and `shared/api-client-react/src/generated/` from the updated OpenAPI via `pnpm --filter @workspace/api-spec codegen` (matches the orval pipeline used by 010 — the per-feature Zod barrel is NOT hand-authored).

### Backend infrastructure

- [ ] T010 [P] `backend/src/lib/forecast/dates.ts` — small pure utilities: `today_utc_date()`, `add_days(date, n)`, `clamp_date(date, lo, hi)`. Used by the runner and the math service so date arithmetic stays in one place and is unit-testable without hitting Postgres.
- [ ] T011 [P] `backend/src/lib/forecast/redis-flags.ts` — read/write helpers for two Redis keys: `forecast:alerts:paused` (no TTL, set by capture-rate retention job — R-8) and `forecast_alert:<product_id>` (7-day TTL dedupe per R-3). Mirrors the shape of `backend/src/services/copilot/lib/rate-limit.ts`.
- [ ] T012 [P] Prometheus metrics in `backend/src/observability/metrics.ts`: counter `forecast_runs_total{outcome}`, counter `forecast_products_predicted_total`, counter `forecast_products_skipped_total{reason}`, counter `forecast_alerts_emitted_total`, histogram `forecast_run_seconds`. Exported via the existing `/metrics` endpoint per FR-FORECAST-008.

### Forecast service skeletons

- [ ] T013 [P] `backend/src/services/forecast/statistical.ts` — pure functions only: `computeAvgDailySales(orders14d)`, `computeDowMultiplier(orders28d, targetDow)`, `computeDowBlend(multipliers7d)`, `deriveConfidence(orders14d, cv)`. No DB calls; takes plain JS arrays. Powers R-1 and is the unit-test surface of the math.
- [ ] T014 [P] `backend/src/services/forecast/reorder.ts` — pure function `recommendReorderQty(predictedDemand30d, currentStock)` returning `max(0, predictedDemand30d * 1.2 - currentStock)`. Per R-2.
- [ ] T015 [P] `backend/src/services/forecast/aggregate.ts` — single batched SQL query that returns, for each active non-archived product, an array of `{ orderDate, count }` for the last 28 days. The single round-trip is the perf budget guarantee (R-9).
- [ ] T016 [P] `backend/src/services/forecast/run-store.ts` — CRUD over `inventory_forecast_runs`: `createInFlightRun()`, `markSuccess(id, counts)`, `markFailure(id, reason)`, `latestSuccessful()`. Stamps `worker_tier` from `process.env.WORKER_TIER_ID`.
- [ ] T017 [P] `backend/src/services/forecast/forecast-store.ts` — `upsertForecast(row)` honoring the `(product_id, forecast_date)` unique constraint via `ON CONFLICT … DO UPDATE`; `latestForProducts(ids)`; `latestAtRisk(limit)`; `latestForProduct(id)`. The upsert pattern is what makes T026 idempotent (FR-FORECAST-006).
- [ ] T018 [P] `backend/src/services/forecast/alerts.ts` — given a fresh run id, selects rows with `at_risk = true AND confidence IN ('high','medium') AND predicted_runout_at <= forecast_date + 3 days`, dedupes via the Redis flag (T011), respects the 50-alert cap (FR-ALERT-005), writes `admin_alerts` rows of type `forecast_stockout`, and dispatches via the existing `alerting.service.ts`. Honors `ALERTING_ENABLED=false` per FR-ALERT-004.

**Checkpoint**: Foundation ready — all user stories may start. Verify by running `pnpm typecheck` (must pass) and confirming the new schema files appear in `@workspace/db`'s exports.

---

## Phase 3: User Story 1 — Spot products at risk of stockout (P1) 🎯 MVP

**Goal**: Authenticated admins open `/admin/products` and within 5 seconds see the top N products predicted to run out, with predicted runout date, recommended reorder quantity, and a link to the existing product-edit page.

**Independent Test**: Run the daily forecast against a fixture catalog with three obvious patterns (fast-mover, slow-mover, brand-new). Open `/admin/products`. The fast-mover ranks first with a runout inside 7 days; the slow-mover does not appear; the new product surfaces with an "insufficient data" badge and no runout date.

### Tests for User Story 1

- [ ] T019 [P] [US1] Test in `backend/src/test/forecast/statistical.test.ts`: deterministic order-history fixtures exercise `computeAvgDailySales`, `computeDowMultiplier`, `deriveConfidence` per R-1. Edge cases: zero-sales days, single-day spike, exact 14-day boundary.
- [ ] T020 [P] [US1] Test in `backend/src/test/forecast/reorder.test.ts`: `recommendReorderQty` returns the correct value for above-stock and below-stock cases; floors at zero; matches R-2.
- [ ] T021 [P] [US1] Test in `backend/src/test/forecast/run-idempotency.test.ts`: running the forecast twice on the same calendar day produces exactly one row per (product, forecast_date) — second run UPDATEs in place via the `(product_id, forecast_date)` constraint per FR-FORECAST-006.
- [ ] T022 [P] [US1] Test in `backend/src/test/forecast/insufficient-data.test.ts`: a product with < 14 days of order history gets a row with `confidence='insufficient_data'` and NULL forecasts (FR-FORECAST-003); the row is queryable but `at_risk=false`.
- [ ] T023 [P] [US1] Test in `backend/src/test/forecast/at-risk-route.test.ts`: unauthenticated request to `GET /api/admin/forecast/at-risk` returns 401; admin without `inventory` scope returns 403; admin with scope returns 200 with the `AtRiskResponse` shape.
- [ ] T024 [P] [US1] Test in `backend/src/test/forecast/skips-archived.test.ts`: archived (`isArchived=true`) and inactive (`isActive=false`) products are skipped entirely (FR-FORECAST-004); skip count appears in `inventory_forecast_runs.products_skipped`.
- [ ] T025 [P] [US1] Test in `frontend/src/test/admin/forecast/StockoutRiskPanel.test.tsx`: panel renders top-10 rows for fresh data, "no products at risk" empty state, "data is stale" banner when last run > 24h, and the calibrating banner when the Redis pause flag is on.

### Implementation

- [ ] T026 [US1] `backend/src/services/forecast/forecast.service.ts` — the orchestrator: opens an in-flight run, calls `aggregate.ts`, iterates products through `statistical.ts` + `reorder.ts`, upserts via `forecast-store.ts`, marks the run success/failure, fires `alerts.ts` (US3), writes the `audit_logs` row per FR-FORECAST-009. Honors FR-FORECAST-005 (no synchronous calls from order paths — this function is invoked only from the cron in T037).
- [ ] T027 [US1] `backend/src/routes/admin/forecast.ts` — `GET /api/admin/forecast/at-risk` (gated by `requireAdmin` + `requirePermission("inventory")`; reads via `forecast-store.latestAtRisk(limit)`; computes `pipeline_state` from `latestSuccessful()`'s `completed_at` and the Redis pause flag).
- [ ] T028 [US1] Mount `forecastRouter` into `backend/src/routes/admin/index.ts` next to the existing `risk` mount, with the same `requireAdmin` + `requirePermission("inventory")` gate.
- [ ] T029 [P] [US1] `frontend/src/components/admin/forecast/StockoutRiskPanel.tsx` — the panel: collapsed-when-empty, RTL-aware container, fetches via the generated TanStack hook, renders up to 10 rows; depends on T030.
- [ ] T030 [P] [US1] `frontend/src/components/admin/forecast/RiskRow.tsx` — single row component: product thumbnail + name (reusing existing product-table conventions), current stock count, predicted runout date in `ar-LY` locale, recommended reorder quantity inside an inline-LTR span (R-5), link to `/admin/products/:id`, "آخر تحديث" timestamp.
- [ ] T031 [P] [US1] `frontend/src/components/admin/forecast/api.ts` — small wrapper over the generated TanStack Query hook for `GET /api/admin/forecast/at-risk` so the component-side code is readable; matches the 010 copilot `api.ts` convention.
- [ ] T032 [US1] Mount `<StockoutRiskPanel />` above the existing product list in `frontend/src/pages/admin/products.tsx`. The mount is conditional on the panel having data OR being in stale/calibrating state — never rendered when uninitialized so a fresh deploy doesn't show an empty banner before the first cron run.

**Checkpoint**: US1 fully functional — Phase 1 admins can see at-risk products and click through. The cron itself ships in Phase 4 (depended on by every story); this checkpoint validates the read surface against seeded fixture rows.

---

## Phase 4: User Story 2 — Ask the copilot in natural language (P2)

**Goal**: An admin asks "أي منتجات على وشك أن تنفد الأسبوع القادم؟" in the AI Admin Copilot. The copilot calls `forecast_demand`, returns rows verbatim from `inventory_forecasts`, and offers to deep-link the admin into the panel.

**Independent Test**: Phase 1 copilot enabled. Admin asks "show me products at risk". Copilot's reply lists product IDs that match a direct `SELECT … WHERE at_risk=true` against `inventory_forecasts` for the current calendar day. Asking about a non-existent product returns "no forecast available" — no fabrication.

### Tests for User Story 2

- [ ] T033 [P] [US2] Test in `backend/src/test/forecast/copilot-tool.test.ts`: `forecast_demand` invoked without filters returns at-risk-only rows by default; `at_risk_only=false` returns all rows; `product_id` filter returns the latest row for that product or empty; `horizon_days=30` is honored.
- [ ] T034 [P] [US2] Test in `backend/src/test/forecast/copilot-fabrication.test.ts`: a copilot turn that asks the model to list at-risk products MUST cite IDs verbatim from the tool output; the test asserts every product mentioned in the assistant text appears in the tool's returned `rows[].product_id`.
- [ ] T035 [P] [US2] Test in `backend/src/test/forecast/copilot-scope.test.ts`: an admin without the `inventory` scope sees the `forecast_demand` tool excluded from the catalog passed to the LLM; the copilot replies "you do not have inventory access" rather than calling the tool.

### Implementation

- [ ] T036 [US2] Add `forecast_demand` to `backend/src/services/copilot/tools/read.ts` per `contracts/README.md`: `requiredScope: "inventory"`, accepts `horizon_days ∈ {7,30}`, `at_risk_only`, `product_id`, `limit`; handler reads via `forecast-store` only; returns `{ data_freshness_hours, pipeline_state, rows[] }` with `panel_url` per row pointing at `/admin/products?highlight=<id>`. Append to the `READ_TOOLS` array next to `query_risk_events` (matches the existing 010 bridge convention).

**Checkpoint**: US2 functional — the copilot can answer forecast questions in Arabic + English with grounded data. Verify against `quickstart.md` §3.

---

## Phase 5: User Story 3 — Get alerted before the stockout (P2)

**Goal**: A forecast predicting runout within 3 days at confidence ≥ 0.7 fires an existing-channel alert (Discord + Telegram via the existing `alerting.service.ts`).

**Independent Test**: Insert a fixture product whose forecast predicts a 2-day runout at high confidence. Run the forecast. Verify exactly one new `admin_alerts` row of type `forecast_stockout` and exactly one webhook dispatch. Re-run the forecast within 7 days — no duplicate alert (Redis dedupe).

### Tests for User Story 3

- [ ] T037 [P] [US3] Test in `backend/src/test/forecast/alerts-fires.test.ts`: a fixture forecast meeting the eligibility predicate produces one `admin_alerts` row with `type='forecast_stockout'` and the `alerting.service` mock records exactly one dispatch with `dedupKey='forecast_stockout|<id>'`.
- [ ] T038 [P] [US3] Test in `backend/src/test/forecast/alerts-dedupe.test.ts`: a second forecast for the same product within 7 days writes no new alert (Redis NX returns false); re-running on day 8 fires again.
- [ ] T039 [P] [US3] Test in `backend/src/test/forecast/alerts-cap.test.ts`: 60 fixture products all eligible for alerts in one run produce exactly 50 `admin_alerts` rows; the run row has `alerts_capped=true`; the cap-hit is audit-logged per FR-ALERT-005.
- [ ] T040 [P] [US3] Test in `backend/src/test/forecast/alerts-disabled.test.ts`: with `ALERTING_ENABLED=false`, the run still writes the `admin_alerts` row but the alerting-service mock records zero webhook calls (FR-ALERT-004).

### Implementation

- [ ] T041 [US3] Wire `alerts.ts` (T018) into `forecast.service.ts` (T026) so it fires once per successful run, after upserts complete. Stamp `inventory_forecast_runs.alerts_emitted` and `alerts_capped` on the run row.

**Checkpoint**: US3 functional — admins are alerted before stockouts via the existing notification pipeline. Verify against `quickstart.md` §4.

---

## Phase 6: User Story 4 — Explainability (P3)

**Goal**: For each forecasted product, an admin can audit the inputs that drove the prediction (avg-daily-sales, DoW blend, current stock, history depth).

**Independent Test**: Click a row in the risk panel; the explanation drawer expands; the displayed components reproduce the headline numbers within ±1 unit.

### Tests for User Story 4

- [ ] T042 [P] [US4] Test in `backend/src/test/forecast/product-detail.test.ts`: `GET /api/admin/forecast/products/:id` returns a `ForecastDetail` with `explanation.avg_daily_sales`, `explanation.dow_blend_7d`, `explanation.days_of_history_available`; for an `insufficient_data` row the latter is < 14.
- [ ] T043 [P] [US4] Test in `frontend/src/test/admin/forecast/ExplainDrawer.test.tsx`: the expander renders the explanation values, formats them in Arabic locale, and asserts that `avg_daily_sales × dow_blend_7d × 7 ≈ predicted_demand_7d` within ±1.

### Implementation

- [ ] T044 [P] [US4] Extend `backend/src/routes/admin/forecast.ts` (T027) with `GET /api/admin/forecast/products/:id` returning `ProductDetailResponse` per the OpenAPI contract; reads via `forecast-store.latestForProduct(id)`.
- [ ] T045 [US4] Extend `frontend/src/components/admin/forecast/RiskRow.tsx` (T030) with an expandable "ما الذي أنتج هذا التوقع؟" drawer that fetches the per-product detail on first open and displays the explanation breakdown with the headline-reproducibility check rendered as a sanity hint.

**Checkpoint**: US4 functional — the prediction is auditable end-to-end. Verify against `quickstart.md` §3 (US1 walkthrough mentions the drawer).

---

## Phase 7: Cron, Retention & Operational Readiness

**Purpose**: Wire the daily job + retention + capture-rate measurement so the feature is self-operating once the env flag is flipped.

- [ ] T046 [P] `backend/src/jobs/forecast-runner.ts` — `node-cron` schedule at `15 2 * * *` (02:15 UTC). First action: short-circuit with a structured warn log if `process.env.WORKER_TIER !== "true"` OR `process.env.FORECAST_RUNNER_ENABLED !== "true"`. Calls `forecast.service.run()` and surfaces the elapsed-ms + outcome in the existing Pino structured log shape.
- [ ] T047 [P] `backend/src/jobs/forecast-retention.ts` — daily at 03:30 UTC: deletes `inventory_forecasts` rows older than 90 days; reaps orphaned `in_flight` runs > 24h old (sets outcome='failure' with reason='abandoned' per data-model §2.1); computes the 14-day capture rate per `data-model.md` §3 invariant 4 and writes it back to the latest run row; sets `forecast:alerts:paused` Redis flag when capture_rate < 0.5 per SC-008. Lives next to `risk-retention.ts`.
- [ ] T048 [P] Wire both jobs into `backend/src/jobs/cron.ts` next to the existing `low_stock`, `risk-retention`, and `copilot-reaper` schedules. Cron entries MUST be conditional on the worker-tier env check (the same short-circuit pattern T046 uses) so a misconfigured deploy is observably off.
- [ ] T049 [P] Test in `backend/src/test/forecast/retention.test.ts`: rows with `forecast_date < CURRENT_DATE - 90 days` are deleted; younger rows survive; `inventory_forecast_runs` rows older than 90 days cascade-delete their child forecasts.
- [ ] T050 [P] Test in `backend/src/test/forecast/capture-rate.test.ts`: seeded forecasts + actual zero-stock outcomes produce the expected 14-day capture rate; below-50% sets the Redis pause flag; above-50% leaves it untouched (the flag is manual-clear per R-8).

**Checkpoint**: Feature is hands-off. Daily run, retention, capture-rate measurement, and kill-criterion fail-safe all operating without manual intervention.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Tighten everything that crosses stories.

- [ ] T051 [P] RTL audit of `StockoutRiskPanel.tsx` and `RiskRow.tsx` per Constitution §Arabic-First UX: panel slide direction, drawer slide direction, numeric content inside inline-LTR span, Arabic locale on every date format. Validate by toggling document direction in the browser.
- [ ] T052 [P] Performance verification on staging: run the forecast against a 10k-product seed corpus and confirm SC-005 (run < 5 minutes) and SC-004 (panel p95 ≤ 500ms with 10 rows). Capture the Prometheus histograms in the release note.
- [ ] T053 [P] Verify SC-006: the customer purchase critical path p95 is unchanged within ±1% versus the week before launch. Constitution §Quality Gates demands no regression on the catalog/wallet hot path.
- [ ] T054 [P] Defense-in-depth tabletop: walk through the five layers (admin auth, `inventory` scope, cron tier guard, archived/inactive filter, alert volume cap) and confirm none can be bypassed individually. Document the walkthrough in `specs/011-inventory-demand-forecast/notes-defense-in-depth.md`.
- [ ] T055 [P] Update `OPERATIONS_RUNBOOK.md` with a new "Inventory Demand Forecasting" section pointing at `quickstart.md` §6 (operating shortcuts), §7 (failure modes), and §8 (decommission checklist).
- [ ] T056 [P] Update `PROJECT_OVERVIEW.md` with a one-paragraph summary linking the spec/plan/research/data-model/quickstart artifacts, mirroring the entry the 003 anomaly-detection feature carries.
- [ ] T057 [P] Validate fail-fast on a fresh deploy: with `FORECAST_RUNNER_ENABLED=true` but `WORKER_TIER` unset, confirm the cron entry refuses to run and the log line is unambiguous (no silent half-on state).
- [ ] T058 Final end-to-end run of `quickstart.md` §1–§5 against staging: trigger the cron, open the panel, ask the copilot, observe the alert, validate the explanation drawer math. Capture the trace IDs in the release note for the pilot admin group.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **blocks all user stories**.
- **User Stories (Phase 3+)**: each starts after Foundational. US1 is the MVP. US2 + US3 depend on US1 (the forecast service from US1 produces the rows they consume). US4 depends on US1 (panel) only.
- **Cron & retention (Phase 7)**: depends on US1's `forecast.service.ts`. Without Phase 7 the feature works on-demand but is not self-operating; ship Phase 7 with US1 unless an early demo specifically wants on-demand only.
- **Polish (Phase 8)**: depends on all desired user stories.

### User Story Dependencies

- **US1 (P1, MVP)** — depends on: Phase 2.
- **US2 (P2)** — depends on: Phase 2 + US1 (`forecast-store` is shared).
- **US3 (P2)** — depends on: Phase 2 + US1 (alerts run after the upsert in `forecast.service.ts`).
- **US4 (P3)** — depends on: Phase 2 + US1 (extends the panel).

### Within Each User Story

- Tests written first; verified failing before implementation.
- Schemas before services; services before routes; routes before frontend wiring.
- Story marked complete only when its Independent Test passes end-to-end.

### Parallel Opportunities

- All Phase 1 setup tasks (T001–T003) can run in parallel.
- Foundational schema tasks T004 + T005 are sequential (T005 depends on T004's table existing); T010–T018 (lib + services) are mostly parallel within their groups.
- Within US1, T013–T017 (services) are parallel; T029–T031 (frontend) are parallel.
- Within US3, T037–T040 (tests) are parallel.
- Phase 7 cron + retention tasks T046, T047, T049, T050 are parallel; T048 is the wiring step that depends on T046 + T047.
- Phase 8 polish tasks are all parallel.

---

## Parallel Example: User Story 1

```bash
# Backend tests (parallel):
Task: "Statistical math tests — backend/src/test/forecast/statistical.test.ts"
Task: "Reorder formula tests — backend/src/test/forecast/reorder.test.ts"
Task: "Run idempotency tests — backend/src/test/forecast/run-idempotency.test.ts"
Task: "Insufficient-data tests — backend/src/test/forecast/insufficient-data.test.ts"
Task: "At-risk route tests — backend/src/test/forecast/at-risk-route.test.ts"

# Backend services (parallel):
Task: "Statistical helpers — backend/src/services/forecast/statistical.ts"
Task: "Reorder formula — backend/src/services/forecast/reorder.ts"
Task: "Aggregate query — backend/src/services/forecast/aggregate.ts"
Task: "Run store — backend/src/services/forecast/run-store.ts"
Task: "Forecast store — backend/src/services/forecast/forecast-store.ts"

# Frontend components (parallel):
Task: "Risk panel — frontend/src/components/admin/forecast/StockoutRiskPanel.tsx"
Task: "Risk row — frontend/src/components/admin/forecast/RiskRow.tsx"
Task: "Hook wrapper — frontend/src/components/admin/forecast/api.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup (~0.5 day).
2. Phase 2 Foundational (~1–2 days; bulk of the schema, contracts, and pure-function services).
3. Phase 3 US1 (~1–2 days).
4. Phase 7 cron + retention (~0.5 day) so the panel actually has data without manual intervention.
5. **STOP and validate**: pilot admins use the panel for the 14-day calibration window. Measure SC-001 (capture rate ≥ 70%) and SC-002 (false-positive rate ≤ 25%).
6. Ship Phase 1 of the rollout to production with `FORECAST_RUNNER_ENABLED=true` + the panel mount.

### Incremental Delivery

1. MVP (US1) → panel + cron in prod.
2. - US3 (alerting) → existing notification channels carry forecast warnings.
3. - US2 (copilot tool) → admins can ask in natural language.
4. - US4 (explainability) → audit drawer for trust during pilot.
5. - Phase 8 polish + decommission readiness.

### Parallel Team Strategy

After Phase 2 completes:

- **Track A (Backend services)** — US1 runner → US3 alert wire-up → US4 product-detail endpoint.
- **Track B (Frontend)** — US1 panel + row → US4 explanation drawer.
- **Track C (Copilot + Ops)** — US2 tool catalog entry; Phase 7 cron + retention; Phase 8 polish in parallel.

Each track integrates at the `forecast-store` boundary; the OpenAPI fragment (T008) and generated hooks (T009) keep them in sync.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps the task to a user story for traceability.
- Each user story has a matching set of Independent Test criteria from `spec.md`; tasks include the tests that demonstrate those criteria.
- Verify tests fail before implementing.
- Commit after each task (or logical group); follow the project commit-and-push convention (direct-to-main per the user's standing rule).
- Stop at any checkpoint to validate the story independently.
- Do not weaken safety invariants for delivery speed: SC-006 (customer-path latency unchanged), SC-007 (no fabrication), and SC-008 (kill criterion auto-pause) MUST hold in production.
