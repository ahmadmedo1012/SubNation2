# Phase 1 Data Model — Arabic Catalog Content Enrichment

**Feature**: 012-arabic-catalog-enrichment
**Date**: 2026-06-04
**Status**: complete
**Companion**: [research.md](./research.md), [contracts/openapi.enrichment.yaml](./contracts/openapi.enrichment.yaml)

This document is the source of truth for the persistence layer.

---

## 1. Tables

### 1.1 `enrichment_runs`

One row per cron execution. Mirrors the shape of `inventory_forecast_runs` so on-call has one mental model.

| Column                  | Type                       | Null | Default       | Notes                                                          |
| ----------------------- | -------------------------- | ---- | ------------- | -------------------------------------------------------------- |
| `id`                    | `serial PRIMARY KEY`       | NO   | (sequence)    | Stable opaque id; referenced by every draft row in the run.    |
| `started_at`            | `timestamptz`              | NO   | `now()`       | Worker-tier wall-clock at job start.                           |
| `completed_at`          | `timestamptz`              | YES  | NULL          | NULL means in-flight or crashed.                               |
| `outcome`               | `varchar(20)`              | NO   | `'in_flight'` | One of `in_flight`, `success`, `failure`.                      |
| `drafts_generated`      | `integer`                  | NO   | `0`           | Drafts that passed validation.                                 |
| `drafts_invalid`        | `integer`                  | NO   | `0`           | LLM outputs that failed the validator (FR-DRAFT-007).          |
| `products_skipped`      | `jsonb`                    | NO   | `'{}'`        | Per-reason skip counts: `{archived, inactive, recently_rejected, already_drafted, no_eligible_field}`. |
| `tokens_spent`          | `integer`                  | NO   | `0`           | Cumulative input + output tokens across all LLM calls in this run. |
| `daily_token_cap`       | `integer`                  | NO   | `0`           | The cap value at run-start; recorded so cost back-tests are reproducible. |
| `cap_reached`           | `boolean`                  | NO   | `false`       | True iff the run halted because cumulative tokens exceeded the cap. |
| `worker_tier`           | `varchar(50)`              | YES  | NULL          | Forensic tier id captured from `process.env.WORKER_TIER_ID`.   |
| `failure_reason`        | `text`                     | YES  | NULL          | Free-text capture when `outcome='failure'`.                    |

**Indexes**:

- `idx_enrichment_runs_started_at` on `(started_at DESC)` — supports the "last run" query.
- `idx_enrichment_runs_outcome` on `(outcome, started_at DESC)` — supports "last successful run".

### 1.2 `enrichment_drafts`

One row per (product, field, iteration). The state-machine surface (research §R-7) sits on this table.

| Column            | Type                                                                         | Null | Default     | Notes                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------- | ---- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `serial PRIMARY KEY`                                                         | NO   | (sequence)  | Stable opaque id.                                                                                                           |
| `run_id`          | `integer NOT NULL REFERENCES enrichment_runs(id) ON DELETE CASCADE`          | NO   | —           | Cascades because drafts have no value once the parent run is purged.                                                        |
| `product_id`      | `integer NOT NULL REFERENCES products(id) ON DELETE CASCADE`                 | NO   | —           | Cascade on product delete.                                                                                                  |
| `field_name`      | `varchar(50)`                                                                | NO   | —           | One of `description`, `description_long`, `faq`. Enforced via CHECK constraint.                                             |
| `state`           | `varchar(20)`                                                                | NO   | `'drafted'` | One of `drafted`, `published`, `rejected`, `draft_invalid`. CHECK constraint.                                                |
| `generated_text`  | `text`                                                                       | NO   | —           | Original LLM output (the verbatim copy the model produced). Always populated, even for `draft_invalid` rows.                |
| `final_text`      | `text`                                                                       | YES  | NULL        | Admin's edited version. NULL until publish; equals `generated_text` if admin published without editing.                     |
| `model_id`        | `varchar(64)`                                                                | NO   | —           | e.g., `claude-sonnet-4-6`.                                                                                                  |
| `input_tokens`    | `integer`                                                                    | NO   | `0`         | Input-side token count from this single call.                                                                               |
| `output_tokens`   | `integer`                                                                    | NO   | `0`         | Output-side token count.                                                                                                    |
| `created_at`      | `timestamptz`                                                                | NO   | `now()`     | Cron emit time.                                                                                                             |
| `published_at`    | `timestamptz`                                                                | YES  | NULL        | Set when state transitions to `published`.                                                                                  |
| `published_by`    | `integer REFERENCES admin_users(id) ON DELETE SET NULL`                      | YES  | NULL        | The admin who clicked apply.                                                                                                |
| `rejected_at`     | `timestamptz`                                                                | YES  | NULL        | Set when state transitions to `rejected`. Drives the 14-day suppression window (research §R-6).                             |
| `rejected_by`     | `integer REFERENCES admin_users(id) ON DELETE SET NULL`                      | YES  | NULL        | The admin who clicked reject.                                                                                                |
| `rejection_reason`| `text`                                                                       | YES  | NULL        | Free-text reason (optional; FR-PANEL-007).                                                                                   |
| `validation_errors` | `jsonb`                                                                    | YES  | NULL        | When state='draft_invalid', this holds the validator's findings.                                                            |

**Constraints**:

- `CHECK (state IN ('drafted', 'published', 'rejected', 'draft_invalid'))`.
- `CHECK (field_name IN ('description', 'description_long', 'faq'))`.
- `CHECK ((state = 'published') = (published_at IS NOT NULL))` — published rows always carry a timestamp.
- `CHECK ((state = 'rejected') = (rejected_at IS NOT NULL))` — same for rejected rows.

**Indexes**:

- `idx_enrichment_drafts_state_created` on `(state, created_at DESC)` — supports the panel's main query.
- `idx_enrichment_drafts_product_field_state` on `(product_id, field_name, state, rejected_at)` — supports the suppression-window check the candidate selector runs.
- `idx_enrichment_drafts_run` on `(run_id)` — supports retention purge.

### 1.3 `audit_logs` extension

No schema change. The existing `audit_logs.action` column is `varchar(100)`. We add two new literals:

- `enrichment.run` — written per successful cron run with metadata `{runId, draftsGenerated, draftsInvalid, tokensSpent, capReached}`.
- `enrichment.publish` — written per admin apply with metadata `{draftId, productId, fieldName, original, final, edited: bool}`.

---

## 2. State machine (full diagram)

```text
                cron INSERT             cron INSERT (validator failed)
                     |                          |
                     v                          v
              ┌─────────────┐            ┌──────────────────┐
              │  drafted    │            │  draft_invalid   │  (error sink)
              └─────┬───────┘            └──────────────────┘
                    │
                    │ admin "تطبيق"          │ admin "رفض"
                    v                        v
              ┌──────────────┐         ┌──────────────┐
              │  published   │         │  rejected    │
              │  (terminal)  │         │  (terminal)  │
              └──────────────┘         └──────────────┘
```

**Transition rules**:

- `drafted → published`: requires `state='drafted'` AND a valid admin id; the apply handler also writes the product field through the existing service-layer path.
- `drafted → rejected`: requires `state='drafted'` AND a valid admin id; optional `rejection_reason`.
- `drafted → draft_invalid`: only the cron does this, only on validator failure. NEVER fires from the panel.
- All other transitions are forbidden by the CHECK constraints + application-level state checks in the publish/reject handlers.

---

## 3. Reconciliation queries

The retention cron (research §R-9) runs these once daily at 04:00 UTC. Any non-zero result fires the existing `alerting.service.ts` webhook.

### Invariant 1 — every draft has a parent run

```sql
SELECT COUNT(*) FROM enrichment_drafts d
LEFT JOIN enrichment_runs r ON r.id = d.run_id
WHERE r.id IS NULL;
-- expected: 0 (cascade FK guarantees this; query is a paranoia check)
```

### Invariant 2 — published rows always have published_at + published_by

```sql
SELECT id FROM enrichment_drafts
WHERE state = 'published' AND (published_at IS NULL OR published_by IS NULL);
-- expected: 0
```

### Invariant 3 — apply events have audit rows

```sql
SELECT d.id FROM enrichment_drafts d
LEFT JOIN audit_logs a ON a.action = 'enrichment.publish'
  AND (a.metadata::jsonb)->>'draftId' = d.id::text
WHERE d.state = 'published' AND a.id IS NULL;
-- expected: 0 (SC-006)
```

### Invariant 4 — cap_reached runs match tokens_spent vs daily_token_cap

```sql
SELECT id FROM enrichment_runs
WHERE outcome = 'success' AND cap_reached = true
  AND tokens_spent < daily_token_cap;
-- expected: 0 (cap_reached should only flip when the loop actually exited from the cap check)
```

---

## 4. Migration plan

Single migration: `shared/db/drizzle/<NNNN>_enrichment.sql`. All statements idempotent per Constitution §V; integrates with the existing Redis-NX boot-migration lock.

```sql
CREATE TABLE IF NOT EXISTS enrichment_runs (
  id                SERIAL       PRIMARY KEY,
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  outcome           VARCHAR(20)  NOT NULL DEFAULT 'in_flight',
  drafts_generated  INTEGER      NOT NULL DEFAULT 0,
  drafts_invalid    INTEGER      NOT NULL DEFAULT 0,
  products_skipped  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  tokens_spent      INTEGER      NOT NULL DEFAULT 0,
  daily_token_cap   INTEGER      NOT NULL DEFAULT 0,
  cap_reached       BOOLEAN      NOT NULL DEFAULT false,
  worker_tier       VARCHAR(50),
  failure_reason    TEXT
);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_started_at ON enrichment_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_outcome ON enrichment_runs (outcome, started_at DESC);

CREATE TABLE IF NOT EXISTS enrichment_drafts (
  id                  SERIAL       PRIMARY KEY,
  run_id              INTEGER      NOT NULL REFERENCES enrichment_runs(id) ON DELETE CASCADE,
  product_id          INTEGER      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_name          VARCHAR(50)  NOT NULL,
  state               VARCHAR(20)  NOT NULL DEFAULT 'drafted',
  generated_text      TEXT         NOT NULL,
  final_text          TEXT,
  model_id            VARCHAR(64)  NOT NULL,
  input_tokens        INTEGER      NOT NULL DEFAULT 0,
  output_tokens       INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  published_at        TIMESTAMPTZ,
  published_by        INTEGER      REFERENCES admin_users(id) ON DELETE SET NULL,
  rejected_at         TIMESTAMPTZ,
  rejected_by         INTEGER      REFERENCES admin_users(id) ON DELETE SET NULL,
  rejection_reason    TEXT,
  validation_errors   JSONB,
  CONSTRAINT chk_enrichment_state
    CHECK (state IN ('drafted','published','rejected','draft_invalid')),
  CONSTRAINT chk_enrichment_field
    CHECK (field_name IN ('description','description_long','faq')),
  CONSTRAINT chk_enrichment_published_consistency
    CHECK ((state = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT chk_enrichment_rejected_consistency
    CHECK ((state = 'rejected') = (rejected_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_enrichment_drafts_state_created
  ON enrichment_drafts (state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_drafts_product_field_state
  ON enrichment_drafts (product_id, field_name, state, rejected_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_drafts_run
  ON enrichment_drafts (run_id);
```

---

## 5. Read-path overview

| Endpoint / consumer                              | Reads                                                                 | Filters                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET /api/admin/enrichment/list` (panel)         | `enrichment_drafts WHERE state='drafted'`                              | `LIMIT 25 OFFSET <cursor>`, ORDER BY created_at DESC           |
| `POST /api/admin/enrichment/:id/publish`         | the single draft row                                                   | identity by id; verify state='drafted'                         |
| `POST /api/admin/enrichment/:id/reject`          | the single draft row                                                   | identity by id; verify state='drafted'                         |
| `query_enrichment_drafts` (copilot tool)         | `enrichment_drafts` filtered by state, product_id, field_name          | optional product_id; optional state                            |
| Candidate selector (cron, in-process)            | `products LEFT JOIN enrichment_drafts` to find eligible product+field  | excludes archived/inactive + recently-rejected combinations    |
| Retention cron                                   | `enrichment_drafts WHERE created_at < CURRENT_DATE - 90 AND state IN (terminal)` | none — pure delete                                       |

---

**Status**: data model complete.
