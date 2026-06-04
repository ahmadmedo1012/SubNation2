---
description: "Task list for Arabic Catalog Content Enrichment implementation"
---

# Tasks: Arabic Catalog Content Enrichment

**Input**: Design documents from `/specs/012-arabic-catalog-enrichment/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.enrichment.yaml, quickstart.md

**Tests**: REQUIRED for the validator + state-machine guards. Pure-function tests for the Arabic-ratio + length validator (FR-DRAFT-007). Integration tests for the publish/reject state-transition guards may be skipped in CI envs that lack `SESSION_SECRET` (matches the existing test posture).

## Phase 1: Setup

- [ ] T001 Add `ENRICHMENT_RUNNER_ENABLED=false`, `ENRICHMENT_DAILY_TOKEN_CAP=50000`, `ENRICHMENT_PER_RUN_CAP=50` defaults to `config/env.example` next to the existing `FORECAST_RUNNER_ENABLED`. Document the worker-tier requirement.
- [ ] T002 [P] Audit existing `backend/src/services/copilot/llm-client.ts` to confirm it exposes `{text, inputTokens, outputTokens}` and a plain prompt → completion path (no tool catalog). Document any gap in `specs/012-arabic-catalog-enrichment/notes-llm-client.md`.

## Phase 2: Foundational

### Schema & migrations

- [ ] T003 Drizzle schema `shared/db/src/schema/enrichment_runs.ts` per data-model §1.1.
- [ ] T004 Drizzle schema `shared/db/src/schema/enrichment_drafts.ts` per data-model §1.2 (depends on T003).
- [ ] T005 Re-export both from `shared/db/src/schema/index.ts`.
- [ ] T006 Boot migration in `backend/src/migrate.ts` per data-model §4 — idempotent CREATE TABLE IF NOT EXISTS for both tables, indexes, CHECK constraints.

### Backend infrastructure

- [ ] T007 [P] `backend/src/services/enrichment/prompts.ts` — three prompt templates (description, description_long, faq) with explicit Arabic-output instruction.
- [ ] T008 [P] `backend/src/services/enrichment/validator.ts` — pure functions: `arabicRatio(text)`, `validateDescription`, `validateDescriptionLong`, `validateFaq`. Returns `{ ok: true } | { ok: false, errors: [] }`.
- [ ] T009 [P] `backend/src/services/enrichment/run-store.ts` — CRUD over `enrichment_runs` (createInFlight, markSuccess, markFailure, latestSuccessful).
- [ ] T010 [P] `backend/src/services/enrichment/draft-store.ts` — CRUD: `insertDraft`, `getById`, `listByState`, `markPublished`, `markRejected`, `markInvalid`, `selectForCopilot`.
- [ ] T011 [P] `backend/src/services/enrichment/candidates.ts` — single batched query that returns eligible (product_id, field_name) pairs respecting active+non-archived + 14-day rejection suppression + already-drafted exclusion.

### Frontend infrastructure

- [ ] T012 Merge `specs/012-arabic-catalog-enrichment/contracts/openapi.enrichment.yaml` into `shared/api-spec/openapi.yaml` and regenerate via `pnpm --filter @workspace/api-spec codegen`.

## Phase 3: User Story 1 — Admin reviews and approves a draft (P1) 🎯 MVP

### Tests for US1

- [ ] T013 [P] [US1] Pure-function tests in `backend/src/services/enrichment/__tests__/validator.test.ts` — Arabic ratio, length bounds, FAQ shape, edge cases (empty string, all-Latin, repeated tokens).
- [ ] T014 [P] [US1] Tests for the publish state transition: rejects a draft already in `state='published'`; the same admin re-clicking apply twice gets a 409 on the second call.

### Implementation

- [ ] T015 [US1] `backend/src/services/enrichment/publish.ts` — admin apply path: load draft, verify state='drafted', call the existing product-edit service path with the field update, mark draft published (with `final_text`, `published_at`, `published_by`), write the audit_logs row.
- [ ] T016 [US1] `backend/src/routes/admin/enrichment.ts` — three endpoints (GET /list, POST /:id/publish, POST /:id/reject).
- [ ] T017 [US1] Mount `enrichmentRouter` in `backend/src/routes/admin/index.ts` under requireAdmin + requirePermission("inventory").
- [ ] T018 [P] [US1] `frontend/src/components/admin/enrichment/DiffPreview.tsx` — side-by-side current ↔ proposed renderer; handles plain text + JSON-shaped FAQ input.
- [ ] T019 [P] [US1] `frontend/src/components/admin/enrichment/DraftRow.tsx` — single-row component with the three action buttons (apply / edit / reject).
- [ ] T020 [P] [US1] `frontend/src/components/admin/enrichment/EnrichmentReviewPanel.tsx` — paged list, refetch on action.
- [ ] T021 [US1] `frontend/src/pages/admin/enrichment.tsx` — `/admin/products/enrichment` route mount; depends on T019–T020.
- [ ] T022 [US1] Wire route into `frontend/src/App.tsx` and add a sidebar entry in `frontend/src/pages/admin/layout.tsx` under "الكتالوج" (gated on `inventory` scope, like the existing /admin/products entry).

## Phase 4: User Story 2 — Cron drafts content off-peak (P1)

### Tests for US2

- [ ] T023 [P] [US2] Tests in `backend/src/services/enrichment/__tests__/candidates.test.ts` — fixture-driven: archived products skipped, recently-rejected combinations skipped, already-drafted combinations skipped, thin-description threshold honored (FR-SAFETY-004).

### Implementation

- [ ] T024 [US2] `backend/src/services/enrichment/enrichment.service.ts` — orchestrator: open run → load candidates → per-candidate prompt + LLM call + validation → store draft + accumulate tokens → mark run success/failure → write audit row.
- [ ] T025 [US2] `backend/src/jobs/enrichment-runner.ts` — worker-tier-guarded cron entry: short-circuits unless WORKER_TIER=true AND ENRICHMENT_RUNNER_ENABLED=true; calls `runEnrichment()`.
- [ ] T026 [US2] Wire `enrichment-runner` into `backend/src/jobs/cron.ts` at 03:45 UTC.
- [ ] T027 [P] [US2] `backend/src/jobs/enrichment-retention.ts` — daily 04:00 UTC purge of terminal-state drafts > 90 days; reaps orphaned in_flight runs > 24h.
- [ ] T028 [P] [US2] Wire retention into `cron.ts`.

## Phase 5: User Story 3 — Token budget cap (P2)

### Tests for US3

- [ ] T029 [P] [US3] Tests in `backend/src/services/enrichment/__tests__/token-cap.test.ts` — fixture LLM client returns deterministic token counts; verify the loop halts when cumulative tokens > cap; cap=0 refuses to start; cap_reached flag set correctly.

### Implementation

- [ ] T030 [US3] Token-cap accounting inside `enrichment.service.ts` (already part of T024; this task is the test-driven hardening — separated out so the test in T029 has a clean target).

## Phase 6: User Story 4 — Copilot integration (P3)

### Tests for US4

- [ ] T031 [P] [US4] Tests in `backend/src/services/enrichment/__tests__/copilot-tool.test.ts` — `query_enrichment_drafts` returns rows verbatim; product_id filter respects single-product lookup; out-of-scope admin gets the tool excluded from the catalog.

### Implementation

- [ ] T032 [US4] Add `query_enrichment_drafts` to `backend/src/services/copilot/tools/read.ts` with `requiredScope: "inventory"`. Returns rows with `panel_url`. Append to `READ_TOOLS`.

## Phase 7: Polish

- [ ] T033 [P] RTL audit of the panel + diff preview per Constitution §Arabic-First UX.
- [ ] T034 [P] Performance sanity: a 50-candidate run completes inside the 5-minute worker budget (10k-product synthetic seed corpus, sequential Sonnet calls).
- [ ] T035 [P] Update OPERATIONS_RUNBOOK.md with a new "Catalog Enrichment" section pointing at quickstart §6, §7, §8.
- [ ] T036 [P] Update PROJECT_OVERVIEW.md with a one-paragraph summary linking the spec/plan/data-model artifacts.
- [ ] T037 Final end-to-end pilot run: trigger the cron with a fixture catalog, walk through quickstart §1–§5 on staging, capture trace ids in the release note.

---

## Dependencies

- Phase 1 (Setup) blocks Phase 2.
- Phase 2 (Foundational) blocks all user stories.
- US1 + US2 are P1 — the panel needs the runner to have produced drafts; the runner needs the panel for admins to act on its work. Ship together for the MVP.
- US3 depends on US2 (the runner is what enforces the cap).
- US4 depends on US1 (the panel is the authoritative surface; the copilot is the discoverability layer).

## MVP scope (US1 + US2 + Phase 7 polish)

T001–T028 (skipping the per-story tests where the env doesn't allow them) plus T037 form the implementable MVP. US3's cap is already covered by T024's accounting; the explicit US3 tests can land in a follow-up. US4's copilot tool can land any time after US1.
