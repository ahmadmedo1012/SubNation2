# Implementation Plan: Arabic Catalog Content Enrichment

**Branch**: `main` (direct-to-main per user's standing workflow) | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-arabic-catalog-enrichment/spec.md`

## Summary

Add an off-peak batched LLM job that drafts Arabic content for products with missing `description_long`, missing `faq`, or thin `description`. Drafts land in a new `enrichment_drafts` table with `state='drafted'`. Admins review on a new `/admin/products/enrichment` panel and click apply / edit-and-apply / reject; apply writes through the existing low-risk catalog-edit service path. The AI Admin Copilot gets a `query_enrichment_drafts` read tool. Reuses the existing copilot LLM client (010), the existing inventory permission scope, the existing audit-log pipeline. No new SDK, no new env-var-coupled deploy shape, no auto-publish.

## Technical Context

**Language/Version**: TypeScript ~5.9, Node.js ≥ 22 (constitution §Stack & Deployment Shape).

**Primary Dependencies**: Drizzle ORM, PostgreSQL (Neon), `node-cron` (existing scheduler), Pino, `prom-client`, React 19, TanStack Query, wouter, the existing `@anthropic-ai/sdk` already present for 010-ai-admin-copilot. **No new runtime dependencies.**

**Storage**: Two new Drizzle tables in `shared/db/src/schema/`:
- `enrichment_runs` — one row per cron execution (T-style mirror of `inventory_forecast_runs`).
- `enrichment_drafts` — one row per (product_id, field_name, iteration) with the state machine + original-vs-final text columns.

The existing `audit_logs` table accepts the new `action` literals `enrichment.run` and `enrichment.publish`; the `action` column is `varchar(100)`, no migration needed.

**Testing**: Vitest (`backend/src/services/enrichment/__tests__/`). Pure-function tests for the validator (Arabic-character ratio, length bounds, FAQ shape). Integration tests for state-machine transitions are written but skipped in CI envs that lack `SESSION_SECRET` (matches the existing test-infrastructure posture).

**Target Platform**: Web admin dashboard only. Same Node process serving API + built React on `$PORT`. The cron lives on the existing `subnation-worker` tier (constitution §V scheduling rule).

**Project Type**: Web application (existing `backend/` + `frontend/` + `shared/` monorepo).

**Performance Goals**:
- Daily run completes inside the worker tier's 5-minute idle budget for catalogs ≤ 10k products with the per-run cap = 50 (one LLM round-trip ≈ 1–3s, 50 × 3s = 2.5 minutes).
- Panel renders p95 ≤ 500ms for 25 rows (matches the inventory-forecast panel budget).
- Customer purchase critical path latency unchanged within ±1% (SC-005).

**Constraints**:
- Read-only at the LLM boundary — drafts NEVER auto-publish to the live `products` table (FR-SAFETY-001).
- Customer-invisible — no draft surface on the storefront (FR-SAFETY-002).
- Admin-only — `requirePermission("inventory")` matches the existing product-edit gate.
- Cron tier discipline — refuses to run when `WORKER_TIER !== "true"` OR `ENRICHMENT_RUNNER_ENABLED !== "true"`.
- Daily token cap — configurable; the loop halts on next iteration after cumulative tokens exceed the cap (FR-RUN-002).
- 14-day rejection-suppression window — hard-coded constant in v1.

**Scale/Scope**:
- Catalog: ~10k active products in steady state.
- Per-run cap: default 50 drafts/run (configurable via `ENRICHMENT_PER_RUN_CAP`).
- Daily token cap: default 50_000 tokens (input + output combined; configurable via `ENRICHMENT_DAILY_TOKEN_CAP`). Sized at < 10% of the assessment's ROI lever.
- 90-day retention on `enrichment_drafts` matches the 003 risk-events and 011 forecast retention pattern.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                    | Status        | Evidence in plan                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Financial Integrity (NON-NEGOTIABLE)**  | ✅ Pass       | Enrichment is content-only; never touches `wallet_ledger`, `wallet_topups`, `orders`. FR-SAFETY-003 prohibits LLM calls on customer paths. SC-004 explicitly tracks monthly inference spend below the 10%-of-ROI threshold via the daily token cap (FR-RUN-002).                                                                              |
| **II. Passwordless Customer Auth**           | ✅ Pass — N/A | Admin-only feature. The existing argon2 + TOTP 2FA admin auth is reused. No customer-auth surface added or modified.                                                                                                                                                                                                                          |
| **III. Shared Contracts (API-First)**        | ✅ Pass       | New endpoints get Zod schemas in `shared/api-zod/src/enrichment/` (generated by orval), OpenAPI paths in `shared/api-spec/openapi.yaml`, regenerated React Query hooks, and Drizzle schemas in `shared/db/src/schema/`. The copilot tool catalog is code-level (matches the 010 + 011 pattern).                                                |
| **IV. Defense in Depth**                     | ✅ Pass       | Five layers: (1) `requireAdmin`; (2) `requirePermission("inventory")`; (3) cron tier guard (`WORKER_TIER !== "true"` short-circuit); (4) state-machine guard (only `state='drafted'` rows are publishable; `published`/`rejected` are terminal); (5) the apply path goes through the existing service-layer write, inheriting all of its existing guards. |
| **V. Observability & Operational Readiness** | ✅ Pass       | New Prometheus counters/histogram per FR-RUN-001. `audit_logs` rows for both `enrichment.run` (per cron execution) and `enrichment.publish` (per admin apply). Schema migration follows the constitution's idempotent + Redis-NX-locked boot-migration pattern. 90-day retention cron mirrors the 003 + 011 jobs.                              |
| **§ Arabic-First (RTL) UX**                  | ✅ Pass       | The runner's prompt template is Arabic-first; the validator rejects non-Arabic output (FR-DRAFT-007). The admin panel is RTL-aware and uses the existing layout tokens. Numeric content (token counts, dates) renders inside inline-LTR spans.                                                                                                |
| **§ Stack & Deployment Shape**               | ✅ Pass       | Single Node process; two new schema files; ZERO new runtime dependency; no Docker change; no deploy-shape change. The cron runs on `subnation-worker` per §V.                                                                                                                                                                                  |

**Result**: All gates pass without justifying any complexity exceptions. No entry needed in Complexity Tracking.

### Post-design re-check (after Phase 1 artifacts written)

| Principle                                    | Re-check verdict                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Financial Integrity**                   | ✅ Holds. `data-model.md` confirms zero writes to `wallet_ledger` / `wallet_topups` / `orders`. The runner is a pure read-LLM-write into `enrichment_drafts`.                                                                                                            |
| **II. Passwordless Customer Auth**           | ✅ N/A.                                                                                                                                                                                                                                                                |
| **III. Shared Contracts**                    | ✅ Holds. `contracts/openapi.enrichment.yaml` is the single source of truth for the three admin endpoints (list / publish / reject); the copilot tool's argument schema mirrors the OpenAPI request shape.                                                              |
| **IV. Defense in Depth**                     | ✅ Holds. Five layers preserved; the state-machine guard is enforced both at the SQL CHECK constraint (terminal states cannot transition back to `drafted`) and in the apply handler.                                                                                   |
| **V. Observability & Operational Readiness** | ✅ Holds. `data-model.md` §3 documents the daily reconciliation queries; `quickstart.md` covers operator shortcuts. The 90-day retention cron is documented to run on the worker tier.                                                                                  |
| **§ Arabic-First (RTL) UX**                  | ✅ Holds. Frontend layout (research §R-3) and panel mock (quickstart §3) cover Arabic-first + RTL.                                                                                                                                                                       |
| **§ Stack & Deployment Shape**               | ✅ Holds. Single Node process; two new env vars (both optional with safe defaults); no deploy-shape change; reaper on existing worker tier.                                                                                                                            |

## Project Structure

### Documentation (this feature)

```text
specs/012-arabic-catalog-enrichment/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── README.md
│   └── openapi.enrichment.yaml
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
backend/src/
├── jobs/
│   ├── enrichment-runner.ts            # NEW — daily cron, worker-tier-guarded
│   └── enrichment-retention.ts         # NEW — 90-day purge
├── services/enrichment/                # NEW
│   ├── enrichment.service.ts           #   orchestrator: select → draft → store
│   ├── candidates.ts                   #   eligibility query (active + thin content + not recently rejected)
│   ├── prompts.ts                      #   Arabic prompt templates per field
│   ├── validator.ts                    #   Arabic-ratio + length validation
│   ├── draft-store.ts                  #   CRUD over enrichment_drafts
│   ├── run-store.ts                    #   CRUD over enrichment_runs
│   └── publish.ts                      #   admin-apply path through products service
├── routes/admin/
│   └── enrichment.ts                   # NEW — GET /list + POST /:id/publish + POST /:id/reject
└── services/copilot/tools/
    └── read.ts                         # MODIFY — add query_enrichment_drafts tool

frontend/src/
├── components/admin/enrichment/        # NEW
│   ├── EnrichmentReviewPanel.tsx
│   ├── DraftRow.tsx
│   ├── DiffPreview.tsx                 #   side-by-side current ↔ proposed
│   └── api.ts
└── pages/admin/
    └── enrichment.tsx                  # NEW — route /admin/products/enrichment

shared/
├── db/src/schema/
│   ├── enrichment_drafts.ts            # NEW
│   ├── enrichment_runs.ts              # NEW
│   └── index.ts                        # MODIFY — re-export
├── api-spec/openapi.yaml               # MODIFY — append /api/admin/enrichment/* paths
└── api-client-react/                   # REGENERATED via orval

config/env.example                      # MODIFY — add ENRICHMENT_RUNNER_ENABLED, ENRICHMENT_DAILY_TOKEN_CAP, ENRICHMENT_PER_RUN_CAP
```

**Structure Decision**: Web application — existing `backend/` + `frontend/` + `shared/` monorepo. The enrichment feature is a vertical slice across all three workspaces. Cron on `subnation-worker` per §V scheduling rule.

## Complexity Tracking

> No constitution gate violations. This section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| _(none)_  | _(none)_   | _(none)_                             |
