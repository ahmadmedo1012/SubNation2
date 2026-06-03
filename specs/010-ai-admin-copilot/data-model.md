# Phase 1 Data Model: AI Admin Copilot

**Feature**: 010-ai-admin-copilot
**Date**: 2026-06-03
**Drives**: Drizzle schema files in `shared/db/src/schema/copilot_*.ts`, Zod schemas in `shared/api-zod/src/copilot/`, OpenAPI paths in `shared/api-spec/openapi.yaml`.

This document is the source of truth for the new tables and the in-memory shapes that flow between the copilot service, the database, the admin client, and the LLM tool layer. **It is the contract; the Drizzle schema files are the implementation.**

---

## 1. New Postgres tables

### 1.1 `copilot_previews`

A pending preview created when the LLM proposes a draft. Single-use, time-bound.

| Column                 | Type           | Constraint                                        | Description                                                                                                                                                                          |
| ---------------------- | -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | `text`         | PK, ULID                                          | Short URL-safe ID; references it in audit and confirmation.                                                                                                                          |
| `admin_id`             | `integer`      | NOT NULL, FK `admin_users(id)` ON DELETE RESTRICT | Owning admin. Restrict because deleting an admin with pending previews must fail loudly.                                                                                             |
| `intent_text`          | `text`         | NOT NULL                                          | Original natural-language input from the admin (verbatim, no redaction here — admin's own words).                                                                                    |
| `tool_name`            | `varchar(100)` | NOT NULL                                          | The tool the LLM called to produce this draft (e.g., `draft_price_change`).                                                                                                          |
| `action_class`         | `varchar(50)`  | NOT NULL                                          | Coarse class for filtering and risk routing: `read`, `catalog_edit`, `price_change`, `cost_change`, `stock_change`, `status_change`, `permission_change`, `bulk_*`, `wallet_action`. |
| `risk_tier`            | `varchar(20)`  | NOT NULL                                          | `low` (single-confirm) or `high` (double-confirm) or `no_execute` (wallet/refund).                                                                                                   |
| `affected_ids`         | `jsonb`        | NOT NULL                                          | Array of integer IDs the action targets. Empty for read tools (then row is not created).                                                                                             |
| `affected_entity_type` | `varchar(50)`  | NOT NULL                                          | `product`, `inventory`, `admin_user`, etc.                                                                                                                                           |
| `record_versions`      | `jsonb`        | NOT NULL                                          | Map of `{ id: updated_at_iso }` captured at draft time, used for staleness check (R-5).                                                                                              |
| `preview_payload`      | `jsonb`        | NOT NULL                                          | The structured before/after, validation warnings, side-effect notes, and (for bulk) sample + aggregate impact. Shape per §2.1 below.                                                 |
| `model_id`             | `varchar(64)`  | NOT NULL                                          | Concrete model used (e.g., `claude-sonnet-4-6`). For audit.                                                                                                                          |
| `correlation_id`       | `varchar(64)`  | NOT NULL                                          | Joined to logs/metrics.                                                                                                                                                              |
| `created_at`           | `timestamptz`  | NOT NULL DEFAULT `now()`                          |                                                                                                                                                                                      |
| `expires_at`           | `timestamptz`  | NOT NULL                                          | `created_at + interval '5 minutes'` (FR-PREVIEW-003).                                                                                                                                |
| `consumed_at`          | `timestamptz`  | NULL                                              | Set when the preview is used to execute. NULL means available.                                                                                                                       |
| `confirmed_once_at`    | `timestamptz`  | NULL                                              | First-confirmation timestamp (low-risk done after this; high-risk waits for `confirmed_twice_at`).                                                                                   |
| `cooldown_starts_at`   | `timestamptz`  | NULL                                              | Set when the second-confirm dialog renders for high-risk (R-13 cooldown enforcement).                                                                                                |
| `confirmed_twice_at`   | `timestamptz`  | NULL                                              | Second-confirmation timestamp. Must be ≥ `cooldown_starts_at + 3 seconds`.                                                                                                           |

**Indexes**:

- `idx_copilot_previews_admin_created` on `(admin_id, created_at DESC)` — for admin's preview history.
- `idx_copilot_previews_expires` on `(expires_at)` — for the reaper.
- `idx_copilot_previews_action_class` on `(action_class)` — for filtering.

**Lifecycle**:

1. **Created** (`created_at` set, `consumed_at` null, both confirmation columns null).
2. **First-confirmed** (low-risk: `confirmed_once_at` set → execute fires → `consumed_at` set; high-risk: `confirmed_once_at` set, `cooldown_starts_at` set, dialog rendered).
3. **Second-confirmed** (high-risk only: `confirmed_twice_at` set → execute fires → `consumed_at` set).
4. **Expired** (no confirmation arrives before `expires_at`; reaper deletes after `expires_at + 24h`).
5. **Refused** (validation rejected at draft; row never created — failure logged to `copilot_actions` with `outcome=refused`).

**Single-use enforcement**: `consumed_at IS NULL` predicate in the executor's `SELECT … FOR UPDATE`; a second confirmation against an already-consumed preview returns `409 Conflict`.

---

### 1.2 `copilot_actions`

The immutable execution record (or refusal record) — primary copilot audit table.

| Column                | Type           | Constraint                                         | Description                                                                                                         |
| --------------------- | -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `serial`       | PK                                                 | Auto-incrementing integer for joining with `audit_logs.target_id`.                                                  |
| `preview_id`          | `text`         | NULL, FK `copilot_previews(id)` ON DELETE SET NULL | Source preview. NULL when refusal happened before preview creation (e.g., out-of-scope refusal).                    |
| `admin_id`            | `integer`      | NOT NULL, FK `admin_users(id)` ON DELETE RESTRICT  | The admin attributed (FR-AUTH-005).                                                                                 |
| `intent_text`         | `text`         | NOT NULL                                           | Verbatim admin input. Duplicated from preview so refusals (preview_id NULL) still capture it.                       |
| `tool_name`           | `varchar(100)` | NULL                                               | The tool the LLM proposed. NULL when no tool was called (e.g., refusal at intent stage).                            |
| `action_class`        | `varchar(50)`  | NOT NULL                                           | Same vocabulary as `copilot_previews.action_class`, plus: `refusal`, `validation_rejection`.                        |
| `risk_tier`           | `varchar(20)`  | NOT NULL                                           | Same vocabulary as previews.                                                                                        |
| `outcome`             | `varchar(20)`  | NOT NULL                                           | `success`, `partial`, `failure`, `refused`, `validation_rejected`, `rate_limited`, `stale`, `expired`, `cancelled`. |
| `failure_reason`      | `text`         | NULL                                               | Free text — populated when outcome is not `success`.                                                                |
| `before_state`        | `jsonb`        | NULL                                               | Captured snapshot of affected entities pre-execute. NULL for non-execute outcomes.                                  |
| `after_state`         | `jsonb`        | NULL                                               | Post-execute snapshot. NULL for non-execute or for partial/failure where after differs per item.                    |
| `confirmed_once_at`   | `timestamptz`  | NULL                                               | Mirrors preview field for queryability.                                                                             |
| `confirmed_twice_at`  | `timestamptz`  | NULL                                               | Mirrors preview field.                                                                                              |
| `executed_at`         | `timestamptz`  | NULL                                               | When the actual write committed. NULL for non-execute outcomes.                                                     |
| `model_id`            | `varchar(64)`  | NULL                                               | The model that produced this draft. NULL when no model was called.                                                  |
| `model_input_tokens`  | `integer`      | NULL                                               | Cost-tracking.                                                                                                      |
| `model_output_tokens` | `integer`      | NULL                                               | Cost-tracking.                                                                                                      |
| `correlation_id`      | `varchar(64)`  | NOT NULL                                           |                                                                                                                     |
| `created_at`          | `timestamptz`  | NOT NULL DEFAULT `now()`                           |                                                                                                                     |

**Indexes**:

- `idx_copilot_actions_admin_created` on `(admin_id, created_at DESC)` — admin history view.
- `idx_copilot_actions_action_class` on `(action_class)` — class-filter.
- `idx_copilot_actions_outcome` on `(outcome)` — outcome-filter.
- `idx_copilot_actions_preview` on `(preview_id)` — for joins.

**Immutability**: enforced at the application layer. No UPDATE statements may run against this table outside of an explicit data-correction migration; reviews must call out any such migration. Cascade deletes are disallowed (RESTRICT).

---

### 1.3 `copilot_action_items`

Per-item outcomes for bulk executes (FR-BULK-004).

| Column           | Type          | Constraint                                           | Description                      |
| ---------------- | ------------- | ---------------------------------------------------- | -------------------------------- |
| `id`             | `serial`      | PK                                                   |                                  |
| `action_id`      | `integer`     | NOT NULL, FK `copilot_actions(id)` ON DELETE CASCADE | The parent execution.            |
| `entity_type`    | `varchar(50)` | NOT NULL                                             | `product`, `inventory`, etc.     |
| `entity_id`      | `integer`     | NOT NULL                                             | Affected row's ID.               |
| `outcome`        | `varchar(20)` | NOT NULL                                             | `success`, `failure`, `skipped`. |
| `failure_reason` | `text`        | NULL                                                 |                                  |
| `before_value`   | `jsonb`       | NULL                                                 | Field-level before.              |
| `after_value`    | `jsonb`       | NULL                                                 | Field-level after.               |

**Indexes**:

- `idx_copilot_action_items_action` on `(action_id)`.
- `idx_copilot_action_items_entity` on `(entity_type, entity_id)`.

CASCADE on parent delete is acceptable here: per-item rows have no audit value if the parent is deleted, and parent deletion only happens via data-correction migration (see immutability above).

---

## 2. JSONB shapes

### 2.1 `copilot_previews.preview_payload`

Discriminated union by `kind`. The Zod schemas in `shared/api-zod/src/copilot/preview.ts` are the authoritative TypeScript types — what follows is the design.

**Common fields** (all kinds):

```text
{
  kind: "single" | "bulk",
  intent_summary: string,           // human-readable interpreted intent (FR-INTENT-002)
  side_effects: string[],           // e.g. "this will hide products from customers"
  validation_warnings: {
    severity: "warn" | "error",
    code: "below_cost" | "below_margin_floor" | "ambiguous_unit" | ...,
    message: string,
    affected_id: number | null,
  }[],
  irreversible: boolean,            // FR-FAIL-004 flag
  handoff: {                        // populated for wallet draft tool (no execute)
    target_url: string,             // e.g., /admin/topups/123
    rationale: string,
  } | null,
}
```

**Single-action payload (`kind: "single"`)**:

```text
{
  kind: "single",
  ...common,
  entity_type: "product" | "inventory" | "admin_user",
  entity_id: number,
  changes: { field: string, before: unknown, after: unknown }[],
}
```

**Bulk payload (`kind: "bulk"`)**:

```text
{
  kind: "bulk",
  ...common,
  total_affected: number,           // ≤ 500
  sample: {
    entity_type: string,
    entity_id: number,
    changes: { field: string, before: unknown, after: unknown }[],
  }[],                              // up to 20 representative rows
  aggregate_impact: {
    margin_delta_total?: string,    // for price_change_bulk
    stock_delta_total?: number,     // for stock_change_bulk
    archived_count?: number,        // for status_change_bulk
  } | null,
  predicted_failures: {
    entity_id: number,
    reason: string,
  }[],
}
```

### 2.2 `copilot_previews.record_versions`

```text
{
  "<entity_id>": "<updated_at_iso>",
  ...
}
```

For bulk previews, every entity in `affected_ids` has an entry. Staleness check at execute: re-read each entity's `updated_at` and compare.

---

## 3. Tool-catalog shape (LLM-facing types)

The LLM never sees Drizzle types directly. It sees a tool-catalog JSON whose argument schema is generated from the Zod definitions in `shared/api-zod/src/copilot/tools/*.ts`. Tool argument schemas mirror the corresponding admin endpoint's request body, narrowed to the fields the copilot is allowed to set.

**Read tools (Phase 1)**:

| Tool                       | Args                                                | Returns                          | Permission scope                                                      |
| -------------------------- | --------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ | ------------------------- | ----------------------------------------------------------- |
| `search_products`          | `{ q?: string, category?: string, status?: "active" | "draft"                          | "archived", min_stock?: number, max_stock?: number, limit?: number }` | `{ products: ProductSummary[] }`           | `inventory` or `all`      |
| `get_product`              | `{ id: number }`                                    | `{ product: ProductFull }`       | `inventory` or `all`                                                  |
| `list_low_stock`           | `{ threshold: number, category?: string }`          | `{ products: ProductSummary[] }` | `inventory` or `all`                                                  |
| `summarize_recent_changes` | `{ since_iso: string, limit?: number }`             | `{ entries: AuditEntry[] }`      | `admins` or `all`                                                     |
| `find_anomalies`           | `{ kind: "loss-making-price"                        | "refund-cluster"                 | "stock-spike"                                                         | "discount-ratio", window_hours?: number }` | `{ findings: Finding[] }` | scope per kind: pricing→`inventory`, refund→`finance`, etc. |

**Draft tools (Phase 2)**:

| Tool                         | Args                                                                                                           | Risk tier      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------- | ------------ |
| `draft_catalog_edit`         | `{ id: number, fields: Partial<{ name, description, descriptionLong, faq, usageTerms, imageUrl, category }> }` | `low`          |
| `draft_price_change`         | `{ id: number, new_price: string }`                                                                            | `high`         |
| `draft_cost_change`          | `{ id: number, new_cost_price: string }`                                                                       | `high`         |
| `draft_stock_change`         | `{ product_id: number, delta?: number, set_to?: number }` (one of `delta`/`set_to`)                            | `high`         |
| `draft_status_change`        | `{ id: number, action: "publish"                                                                               | "archive"      | "unarchive" }`                                                       | `high`       |
| `draft_bulk_price_change`    | `{ filter: ProductFilter, percent?: number, absolute?: string }`                                               | `high`         |
| `draft_bulk_status_change`   | `{ filter: ProductFilter, action: "archive"                                                                    | "unarchive" }` | `high`                                                               |
| `draft_bulk_category_change` | `{ filter: ProductFilter, new_category: string }`                                                              | `high`         |
| `draft_permission_change`    | `{ admin_id: number, permissions: string[] }`                                                                  | `high`         |
| `draft_wallet_action`        | `{ kind: "credit"                                                                                              | "debit"        | "refund_request", user_id: number, amount: string, reason: string }` | `no_execute` |

`ProductFilter` is `{ category?: string, status?: "active"|"draft"|"archived", search?: string, ids?: number[] }`. The validator computes `affected_ids` by running the filter and refuses at draft time if `affected_ids.length > 500`.

**Permission-scope filtering**: at request time, the system prompt builder (R-3) filters this catalog by the admin's `admin_users.permissions` array. The admin sees only tools they have scope for; the LLM literally cannot call what is not in the request.

---

## 4. State machine: preview lifecycle

```text
                ┌─────────┐
   draft tool → │ CREATED │ ──── /confirm (low-risk) ────→ executor → CONSUMED → SUCCESS/FAILURE/PARTIAL
                └────┬────┘
                     │
                     │ /confirm (high-risk)
                     ▼
              ┌───────────────────┐
              │ AWAITING_DOUBLE   │
              │ cooldown_starts_at│
              └────────┬──────────┘
                       │ /double-confirm (after ≥3s)
                       ▼
                  executor → CONSUMED → SUCCESS/FAILURE/PARTIAL

   ANY STATE ── /cancel ──→ CANCELLED (preview deleted; copilot_actions row with outcome=cancelled)
   ANY STATE ── expires_at < now() ──→ EXPIRED (executor refuses; copilot_actions row with outcome=expired)
   record_versions stale at execute ──→ STALE (executor refuses; copilot_actions row with outcome=stale)
```

Transitions:

- Only the owning admin (`copilot_previews.admin_id`) may confirm/cancel.
- A high-risk preview cannot use the low-risk single-confirm endpoint and vice-versa — the route mismatches the `risk_tier`.
- A `no_execute` (wallet) preview rejects both confirm endpoints with `403` and a handoff URL in the payload.

---

## 5. Audit reconciliation invariants

These are the SC-003/SC-004/SC-005 enforcement queries. The reconciliation worker job runs daily and alerts on any non-zero diff.

| Invariant                                        | SQL sketch                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every successful execute has an `audit_logs` row | `SELECT COUNT(*) FROM copilot_actions a LEFT JOIN audit_logs l ON l.target_type='copilot_action' AND l.target_id = a.id WHERE a.outcome IN ('success','partial') AND l.id IS NULL` — must equal 0 (SC-003).               |
| No execute lacks a confirmation                  | `SELECT COUNT(*) FROM copilot_actions WHERE outcome IN ('success','partial') AND confirmed_once_at IS NULL` — must equal 0 (SC-004).                                                                                      |
| No high-risk execute lacks a double-confirmation | `SELECT COUNT(*) FROM copilot_actions WHERE risk_tier='high' AND outcome IN ('success','partial') AND confirmed_twice_at IS NULL` — must equal 0 (SC-005).                                                                |
| No execute outside a 5-minute preview window     | `SELECT COUNT(*) FROM copilot_actions a JOIN copilot_previews p ON p.id = a.preview_id WHERE a.outcome IN ('success','partial') AND a.executed_at > p.created_at + interval '5 minutes'` — must equal 0 (FR-PREVIEW-003). |
| No execute outside the cooldown for high-risk    | `SELECT COUNT(*) FROM copilot_actions WHERE risk_tier='high' AND outcome IN ('success','partial') AND confirmed_twice_at < confirmed_once_at + interval '3 seconds'` — must equal 0 (FR-CONFIRM-002).                     |

---

## 6. Migration plan

Single migration file `migrations/NNNN_copilot.sql` (or Drizzle-generated):

```text
CREATE TABLE copilot_previews (...);     -- §1.1, with FKs and indexes
CREATE TABLE copilot_actions (...);      -- §1.2
CREATE TABLE copilot_action_items (...); -- §1.3
```

Per Constitution §V, every statement uses `CREATE TABLE … IF NOT EXISTS` and each `CREATE INDEX` uses `IF NOT EXISTS`, idempotent under the existing Redis-NX boot-migration lock. The migration also extends `audit_logs.action` allowed values informally (the column is `varchar(100)`, no enum) — no schema change required to add `"copilot.execute"`.

**Rollback**: dropping the three tables is safe because no other table references them. Cascading FK from `copilot_action_items` to `copilot_actions` is intentional.

**No backfill needed** — these are new tables.

---

## 7. Existing schema dependencies (verified or to-verify)

| Dependency                                     | Status               | Notes                                                    |
| ---------------------------------------------- | -------------------- | -------------------------------------------------------- |
| `products.updated_at`                          | ✅ verified          | `shared/db/src/schema/products.ts:78`                    |
| `inventory.updated_at`                         | ⚠ to verify          | If missing, add as part of this migration.               |
| `admin_users.updated_at`                       | ⚠ to verify          | Same.                                                    |
| `audit_logs.action` accepts new values         | ✅ — `varchar(100)`  | No enum constraint.                                      |
| `audit_logs.actor_id` accepts `admin_users.id` | ✅ — both are `int4` | Matches existing pattern (`actor_type='admin'`).         |
| `admin_users.permissions` array                | ✅ verified          | JSONB array of scope strings; reused for tool filtering. |

The two ⚠ items become tasks in `/speckit-tasks`.
