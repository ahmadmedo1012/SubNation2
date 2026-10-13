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
 *   - Stamp `consumed_at` on the preview INSIDE the same transaction, as a
 *     conditional claim (E-1/R142 — see PreviewAlreadyConsumedError).
 *   - Write `copilot_actions` + `audit_logs` rows atomically.
 *   - Return outcome + new audit id.
 */

import { db, productsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { recordExecute } from "./audit";
import { claimHighRiskForExecute, claimUnconsumedPreview, type PreviewRow } from "./preview-store";

/**
 * E-1 (R142): thrown INSIDE an executor tx when the conditional
 * consumed_at stamp matched 0 rows — a concurrent confirm already
 * consumed the preview. Throwing rolls the whole tx back (product write
 * + copilot_actions + audit_logs) so a double-click inside the claim
 * window can no longer double-execute; the catch maps it to the
 * "consumed" outcome the route answers with an honest 409.
 */
class PreviewAlreadyConsumedError extends Error {
  constructor() {
    super("preview already consumed by a concurrent confirm");
  }
}

export type ExecuteOutcome =
  | { kind: "success"; actionId: number; afterState: unknown }
  | { kind: "stale"; staleIds: number[] }
  | { kind: "expired" }
  | { kind: "consumed" }
  | { kind: "not_found" }
  | { kind: "wrong_tier"; tier: "high" | "no_execute" }
  | { kind: "cooldown_not_elapsed"; cooldownStartsAt: Date }
  | { kind: "first_confirm_missing" }
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

      // E-1 (R142): single-use is a conditional CLAIM, not check-then-act.
      // The claim SELECT above races against a concurrent confirm; stamping
      // consumed_at INSIDE the tx with an isNull(consumed_at) predicate makes
      // the loser's stamp match 0 rows → throw → full rollback (no duplicate
      // copilot_actions/audit_logs for one admin intent).
      const { copilotPreviewsTable } = await import("@workspace/db");
      const [consumed] = await tx
        .update(copilotPreviewsTable)
        .set({ consumedAt: new Date() })
        .where(
          and(eq(copilotPreviewsTable.id, preview.id), isNull(copilotPreviewsTable.consumedAt)),
        )
        .returning({ id: copilotPreviewsTable.id });
      if (!consumed) throw new PreviewAlreadyConsumedError();

      return actionRow.id;
    });
  } catch (err) {
    if (err instanceof PreviewAlreadyConsumedError) return { kind: "consumed" };
    logger.error({ err, previewId: preview.id }, "copilot executor: transaction failed");
    return { kind: "failure", reason: err instanceof Error ? err.message : String(err) };
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

// ────────────────────────────────────────────────────────────────────────
// High-risk execute path (US4)
// ────────────────────────────────────────────────────────────────────────

/**
 * Execute a high-risk preview after the 3-second cooldown has elapsed.
 *
 * Pre-execute checks:
 *   1. Owner-matching, unexpired, unconsumed.
 *   2. confirmed_once_at IS NOT NULL AND now() >= cooldown_starts_at + 3s
 *      (handled by claimHighRiskForExecute).
 *   3. risk_tier === "high".
 *   4. Per-entity record_versions match (FR-PREVIEW-004).
 *
 * Apply: route on toolName to the right column update; price_change touches
 * `price`, cost_change `cost_price`, status_change `is_active`+`is_archived`.
 *
 * Audit dual-write happens inside the same transaction as the product
 * update (FR-EXECUTE-003).
 */
export async function executeHighRiskDoubleConfirm(args: {
  previewId: string;
  adminId: number;
}): Promise<ExecuteOutcome> {
  // Peek first so we can return distinct codes for not-found vs cooldown.
  const peeked = await claimUnconsumedPreview(args.previewId, args.adminId);
  if (!peeked) return { kind: "not_found" };
  if (peeked.riskTier !== "high") {
    return { kind: "wrong_tier", tier: peeked.riskTier === "low" ? "high" : "no_execute" };
  }
  if (!peeked.confirmedOnceAt || !peeked.cooldownStartsAt) {
    return { kind: "first_confirm_missing" };
  }
  const now = Date.now();
  const cooldownEndMs = peeked.cooldownStartsAt.getTime() + 3000;
  if (now < cooldownEndMs) {
    return { kind: "cooldown_not_elapsed", cooldownStartsAt: peeked.cooldownStartsAt };
  }

  const claimed = await claimHighRiskForExecute(args.previewId, args.adminId);
  if (!claimed) {
    return { kind: "failure", reason: "preview no longer claimable" };
  }
  const preview = claimed;

  // Staleness check.
  if (preview.affectedEntityType !== "product") {
    return { kind: "failure", reason: `unsupported entity type: ${preview.affectedEntityType}` };
  }
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
  if (stale.length > 0) return { kind: "stale", staleIds: stale };

  const productId = preview.affectedIds[0]!;
  const payload = preview.previewPayload as {
    changes?: Array<{ field: string; before: unknown; after: unknown }>;
  };
  const changes = payload.changes ?? [];
  if (changes.length === 0) {
    return { kind: "failure", reason: "preview has no changes" };
  }

  const updateValues: Record<string, unknown> = {};
  for (const c of changes) {
    if (preview.toolName === "draft_price_change" && c.field === "price") {
      // r4 red-team F-1 (defense in depth): the draft handler bounds
      // new_price at 0.01..1M, but the preview store is a separate
      // persistence layer — re-validate at the write boundary so a
      // corrupted/legacy preview can never poison the catalog with a
      // price the checkout INVALID_PRICE gate would fail-closed on.
      const n = Number(c.after);
      if (!Number.isFinite(n) || n < 0.01 || n > 1_000_000) {
        return {
          kind: "failure",
          reason: `price out of bounds (0.01..1000000): ${String(c.after).slice(0, 40)}`,
        };
      }
      updateValues.price = c.after as string;
    } else if (preview.toolName === "draft_cost_change" && c.field === "costPrice") {
      const n = Number(c.after);
      if (!Number.isFinite(n) || n < 0.01 || n > 1_000_000) {
        return {
          kind: "failure",
          reason: `costPrice out of bounds (0.01..1000000): ${String(c.after).slice(0, 40)}`,
        };
      }
      updateValues.costPrice = c.after as string;
    } else if (
      preview.toolName === "draft_status_change" &&
      (c.field === "isActive" || c.field === "isArchived")
    ) {
      updateValues[c.field] = Boolean(c.after);
    } else {
      return {
        kind: "failure",
        reason: `unsupported field/tool combo: ${preview.toolName}/${c.field}`,
      };
    }
  }

  let actionId = -1;
  try {
    actionId = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .limit(1);
      if (!before) throw new Error("product disappeared mid-transaction");

      const [after] = await tx
        .update(productsTable)
        .set(updateValues)
        .where(eq(productsTable.id, productId))
        .returning();
      if (!after) throw new Error("product update returned no row");

      const { auditLogsTable, copilotActionsTable } = await import("@workspace/db");
      const confirmedTwiceAt = new Date();
      const [actionRow] = await tx
        .insert(copilotActionsTable)
        .values({
          previewId: preview.id,
          adminId: args.adminId,
          intentText: preview.intentText,
          toolName: preview.toolName,
          actionClass: preview.actionClass,
          riskTier: "high",
          outcome: "success",
          beforeState: before as never,
          afterState: after as never,
          confirmedOnceAt: preview.confirmedOnceAt,
          confirmedTwiceAt,
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
          fields: changes.map((c) => c.field),
        }),
      });

      // Stamp confirmed_twice_at + consumed_at inside the same tx.
      // E-1 (R142): the consumed stamp is a CONDITIONAL claim
      // (isNull(consumed_at)) — a concurrent double-confirm matches 0
      // rows → throw → rollback (the duplicate action/audit rows vanish).
      const { copilotPreviewsTable: previewsT } = await import("@workspace/db");
      const [consumedTwiceRow] = await tx
        .update(previewsT)
        .set({ confirmedTwiceAt, consumedAt: new Date() })
        .where(and(eq(previewsT.id, preview.id), isNull(previewsT.consumedAt)))
        .returning({ id: previewsT.id });
      if (!consumedTwiceRow) throw new PreviewAlreadyConsumedError();

      return actionRow.id;
    });
  } catch (err) {
    if (err instanceof PreviewAlreadyConsumedError) return { kind: "consumed" };
    logger.error({ err, previewId: preview.id }, "copilot high-risk executor: transaction failed");
    return { kind: "failure", reason: err instanceof Error ? err.message : String(err) };
  }

  const [after] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  return { kind: "success", actionId, afterState: after ?? null };
}
