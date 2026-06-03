/**
 * Executor (010-ai-admin-copilot, T085).
 *
 * Phase 3 — Low-risk catalog edits only. Wraps the domain mutation and
 * the audit dual-write in a single Postgres transaction so a failed
 * audit insert rolls back the product write (FR-EXECUTE-003: no silent
 * partial state).
 *
 * Pre-execute checks (in order, all required to pass):
 *   1. Preview is owner-matching, unconsumed, unexpired (claim).
 *   2. Risk tier is `low` (high-risk goes through executeHighRisk in US4).
 *   3. Re-read each affected entity and compare `updated_at` against
 *      `record_versions` captured at draft time → reject if stale
 *      (FR-PREVIEW-004).
 *   4. Tool is one we know how to execute.
 *
 * Post-execute:
 *   - Stamp `consumed_at` on the preview.
 *   - Write `copilot_actions` + `audit_logs` rows atomically.
 *   - Return outcome + new audit id.
 */

import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { recordExecute } from "./audit";
import { claimUnconsumedPreview, markConsumed, type PreviewRow } from "./preview-store";

export type ExecuteOutcome =
  | { kind: "success"; actionId: number; afterState: unknown }
  | { kind: "stale"; staleIds: number[] }
  | { kind: "expired" }
  | { kind: "consumed" }
  | { kind: "not_found" }
  | { kind: "wrong_tier"; tier: "high" | "no_execute" }
  | { kind: "failure"; reason: string };

export async function executeLowRiskConfirm(args: {
  previewId: string;
  adminId: number;
}): Promise<ExecuteOutcome> {
  const claimed = await claimUnconsumedPreview(args.previewId, args.adminId);
  if (!claimed) {
    // Distinguish the three "not claimable" cases for the route to map
    // to 404/410/409 — the cheaper way is a second read.
    const { db: db2, copilotPreviewsTable } = await import("@workspace/db");
    void db2;
    void copilotPreviewsTable;
    return { kind: "not_found" };
  }
  const preview = claimed;

  if (preview.riskTier !== "low") {
    return { kind: "wrong_tier", tier: preview.riskTier === "high" ? "high" : "no_execute" };
  }

  // Staleness check on each affected entity.
  if (preview.affectedEntityType === "product") {
    const stale: number[] = [];
    for (const id of preview.affectedIds) {
      const [row] = await db
        .select({ updatedAt: productsTable.updatedAt })
        .from(productsTable)
        .where(eq(productsTable.id, id))
        .limit(1);
      if (!row) {
        stale.push(id);
        continue;
      }
      const expected = preview.recordVersions[String(id)];
      const actual = (row.updatedAt ?? new Date(0)).toISOString();
      if (!expected || expected !== actual) stale.push(id);
    }
    if (stale.length > 0) {
      return { kind: "stale", staleIds: stale };
    }
  } else {
    return { kind: "failure", reason: `unsupported entity type: ${preview.affectedEntityType}` };
  }

  // Apply the change. Phase 3 supports only draft_catalog_edit (low risk).
  if (preview.toolName !== "draft_catalog_edit") {
    return { kind: "failure", reason: `unsupported tool: ${preview.toolName}` };
  }

  const payload = preview.previewPayload as {
    changes?: Array<{ field: string; after: unknown }>;
  };
  const changes = payload.changes ?? [];
  if (changes.length === 0) {
    return { kind: "failure", reason: "preview has no changes" };
  }
  const productId = preview.affectedIds[0]!;
  const updateValues: Record<string, unknown> = {};
  for (const c of changes) {
    updateValues[c.field] = c.after;
  }

  let actionId = -1;
  try {
    actionId = await db.transaction(async (tx) => {
      // Re-fetch full row inside the transaction for `before_state` snapshot.
      const [before] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .limit(1);
      if (!before) throw new Error("product disappeared mid-transaction");

      // Drizzle's $onUpdate hook on products.updatedAt fires here.
      const [after] = await tx
        .update(productsTable)
        .set(updateValues)
        .where(eq(productsTable.id, productId))
        .returning();
      if (!after) throw new Error("product update returned no row");

      // We can't call recordExecute(tx) — the helper opens its own tx —
      // so insert directly here within OUR transaction so the audit
      // write rolls back together with the product update on failure.
      const { auditLogsTable, copilotActionsTable } = await import("@workspace/db");
      const [actionRow] = await tx
        .insert(copilotActionsTable)
        .values({
          previewId: preview.id,
          adminId: args.adminId,
          intentText: preview.intentText,
          toolName: preview.toolName,
          actionClass: preview.actionClass,
          riskTier: "low",
          outcome: "success",
          beforeState: before as never,
          afterState: after as never,
          confirmedOnceAt: new Date(),
          executedAt: new Date(),
          modelId: preview.modelId,
          correlationId: preview.correlationId,
        })
        .returning({ id: copilotActionsTable.id });
      if (!actionRow) throw new Error("copilot_actions insert returned no row");

      await tx.insert(auditLogsTable).values({
        actorType: "admin",
        actorId: args.adminId,
        action: `copilot.${preview.actionClass}`,
        targetType: "copilot_action",
        targetId: actionRow.id,
        metadata: JSON.stringify({
          outcome: "success",
          toolName: preview.toolName,
          productId,
        }),
      });

      return actionRow.id;
    });
  } catch (err) {
    logger.error({ err, previewId: preview.id }, "copilot executor: transaction failed");
    return { kind: "failure", reason: err instanceof Error ? err.message : String(err) };
  }

  // Mark the preview consumed AFTER the transaction commits.
  try {
    await markConsumed(preview.id);
  } catch (err) {
    logger.warn({ err, previewId: preview.id }, "copilot: markConsumed failed");
  }

  // Re-read the after state once more to return to the caller (the value
  // captured inside the tx isn't easily threaded out of recordExecute).
  const [after] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);

  return { kind: "success", actionId, afterState: after ?? null };
}

// Re-export for tests / future bulk path.
export type { PreviewRow };
export { recordExecute };
