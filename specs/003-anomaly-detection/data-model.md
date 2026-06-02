# Data Model: Anomaly Detection Entities

**Feature**: 003-anomaly-detection
**Phase**: 1 (design)
**Prerequisites**: [plan.md](./plan.md), [research.md](./research.md), [spec.md](./spec.md).

This file describes the four new entities introduced by this
feature: `RiskEvent`, `RiskRule`, `RiskConfig`, `RiskLabel`.
**Migrations are not produced in this branch** (per the
plan's deliberate split). The Drizzle schema code that
implements this model lives in
`shared/db/src/schema/risk.ts` and is created in a
follow-up implementation branch.

---

## 1. RiskEvent

A scored event. One row per scored event.

### Fields

| Field                | Type                               | Description                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid` (PK)                        | Server-generated event id                                                                                                                                                                                                          |
| `userId`             | `uuid` (FK → `users.id`, nullable) | The user the event is about; null for unauthenticated events (e.g., failed logins)                                                                                                                                                 |
| `eventType`          | `enum`                             | One of: `login_attempt`, `login_success`, `login_failure`, `otp_request`, `otp_verify`, `topup_attempt`, `topup_success`, `order_create`, `order_deliver`, `coupon_apply`, `referral_event`                                        |
| `score`              | `integer` (0-100)                  | The risk score                                                                                                                                                                                                                     |
| `level`              | `enum`                             | One of: `low`, `medium`, `high`, `critical` (derived from `score` and `confidence`)                                                                                                                                                |
| `confidence`         | `numeric(4,3)` (0.000-1.000)       | The scorer's confidence                                                                                                                                                                                                            |
| `ruleFired`          | `text[]`                           | Names of the rules that fired (e.g., `["impossible_travel_v1", "new_account_large_topup"]`)                                                                                                                                        |
| `statisticalSignals` | `jsonb`                            | Per-signal value (e.g., `{z_topup: 4.2, velocity_orders_1h: 5, geo_new_country: true}`)                                                                                                                                            |
| `mlScore`            | `numeric(4,3)` (nullable)          | Phase 3: per-event fraud probability                                                                                                                                                                                               |
| `topFeatures`        | `jsonb` (nullable)                 | Phase 3: top-3 SHAP values with feature names                                                                                                                                                                                      |
| `actionTaken`        | `enum`                             | One of: `none`, `log`, `soft_block`, `hard_block`, `alert`                                                                                                                                                                         |
| `ipAddress`          | `inet`                             | The source IP; PII-handled per logger redaction                                                                                                                                                                                    |
| `userAgent`          | `text`                             | Source user agent; truncated to 256 chars                                                                                                                                                                                          |
| `createdAt`          | `timestamptz`                      | Score time, indexed                                                                                                                                                                                                                |
| `shownAt`            | `timestamptz` (nullable)           | First time an admin opened the investigation view for this event; written by the investigation page on mount and updated only on first view. Powers the AW-1 metric (triage time = `risk_labels.createdAt - risk_events.shownAt`). |

### Validation rules

- `score` is in `[0, 100]`.
- `confidence` is in `[0.000, 1.000]`.
- `level` is derived; persisted value MUST match the derivation
  on write. (DB-level CHECK or trigger.)
- `eventType` is constrained to the enum values above.
- `actionTaken = hard_block` requires `level = critical`.
- `actionTaken = soft_block` requires `level >= high`.

### Indexes

- `(userId, createdAt DESC)` — for per-user history queries.
- `(level, createdAt DESC)` — for the review queue.
- `(createdAt DESC)` — for time-range queries.
- `(eventType, createdAt DESC)` — for per-type analytics.

### Retention

- 90 days default.
- Labeled events are extended to 97 days (training data
  buffer for Phase 3).
- `risk_labels` (the labels table) is kept indefinitely;
  the `risk_labels.riskEventId` references `risk_events.id`
  but is preserved even after the event is purged via
  on-delete-set-null semantics (or a `risk_event_snapshot`
  jsonb column on the label, to be decided at migration
  time).

---

## 2. RiskRule

A rule definition. One row per rule.

### Fields

| Field         | Type                           | Description                                               |
| ------------- | ------------------------------ | --------------------------------------------------------- |
| `id`          | `uuid` (PK)                    | Server-generated rule id                                  |
| `name`        | `text` (unique)                | The rule name (e.g., `impossible_travel_v1`)              |
| `description` | `text`                         | Human-readable description                                |
| `expression`  | `jsonb`                        | The rule expression in the small DSL (see research.md §4) |
| `enabled`     | `boolean`                      | Whether the rule is currently active                      |
| `version`     | `integer`                      | Increments on every edit; supports rollback               |
| `createdBy`   | `uuid` (FK → `admin_users.id`) | Who created the rule                                      |
| `createdAt`   | `timestamptz`                  | Creation time                                             |
| `updatedBy`   | `uuid` (FK → `admin_users.id`) | Who last edited                                           |
| `updatedAt`   | `timestamptz`                  | Last edit time                                            |

### Validation rules

- `name` is unique and stable (used in `RiskEvent.ruleFired`).
- `expression` validates against the DSL schema (see below).
- `enabled = false` rules do not fire but remain auditable.
- `version` increments monotonically per row; rollback is to
  a previous version (creates a new row with the old
  expression, leaving the audit trail intact).

### DSL schema (sketch)

```ts
{
  type: "and" | "or",
  clauses: Array<{
    field: string,           // e.g., "user.topup_amount_24h"
    operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in"
                 | "count_in_last_N_minutes" | "distinct_count_in_last_N_hours",
    value: number | string | string[] | { n: number, minutes: number }
  }>
}
```

The DSL is intentionally narrow; admin-tunable in the admin
panel; auditable; no arbitrary code execution.

### Indexes

- `(name)` unique.
- `(enabled)` for "show only enabled rules" queries.

---

## 3. RiskConfig

A singleton configuration. One row.

### Fields

| Field              | Type                           | Description                                                                                            |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `id`               | `integer` (PK, always 1)       | Singleton constraint                                                                                   |
| `thresholds`       | `jsonb`                        | `{ low: 0, medium: 30, high: 60, critical: 85 }` (defaults; lower bound per level — matches spec §5.2) |
| `allowlist`        | `jsonb`                        | `{ ips: [], devices: [], phones: [] }`                                                                 |
| `autoBlockEnabled` | `jsonb`                        | `{ softBlock: true, hardBlock: false, alert: true }` (defaults; hardBlock is opt-in)                   |
| `modelEnabled`     | `boolean`                      | Phase 3: whether the model is in the scoring path                                                      |
| `updatedBy`        | `uuid` (FK → `admin_users.id`) | Who last changed the config                                                                            |
| `updatedAt`        | `timestamptz`                  | Last change time                                                                                       |

### Validation rules

- `id = 1` (singleton); enforced by a partial unique index.
- `thresholds.low < thresholds.medium < thresholds.high <
thresholds.critical`; all in `[0, 100]`.
- `autoBlockEnabled.hardBlock = true` requires
  `modelEnabled = true` (Phase 3 only) and a per-level
  `confidence` floor; otherwise hardBlock is ignored.
- Every change is recorded in `audit_logs`.

### Indexes

- `(id)` unique + partial unique where `id = 1`.

---

## 4. RiskLabel

A human-confirmed label. One row per labeled event.

### Fields

| Field         | Type                                               | Description                                              |
| ------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `id`          | `uuid` (PK)                                        | Server-generated label id                                |
| `riskEventId` | `uuid` (FK → `risk_events.id`, on-delete set null) | The labeled event                                        |
| `label`       | `enum`                                             | One of: `confirmed_fraud`, `false_positive`, `escalated` |
| `labeledBy`   | `uuid` (FK → `admin_users.id`)                     | Who labeled it                                           |
| `labeledAt`   | `timestamptz`                                      | When the label was set                                   |
| `notes`       | `text` (nullable)                                  | Free-form notes from the admin                           |

### Validation rules

- A given `riskEventId` can have at most one `label` row.
  (Bulk operations write one row per event.)
- `label = escalated` does not feed the model; the model
  uses only `confirmed_fraud` and `false_positive`.
- `notes` is optional; if present, length <= 2000 chars.

### Indexes

- `(riskEventId)` unique — at most one label per event.
- `(label, labeledAt DESC)` — for model training queries.
- `(labeledAt DESC)` — for daily-triage metrics.

---

## 5. Cross-entity relationships

```
users 1 ─── * risk_events * ─── 1 risk_labels
                   │
                   └── * (no FK; risk_events.ruleFired is a text[] of names)
                              │
                              ▼
                       risk_rules (by name)
```

- A `risk_event` references `users` (nullable) and stores
  the rule names that fired as a text array.
- A `risk_label` references exactly one `risk_event` and
  exactly one `admin_user`.
- A `risk_config` is a singleton; `audit_logs` records every
  change to it.

## 6. Migration plan (deferred to implementation branch)

The four new tables are introduced in a single migration in
Phase 2 of the implementation. Phase 1 ships with **no
schema changes**, only the rule engine and admin endpoints.
The migration is small (4 tables, ~10 indexes, ~3
constraints) and is split out for review per the plan.

The migration MUST be reviewed together with:

- The Drizzle schema in `shared/db/src/schema/risk.ts`.
- The Zod validators in `shared/api-zod/src/risk.ts`.
- The OpenAPI spec extension in `shared/api-spec/openapi.yaml`.
- The first 8-10 rule definitions seeded into `risk_rules`.

This is the "reviewable change set" pattern referenced in
the plan; it ensures the migration is reviewed in context
and not as a standalone SQL diff.

## 7. Validation rules (testable from the schema alone)

A `risk_event` row is conformant iff:

- `score`, `confidence`, `level`, and `actionTaken` are
  consistent with the validation rules in §1.
- `userId` is null OR a valid `users.id`.
- `ruleFired` contains names that exist in
  `risk_rules.name` (best-effort; new rules can
  pre-exist in code before the table is seeded).

A `risk_label` row is conformant iff:

- `riskEventId` references a real `risk_event.id` (or
  null if the event was purged under retention).
- `label` is one of the enum values.
- `labeledBy` references a real `admin_user.id`.

A `risk_config` row is conformant iff:

- `id = 1` (singleton).
- `thresholds` are strictly increasing in `[0, 100]`.
- `autoBlockEnabled.hardBlock = true` implies
  `modelEnabled = true`.
