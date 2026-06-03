/**
 * Atomic dual-write of `copilot_actions` + `audit_logs` (010-ai-admin-copilot, T034).
 *
 * Every executed copilot action MUST produce both rows in one transaction
 * so reconciliation invariants (SC-003) cannot drift. Refusal /
 * cancellation paths write only `copilot_actions` (per data-model.md §R-8).
 */

import { auditLogsTable, copilotActionsTable, copilotActionItemsTable, db } from "@workspace/db";
import { logger } from "../../lib/logger";

export type ActionOutcome =
  | "success"
  | "partial"
  | "failure"
  | "refused"
  | "validation_rejected"
  | "rate_limited"
  | "stale"
  | "expired"
  | "cancelled";

export interface RecordExecuteInput {
  previewId: string;
  adminId: number;
  intentText: string;
  toolName: string;
  actionClass: string;
  riskTier: "low" | "high" | "no_execute";
  outcome: Exclude<ActionOutcome, "refused" | "validation_rejected" | "rate_limited" | "cancelled">;
  failureReason?: string | null;
  beforeState: unknown;
  afterState: unknown;
  confirmedOnceAt: Date;
  confirmedTwiceAt?: Date | null;
  modelId: string;
  correlationId: string;
  /** Per-item outcomes for bulk; omit for single-entity actions. */
  items?: Array<{
    entityType: string;
    entityId: number;
    outcome: "success" | "failure" | "skipped";
    failureReason?: string | null;
    beforeValue?: unknown;
    afterValue?: unknown;
  }>;
}

/**
 * Write a copilot_actions row + matching audit_logs row in one transaction,
 * plus per-item rows for bulk. Returns the new copilot_actions.id.
 *
 * If the transaction fails the caller should treat the original write as
 * having NOT been committed — but in practice the executor wraps the
 * domain mutation AND this audit write in the same transaction, so the
 * domain change is rolled back together with a failed audit insert.
 */
export async function recordExecute(input: RecordExecuteInput): Promise<number> {
  return db.transaction(async (tx) => {
    const [action] = await tx
      .insert(copilotActionsTable)
      .values({
        previewId: input.previewId,
        adminId: input.adminId,
        intentText: input.intentText,
        toolName: input.toolName,
        actionClass: input.actionClass,
        riskTier: input.riskTier,
        outcome: input.outcome,
        failureReason: input.failureReason ?? null,
        beforeState: input.beforeState as never,
        afterState: input.afterState as never,
        confirmedOnceAt: input.confirmedOnceAt,
        confirmedTwiceAt: input.confirmedTwiceAt ?? null,
        executedAt: new Date(),
        modelId: input.modelId,
        correlationId: input.correlationId,
      })
      .returning({ id: copilotActionsTable.id });
    if (!action) throw new Error("copilot_actions insert returned no row");

    if (input.items && input.items.length > 0) {
      await tx.insert(copilotActionItemsTable).values(
        input.items.map((it) => ({
          actionId: action.id,
          entityType: it.entityType,
          entityId: it.entityId,
          outcome: it.outcome,
          failureReason: it.failureReason ?? null,
          beforeValue: (it.beforeValue ?? null) as never,
          afterValue: (it.afterValue ?? null) as never,
        })),
      );
    }

    await tx.insert(auditLogsTable).values({
      actorType: "admin",
      actorId: input.adminId,
      action: `copilot.${input.actionClass}`,
      targetType: "copilot_action",
      targetId: action.id,
      metadata: JSON.stringify({
        outcome: input.outcome,
        failureReason: input.failureReason ?? null,
        toolName: input.toolName,
      }),
    });

    return action.id;
  });
}

export interface RecordNonExecuteInput {
  previewId?: string | null;
  adminId: number;
  intentText: string;
  toolName?: string | null;
  actionClass: string;
  riskTier: "low" | "high" | "no_execute";
  outcome: "refused" | "validation_rejected" | "rate_limited" | "cancelled";
  failureReason?: string | null;
  modelId?: string | null;
  modelInputTokens?: number | null;
  modelOutputTokens?: number | null;
  correlationId: string;
}

/** Write only a `copilot_actions` row for non-execute outcomes. */
export async function recordNonExecute(input: RecordNonExecuteInput): Promise<number | null> {
  try {
    const [row] = await db
      .insert(copilotActionsTable)
      .values({
        previewId: input.previewId ?? null,
        adminId: input.adminId,
        intentText: input.intentText,
        toolName: input.toolName ?? null,
        actionClass: input.actionClass,
        riskTier: input.riskTier,
        outcome: input.outcome,
        failureReason: input.failureReason ?? null,
        modelId: input.modelId ?? null,
        modelInputTokens: input.modelInputTokens ?? null,
        modelOutputTokens: input.modelOutputTokens ?? null,
        correlationId: input.correlationId,
      })
      .returning({ id: copilotActionsTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "copilot non-execute audit insert failed");
    return null;
  }
}
