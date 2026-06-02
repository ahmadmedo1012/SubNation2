---
description: "Task list for Auth and Wallet Anomaly Detection (003-anomaly-detection)"
---

# Tasks: Auth and Wallet Anomaly Detection

**Input**: Design documents from `/specs/003-anomaly-detection/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: The spec does not request TDD; tests are deferred to
the existing SubNation test suite under
`backend/tests/risk/`. Per-phase kill criteria and the
success metrics in spec §9-§10 serve as the operational
acceptance tests.

**Organization**: Tasks are grouped by user story to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Web app**: `backend/src/`, `frontend/src/`, `shared/db/`, `shared/api-zod/`, `shared/api-spec/`, `shared/api-client-react/`
- Paths shown below reflect the existing SubNation monorepo (see `plan.md` §"Project Structure").

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization; create the additive
directory layout and register the new shared packages.

- [ ] T001 Create risk-module directories per plan §"Project Structure" (backend services/routes, frontend pages/components, shared schema/zod/openapi/hooks)
- [ ] T002 [P] Register `shared/db/src/schema/risk.ts` in the existing Drizzle barrel `shared/db/src/schema/index.ts`
- [ ] T003 [P] Register `shared/api-zod/src/risk.ts` in the existing Zod barrel `shared/api-zod/src/index.ts`
- [ ] T004 [P] Create a `tools/quality/risk-lint.ts` placeholder that re-uses `pnpm lint --filter @subnation/api-zod` and `pnpm typecheck` for the new risk module (CI wiring, no behavior)
- [ ] T005 [P] Add a feature-flag env var `RISK_PIPELINE_ENABLED` (default `false`) — read directly from `process.env` in `backend/src/services/risk-scoring.service.ts` and gated in `backend/scripts/synthetic-risk-event.ts`; document it in `config/env.example` next to `ALERTING_ENABLED` so the Phase 1 rollout is opt-in (the project does not have a `backend/src/config/env.ts` — env loading lives in `backend/src/lib/env.ts`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete
before ANY user story can be implemented. Rule engine,
scoring orchestration, observability, and the four new
Drizzle tables (in a single migration, per plan
§"Migrations") land here.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T006 Add Drizzle schemas for `risk_events`, `risk_rules`, `risk_config`, `risk_labels` in `shared/db/src/schema/risk.ts` per `data-model.md` (single Drizzle-generated migration committed under `shared/db/drizzle/<next_index>_<name>.sql` via `pnpm --filter @subnation/db db:generate`; never hand-author SQL — the project is Drizzle-first per the existing `shared/db/drizzle/` layout). The migration MUST include `risk_events.shownAt` (nullable timestamptz) per `data-model.md` §1 so SC-004 (AW-1 triage time) is measurable.
- [ ] T007 [P] Define Zod validators for all request/response shapes in `shared/api-zod/src/risk.ts` per `contracts/*.contract.md` (one schema per contract, exported with stable names: `RiskDashboardResponse`, `RiskEventListQuery`, `RiskEventDetail`, `RiskEventLabelRequest`, `BulkLabelRequest`, `RiskRulesListResponse`, `RiskRuleUpdateRequest`, `RiskConfigResponse`, `RiskConfigUpdateRequest`, `RiskUserHistoryResponse`)
- [ ] T008 [P] Extend `shared/api-spec/openapi.yaml` with the new paths under `tags: [admin/risk]` matching the contracts (server-side validation only; no client codegen yet)
- [ ] T009 Implement the typed rule engine in `backend/src/services/risk-rules.service.ts` per `research.md` §4 (typed predicates; no DSL yet)
- [ ] T010 Implement the scoring orchestration in `backend/src/services/risk-scoring.service.ts` (reads from `risk-rules.service`; produces `{ score, level, confidence, ruleFired }` using the Phase-1 confidence formula in `research.md` §9; consults the cached `risk_config.allowlist` (ips/devices/phones) and forces `actionTaken = log` for any allowlisted source per spec §5.4; combines the per-event score with the rolling per-user aggregated risk score from T010a before deciding `actionTaken` per spec §5.4; emits to `risk_events` table when `RISK_PIPELINE_ENABLED=true`; falls back to rules-only with a Sentry warning on any internal error per `research.md` §1)
- [ ] T010a [P] Implement the rolling per-user aggregated risk score in `backend/src/lib/risk-aggregate.ts` (7-day weighted mean of recent `risk_events.score` for the user, with exponential decay `λ=0.1/day`; consumed by T010's action decision and by T046's `userHeatmap.aggregatedScore`; cached in Redis with 5-min TTL keyed on `userId`)
- [ ] T011 [P] Implement the soft-block middleware in `backend/src/middleware/risk-soft-block.ts` (reads `risk_events.actionTaken=soft_block` for the current `userId`; consults `risk_config.allowlist` and short-circuits when the request's IP/device/phone matches; forces re-auth on the next protected request when not allowlisted; never blocks the request itself; uses the existing auth providers per Constitution Principle II)
- [ ] T011a [P] Implement the hard-block middleware in `backend/src/middleware/risk-hard-block.ts` (reads `risk_events.actionTaken=hard_block` for the current `userId`; gated on `risk_config.modelEnabled=true` AND `risk_config.autoBlockEnabled.hardBlock=true` per `data-model.md` §3 — otherwise no-op; consults the allowlist and short-circuits on match; refuses the triggering action with HTTP 423 Locked + structured error code `risk.hard_block_active`; writes to `audit_logs` with `action='risk.hard_block_applied'`; never installed on the purchase critical path per Constitution Principle I)
- [ ] T012 [P] Implement the critical-alert writer in `backend/src/services/risk-alerts.service.ts` (writes a row to the existing `admin_alerts` table and broadcasts via the existing Telegram bot + Discord webhook if `ALERTING_ENABLED=true` and `DISCORD_WEBHOOK_URL` is set; no new alert channel)
- [ ] T013 [P] Implement the audit-log fallback label writer in `backend/src/lib/risk-labels.ts` (Phase 1 fallback: labels go to `audit_logs` with `action='risk.label'`, `target=<riskEventId>`, `meta={label, notes}`; replaced by `risk_labels` table once migration T006 lands)
- [ ] T014 [P] Add Prometheus counters/histograms in `backend/src/observability/metrics.ts`: `risk_events_scored_total{event_type,level}`, `risk_scoring_duration_seconds{event_type}`, `risk_rule_fired_total{rule_id}`, `risk_alerts_sent_total{channel,level}`, `risk_labels_total{label}`
- [ ] T015 Seed the Phase-1 hard-threshold rules into `risk_rules` via a one-time seed script `backend/src/db/seed/risk-rules.seed.ts` (covers spec §4.1 hard-threshold patterns only — statistical signals belong in T048): `otp_brute_force_v1` (>5 OTPs same phone in 15min ⇒ +50 score), `failed_login_burst_v1` (>10 failed logins same IP in 15min ⇒ +40 score), `impossible_travel_v1` (login from different country within 1h of last success ⇒ +50 score), `new_account_large_topup_v1` (first topup >100 LYD AND account_age<24h ⇒ +60 score), `card_fingerprint_shared_v1` (same card across >2 user accounts ⇒ +70 score), `otp_burst_per_ip_v1` (>20 OTP requests same IP in 1h ⇒ +30 score). Each row stores the score increment in `expression.score_delta` so T044's synthetic event (`new_account_large_topup` + `impossible_travel` ⇒ 60+50 = 110, capped to 100, level=critical) deterministically reaches critical. Idempotent on `risk_rules.name`.
- [ ] T016 [P] Add the risk-scoring service health indicator to the existing `/status` page at `backend/src/routes/status.ts` (green/yellow/red; returns to red on any Sentry capture in the last 5 min)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 - Investigate a flagged event (Priority: P1) 🎯 MVP

**Goal**: An admin opens a high-risk event from the
dashboard, sees the rules that fired, the statistical
signals, and (Phase 3) the ML score with top-3
contributing features. One click takes the admin from
the event to the user's full risk history.

**Independent Test**: From a synthetic high-risk event
(emitted via a dev-only endpoint), open the event in
the investigation view; the five questions (who/when/
where/what/what-to-do) are answerable in < 30 seconds.

### Implementation for User Story 1

- [ ] T017 [P] [US1] Implement `GET /api/admin/risk/events/:id` in `backend/src/routes/admin/risk.ts` (returns the `RiskEventDetail` shape per `contracts/risk-events.contract.md`; 404 on missing; admin + 2FA gated)
- [ ] T018 [P] [US1] Implement `GET /api/admin/risk/users/:userId/history` in `backend/src/routes/admin/risk.ts` (returns the `RiskUserHistoryResponse` shape per `contracts/risk-user-history.contract.md`; reads from `risk_events`, `audit_logs`, and the user features in `backend/src/lib/risk-features.ts`; 404 on missing user)
- [ ] T019 [P] [US1] Implement per-user feature snapshot helper in `backend/src/lib/risk-features.ts` (account age, lifetime topup/order counts and amounts, std-dev, recent activity windows, distinct countries 30d)
- [ ] T020 [P] [US1] Create the `RiskInvestigation` component in `frontend/src/components/admin/risk/RiskInvestigation.tsx` (header + rule panel + statistical-signals panel + user-timeline panel + action panel; per spec §6.3)
- [ ] T021 [P] [US1] Create the `RiskUserHistory` component in `frontend/src/components/admin/risk/RiskUserHistory.tsx` (risk timeline + event log + action history + feature snapshot; per spec §6.5)
- [ ] T021a [P] [US1] Implement `POST /api/admin/risk/users/:userId/lock` in `backend/src/routes/admin/risk.ts` (sets `users.isActive=false`; writes to `audit_logs` with `action='risk.lock'`, `target=<userId>`, `meta={reason}`; admin + 2FA gated; never on the purchase critical path per Constitution Principle I; rejects 409 if user is already locked)
- [ ] T021b [P] [US1] Implement `POST /api/admin/risk/users/:userId/unlock` in `backend/src/routes/admin/risk.ts` (sets `users.isActive=true`; writes to `audit_logs` with `action='risk.unlock'`; admin + 2FA gated; rejects 409 if user is not currently locked)
- [ ] T021c [P] [US1] Implement `POST /api/admin/risk/users/:userId/force-reauth` in `backend/src/routes/admin/risk.ts` (writes a `risk_events` row with `actionTaken='soft_block'` so T011's middleware will force re-auth on the user's next protected request; deletes the user's active `sessions` rows so the next request restarts the existing provider flow per Constitution Principle II — does not create a new auth path; writes to `audit_logs` with `action='risk.force_reauth'`; admin + 2FA gated)
- [ ] T021d [P] [US1] Implement `POST /api/admin/risk/users/:userId/require-approval` in `backend/src/routes/admin/risk.ts` (sets a per-user flag in `risk_config.allowlist`-counterpart `requireApprovalUserIds` jsonb on the singleton config; consumed by the wallet-topup and order routes to require admin approval before the next state change; writes to `audit_logs` with `action='risk.require_approval'`; admin + 2FA gated)
- [ ] T022 [US1] Create the investigation page in `frontend/src/pages/admin/risk-event.tsx` that mounts `RiskInvestigation` and links to `RiskUserHistory` (route `/admin/risk/events/:id`; admin-only via existing route guards)
- [ ] T023 [US1] Regenerate the React Query hooks in `shared/api-client-react/src/hooks/risk.ts` for `useAdminRiskEvent`, `useAdminRiskUserHistory`, `useAdminRiskLockUser`, `useAdminRiskUnlockUser`, `useAdminRiskForceReauth`, and `useAdminRiskRequireApproval` (run the existing codegen; commit the regenerated file). Also extend `shared/api-spec/openapi.yaml` to cover the four new admin-action paths so codegen has a source.

**Checkpoint**: At this point, US1 is fully functional and
testable independently: the admin can open any
high-risk event and see the full investigation view.

---

## Phase 4: User Story 2 - Triage the daily review queue (Priority: P1)

**Goal**: A reviewer processes 30 events in under 30
minutes, batch-confirming false positives and
escalating the rest, with filters by level, time,
event type, and rule.

**Independent Test**: Synthesize 30 events (15 fraud,
15 not-fraud), filter to "medium risk, last 24h",
confirm-fraud and mark-false-positive in bulk; the
labels appear in `risk_labels` and on a reload.

### Implementation for User Story 2

- [ ] T024 [P] [US2] Implement `GET /api/admin/risk/events` in `backend/src/routes/admin/risk.ts` (returns the `RiskEventListQuery` shape per `contracts/risk-events.contract.md`; supports filters `level`, `eventType`, `from`, `to`, `ruleFired`, `userSearch`; cursor-based pagination; admin + 2FA gated)
- [ ] T025 [P] [US2] Implement cursor-based pagination helper in `backend/src/lib/risk-cursor.ts` (opaque base64 cursor encoding `(createdAt, id)`; deterministic order `(createdAt DESC, id DESC)`; the existing Postgres index from T006 makes the query O(log n))
- [ ] T026 [P] [US2] Implement `POST /api/admin/risk/events/:id/label` in `backend/src/routes/admin/risk.ts` (validates with `RiskEventLabelRequest`; writes to `risk_labels`; 404 on missing event; 409 if already labeled; admin + 2FA gated)
- [ ] T027 [P] [US2] Implement `POST /api/admin/risk/events/bulk-label` in `backend/src/routes/admin/risk.ts` (validates with `BulkLabelRequest`; max 100 events; returns applied count + skipped reasons; admin + 2FA gated)
- [ ] T028 [P] [US2] Create the `RiskEventCard` component in `frontend/src/components/admin/risk/RiskEventCard.tsx` (one row in the review queue; quick-action buttons; click to open investigation view)
- [ ] T029 [P] [US2] Create the `RiskReviewQueue` component in `frontend/src/components/admin/risk/RiskReviewQueue.tsx` (filter bar, sortable list, bulk-action toolbar, pagination controls; per spec §6.2)
- [ ] T030 [US2] Create the review-queue page in `frontend/src/pages/admin/risk-events.tsx` that mounts `RiskReviewQueue` (route `/admin/risk/events`; admin-only)
- [ ] T031 [US2] Regenerate the React Query hooks in `shared/api-client-react/src/hooks/risk.ts` for `useAdminRiskEvents`, `useAdminRiskLabelEvent`, and `useAdminRiskBulkLabel` (run the existing codegen; commit the regenerated file)

**Checkpoint**: At this point, US1 and US2 both work
independently. The review-queue → investigation flow
is complete.

---

## Phase 5: User Story 3 - Configure risk thresholds and allowlists (Priority: P2)

**Goal**: An admin tunes thresholds and the allowlist
from the admin panel without redeploying; changes are
audit-logged and take effect on the next event.

**Independent Test**: Change the high-risk threshold
from 60 to 70 from the admin panel; the change is in
`risk_config`, in `audit_logs`, and applies to the
next scored event without a redeploy.

### Implementation for User Story 3

- [ ] T032 [P] [US3] Implement `GET /api/admin/risk/rules` in `backend/src/routes/admin/risk.ts` (returns the `RiskRulesListResponse` shape; admin + 2FA gated)
- [ ] T033 [P] [US3] Implement `PUT /api/admin/risk/rules/:id` in `backend/src/routes/admin/risk.ts` (validates with `RiskRuleUpdateRequest`; increments `version`; writes to `audit_logs`; admin + 2FA gated)
- [ ] T034 [P] [US3] Implement `GET /api/admin/risk/config` in `backend/src/routes/admin/risk.ts` (returns the `RiskConfigResponse` shape; auto-seeds the singleton on first read; admin + 2FA gated)
- [ ] T035 [P] [US3] Implement `PUT /api/admin/risk/config` in `backend/src/routes/admin/risk.ts` (validates with `RiskConfigUpdateRequest`; enforces `thresholds.low < medium < high < critical` and `autoBlockEnabled.hardBlock=true` requires `modelEnabled=true`; writes to `audit_logs`; **publishes a `risk_config_invalidated` cache-bust message via Redis pub/sub so the cache in T037 evicts immediately rather than waiting up to 60s**; admin + 2FA gated)
- [ ] T036 [P] [US3] Implement the small DSL validator in `backend/src/lib/risk-dsl.ts` (parses the JSONB `expression` per `data-model.md` §2 DSL schema sketch; rejects unknown operators and free-form code; returns typed AST or a structured error)
- [ ] T037 [P] [US3] Wire the `risk-config` cache in `backend/src/services/risk-config-cache.service.ts` (Redis-backed; TTL 60s; cache-aside; **subscribes to the `risk_config_invalidated` channel so a PUT in T035 evicts the cache within ~50ms — satisfying the spec §1 US3 acceptance "next event uses the new threshold"**; consumed by the scoring service to avoid a DB hit per event)
- [ ] T038 [P] [US3] Create the `RiskConfigEditor` component in `frontend/src/components/admin/risk/RiskConfigEditor.tsx` (threshold sliders with validation, allowlist editor, auto-block toggles; per spec §6.1)
- [ ] T039 [P] [US3] Create the `RiskRulesEditor` component in `frontend/src/components/admin/risk/RiskRulesEditor.tsx` (rule list, enable/disable toggle, expression viewer; per spec §6.1)
- [ ] T040 [US3] Create the configuration page in `frontend/src/pages/admin/risk-config.tsx` that mounts `RiskConfigEditor` and `RiskRulesEditor` (route `/admin/risk/config`; admin-only)
- [ ] T041 [US3] Regenerate the React Query hooks in `shared/api-client-react/src/hooks/risk.ts` for `useAdminRiskRules`, `useAdminRiskUpdateRule`, `useAdminRiskConfig`, and `useAdminRiskUpdateConfig` (run the existing codegen; commit the regenerated file)

**Checkpoint**: At this point, US1, US2, and US3 are
fully functional. The admin can investigate, triage,
and tune the system from the panel.

---

## Phase 6: User Story 4 - Receive a critical alert (Priority: P2)

**Goal**: A critical event (level=critical — derived from
the admin-configurable `risk_config.thresholds.critical`)
triggers an immediate alert on the existing `admin_alerts`
channel (Telegram, Discord via `ALERTING_ENABLED` /
`DISCORD_WEBHOOK_URL`). The alert includes the user id,
the action attempted, the top contributing features, and
a one-click link to the investigation view.

**Independent Test**: A synthetic critical event causes
an alert to appear in the configured channel within 60
seconds of scoring.

### Implementation for User Story 4

- [ ] T042 [P] [US4] Wire `level === 'critical'` → `risk-alerts.service.send` in `backend/src/services/risk-scoring.service.ts` (after every score is persisted; **uses the derived `level` from `risk_config.thresholds.critical` (cached via T037) so admin threshold tuning takes effect without a redeploy — never hard-code 85**; non-blocking; failure to deliver does not fail the scoring path; logged at WARN with `risk_alert_delivery_failed`)
- [ ] T043 [P] [US4] Add the critical-alert latency timer in `backend/src/observability/metrics.ts` (`risk_alert_delivery_seconds{channel}` histogram; SC-005 SLO of 60s is observable on `/status` and Grafana)
- [ ] T044 [P] [US4] Add the synthetic critical-event dev tool in `backend/scripts/synthetic-risk-event.ts` (POST a fake `login_success` from a new country followed by a 200 LYD top-up within 1h of account creation; given the deterministic rule scores in T015 — `new_account_large_topup_v1` (+60) and `impossible_travel_v1` (+50) — the synthesised event reaches score=100, level=critical regardless of the cached `risk_config.thresholds.critical` (default 85); gated on `NODE_ENV !== 'production'`; for SC-005 verification only)
- [ ] T045 [US4] Add the alert-payload contract test in `backend/tests/risk/alerts.test.ts` (verifies the alert payload includes `userId`, `eventType`, `topFeatures`, and the investigation-view URL with a valid one-time link)

**Checkpoint**: At this point, US1-US4 are all
independently functional. The full admin surface
(investigate, triage, configure, alert) is in place.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Dashboard entry point, statistical signals
(spec Phase 2), ML model (spec Phase 3), retention,
daily digest, kill-criteria widget, and quickstart
validation. These are improvements that affect multiple
user stories.

- [ ] T046 [P] Implement `GET /api/admin/risk/dashboard` in `backend/src/routes/admin/risk.ts` (returns the `RiskDashboardResponse` shape per `contracts/risk-dashboard.contract.md`; 4 parallel sub-queries for top-line metrics, live feed, user heatmap, rule health; admin + 2FA gated)
- [ ] T047 [P] Create the `RiskDashboard` component in `frontend/src/components/admin/risk/RiskDashboard.tsx` (top-line metrics, live feed, user heatmap, rule health; per spec §6.1) and the page in `frontend/src/pages/admin/risk.tsx` (route `/admin/risk`)
- [ ] T048 [P] Implement the statistical signals service in `backend/src/services/risk-statistical.service.ts` (z-score on top-up amount, z-score on hourly login rate, velocity 1h/6h/24h, geo-entropy 30d, time-of-day deviation; per-user baselines in Postgres + Redis hot-cache per `research.md` §3)
- [ ] T049 [P] Wire the per-user baselines in `backend/src/lib/risk-baselines.ts` (read-through cache; rebuild on cold start from Postgres; bound the hot-cache to top 1K active users)
- [ ] T050 [P] Implement the daily digest job in `backend/src/jobs/risk-daily-digest.ts` (one Telegram message at admin-local morning time with the day's top-10 highest-risk events, the day's confirmed-fraud count, and the 7-day false-positive rate; composes with O1 from the AI Opportunity Assessment)
- [ ] T051 [P] Add the ML inference library to `backend/package.json` (decision per `research.md` §2: prefer `onnxruntime-node` with a `lightgbm` model exported to ONNX; fallback to `@tensorflow/tfjs-node`; gated on the 500-label gate)
- [ ] T052 [P] Implement the model retrain job in `backend/src/jobs/risk-retrain.ts` (weekly; trains on `risk_labels` from the last 90 days; refuses to deploy unless AUC >= 0.7 on hold-out; per the Phase-3 kill criterion in spec §10)
- [ ] T053 [P] Add SHAP-based top-features computation in `backend/src/lib/risk-shap.ts` (top-3 features with human-readable descriptions; if SHAP explanations are unintelligible in a user test, the model is not deployed per spec §4.4)
- [ ] T054 [P] Add the 90-day retention policy in `backend/src/jobs/risk-retention.ts` (daily cron on `subnation-worker`; purges `risk_events` older than 90 days; extends labeled events to 97 days; keeps `risk_labels` indefinitely)
- [ ] T055 [P] Add the kill-criteria widget in `frontend/src/components/admin/risk/RiskKillCriteria.tsx` (shows the 7-day false-positive rate, the 30-day confirmed-fraud count, and the AUC of the latest retrain; turns red when any per-phase kill criterion from spec §10 is exceeded)
- [ ] T055a [P] Add the degraded-mode banner: emit a Redis flag `risk:pipeline:degraded` from T010's fallback path (TTL 5 min, refreshed on each fallback) and create `frontend/src/components/admin/risk/RiskDegradedBanner.tsx` that polls `GET /api/admin/risk/health` (reading the flag) every 30s and renders an Arabic-RTL banner at the top of `risk.tsx`, `risk-events.tsx`, `risk-event.tsx`, and `risk-config.tsx` when the flag is set — per spec §1 Edge Cases ("admin panel MUST show a banner indicating the degraded mode")
- [ ] T055b [P] Add the admin-to-action latency metric in `backend/src/observability/metrics.ts` (`risk_admin_to_action_seconds{level}` histogram; recorded when a label or admin action lands on a critical event by joining `risk_alerts_sent_at` (from T012) with `risk_labels.labeledAt` / `audit_logs.created_at` — closes the SC-005 admin-to-action measurement loop ≤15min median, ≤60min p95)
- [ ] T055c [P] Add the AUC success-threshold dashboard in `backend/src/jobs/risk-retrain.ts` and `frontend/src/components/admin/risk/RiskKillCriteria.tsx` (records `risk_model_auc{retrain_id}` Prometheus gauge on every retrain; the kill-criteria widget surfaces a green/yellow/red light against the SC-002 threshold "AUC ≥ 0.85 sustained across two consecutive retrains" — distinct from the deploy gate AUC ≥ 0.7 enforced in T052; the SC-002 light flips green only when the latest two retrains both clear 0.85)
- [ ] T056 Regenerate the final React Query hooks in `shared/api-client-react/src/hooks/risk.ts` for `useAdminRiskDashboard` and `useAdminRiskHealth` (run the existing codegen; commit the regenerated file)
- [ ] T057 Run `quickstart.md` validation: synthesize 10 events via T044, run the admin through US1-US4 paths, confirm SC-002..SC-006 are observable on `/status` and the dashboard, confirm the degraded-mode banner from T055a appears when the scoring service is killed, confirm the cache-invalidation channel from T035/T037 evicts in <100ms, confirm the 500-label gate is enforced by T052, confirm the SC-002 AUC widget from T055c stays neutral until two consecutive retrains land
- [ ] T058 Re-validate the Constitution Check against the implementation: confirm zero new auth paths (T021c reuses existing providers), zero AI on the purchase critical path (T011a is never installed on `/api/wallet/purchase`), defense-in-depth (T010 + T011 + T011a allowlist consultation), observability on `/status` (per spec §13 SC-006)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories.
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion.
  - User stories can then proceed in parallel (if staffed).
  - Or sequentially in priority order (US1 → US2 → US3 → US4).
- **Polish (Phase 7)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories. Reads from `risk_events`; uses the scoring service from T010; writes admin actions via T021a-d into the existing `users` / `sessions` / `audit_logs` tables (no new tables).
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories. Reads from `risk_events`; writes to `risk_labels`. Shares the route file with US1 (sequential, not parallel) but is independently testable.
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories. Reads/writes `risk_rules` and `risk_config`; uses the DSL validator from T036; T035 publishes the cache-bust channel that T037 subscribes to.
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories. Uses the alert service from T012; integrated into the scoring service in T042 via `level === 'critical'` (admin-tunable, not hard-coded).

### Within Each User Story

- Schema (in foundational) before endpoints.
- Endpoints before frontend components.
- Frontend components before page wiring.
- Generated React Query hooks regenerate after each route addition; commit the regenerated file.
- Story complete before moving to next priority.

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel.
- All Foundational tasks marked [P] can run in parallel (within Phase 2).
- T006, T007, T008 are independent and can be authored in parallel.
- T009, T010, T010a, T011, T011a, T012, T013, T014, T015, T016 are independent and can be authored in parallel — note T010 reads the cached config produced by T037 (US3) at runtime but does not depend on T037 _being merged first_; the scoring service degrades gracefully to defaults if the cache is empty.
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows).
- Within a user story, all [P] implementation tasks (route + component) can run in parallel.
- Within US1, the four admin-action endpoints T021a/T021b/T021c/T021d are independent of each other and of T017–T021; they share `backend/src/routes/admin/risk.ts` so the [P] marker means _can be authored in parallel_, not _can be committed without rebase_ — merge them sequentially or in one batch.
- Different user stories can be worked on in parallel by different team members.

---

## Parallel Example: User Story 1

```bash
# Launch all implementation tasks for User Story 1 together:
Task: "Implement GET /api/admin/risk/events/:id in backend/src/routes/admin/risk.ts"
Task: "Implement GET /api/admin/risk/users/:userId/history in backend/src/routes/admin/risk.ts"
Task: "Implement per-user feature snapshot helper in backend/src/lib/risk-features.ts"
Task: "Implement POST /api/admin/risk/users/:userId/lock in backend/src/routes/admin/risk.ts"
Task: "Implement POST /api/admin/risk/users/:userId/unlock in backend/src/routes/admin/risk.ts"
Task: "Implement POST /api/admin/risk/users/:userId/force-reauth in backend/src/routes/admin/risk.ts"
Task: "Implement POST /api/admin/risk/users/:userId/require-approval in backend/src/routes/admin/risk.ts"
Task: "Create the RiskInvestigation component in frontend/src/components/admin/risk/RiskInvestigation.tsx"
Task: "Create the RiskUserHistory component in frontend/src/components/admin/risk/RiskUserHistory.tsx"

# Then sequentially (depends on the route + component being present):
Task: "Create the investigation page in frontend/src/pages/admin/risk-event.tsx"
Task: "Regenerate the React Query hooks in shared/api-client-react/src/hooks/risk.ts"
```

## Parallel Example: User Story 2

```bash
# Launch all implementation tasks for User Story 2 together:
Task: "Implement GET /api/admin/risk/events in backend/src/routes/admin/risk.ts"
Task: "Implement cursor-based pagination helper in backend/src/lib/risk-cursor.ts"
Task: "Implement POST /api/admin/risk/events/:id/label in backend/src/routes/admin/risk.ts"
Task: "Implement POST /api/admin/risk/events/bulk-label in backend/src/routes/admin/risk.ts"
Task: "Create the RiskEventCard component in frontend/src/components/admin/risk/RiskEventCard.tsx"
Task: "Create the RiskReviewQueue component in frontend/src/components/admin/risk/RiskReviewQueue.tsx"
```

## Parallel Example: User Story 3

```bash
# Launch all implementation tasks for User Story 3 together:
Task: "Implement GET /api/admin/risk/rules in backend/src/routes/admin/risk.ts"
Task: "Implement PUT /api/admin/risk/rules/:id in backend/src/routes/admin/risk.ts"
Task: "Implement GET /api/admin/risk/config in backend/src/routes/admin/risk.ts"
Task: "Implement PUT /api/admin/risk/config in backend/src/routes/admin/risk.ts"
Task: "Implement the small DSL validator in backend/src/lib/risk-dsl.ts"
Task: "Wire the risk-config cache in backend/src/services/risk-config-cache.service.ts"
Task: "Create the RiskConfigEditor component in frontend/src/components/admin/risk/RiskConfigEditor.tsx"
Task: "Create the RiskRulesEditor component in frontend/src/components/admin/risk/RiskRulesEditor.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 + US2 — both P1)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories).
3. Complete Phase 3: User Story 1 (Investigate).
4. Complete Phase 4: User Story 2 (Triage review queue).
5. **STOP and VALIDATE**: T057 quickstart; confirm SC-002..SC-006 are observable (SC-001 is a post-launch outcome metric, only verifiable after 90 days of Phase 3 in production).
6. Deploy/demo if ready.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready.
2. Add US1 → Test independently → Deploy/Demo (MVP!).
3. Add US2 → Test independently → Deploy/Demo.
4. Add US3 → Test independently → Deploy/Demo.
5. Add US4 → Test independently → Deploy/Demo.
6. Add Polish (dashboard, statistical signals, ML model) → Test independently → Deploy/Demo.
7. Each story adds value without breaking previous stories.

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together.
2. Once Foundational is done:
   - Developer A: User Story 1 (Investigate).
   - Developer B: User Story 2 (Triage review queue).
   - Developer C: User Story 3 (Configure rules + thresholds).
3. After US1-US3 ship, add US4 (Critical alerts) and the Polish phase in parallel.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- Each user story should be independently completable and testable.
- The "tests" are the per-phase kill criteria in spec §10 and the success metrics in spec §9, plus the existing SubNation test suite.
- Commit after each task or logical group.
- Stop at any checkpoint to validate story independently.
- Avoid: vague tasks, same file conflicts (multiple [P] tasks writing to `backend/src/routes/admin/risk.ts` are intentionally NOT marked [P] — the route file is sequential), cross-story dependencies that break independence.
- The four new tables are introduced in a single migration in T006; per the plan's deliberate split, this migration is small and reviewable.
- All risk-scoring log statements MUST use the existing redaction-aware Pino logger per `research.md` §7; no raw IP, device fingerprint, or user-agent at PII levels.
- The Constitution is binding. Any conflict between a task and the Constitution is resolved in favor of the Constitution.
