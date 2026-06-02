# Quickstart: Exercising the Anomaly Detection Feature Locally

**Feature**: 003-anomaly-detection

This is a one-page guide for the developer who picks up this
feature in the implementation branch. The full design is in
[`spec.md`](./spec.md). The technical decisions are in
[`research.md`](./research.md). The data model is in
[`data-model.md`](./data-model.md). The API surface is in
[`contracts/`](./contracts/).

## 1. What you'll need

- The existing SubNation monorepo at the implementation
  branch (this spec is the design; the implementation is a
  follow-up).
- A local Postgres (Neon local or `docker compose up postgres`).
- A local Redis (`docker compose up redis`).
- `pnpm install` (the existing dev script auto-picks free
  ports).

## 2. Phase 1 — Rules only (no new tables)

In Phase 1 there is **no migration**. The feature ships with:

- The rule engine in `backend/src/services/risk-rules.service.ts`.
- The admin endpoints in `backend/src/routes/admin/risk.ts`.
- The admin UI in `frontend/src/pages/admin/risk.tsx` and
  `frontend/src/components/admin/risk/`.
- Labels written to `audit_logs` (no new table).

To exercise:

1. Add `RISK_PIPELINE_ENABLED=true` to your local `.env` (the
   pipeline is opt-in by default; the env var is read in
   `backend/src/lib/env.ts` consumers — see T005). Then
   `pnpm install && pnpm dev`.
2. Sign in as admin (2FA).
3. Open `/admin/risk`. The dashboard renders with `eventsScored = 0`
   and the live feed empty.
4. Trigger a synthetic event from the dev tools
   (`backend/scripts/synthetic-risk-event.ts`, to be added in
   implementation): e.g., a login failure followed by an
   impossible-travel login success. The event appears in
   the dashboard within seconds.
5. Click the event, see the rule panel ("impossible_travel_v1
   fired"), label it as `false_positive`. The label is
   written to `audit_logs` with `action = risk.label` and
   `target = <eventId>`.

> **Note on tables in dev.** The four risk tables
> (`risk_events`, `risk_rules`, `risk_config`, `risk_labels`)
> are created by the single Foundational migration (T006) so
> a brand-new clone can run end-to-end. Phase 1 of the
> *rollout* still treats labels as `audit_logs` rows — the
> tables exist on disk but the label-write path lives in
> `backend/src/lib/risk-labels.ts` (T013) and only switches
> over in the Phase-2 rollout. This split is the reviewable
> change set the plan describes; in dev it collapses to one
> migration so the feature can be exercised end-to-end on a
> fresh clone.

## 3. Phase 2 — Statistical detection (rollout flip)

Phase 2 of the rollout enables statistical signals and flips
the label-write path from `audit_logs` to `risk_labels`. The
tables themselves already exist from T006. To exercise:

1. The Foundational migration is already applied from §2 — no
   second migration needed.
2. Restart the dev server.
3. Trigger events; the dashboard now shows statistical
   signals (z-scores, velocity) on the investigation view.
4. Bulk-label 20 events as `false_positive` from the
   review queue; the labels are now in `risk_labels` and
   feed the Phase 3 model retrain.

## 4. Phase 3 — ML-assisted scoring (model trained)

Phase 3 requires >= 500 labeled events (per research.md §8).
To exercise:

1. Run `pnpm tsx backend/src/jobs/risk-retrain.ts` to
   train the model on the collected labels.
2. Set `risk_config.modelEnabled = true` from the admin
   panel.
3. New events include `mlScore` and `topFeatures` in the
   investigation view.
4. Set `autoBlockEnabled.hardBlock = true` (gated on
   `modelEnabled` per the contracts).

## 5. How to test the failure modes

- **Scoring service down**: stop the backend (`Ctrl-C`),
  restart, observe the dashboard's degraded-mode banner.
  The fallback path is rules-only; no legitimate customer
  is blocked.
- **Redis down**: the rate-limit fallback (in-memory in dev)
  applies; the risk-scoring service uses the same fallback
  for ephemeral state.
- **HardBlock without modelEnabled**: try to set
  `autoBlockEnabled.hardBlock = true` with
  `modelEnabled = false`. The PUT `/api/admin/risk/config`
  endpoint rejects the request with 400.

## 6. How to read the kill-criteria check

Each phase has a kill criterion. To verify:

- **Phase 1**: check the `false_positive_rate_7d` metric in
  the dashboard. If >= 1% in any 7-day window, raise the
  rule thresholds (via `PUT /api/admin/risk/config`) or
  revert the affected rule (via `PUT
  /api/admin/risk/rules/:id` with `enabled: false`).
- **Phase 2**: compare the precision of statistical signals
  vs rules-only on the labeled events. If statistical
  signals add < 10%, the phase is killed per spec §10.
- **Phase 3**: re-evaluate AUC on hold-out after each
  retrain. If AUC < 0.7 or SHAP explanations are
  unintelligible in a user test, the model is not deployed.

## 7. Source of truth

The authoritative design is in
[`spec.md`](./spec.md). The technical decisions are in
[`research.md`](./research.md). The data model is in
[`data-model.md`](./data-model.md). The API surface is in
[`contracts/`](./contracts/). The Constitution is in
`.specify/memory/constitution.md`. The AI Opportunity
Assessment is in
`specs/001-ai-opportunity-assessment/assessment.md`.

If any of these change materially, the design should be
re-validated; in particular, the Constitution's principles
on financial integrity and passwordless auth are
non-negotiable and bound the implementation.
