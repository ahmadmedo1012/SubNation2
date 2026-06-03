---
description: "Task list for AI Admin Copilot implementation"
---

# Tasks: AI Admin Copilot

**Input**: Design documents from `/specs/010-ai-admin-copilot/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.copilot.yaml, contracts/tool-catalog.md, quickstart.md

**Tests**: REQUIRED. Constitution §Quality Gates requires real-invariant assertions for all new flows; FR-PREVIEW-004 (staleness), FR-CONFIRM-004 (single-use), and FR-BULK-004 (per-item outcomes) demand concurrency-style tests. Spec User Stories each include explicit Independent Test criteria. Test tasks are therefore non-optional and are interleaved before each implementation slice.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different file, no dependency on incomplete tasks — safe to parallelize.
- **[Story]**: Maps the task to a user story (US1…US8) for traceability.
- File paths are absolute-from-repo-root; an LLM picking up a task should not need additional context to find or edit them.

## Path Conventions (Web Application)

- Backend: `backend/src/`
- Frontend: `frontend/src/`
- Shared (Drizzle, Zod, OpenAPI, generated React hooks): `shared/db/src/`, `shared/api-zod/src/`, `shared/api-spec/`, `shared/api-client-react/`
- Backend tests: `backend/src/test/copilot/`
- Frontend tests: `frontend/src/test/admin/copilot/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire the project to allow copilot work to begin. Reuse the constitution's substrate; add only what's missing.

- [x] T001 Add `ANTHROPIC_API_KEY` to `config/env.example` and to the boot validator (`backend/src/lib/env.ts` or equivalent) with fail-fast on missing-in-production, matching the existing `SESSION_SECRET` / `ENCRYPTION_KEY` pattern (Constitution §IV "fail fast on weak/missing secrets")
- [x] T002 [P] Add `@anthropic-ai/sdk` to `backend/package.json` (latest stable) and run `pnpm install`
- [x] T003 [P] Audit existing schema files for `updated_at` coverage on writable entities and record findings in `specs/010-ai-admin-copilot/notes-updated-at-audit.md`: `shared/db/src/schema/products.ts` (✅ confirmed in research §R-7), `shared/db/src/schema/inventory.ts`, `shared/db/src/schema/admin_users.ts`. Output is a checklist of which tables need an `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` migration.

**Checkpoint**: Setup complete. Foundation can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, contracts, middleware, and copilot-specific services that EVERY user story depends on. **No user-story implementation may start until this phase finishes.**

### Schema & migrations

- [X] T004 Drizzle schema for `copilot_previews` in `shared/db/src/schema/copilot_previews.ts` — column set per `data-model.md` §1.1, including indexes `idx_copilot_previews_admin_created`, `idx_copilot_previews_expires`, `idx_copilot_previews_action_class`
- [X] T005 [P] Drizzle schema for `copilot_actions` in `shared/db/src/schema/copilot_actions.ts` — column set per `data-model.md` §1.2, indexes `idx_copilot_actions_admin_created`, `idx_copilot_actions_action_class`, `idx_copilot_actions_outcome`, `idx_copilot_actions_preview`
- [X] T006 [P] Drizzle schema for `copilot_action_items` in `shared/db/src/schema/copilot_action_items.ts` — column set per `data-model.md` §1.3, indexes `idx_copilot_action_items_action`, `idx_copilot_action_items_entity`
- [X] T007 Re-export the three new tables from `shared/db/src/schema/index.ts`
- [X] T008 Boot migration `backend/src/db/migrations/NNNN_copilot.sql` creating the three tables via `IF NOT EXISTS` per Constitution §V; integrates with the existing Redis-NX boot-migration lock
- [X] T009 [P] If T003 finds `inventory.updated_at` missing: add migration step in `NNNN_copilot.sql` to `ALTER TABLE inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` plus a Drizzle `onUpdate` hook; otherwise skip
- [X] T010 [P] If T003 finds `admin_users.updated_at` missing: same migration pattern as T009 for `admin_users`; otherwise skip

### Shared contracts (Constitution §III)

- [ ] T011 [P] Zod request/response schemas in `shared/api-zod/src/copilot/ask.ts` (matches `openapi.copilot.yaml` `/ask` operation)
- [ ] T012 [P] Zod schemas in `shared/api-zod/src/copilot/draft.ts`
- [ ] T013 [P] Zod schemas in `shared/api-zod/src/copilot/preview.ts` (Preview, SinglePreviewPayload, BulkPreviewPayload, ValidationWarning, RefusalResponse)
- [ ] T014 [P] Zod schemas in `shared/api-zod/src/copilot/confirm.ts` (ConfirmResponse with `awaiting_double_confirm` variant)
- [ ] T015 [P] Zod schemas in `shared/api-zod/src/copilot/history.ts` (HistoryEntry, paged response)
- [ ] T016 [P] Zod tool argument schemas in `shared/api-zod/src/copilot/tools/read.ts` (search_products, get_product, list_low_stock, summarize_recent_changes, find_anomalies)
- [ ] T017 [P] Zod tool argument schemas in `shared/api-zod/src/copilot/tools/draft.ts` (draft_catalog_edit, draft_price_change, draft_cost_change, draft_stock_change, draft_status_change, draft_permission_change, draft_wallet_action)
- [ ] T018 [P] Zod tool argument schemas in `shared/api-zod/src/copilot/tools/bulk.ts` (draft_bulk_price_change, draft_bulk_status_change, draft_bulk_category_change, ProductFilter)
- [ ] T019 Barrel export in `shared/api-zod/src/copilot/index.ts`
- [ ] T020 Merge `specs/010-ai-admin-copilot/contracts/openapi.copilot.yaml` paths and component schemas into `shared/api-spec/openapi.yaml` under the existing admin namespace
- [ ] T021 Regenerate `shared/api-client-react/` from the updated OpenAPI via the existing orval pipeline (`pnpm --filter @workspace/api-client-react generate`)

### Backend infrastructure

- [ ] T022 [P] `backend/src/lib/copilot/ids.ts` — ULID generator + URL-safe formatter for preview IDs
- [ ] T023 [P] `backend/src/lib/copilot/redaction.ts` — extends Pino redaction list with copilot-specific paths per research §R-14 (`*.metadata.before.accountPassword`, `*.preview_payload.before.accountPassword`, etc.); wires into the existing logger init
- [ ] T024 [P] `backend/src/lib/copilot/secret-scan.ts` — outbound regex pack (Postgres URLs, AWS keys, Bearer tokens, password fields) with a single `scan(payload): { hasMatch, matches }` API; used by both response and storage paths
- [ ] T025 `backend/src/lib/copilot/rate-limit.ts` — Redis sliding-window middleware: keys `copilot:rl:1m:<adminId>` (60s, 30 max) and `copilot:rl:1h:<adminId>` (3600s, 200 max), implemented via Lua for atomicity (research §R-6); returns 429 with `Retry-After` and increments `copilot_rate_limit_denials_total`
- [ ] T026 [P] `backend/src/middlewares/requirePhase.ts` — uses `phase-flags.ts` (T142) to read `phase{1,2,3}_enabled` and `phase3_high_risk_enabled`; gates routes per phase; returns 503 `COPILOT_PHASE_DISABLED` when the relevant phase is off.
- [ ] T027 [P] `backend/src/middlewares/requireCopilotPermission.ts` — maps `action_class` to required admin permission scope; on missing scope, calls the audit-write helper from T146 then rejects with `403 COPILOT_OUT_OF_SCOPE`.

### Copilot service skeletons

- [ ] T028 [P] `backend/src/services/copilot/llm.client.ts` — thin Anthropic SDK wrapper; supports `messages.create` with tool-use, prompt caching, and SSE streaming; reads model id from config
- [ ] T029 [P] `backend/src/services/copilot/system-prompt.ts` — builds the layered system prompt per research §R-3 (static preamble + cache-marked tool catalog summary + per-admin scope summary + per-session ephemeral context); never logs the full prompt at info-level
- [ ] T030 [P] `backend/src/services/copilot/tool-catalog.ts` — central tool registry: maps tool name → Zod arg schema, required scope, risk tier, draft handler, execute handler. Filters the catalog by the admin's permissions array before returning the array passed to `llm.client`
- [ ] T031 [P] `backend/src/services/copilot/preview.store.ts` — CRUD for `copilot_previews`: `create`, `getOwned`, `markFirstConfirmed`, `markDoubleConfirmed`, `markConsumed`, `cancel`, `findExpired`. All ops verify `admin_id` ownership.
- [ ] T032 [P] `backend/src/services/copilot/confirmation.ts` — single-confirm + double-confirm lifecycle: enforces 3-second cooldown server-side, single-use predicate, owner check, freshness check, 5-minute TTL check
- [ ] T033 [P] `backend/src/services/copilot/validator.ts` — schema check + business-rule check (price ≥ cost-policy floor unless override scope; stock ≥ 0; status transitions; admin self-demotion guard); returns `RefusalResponse` with stable codes per `tool-catalog.md` Refusal Protocol
- [ ] T034 `backend/src/services/copilot/audit.ts` — atomic dual-write of `copilot_actions` + `audit_logs` row (`action="copilot.execute"`, `target_type="copilot_action"`) inside a single transaction; refusal/cancellation paths write only to `copilot_actions`
- [ ] T035 [P] `backend/src/services/copilot/observability.ts` — registers Prometheus metrics: counter `copilot_command_total{kind,outcome}`, counter `copilot_rate_limit_denials_total`, counter `copilot_safety_refusal_total{reason}`, counter `copilot_validation_rejection_total`, histograms `copilot_preview_seconds{kind}` and `copilot_execute_seconds{kind}`, histograms `copilot_llm_input_tokens` and `copilot_llm_output_tokens`

### Worker

- [ ] T036 `backend/src/jobs/copilot-reaper.ts` — every 5 minutes on the `subnation-worker` tier (Constitution §V scheduling rule), deletes `copilot_previews` rows where `expires_at < now() - interval '24 hours'`. MUST refuse to run when `process.env.WORKER_TIER !== "true"` (web tier blocks the job).

### Phase-flag storage (added by /speckit-analyze remediation, 2026-06-03)

- [ ] T140 Audit existing settings storage in `shared/db/src/schema/` and `backend/src/routes/admin/settings.ts`. If a generic key/value `admin_settings` table already exists, document its shape in `specs/010-ai-admin-copilot/notes-settings-storage.md` and skip T141; otherwise proceed.
- [ ] T141 If T140 finds no suitable table: add Drizzle schema `shared/db/src/schema/copilot_settings.ts` — single row keyed by a fixed `id=1`, with boolean columns `phase1_enabled`, `phase2_enabled`, `phase3_enabled`, `phase3_high_risk_enabled` (all `NOT NULL DEFAULT false`), `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_by INTEGER REFERENCES admin_users(id)`. Add to the boot migration in T008.
- [ ] T142 [P] Backend reader in `backend/src/services/copilot/phase-flags.ts` — caches the flags row in-process for 30 seconds; invalidates on the writer's UPDATE.
- [ ] T143 [P] Admin API `PATCH /api/admin/copilot/settings` (super-admin scope `admins` or `all` only) that updates the four flags and writes a `copilot_actions` row with `action_class="phase_flag_change"` plus an `audit_logs` row — every flip of a phase flag is itself an auditable admin action. Add Zod schema in `shared/api-zod/src/copilot/settings.ts` and OpenAPI path in the contracts fragment.
- [ ] T144 [P] Admin UI in `frontend/src/pages/admin/settings.tsx` — adds a "Copilot phases" panel with four toggles, each requiring the high-risk double-confirm pattern (changing phase flags is high-risk by definition). Reuse `DoubleConfirmDialog` from T101.
- [ ] T145 [P] Test in `backend/src/test/copilot/phase-flags.test.ts` — flipping `phase1_enabled` from false→true allows `/ask`; flipping back to false returns 503; flipping `phase3_high_risk_enabled` to true while `phase3_enabled` is false is rejected as inconsistent.

### Authorization-denial audit (added by /speckit-analyze remediation, 2026-06-03)

- [ ] T146 Update `backend/src/middlewares/requireCopilotPermission.ts` (T027) so that when a request is denied for missing scope, BEFORE returning 403, it writes a `copilot_actions` row with `admin_id=<requesting admin>`, `intent_text=<request body intent_text or "">`, `action_class="refusal"`, `risk_tier="low"`, `outcome="refused"`, `failure_reason="out_of_scope: missing scope <scope_name>"`. No `audit_logs` row is written for refusals (per data-model.md §R-8).
- [ ] T147 [P] Test in `backend/src/test/copilot/audit.refusal.test.ts` — admin without `inventory` scope calls `/draft` with a price-change intent → 403 `COPILOT_OUT_OF_SCOPE`; verify exactly one `copilot_actions` row exists with `outcome="refused"` and the correct `failure_reason`. Same admin retry → second row added (refusals are not deduped).
- [ ] T148 [P] Extend the daily reconciliation worker (T119) with one more invariant: any 403 returned by copilot routes within the report window has a matching `copilot_actions` row with `outcome="refused"`. Mismatches alert via the existing webhook.

### History entity-filter (added by /speckit-analyze remediation, 2026-06-03)

- [ ] T149 Update `shared/api-zod/src/copilot/history.ts` (T015) to include optional `entity_type: z.string()` and `entity_id: z.number().int()` query params; assert that `entity_id` requires `entity_type`.
- [ ] T150 Update `backend/src/routes/admin/copilot/history.ts` (T117) so the SQL filter joins on `copilot_action_items.entity_type/entity_id` for bulk actions and on the parent `copilot_previews.affected_entity_type` + JSONB-contained id for single actions.
- [ ] T151 [P] Extend `backend/src/test/copilot/history.routes.test.ts` (T113) with two cases: filter by `entity_type=product&entity_id=42` returns only actions touching that product (single + bulk that included it); requesting `entity_id=42` without `entity_type` returns 400 with a clear message.

### Service-parity decision (added by /speckit-analyze remediation, 2026-06-03)

- [ ] T152 Decide between Option A (extract `products.service.ts`) and Option B (executor-side checklist). Document the choice in `specs/010-ai-admin-copilot/notes-service-parity.md`. Default recommendation: **Option A** — extract a thin service layer for product writes so the copilot and the existing admin route share one path; matches Constitution §III's "single source of truth" pattern and avoids the executor needing to know about every side-effect.

#### Option A path (recommended)

- [ ] T153 [P] Extract `backend/src/services/products.service.ts` from `backend/src/routes/admin/products.ts`: pull `updateProduct(id, fields, { actor })`, `archiveProduct`, `unarchiveProduct`, `setStock`, `setPrice`, `setCostPrice` into named exports that wrap the existing transaction, slugifyWithId, bumpSitemapCache, and writeAuditLog calls. Update the existing admin route to call the service instead of the inline logic; verify all existing product tests pass unchanged.
- [ ] T154 [P] Refactor T086 (catalog-edit execute), T097 (price/cost), T098 (stock), T099 (status) to call the new service functions exclusively. Executor MUST NOT invoke `productsTable.update` directly.
- [ ] T155 [P] Test in `backend/src/test/copilot/service-parity.test.ts` — for each writable field, assert that a copilot-driven edit and an admin-route-driven edit produce byte-identical state in `products`, `audit_logs`, the sitemap cache key, and the slug column.

#### Option B path (rejected unless A proves too costly)

- [ ] T156 Document in `specs/010-ai-admin-copilot/notes-service-parity.md` the exhaustive checklist of side effects the executor must invoke per write class (slugifyWithId on name/slug change, bumpSitemapCache on category/status change, writeAuditLog with the existing 'admin' actor type, etc.). The executor implementation must mirror this checklist exactly.
- [ ] T157 Add a Phase 11 audit task: "Diff the executor's product-write code path against the inline `routes/admin/products.ts` logic line-by-line; any divergence is a defect."

**Checkpoint**: Foundation ready — all user stories may start. Verify by running `pnpm typecheck` (must pass) and confirming `audit_logs` table accepts the new `action` literal.

---

## Phase 3: User Story 1 — Read-only Catalog & Operations Assistant (P1) 🎯 MVP

**Goal**: Authenticated admins ask natural-language questions about products, inventory, orders, and audit history; the copilot answers with grounded data and citations. No write tools are exposed.

**Independent Test**: Phase 1 flag enabled. Admin asks "show me products with stock below 5 in the gaming category" — copilot returns a list with product IDs grounded in `inventory` data. Admin asks "delete product 42" — copilot refuses with "write actions are not yet enabled" because no draft tool is in the catalog.

### Tests for User Story 1 (write FIRST, ensure they FAIL before implementation)

- [ ] T037 [P] [US1] Test in `backend/src/test/copilot/ask.routes.test.ts`: unauthenticated request to `POST /api/admin/copilot/ask` returns 401
- [ ] T038 [P] [US1] Test in `backend/src/test/copilot/ask.routes.test.ts`: authenticated admin gets SSE stream with `tool_use` and `tool_result` events for a search query
- [ ] T039 [P] [US1] Test in `backend/src/test/copilot/permission-filter.test.ts`: admin with only `inventory` scope cannot trigger any tool requiring `finance` or `admins`; tool catalog passed to LLM excludes them
- [ ] T040 [P] [US1] Test in `backend/src/test/copilot/secret-scan.test.ts`: a tool result that would include an inventory `accountPassword` triggers `COPILOT_SECRET_LEAK` refusal and is NOT returned to the client
- [ ] T041 [P] [US1] Test in `backend/src/test/copilot/anomaly-heuristics.test.ts`: each of the four heuristics (loss-making-price, refund-cluster, stock-spike, discount-ratio) returns expected fixture rows
- [ ] T042 [P] [US1] Test in `backend/src/test/copilot/rate-limit.test.ts`: 31st request in 60 seconds receives 429 with `Retry-After`; metric `copilot_rate_limit_denials_total` increments
- [ ] T043 [P] [US1] Test in `frontend/src/test/admin/copilot/CommandInput.test.tsx`: submitting empty input is disabled; Ctrl/Cmd+K toggles the panel

### Read tools

- [ ] T044 [P] [US1] `backend/src/services/copilot/tools/read/search-products.ts` — handler reads `productsTable` with optional filters, returns `ProductSummary[]`
- [ ] T045 [P] [US1] `backend/src/services/copilot/tools/read/get-product.ts` — full product fetch including FAQ, descriptionLong, usageTerms
- [ ] T046 [P] [US1] `backend/src/services/copilot/tools/read/list-low-stock.ts` — joins `productsTable` and `inventoryTable` count of unsold rows; threshold filter
- [ ] T047 [P] [US1] `backend/src/services/copilot/tools/read/summarize-recent-changes.ts` — pulls from `audit_logs` plus `copilot_actions`, paginated
- [ ] T048 [P] [US1] Anomaly heuristic in `backend/src/services/copilot/anomalies/loss-making-price.ts` — `products.price < products.cost_price * 0.95`
- [ ] T049 [P] [US1] Anomaly heuristic in `backend/src/services/copilot/anomalies/refund-cluster.ts` — ≥3 refunds against one user in last N hours via `wallet_ledger`
- [ ] T050 [P] [US1] Anomaly heuristic in `backend/src/services/copilot/anomalies/stock-spike.ts` — inventory delta > 5× rolling 7-day average
- [ ] T051 [P] [US1] Anomaly heuristic in `backend/src/services/copilot/anomalies/discount-ratio.ts` — flash-sale discount > 50% on a product whose 30-day median price has not changed
- [ ] T052 [US1] `backend/src/services/copilot/tools/read/find-anomalies.ts` — switch over `kind` calling one of T048–T051 and shaping `Finding[]` (depends on T048–T051)

### Route + UI

- [ ] T053 [US1] `backend/src/routes/admin/copilot/ask.ts` — SSE handler: `requireAdmin` → `requirePhase(1)` → `rateLimitCopilot` → calls `llm.client` with the read-only tool catalog filtered to the admin's scopes; emits `token`/`tool_use`/`tool_result`/`done`/`error` SSE events; runs every emitted token through `secret-scan` before flushing
- [ ] T054 [US1] `backend/src/routes/admin/copilot/index.ts` — Express router mount under `/api/admin/copilot/*`
- [ ] T055 [US1] Wire the new copilot router into `backend/src/app.ts` after the existing admin routes; ensure CSRF middleware applies
- [ ] T056 [P] [US1] `frontend/src/components/admin/copilot/CopilotPanel.tsx` — slide-out container, RTL-aware (slides from right in LTR, from left in RTL), opens via Ctrl/Cmd+K hook
- [ ] T057 [P] [US1] `frontend/src/components/admin/copilot/CommandInput.tsx` — textarea with submit-on-Enter, disabled when empty
- [ ] T058 [P] [US1] `frontend/src/components/admin/copilot/SuggestedCommands.tsx` — read-only suggestions tied to current admin route; permission-scoped so wallet suggestions never appear for admins without `finance`
- [ ] T059 [P] [US1] `frontend/src/components/admin/copilot/api.ts` — small wrappers over generated TanStack Query hooks for `/ask` SSE consumption (use native `EventSource` or `fetch` streaming)
- [ ] T060 [US1] Mount the panel in `frontend/src/pages/admin/layout.tsx` so it is available on every admin page; render only when `copilot_phase1_enabled` setting is true

**Checkpoint**: US1 fully functional — Phase 1 admins can ask questions and get grounded answers; no writes are possible because no draft tool exists in the catalog yet. Verify against quickstart §1.

---

## Phase 4: User Story 2 — Draft an Action with Preview, No Execute Yet (P2)

**Goal**: The copilot interprets change commands, runs validation, persists a `copilot_previews` row, and renders a structured before/after preview. Approve and Cancel are visible; Approve is wired but no execute path exists yet.

**Independent Test**: Phase 2 flag enabled. Admin says "update the description of 'Premium Tier' to mention 24/7 support" — receives a preview with the diff. No `audit_logs` row written. Cancel produces a `copilot_actions` row with `outcome=cancelled`.

### Tests for User Story 2

- [ ] T061 [P] [US2] Test in `backend/src/test/copilot/draft.routes.test.ts`: valid draft for catalog edit returns 200 with `preview_id` and a populated `Preview` body matching the OpenAPI schema
- [ ] T062 [P] [US2] Test in `backend/src/test/copilot/draft.validation.test.ts`: hallucinated field returns 409 `COPILOT_HALLUCINATED_FIELD` with no preview created
- [ ] T063 [P] [US2] Test in `backend/src/test/copilot/draft.validation.test.ts`: ambiguous "10" without unit context returns 409 `COPILOT_AMBIGUOUS_INTENT`
- [ ] T064 [P] [US2] Test in `backend/src/test/copilot/preview.ttl.test.ts`: a preview older than 5 minutes returns 410 on `GET /previews/:id`; reaper deletes after TTL+24h
- [ ] T065 [P] [US2] Test in `backend/src/test/copilot/preview.staleness.test.ts`: when the underlying entity's `updated_at` advances after draft, fetching the preview still works but execute fails (test the freshness lock query directly here; full execute test is US3/US4)
- [ ] T066 [P] [US2] Test in `backend/src/test/copilot/preview.ownership.test.ts`: admin A receives 403/404 when fetching admin B's preview; B receives same 403 when trying to cancel A's
- [ ] T067 [P] [US2] Test in `frontend/src/test/admin/copilot/PreviewCard.test.tsx`: renders before/after diff, displays validation warnings, shows "preview only — not yet executed", Cancel button works

### Draft tools

- [ ] T068 [P] [US2] `backend/src/services/copilot/tools/draft/catalog-edit.ts` — handler validates and persists a low-risk preview; uses Zod schema from T017
- [ ] T069 [P] [US2] `backend/src/services/copilot/tools/draft/price-change.ts` — high-risk preview; computes margin delta for `aggregate_impact`; emits `below_cost` warning if applicable
- [ ] T070 [P] [US2] `backend/src/services/copilot/tools/draft/cost-change.ts` — high-risk preview
- [ ] T071 [P] [US2] `backend/src/services/copilot/tools/draft/stock-change.ts` — high-risk preview; supports `delta` or `set_to`; emits `below_zero` warning
- [ ] T072 [P] [US2] `backend/src/services/copilot/tools/draft/status-change.ts` — high-risk preview; populates `side_effects` ("hides products from customers" for archive, "exposes to customers" for publish)
- [ ] T073 [P] [US2] `backend/src/services/copilot/tools/draft/permission-change.ts` — high-risk preview; runs the self-demotion guard from T033
- [ ] T074 [P] [US2] `backend/src/services/copilot/tools/draft/wallet-action.ts` — `risk_tier="no_execute"` preview with `handoff.target_url` populated to the existing wallet admin tool route

### Route + UI

- [ ] T075 [US2] `backend/src/routes/admin/copilot/draft.ts` — handler: rate-limit → permission check → `llm.client` with draft tools filtered to scope → on tool-call, run validator → `secret-scan` the preview payload → persist via `preview.store.create` → return `DraftResponse`
- [ ] T076 [US2] `backend/src/routes/admin/copilot/previews.ts` — `GET /previews/:id` (owner-scoped, returns 410 on TTL expiry) and `POST /previews/:id/cancel` (writes `copilot_actions` with `outcome=cancelled`)
- [ ] T077 [P] [US2] `frontend/src/components/admin/copilot/PreviewCard.tsx` — renders `SinglePreviewPayload`: intent_summary, side_effects, warnings, before/after diff, irreversible badge, Approve/Cancel buttons; in Phase 2 the Approve button is rendered but disabled with an "execute not yet enabled" tooltip until US3 ships
- [ ] T078 [US2] Wire `CopilotPanel` to the draft response: stream the assistant text, then render `PreviewCard` when a `preview_id` is returned; Cancel calls `POST /previews/:id/cancel`

**Checkpoint**: US2 functional — admins see structured previews and can cancel them; no domain mutations occur. Verify against quickstart §2.

---

## Phase 5: User Story 3 — Approve & Execute Low-Risk Catalog Edits (P2)

**Goal**: Low-risk preview + single confirmation triggers execute through existing service-layer functions. Audit pair written atomically.

**Independent Test**: Phase 3 flag + `copilot_phase3_high_risk_enabled=false`. Admin previews a description edit, clicks Approve once. The product is updated, an `audit_logs` row pairs with a new `copilot_actions` row, and the UI shows a success receipt. Same flow with a price preview returns "high-risk — currently disabled".

### Tests for User Story 3

- [ ] T079 [P] [US3] Test in `backend/src/test/copilot/execute.lowrisk.test.ts`: low-risk catalog edit confirms → `products` row updated, `copilot_actions.outcome="success"`, `audit_logs` row exists with `target_type="copilot_action"`, `target_id` matches
- [ ] T080 [P] [US3] Test in `backend/src/test/copilot/execute.atomic.test.ts`: simulate audit-log write failure mid-tx; verify product change is rolled back and no `copilot_actions` row exists (atomic dual-write invariant)
- [ ] T081 [P] [US3] Test in `backend/src/test/copilot/execute.singleuse.test.ts`: confirming the same preview twice returns 409 `COPILOT_ALREADY_CONSUMED` on the second call
- [ ] T082 [P] [US3] Test in `backend/src/test/copilot/execute.staleness.test.ts`: between draft and confirm, mutate the target product's `updated_at` directly; confirm returns 409 `COPILOT_STALE_RECORD`
- [ ] T083 [P] [US3] Test in `backend/src/test/copilot/execute.highriskblock.test.ts`: with high-risk sub-flag disabled, calling `/confirm` for a high-risk preview returns 403 `COPILOT_HIGH_RISK_DISABLED`
- [ ] T084 [P] [US3] Test in `frontend/src/test/admin/copilot/ConfirmDialog.test.tsx`: Approve button enabled, click → API call → ResultPanel renders success with link to product

### Implementation

- [ ] T085 [US3] `backend/src/services/copilot/executor.ts` — single-entity execute path: `BEGIN` → re-read entity, compare `updated_at` to `record_versions` → mark preview consumed → call the chosen interface from T152 (Option A: `products.service.ts`; Option B: documented side-effect checklist) — executor MUST NOT call Drizzle update on `productsTable` directly → write `copilot_actions` + `audit_logs` via `audit.ts` → `COMMIT`. Capture `before_state`/`after_state` JSONB
- [ ] T086 [US3] Execute handler in `backend/src/services/copilot/tools/draft/catalog-edit.ts` (extend with an `execute` function used by `executor.ts`)
- [ ] T087 [US3] `backend/src/routes/admin/copilot/confirm.ts` — `POST /previews/:id/confirm`: rate-limit → permission re-check (FR-AUTH-003) → load preview with `FOR UPDATE` → branch on `risk_tier`: `low` → executor; `high` + sub-flag enabled → `confirmation.markFirstConfirmed` and return `awaiting_double_confirm`; `no_execute` → 403 with handoff URL; expired → 410; consumed → 409
- [ ] T088 [P] [US3] `frontend/src/components/admin/copilot/ConfirmDialog.tsx` — single-confirm dialog with Approve and Cancel; calls `/confirm`
- [ ] T089 [P] [US3] `frontend/src/components/admin/copilot/ResultPanel.tsx` — success/failure indicator, link to affected entity, link to audit entry

**Checkpoint**: US3 functional — low-risk catalog edits execute end-to-end; high-risk paths still gated. Verify against quickstart §3 (low-risk flow).

---

## Phase 6: User Story 4 — High-Risk Action Double-Confirmation Gate (P2)

**Goal**: High-risk previews require a 3-second-cooldown second confirmation before executing; wallet/refund previews surface a handoff link instead of an execute control.

**Independent Test**: Phase 3 flag + `copilot_phase3_high_risk_enabled=true`. Admin previews a price change, clicks Approve → second-confirm panel renders with a 3-second countdown; clicking before 3s elapses returns 425; after 3s, double-confirm executes. Wallet previews show "Open in wallet admin" instead of an execute button.

### Tests for User Story 4

- [ ] T090 [P] [US4] Test in `backend/src/test/copilot/double-confirm.cooldown.test.ts`: `POST /previews/:id/double-confirm` BEFORE `cooldown_starts_at + 3s` returns 425 `COPILOT_COOLDOWN_NOT_ELAPSED`; AFTER returns 200 success
- [ ] T091 [P] [US4] Test in `backend/src/test/copilot/double-confirm.singleuse.test.ts`: replay of double-confirm returns 409
- [ ] T092 [P] [US4] Test in `backend/src/test/copilot/double-confirm.firstmissing.test.ts`: calling double-confirm without first calling confirm returns 409 `COPILOT_FIRST_CONFIRM_MISSING`
- [ ] T093 [P] [US4] Test in `backend/src/test/copilot/wallet.handoff.test.ts`: confirm + double-confirm on a `risk_tier="no_execute"` preview both return 403 with `handoff.target_url`
- [ ] T094 [P] [US4] Test in `backend/src/test/copilot/permission.midflight.test.ts`: between first-confirm and double-confirm, mutate the admin's permissions to remove the relevant scope; double-confirm returns 403 `COPILOT_OUT_OF_SCOPE` (FR-AUTH-003 execute-time re-check)
- [ ] T095 [P] [US4] Test in `frontend/src/test/admin/copilot/DoubleConfirmDialog.test.tsx`: countdown renders 3→2→1; second Confirm button disabled during countdown; Esc/click-outside cancels; keyboard-only path works (Tab order, Enter on enabled button)

### Implementation

- [ ] T096 [US4] `backend/src/routes/admin/copilot/double-confirm.ts` — `POST /previews/:id/double-confirm`: rate-limit → permission re-check → load preview with `FOR UPDATE` → enforce `risk_tier="high"`, `confirmed_once_at IS NOT NULL`, `now() >= cooldown_starts_at + interval '3 seconds'` → mark preview consumed → executor → 200
- [ ] T097 [P] [US4] Execute handler in pricing tool: extend `backend/src/services/copilot/tools/draft/price-change.ts` and `cost-change.ts` with `execute` functions that update `productsTable.price` / `cost_price` via the existing service-layer pattern
- [ ] T098 [P] [US4] Execute handler in `backend/src/services/copilot/tools/draft/stock-change.ts` — uses the existing inventory service to apply `delta` or `set_to`; integrates with the existing transactional purchase invariants (Constitution §I) by routing through the same service path
- [ ] T099 [P] [US4] Execute handler in `backend/src/services/copilot/tools/draft/status-change.ts` — sets `isActive`/`isArchived` via the existing product service
- [ ] T100 [P] [US4] Execute handler in `backend/src/services/copilot/tools/draft/permission-change.ts` — updates `admin_users.permissions` JSONB array; runs the self-demotion guard once more at execute time
- [ ] T101 [P] [US4] `frontend/src/components/admin/copilot/DoubleConfirmDialog.tsx` — second-confirm modal with a visible 3-second countdown; second Confirm button `disabled={remaining > 0}`; full keyboard support; for `no_execute` tier renders a handoff link instead of confirm controls
- [ ] T102 [US4] Update `ConfirmDialog` to dispatch to `DoubleConfirmDialog` when the first `/confirm` response is `awaiting_double_confirm`

**Checkpoint**: US4 functional — every high-risk class is gated by the cooldown; wallet handoff works. Verify against quickstart §3 (high-risk flow).

---

## Phase 7: User Story 5 — Bulk Operations with Sampled Preview (P3)

**Goal**: Bulk commands resolve their affected set, refuse if > 500, otherwise produce a sampled preview with aggregate impact; execute is gated by US4's double-confirm and produces per-item outcomes.

**Independent Test**: Bulk price command matching 200 products produces a preview with total_affected=200, sample of up to 20 rows, and aggregate margin delta. Same command with a filter matching 600 products is refused with `COPILOT_BULK_OVER_CAP`. After double-confirm, partial failures are recorded per-item.

### Tests for User Story 5

- [ ] T103 [P] [US5] Test in `backend/src/test/copilot/bulk.cap.test.ts`: filter matching 501 rows returns 422 `COPILOT_BULK_OVER_CAP` with `suggested_narrowing` populated; no preview created
- [ ] T104 [P] [US5] Test in `backend/src/test/copilot/bulk.preview.test.ts`: filter matching 200 rows returns preview with `total_affected=200`, `sample.length<=20`, `aggregate_impact.margin_delta_total` numeric
- [ ] T105 [P] [US5] Test in `backend/src/test/copilot/bulk.execute.test.ts`: 5 of 100 items fail validation at write time → outcome `partial`, `copilot_action_items` rows for all 100 with correct success/failure mix
- [ ] T106 [P] [US5] Test in `backend/src/test/copilot/bulk.savepoint.test.ts`: a poison row in batch 3 of 10 (50/batch) does NOT roll back batches 1-2 or batches 4-10; the failed batch rolls back to the SAVEPOINT
- [ ] T107 [P] [US5] Test in `frontend/src/test/admin/copilot/BulkPreviewCard.test.tsx`: renders count, sample table, aggregate impact, and predicted-failure list

### Implementation

- [ ] T108 [P] [US5] `backend/src/services/copilot/tools/bulk/price-change.ts` — filter resolver, ≤500 cap, sample, aggregate `margin_delta_total`, predicted failures
- [ ] T109 [P] [US5] `backend/src/services/copilot/tools/bulk/status-change.ts` — same pattern for archive/unarchive bulk
- [ ] T110 [P] [US5] `backend/src/services/copilot/tools/bulk/category-change.ts` — same pattern for bulk category move
- [ ] T111 [US5] Extend `backend/src/services/copilot/executor.ts` with the bulk execute path: iterate `affected_ids` in batches of 50, `SAVEPOINT` per batch, write a `copilot_action_items` row per item, compute parent outcome (`success` | `partial` | `failure`)
- [ ] T112 [P] [US5] `frontend/src/components/admin/copilot/BulkPreviewCard.tsx` — renders count, sample table, aggregate impact, predicted failures, irreversible badge if applicable

**Checkpoint**: US5 functional — bulk previews enforce the 500-row cap; bulk execute produces per-item audit. Verify against quickstart §3 (US5 mapping in §4).

---

## Phase 8: User Story 6 — Audit Trail & Action History (P2)

**Goal**: Every executed action is queryable. The copilot panel and the existing admin audit views surface copilot work with admin attribution and full provenance.

**Independent Test**: After a sequence of executes and cancellations, `GET /api/admin/copilot/history` returns paginated entries filtered by class and outcome; a daily reconciliation worker reports zero drift between `copilot_actions` execute count and matching `audit_logs` rows.

### Tests for User Story 6

- [ ] T113 [P] [US6] Test in `backend/src/test/copilot/history.routes.test.ts`: pagination via `cursor` works; filters by `action_class` and `outcome` are applied; only the requesting admin's rows are returned
- [ ] T114 [P] [US6] Test in `backend/src/test/copilot/audit.invariants.test.ts`: each of the five reconciliation invariants from `data-model.md` §5 returns 0 against a seeded fixture
- [ ] T115 [P] [US6] Test in `backend/src/test/copilot/audit.immutable.test.ts`: there is no UI-callable update or delete path for `copilot_actions` or `audit_logs`; any direct API attempt returns 404
- [ ] T116 [P] [US6] Test in `frontend/src/test/admin/copilot/HistoryView.test.tsx`: filters render correctly; selecting an entry expands to show before/after JSON

### Implementation

- [ ] T117 [US6] `backend/src/routes/admin/copilot/history.ts` — `GET /history` with cursor pagination, filters per OpenAPI; scoped to the requesting admin
- [ ] T118 [P] [US6] `frontend/src/components/admin/copilot/HistoryView.tsx` — table with filter chips (class/outcome/admin/since), expandable rows showing before/after, link-out to affected entity
- [ ] T119 [US6] `backend/src/jobs/copilot-reconciliation.ts` — daily worker job: runs the five SQL invariants from `data-model.md` §5; any non-zero result fires the existing alerting webhook (`alerting.service.ts`)

**Checkpoint**: US6 functional — full audit visibility plus the reconciliation safety net. Verify against quickstart §4 (US6 mapping).

---

## Phase 9: User Story 7 — Anomaly & Risk Inspection (P3)

**Goal**: The copilot summarizes unusual or risky activity using the four heuristics from US1; can offer a draft mitigation as a preview only.

**Independent Test**: Insert a known-pattern fixture (price-below-cost product, refund cluster, stock spike, 60% discount on a price-stable product). Ask "summarize loss-making products" / "any unusual refund activity?" / etc. The copilot lists the rows, explains each, and proposes a draft mitigation that is preview-only and never auto-confirms.

### Tests for User Story 7

- [ ] T120 [P] [US7] Test in `backend/src/test/copilot/anomaly-summary.test.ts`: model response includes the heuristic-returned IDs verbatim, with no fabricated entries (FR-INTENT-003)
- [ ] T121 [P] [US7] Test in `backend/src/test/copilot/anomaly-mitigation.test.ts`: when admin asks "fix the loss-making prices", model produces a draft preview (US2 path) and never auto-confirms; preview must still be Approved by the admin

### Implementation

- [ ] T122 [US7] System-prompt addition: "When asked about anomalies or risky activity, use `find_anomalies` rather than fabricating findings. To propose mitigation, use the appropriate `draft_*` tool — never act on the anomaly directly." Update `backend/src/services/copilot/system-prompt.ts`
- [ ] T123 [US7] `frontend/src/components/admin/copilot/PreviewCard.tsx` — render an "Anomaly source" reference when the preview was triggered by `find_anomalies`, linking back to the heuristic match (no new component, just an extension)

**Checkpoint**: US7 functional — anomaly summaries are grounded; mitigations follow the standard draft → preview → confirm flow.

---

## Phase 10: User Story 8 — Suggested Commands, Recent Actions, Inline UX (P3)

**Goal**: The panel surfaces context-aware suggested commands, recent actions, and respects admin permissions everywhere.

**Independent Test**: Open the panel from `/admin/products/:id` — suggestions reference that product. Recent actions list shows the admin's last N copilot actions on that entity, linked to their audit entries. An admin without `finance` scope never sees wallet-related suggestions anywhere.

### Tests for User Story 8

- [ ] T124 [P] [US8] Test in `frontend/src/test/admin/copilot/SuggestedCommands.test.tsx`: panel opened from `/admin/products/42` shows suggestions referencing product 42; an admin without `finance` scope never sees wallet-related suggestions
- [ ] T125 [P] [US8] Test in `frontend/src/test/admin/copilot/RecentActions.test.tsx`: only the requesting admin's recent actions are listed; entries link to their audit entries

### Implementation

- [ ] T126 [P] [US8] `frontend/src/components/admin/copilot/RecentActions.tsx` — fetches `/history?limit=5`, renders entries with one-line summary and link
- [ ] T127 [P] [US8] Extend `frontend/src/components/admin/copilot/SuggestedCommands.tsx` with route-aware logic: on a product-detail page suggest update-price, update-description, add-FAQ, publish/archive (filtered by scope); on inventory page suggest stock-related; on admin-management page suggest permission-related
- [ ] T128 [US8] Suggested-command permission filter: pull admin permissions from existing session API, filter the suggestion list before render so out-of-scope items never appear

**Checkpoint**: US8 functional — discoverability and recent-action visibility complete.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Tighten everything that crosses stories.

- [ ] T129 [P] RTL audit of all copilot UI: verify panel slide direction, diff renderer alignment, button order in `DoubleConfirmDialog`, all i18n strings authored Arabic-first per Constitution §Arabic-First (RTL) UX
- [ ] T130 [P] Performance verification on staging: run synthetic load to validate SC-006 (single preview ≤5s p95) and SC-007 (bulk ≤500-row preview ≤15s p95); record the histogram percentiles
- [ ] T131 [P] Verify the existing constitution gate: catalog and wallet read endpoints stay <200ms p95 with copilot routes registered
- [ ] T132 [P] Constitution §IV defense-in-depth review: tabletop the six layers (auth, scope, IP rate-limit, user rate-limit, copilot rate-limit, preview TTL+version+single-use) and confirm none can be bypassed individually
- [ ] T133 [P] Logger redaction smoke test: write a synthetic copilot preview containing `accountPassword`, run the log line through the redactor, assert the value is replaced
- [ ] T134 [P] Outbound secret-scan smoke test: assemble a preview payload with a Postgres URL in `metadata.before`, verify the response is refused with `COPILOT_SECRET_LEAK`
- [ ] T135 [P] Update `OPERATIONS_RUNBOOK.md` with copilot-specific runbook entries: how to read `copilot_actions`, what to do if reconciliation alerts fire, how to roll back a phase via the admin settings flag
- [ ] T136 [P] Update `PROJECT_OVERVIEW.md` with a one-paragraph copilot summary linking the spec/plan/research/data-model/quickstart artifacts
- [ ] T137 [P] Validate `ANTHROPIC_API_KEY` fail-fast in production: simulate a missing/empty key on boot and verify the process exits non-zero with the existing fail-fast message pattern
- [ ] T138 [P] Validate phase flags: with all three phase flags off, confirm `/api/admin/copilot/*` returns 503 `COPILOT_PHASE_DISABLED` with no LLM call made (no token cost burned on disabled phase)
- [ ] T139 Final end-to-end run of `quickstart.md` §1–§4 against staging; capture the trace IDs in a release note for the pilot admin group

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **blocks all user stories**.
- **User Stories (Phase 3+)**: each starts after Foundational. US1 is the MVP. US3 depends on US2's preview surface. US4 depends on US3's executor. US5 depends on US4 (high-risk gate). US6 depends on having `copilot_actions` rows to read (any of US3/US4/US5). US7 depends on US1 (read-only) + US2 (draft) only. US8 depends on US1 + US6.
- **Polish (Phase 11)**: depends on all desired user stories.

### User Story Dependencies

- **US1 (P1, MVP)** — depends on: Phase 2 only.
- **US2 (P2)** — depends on: Phase 2 only. Independent of US1.
- **US3 (P2)** — depends on: Phase 2 + US2 (executor consumes US2 previews).
- **US4 (P2)** — depends on: Phase 2 + US3 (extends executor with high-risk gate).
- **US5 (P3)** — depends on: Phase 2 + US4 (bulk executes are always high-risk).
- **US6 (P2)** — depends on: Phase 2; richer with US3+/data, but `/history` endpoint can ship after Phase 2.
- **US7 (P3)** — depends on: Phase 2 + US1 (read tools) + US2 (draft mitigation).
- **US8 (P3)** — depends on: Phase 2 + US1 (UI shell) + US6 (recent-actions feed).

### Within Each User Story

- Tests written first; verified failing before implementation.
- Models/schemas before services; services before routes; routes before frontend wiring.
- Story marked complete only when its Independent Test passes end-to-end.

### Parallel Opportunities

- All Setup tasks marked [P].
- Foundational schema tasks T004/T005/T006 are sequential (T007 then needs all three) but T011–T018 (Zod schemas) and T022–T035 (services) are mostly parallel within their groups.
- Within US1, T044–T051 (read tools and anomaly heuristics) are all parallel; T056–T058 (frontend components) are parallel.
- Within US2, T068–T074 (draft tool handlers) are all parallel.
- Within US4, T097–T100 (execute handlers across pricing/inventory/status/permission) are all parallel; UI work T101 is parallel with the backend handlers.
- Within US5, T108–T110 (bulk tool handlers) are parallel.

---

## Parallel Example: User Story 1

```bash
# Backend tests (parallel):
Task: "Test that authenticated admin gets SSE stream — backend/src/test/copilot/ask.routes.test.ts"
Task: "Test permission-scope tool filter — backend/src/test/copilot/permission-filter.test.ts"
Task: "Test rate limit 429 — backend/src/test/copilot/rate-limit.test.ts"
Task: "Test secret scanner — backend/src/test/copilot/secret-scan.test.ts"

# Read tools (parallel):
Task: "search_products handler — backend/src/services/copilot/tools/read/search-products.ts"
Task: "get_product handler — backend/src/services/copilot/tools/read/get-product.ts"
Task: "list_low_stock handler — backend/src/services/copilot/tools/read/list-low-stock.ts"
Task: "summarize_recent_changes handler — backend/src/services/copilot/tools/read/summarize-recent-changes.ts"

# Anomaly heuristics (parallel):
Task: "loss-making-price heuristic — backend/src/services/copilot/anomalies/loss-making-price.ts"
Task: "refund-cluster heuristic — backend/src/services/copilot/anomalies/refund-cluster.ts"
Task: "stock-spike heuristic — backend/src/services/copilot/anomalies/stock-spike.ts"
Task: "discount-ratio heuristic — backend/src/services/copilot/anomalies/discount-ratio.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup (~1–2 days).
2. Phase 2 Foundational (~3–5 days; bulk of the schema, contracts, and infrastructure).
3. Phase 3 US1 (~2–3 days).
4. **STOP and validate**: pilot admins use the read-only assistant for one week. Measure SC-002 (preview accept rate is N/A here) and SC-010 (admin satisfaction).
5. Ship Phase 1 to production behind `copilot_phase1_enabled`.

### Incremental Delivery

1. MVP (US1) → Phase 1 in prod.
2. - US2 → Phase 2 in prod (still no writes; admins see how the copilot would change things).
3. - US3 → Phase 3 in prod with `copilot_phase3_high_risk_enabled=false` (low-risk catalog edits only).
4. - US4 → flip the high-risk sub-flag; price/stock/publish/archive/permission classes go live.
5. - US5 → bulk goes live (still gated by US4's double-confirm).
6. - US6 → richer history view + reconciliation alerts active.
7. - US7 → anomaly inspector active.
8. - US8 → polished discoverability.
9. - Polish phase.

### Parallel Team Strategy

After Phase 2 completes:

- **Track A (Backend services)** — US2 draft handlers → US3 executor → US4 high-risk handlers → US5 bulk path.
- **Track B (Frontend)** — US1 panel/CommandInput → US2 PreviewCard → US3 ConfirmDialog/ResultPanel → US4 DoubleConfirmDialog → US5 BulkPreviewCard → US8 RecentActions/Suggestions.
- **Track C (Audit + Ops)** — US6 history route + reconciliation worker; Phase 11 polish items in parallel.

Each track integrates at the route boundaries; the OpenAPI fragment (T020) and generated hooks (T021) keep them in sync.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps the task to a user story for traceability.
- Each user story has a matching set of Independent Test criteria from `spec.md`; tasks include the tests that demonstrate those criteria.
- Verify tests fail before implementing.
- Commit after each task (or logical group); follow the project commit-and-push convention.
- Stop at any checkpoint to validate the story independently.
- Do not weaken safety invariants for delivery speed: SC-003/004/005/008/009/012 must each be 0 in production.
