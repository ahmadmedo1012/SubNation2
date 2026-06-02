# Implementation Plan: Auth and Wallet Anomaly Detection

**Branch**: `003-anomaly-detection` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-anomaly-detection/spec.md`

## Summary

Implement an admin-facing, layered, defense-in-depth anomaly
detection system that scores auth and wallet events, surfaces
high-risk events to admins, and feeds human labels back into a
self-improving model. The system ships in three phases (rules,
statistical, ML) with per-phase kill criteria and a hard
constraint that the model never gates the purchase path.

This plan describes the technical design (file layout, modules,
endpoints, storage, observability) for a feature whose product
design is already specified in
[`spec.md`](./spec.md). No implementation work begins until this
plan is reviewed and approved; migrations are deliberately
deferred to a follow-up branch as a separate, reviewable change
set.

## Technical Context

The feature extends the existing SubNation Express 5 / Drizzle /
PostgreSQL / Redis / Pino stack. No new runtime dependencies are
introduced in Phase 1; Phase 3 may add a small ML inference
library (see [`research.md`](./research.md) §3).

- **Language/Version**: TypeScript ~5.9 (matches the existing
  monorepo).
- **Primary Dependencies**:
  - Backend: Express 5, Drizzle ORM, PostgreSQL (Neon), Redis,
    Pino, Sentry, `prom-client`, Zod, `argon2`.
  - Frontend: React 19, Vite, TanStack Query (admin panel
    extension), Tailwind.
  - Phase 3: a small inference library — choice deferred to
    research.md §3.
- **Storage**:
  - New tables in PostgreSQL (Phase 2): `risk_events`,
    `risk_rules`, `risk_config`, `risk_labels`.
  - Redis used for ephemeral scoring buffers and degraded-mode
    state.
  - No S3 / object storage.
- **Testing**: Vitest (existing). New tests live under
  `backend/tests/risk/`. The spec's "tests" are the spec's
  cross-validation in §9 (Success Metrics) and §10 (Kill
  Criteria), plus the existing SubNation test suite.
- **Target Platform**: Same as SubNation — Node.js 22+ on
  Render Docker (web + worker + redis).
- **Project Type**: Backend service + admin-panel extension.
- **Performance Goals**:
  - Phase 1: < 5ms added p95 latency on sync paths
    (login, OTP, checkout).
  - Phase 2: < 20ms added p95 latency on sync paths.
  - Phase 3: < 50ms added p95 latency on non-critical
    paths; checkout is observation-only (scored after
    the fact).
  - Async scoring throughput: >= 1000 events/sec on the
    worker tier.
- **Constraints**:
  - Per-event inference cost <= 10% of recovered fraud
    loss (cost test from SC-004 / FR-006 in the AI
    Opportunity Assessment).
  - Zero AI on the purchase critical path (Constitution
    Principle I).
  - Zero new auth path (Constitution Principle II).
  - < $5/day at expected volume (~50K events/day).
  - Failure mode MUST be rules-only; never block legitimate
    customers because the scoring service is down.
- **Scale/Scope**:
  - ~50K events/day scored (estimated; subject to validation
    in Phase 1).
  - 90-day retention on `risk_events`; 7-day extension for
    labeled events; `risk_labels` kept indefinitely.
  - Single backend service; one new admin module; one new
    shared Zod contract package (`shared/api-zod` extension).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

This plan is the technical design for the feature specified in
[spec.md](./spec.md), which already records the Constitution
alignment. The plan-level gates are:

- **I. Financial Integrity (NON-NEGOTIABLE)** — The model
  observes the wallet; it never computes, gates, or replaces
  the atomic purchase transaction or the append-only ledger.
  The Constitution's defense-in-depth framing is mirrored in
  the spec's §4.3 (model is small and explainable, never on
  the critical path of a purchase). The plan re-enforces
  this in §"Failure modes": the sync fast-path is rules-only,
  and Phase 3 scoring is observation-only on the checkout
  path. ✅ PASS.
- **II. Passwordless Customer Auth** — No new auth path is
  introduced. Blocks are friction steps (force re-auth on the
  existing three providers: Google, Telegram, WhatsApp), not
  customer lockouts without recourse. The action surface lives
  on `risk_events.actionTaken`
  (enum: `none | log | soft_block | hard_block | alert`); the
  `soft_block` value invalidates the current session and forces
  the user back through the existing provider on the next
  request — it never introduces a new provider, never bypasses
  2FA on admin, and never locks a customer out without recourse.
  ✅ PASS.
- **III. Shared Contracts (API-First)** — All new endpoints
  are defined as Zod schemas in `shared/api-zod` and exposed
  via `shared/api-spec` (OpenAPI) in the same change. The
  generated React hooks in `shared/api-client-react` are
  regenerated for the admin-panel extension. ✅ PASS.
- **IV. Defense in Depth** — This feature is itself a new
  layer in the defense-in-depth stack: it layers on top of
  the existing rate-limit, audit, CSRF, CSP, and redaction
  controls, never as a replacement. The model is
  confidence-aware; auto-block requires a configurable
  confidence floor; an allowlist exempts known-good actors.
  ✅ PASS.
- **V. Observability & Operational Readiness** — Every
  pipeline emits structured Pino logs, Sentry errors,
  Prometheus counters/histograms, and a `/status` health
  indicator. The model is shipped only after the per-phase
  kill criteria in spec §10 are met; degradation to
  rules-only is automatic. ✅ PASS.
- **Domain Constraint: Arabic-First (RTL) UX** — Out of
  scope. This is an admin-facing feature, not customer-facing
  UI. The admin panel retains its existing language policy
  (Arabic-first RTL is for customer-facing copy per the
  Constitution). The few new admin strings follow the same
  pattern as existing admin surfaces. ✅ PASS for this
  branch (explicitly out-of-scope, consistent with the
  AI Opportunity Assessment's clarified Assumptions).

**Gate result**: PASS. The plan is Constitution-compliant on
all five principles plus the Arabic-first domain constraint
(which is out-of-scope for this admin feature). No violations
require justification.

## Project Structure

### Documentation (this feature)

```text
specs/003-anomaly-detection/
├── spec.md              # The design document (already produced, in review)
├── plan.md              # This file
├── research.md          # Phase 0: technical decisions (model library, sync path, etc.)
├── data-model.md        # Phase 1: Drizzle schemas for risk_events, risk_rules, risk_config, risk_labels
├── contracts/           # Phase 1: Zod schemas + OpenAPI snippets for the new admin endpoints
│   ├── risk-dashboard.contract.md
│   ├── risk-events.contract.md
│   ├── risk-user-history.contract.md
│   ├── risk-rules.contract.md
│   └── risk-admin-actions.contract.md   # lock / unlock / force-reauth / require-approval
├── quickstart.md        # Phase 1: how to exercise the new admin surfaces locally
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16 passing)
└── tasks.md             # (NOT produced in this branch; deferred to a follow-up `/speckit-tasks` after plan approval)
```

### Source Code (repository root)

The plan adds the following layout to the existing monorepo.
No existing file is renamed or restructured; the new code is
additive.

```text
backend/src/
├── routes/admin/
│   ├── risk.ts                     # NEW: admin endpoints for risk dashboard, events, labels, rules, config
│   └── ...                          # (existing admin routes unchanged)
├── services/
│   ├── risk-scoring.service.ts     # NEW: orchestration of rules + statistical + ML scoring
│   ├── risk-rules.service.ts       # NEW: rule evaluation
│   ├── risk-statistical.service.ts # NEW: z-score, velocity, geo-entropy
│   ├── risk-ml.service.ts          # NEW (Phase 3): per-event fraud probability + SHAP
│   ├── risk-alerts.service.ts      # NEW: critical-event alerting via existing admin_alerts channel
│   └── ...                          # (existing services unchanged)
├── lib/
│   ├── risk-features.ts            # NEW: per-user feature extraction
│   ├── risk-labels.ts              # NEW: label-collection helpers
│   └── ...                          # (existing libs unchanged)
├── jobs/
│   ├── risk-retrain.ts             # NEW (Phase 3): weekly model retrain
│   ├── risk-daily-digest.ts        # NEW: composes with O1 from the AI Opportunity Assessment
│   └── ...                          # (existing jobs unchanged)
└── middleware/
    ├── risk-soft-block.ts          # NEW: forces re-auth on next request when risk_action = soft-block
    └── ...                          # (existing middleware unchanged)

shared/db/src/schema/
├── risk.ts                          # NEW (Phase 2): Drizzle schemas for risk_events, risk_rules, risk_config, risk_labels
└── ...                              # (existing schemas unchanged)

shared/api-zod/src/
├── risk.ts                          # NEW: Zod validators for new admin endpoints
└── ...                              # (existing zod schemas unchanged)

shared/api-spec/
├── openapi.yaml                     # EXTENDED: paths for /api/admin/risk/*
└── ...                              # (existing spec unchanged)

shared/api-client-react/src/
├── hooks/risk.ts                    # NEW: generated hooks for the admin panel
└── ...                              # (existing hooks unchanged)

frontend/src/
├── pages/admin/
│   ├── risk.tsx                     # NEW: Risk & Fraud dashboard
│   ├── risk-events.tsx              # NEW: review queue
│   ├── risk-event.tsx               # NEW: investigation view
│   └── ...                          # (existing admin pages unchanged)
├── components/admin/risk/
│   ├── RiskDashboard.tsx            # NEW
│   ├── RiskEventCard.tsx            # NEW
│   ├── RiskInvestigation.tsx        # NEW
│   ├── RiskUserHistory.tsx          # NEW
│   └── ...                          # NEW
└── ...                              # (existing frontend unchanged)

backend/tests/risk/                  # NEW
├── rules.test.ts                    # NEW
├── statistical.test.ts              # NEW
├── ml.test.ts                       # NEW (Phase 3)
├── admin-endpoints.test.ts          # NEW
├── fall-back.test.ts                # NEW: scoring-service-down → rules-only
└── ...                              # NEW
```

### Migrations

The four new tables (`risk_events`, `risk_rules`, `risk_config`,
`risk_labels`) are introduced by a **single Drizzle-generated
migration** (T006 in `tasks.md`) before any user story begins,
so the feature can be exercised end-to-end on a fresh clone.
The plan's deliberate Phase-1/Phase-2 split is preserved as a
**rollout-time** distinction, not a schema-time one:

- **Rollout Phase 1 (rules-only)**: the tables exist on disk
  but the label-write path in `backend/src/lib/risk-labels.ts`
  (T013) writes to `audit_logs` with `action='risk.label'` so
  the existing audit trail captures admin labels with no
  dependency on a new write surface. This is the smallest
  reversible change: a feature-flag flip
  (`RISK_PIPELINE_ENABLED=false`) reverts to no scoring with
  no schema rollback required.
- **Rollout Phase 2 (statistical)**: the same `risk-labels.ts`
  helper switches the write target from `audit_logs` to the
  `risk_labels` table (one-line code change) once the
  statistical-signals service in T048 lands. The Phase-1
  `audit_logs` rows remain readable as historical provenance.
- **Rollout Phase 3 (ML)**: enables `risk_config.modelEnabled`
  via the admin panel; no further migration needed.

The migration is small (4 tables, ~10 indexes, ~3 constraints,
plus the `shownAt` column for SC-004 measurability per
`data-model.md` §1) and is reviewed together with the Drizzle
schema in `shared/db/src/schema/risk.ts`, the Zod validators
in `shared/api-zod/src/risk.ts`, the OpenAPI extension, and
the seed rules from T015. The "reviewable change set" pattern
is preserved: one PR, one schema, one migration, one set of
contracts.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No Constitution Check violations. The complexity of the
feature lives in the breadth of the surface (a new admin
module, new endpoints, new schemas, new tests, new
observability) and in the three-phase rollout with per-phase
kill criteria — not in any architectural rule violation. The
plan's design choices (no new tables in Phase 1; rules as
code; small ML model; confidence-aware auto-block) are
explicitly intended to keep the feature small and reversible.
