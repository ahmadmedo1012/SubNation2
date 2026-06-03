# Updated_at Coverage Audit

**Task**: T003 (from `specs/010-ai-admin-copilot/tasks.md`)
**Date**: 2026-06-03
**Purpose**: Confirm whether each writable entity targeted by FR-DATA-002 has a monotonic `updated_at` column sufficient for the FR-PREVIEW-004 staleness check.

## Findings

| Schema file                           | Column                                          | Status                      |
| ------------------------------------- | ----------------------------------------------- | --------------------------- |
| `shared/db/src/schema/products.ts`    | `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` | **✅ Present** (line 78–80) |
| `shared/db/src/schema/inventory.ts`   | _missing_                                       | **⚠ Add migration**         |
| `shared/db/src/schema/admin_users.ts` | _missing_                                       | **⚠ Add migration**         |

## Required follow-up

T009 and T010 (currently conditional in `tasks.md`) MUST be executed unconditionally. The migration in T008 must include:

```sql
ALTER TABLE inventory   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
```

Plus matching Drizzle schema additions (NOT NULL, default `now()`, with an `onUpdate` hook so writes advance the timestamp).

## Rationale

`updated_at` is the staleness reference captured in `copilot_previews.record_versions` (data-model.md §1.1). Without it, the executor cannot detect a stale preview for inventory or admin permission edits — both of which are explicitly writable in Phase 3 (FR-DATA-002) and gated by high-risk double-confirmation (FR-CONFIRM-003).

Without the migration:

- A bulk stock change drafted at T0 and confirmed at T0+30s would silently overwrite a concurrent admin edit on the same row (violates "stale preview" edge case + FR-PREVIEW-004).
- A permission change drafted at T0 and confirmed at T0+10s could clobber a security-driven role downgrade applied at T0+5s.

Both are unacceptable; both require the column.

## Other writable tables in Phase 2

Phase 2 introduces three new tables (`copilot_previews`, `copilot_actions`, `copilot_action_items`). The data-model.md spec includes `created_at` on all three; only `copilot_previews` mutates after creation (confirmation timestamps, `consumed_at`). It does NOT need an `updated_at` because the staleness check is on the _target_ entity, not the preview itself.

## Disposition

Phase 2 migration `NNNN_copilot.sql` (task T008) MUST add `updated_at` to both `inventory` and `admin_users`. T009 and T010 are no longer conditional — they are required.
