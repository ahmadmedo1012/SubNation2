# Research: Anomaly Detection Technical Decisions

**Feature**: 003-anomaly-detection
**Phase**: 0 (research)
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[`specs/001-ai-opportunity-assessment/assessment.md`](../001-ai-opportunity-assessment/assessment.md).

This file resolves the technical decisions left open by the
design document. Each decision is in the format
*Decision → Rationale → Alternatives considered*.

---

## 1. Sync scoring path: in-process vs Redis queue

**Decision**: Phase 1 and Phase 2 use **in-process scoring**
on the request path for events where the score affects the
response (login, OTP verify, top-up completion, checkout).
Phase 3 keeps the **request path** in-process for
non-critical events and **moves the critical-path score to
the worker tier** (asynchronous, post-transaction).

**Rationale**: The performance budget in the spec (Phase 1:
< 5ms; Phase 2: < 20ms; Phase 3: < 50ms) is met comfortably
by an in-process rule engine (sub-millisecond) and an
in-process statistical engine (sub-millisecond after first
read). Adding a Redis round-trip on every login or top-up
would add 1-5ms per event for no benefit at this volume.
For Phase 3, the model is heavier and the latency budget
shrinks; the Constitution forbids AI on the purchase
critical path, so the worker-tier async path is the only
Constitution-compliant place for the model. The model
observes the transaction, not gates it.

**Alternatives considered**:
- *Always-async* (queue every event): rejected for Phase 1
  because the latency cost is unnecessary and the design
  benefits from synchronous visibility for low-risk events.
- *Always-sync, model on the path*: rejected for Phase 3
  because it violates the Constitution's "AI never gates
  the purchase" rule and adds unbounded latency.

## 2. ML model library (Phase 3)

**Decision (subject to re-evaluation in Phase 3 planning)**:
- **Primary candidate**: a small gradient-boosted model
  served by an in-process inference library. The two
  leading candidates are:
  - `@tensorflow/tfjs-node` with a small saved model
    (cross-platform, no native deps).
  - A `lightgbm`-style model exported to ONNX, loaded
    via `onnxruntime-node` (smaller footprint, faster
    inference, well-suited to tabular features).
- **Fallback**: a cheap hosted inference API (e.g.,
  OpenAI, Anthropic, or a specialty provider) for the
  per-event probability, gated by a per-day spend cap.

**Rationale**: The model is small (10-50 features, tabular
data, a few thousand training rows by Phase 3) and the
inference cost must be sub-cent per 1000 events to satisfy
the spec's cost test. A self-hosted small model is cheaper
at this scale; a hosted API is the fallback if the
self-hosted path adds operational burden. The decision is
deferred to Phase 3 planning because the volume of labels
required to train a useful model is only available after
Phase 1 has been live for 60+ days.

**Alternatives considered**:
- *Custom deep model*: rejected. Tabular fraud features
  rarely justify a deep model; gradient boosting is
  industry-standard and explainable.
- *LLM-based scorer*: rejected. The cost per call is
  orders of magnitude higher than gradient boosting, and
  the LLM would not be more accurate on tabular features.
  Also explicitly rejected by the AI Opportunity
  Assessment (cost-band `frontier-model` does not pass the
  10% test).

## 3. Per-user baseline storage

**Decision**: Per-user baselines (z-score denominators,
velocity medians, geo-entropy) are stored in **Postgres**
(`users`-extension columns) for now, with a **Redis
hot-cache** layer for the top-N most-active users. The
hot-cache is rebuilt on cold start from Postgres.

**Rationale**: Postgres is already the system of record;
no new datastore is introduced. A Redis hot-cache avoids
recomputing baselines for hot users on every request and
keeps the in-process scoring path sub-millisecond after the
first read. The hot-cache size is bounded (top 1K active
users) and the rebuild is O(N) on cold start.

**Alternatives considered**:
- *Redis-only*: rejected. Redis is ephemeral; the
  baselines would be lost on Redis restart.
- *Time-series DB (Timescale, Influx)*: rejected. The
  volume does not justify a new datastore. The existing
  Postgres `orders` table is already time-indexed for the
  forecasting pick.

## 4. Rule engine: declarative vs code

**Decision**: Phase 1 ships rules as **typed code**
(TypeScript predicates under
`backend/src/services/risk-rules.service.ts`). Phase 2
adds a **declarative rule loader** that reads rules from
the `risk_rules` table at startup and from the admin
panel, but the rule *expressions* are still
**constrained to a small DSL** (e.g., `field op value`).

**Rationale**: Free-form code is dangerous (a buggy rule
can block every user); a small DSL is auditable and
admin-tunable. The DSL is intentionally narrow: `field
operator value` with `AND`/`OR` and a small operator set
(`eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `in`, `not_in`,
`count_in_last_N_minutes`, `distinct_count_in_last_N_hours`).
This covers the threats in spec §2 without exposing
arbitrary code execution.

**Alternatives considered**:
- *CEL (Google's Common Expression Language)*: rejected
  for now. CEL is powerful but adds a native dependency
  and a learning curve; the small DSL is sufficient for
  the threats in scope.
- *Full code-as-rules*: rejected. Auditing is hard and
  rollback is slow.

## 5. Label-collection workflow

**Decision**: Labels are written to `audit_logs` in Phase 1
(no new table), then migrated to a dedicated `risk_labels`
table in Phase 2. Every label carries `riskEventId`,
`label`, `labeledBy`, `labeledAt`, and `notes`. Bulk
labels apply the same `labeledBy` (the admin who clicked)
but record each event's transition individually.

**Rationale**: Phase 1 ships with no new tables (per the
plan's deliberate split); the existing `audit_logs`
table already records admin actions with `actor`,
`action`, and `target` fields. Labels in Phase 1 are an
`audit_logs` row of action `risk.label`. Phase 2's
`risk_labels` table is the source of truth for the model
retraining pipeline and replaces the `audit_logs`-based
storage at that point. The migration is forward-only;
the `audit_logs` rows from Phase 1 are still readable as
historical provenance.

**Alternatives considered**:
- *Skip Phase 1 labels*: rejected. The model needs labels
  to train, and labels are the most valuable training
  data. The `audit_logs` workaround costs almost nothing
  to implement.

## 6. Admin 2FA + risk-action intersection

**Decision**: The risk scoring pipeline does **not**
interact with the admin 2FA flow. Admin actions (labeling,
locking, force re-auth on a customer) are protected by the
existing 2FA middleware; the risk scoring pipeline is a
*consumer* of admin actions, not a *modifier* of them.

**Rationale**: The Constitution (Principle II: Passwordless
Customer Auth) protects the customer auth flow. The admin
2FA flow is a separate, already-hardened surface. Mixing
the two would create a circular dependency and would
duplicate the existing 2FA middleware. The risk
scoring pipeline inherits the 2FA protection by virtue of
running inside the existing admin routes (which are
already gated by `requireAdmin` and the 2FA check).

**Alternatives considered**:
- *Risk-based 2FA exemption*: rejected. Reducing 2FA based
  on risk is a Constitution violation (Principle II).
  The Constitution is explicit that 2FA is non-negotiable
  for admin.

## 7. Logging redaction

**Decision**: Risk-scoring logs are subject to the
**existing logger redaction** discipline
(`account_password` / `accountPassword` / future
credential fields). New risk-scoring log statements MUST
use the existing redaction-aware logger and MUST NOT log
raw IP, device fingerprint, or user-agent at PII levels
without review.

**Rationale**: Constitution Principle IV (Defense in
Depth) and the existing logger redaction are
Constitution-binding. A new feature that leaks PII in
logs would be a P0 defect, not a Phase-1 acceptable risk.
The existing Pino logger configuration handles redaction
of the named fields; new fields (e.g., a future
`phone_otp`) follow the same pattern.

**Alternatives considered**:
- *Opt-in redaction*: rejected. Default-deny is the only
  Constitution-compliant posture.

## 8. Cold-start: bootstrap when there are no labels

**Decision**: Phase 1 ships with **rules only** (no model
labels required). Phase 2 adds statistical signals that
are also label-free. Phase 3 trains the model only after
>= 500 labeled events (mix of `confirmed_fraud` and
`false_positive`) have been collected, and the model is
not deployed until AUC >= 0.7 on hold-out.

**Rationale**: A model trained on too few labels is worse
than no model. The Constitution's principle of "no AI on
the critical path" means the model can be deployed
gradually; the 500-label gate is the minimum for a
useful model and is documented in spec §10 as a
Phase-3 gate.

**Alternatives considered**:
- *Pre-trained model*: rejected. The model needs to learn
  SubNation-specific patterns; a generic pre-trained
  fraud model is not a substitute.
- *No threshold, deploy on day 1*: rejected. The Constitution
  requires explainability and audit; a model with no
  SubNation labels cannot satisfy the SC-006
  "Constitution compliance" gate.

---

## 9. Phase-1 confidence formula

**Decision**: In Phase 1 (rules-only), `confidence` is computed
deterministically from the rule fan-out:

```
confidence = clamp(0.5 + 0.1 * rulesFiredInScope, 0.5, 1.0)
```

where `rulesFiredInScope` counts rules whose `expression`
matches the event's `eventType` family (auth / wallet / order)
and that fired for this event. A single rule firing yields
`0.6`; five concurrent rules saturate at `1.0`. Allowlisted
events keep their computed score and confidence but force
`actionTaken = log` (no block) per spec §5.4.

In Phase 2, `confidence` is overlaid with statistical-signal
agreement: each statistical signal that fires beyond its 3σ
threshold contributes `+0.05`, capped at `1.0`. In Phase 3,
`confidence` is replaced by the model's calibrated probability
when `modelEnabled = true`, falling back to the Phase-2
formula when the model is not loaded.

**Rationale**: Spec §5.3 makes blocking decisions depend on
confidence, but the spec deliberately leaves the formula open.
A simple, monotone, bounded formula is auditable, behaves
predictably under rule additions, and never silently flips a
medium-score event to a hard-block. The 0.5 floor reflects
"we always have at least one rule's worth of evidence" once
anything fires; the 1.0 ceiling prevents over-confident
auto-blocks.

**Alternatives considered**:
- *Per-rule confidence weights in the DSL*: rejected for
  Phase 1; adds operator burden with no measurable detection
  benefit at this volume. Reconsidered as a Phase-2 polish
  if false-positive rate stays high after rule tuning.
- *Constant 1.0 confidence*: rejected. Removes the
  Constitution-IV defense-in-depth gate ("we saw something"
  vs "we believe it") and makes auto-block unsafe.

---

## Summary of decisions

| # | Decision | Affects |
|---|---|---|
| 1 | Sync in-process for Phase 1-2; async post-tx for Phase 3 critical paths | Performance, Constitution I |
| 2 | Self-hosted small model in Phase 3; hosted API as fallback | Cost, model ops |
| 3 | Postgres baselines + Redis hot-cache | Storage |
| 4 | Typed code rules in Phase 1; constrained DSL in Phase 2 | Auditability, admin UX |
| 5 | Phase 1 labels in `audit_logs`; Phase 2 in dedicated table | Migration scope |
| 6 | Risk pipeline does not interact with admin 2FA | Constitution II |
| 7 | Existing logger redaction applies to risk-scoring logs | Constitution IV |
| 8 | 500-label gate before Phase 3 model deployment | Phase 3 rollout |
| 9 | Bounded, monotone Phase-1 confidence formula | Constitution IV (defense-in-depth on auto-block) |

All decisions are Constitution-compliant and reversible.
No NEEDS CLARIFICATION markers remain.
