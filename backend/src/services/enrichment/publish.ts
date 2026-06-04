/**
 * Publish handler (012-arabic-catalog-enrichment, T015).
 *
 * Calls the existing low-risk catalog-edit path. Updates the product
 * field through Drizzle's typed update — same shape the existing
 * `routes/admin/products.ts` and the 010 copilot executor use, so
 * `updated_at` fires (Drizzle $onUpdate) and existing audit conventions
 * apply uniformly.
 */

import {
  auditLogsTable,
  db,
  enrichmentDraftsTable,
  productsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getById, markPublished, type DraftField } from "./draft-store";
import { tryParseFaq } from "./prompts";

export type PublishOutcome =
  | { kind: "success"; productId: number; field: DraftField }
  | { kind: "not_found" }
  | { kind: "wrong_state"; current: string }
  | { kind: "failure"; reason: string };

export async function publishDraft(args: {
  draftId: number;
  adminId: number;
  finalTextOverride?: string | null;
}): Promise<PublishOutcome> {
  const draft = await getById(args.draftId);
  if (!draft) return { kind: "not_found" };
  if (draft.state !== "drafted") {
    return { kind: "wrong_state", current: draft.state };
  }

  const field = draft.fieldName;
  const final =
    typeof args.finalTextOverride === "string" && args.finalTextOverride.trim().length > 0
      ? args.finalTextOverride.trim()
      : draft.generatedText;

  // Build the update payload.
  const update: Record<string, unknown> = {};
  if (field === "description") {
    update.description = final;
  } else if (field === "description_long") {
    update.descriptionLong = final;
  } else if (field === "faq") {
    const parsed = tryParseFaq(final);
    if (!parsed) {
      return {
        kind: "failure",
        reason: "final_text was not valid {question, answer}[] JSON",
      };
    }
    update.faq = parsed;
  }

  try {
    const txResult = await db.transaction(async (tx) => {
      // Re-fetch the product inside the tx so we capture before-state.
      const [before] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, draft.productId))
        .limit(1);
      if (!before) throw new Error("product disappeared mid-transaction");

      const [after] = await tx
        .update(productsTable)
        .set(update)
        .where(eq(productsTable.id, draft.productId))
        .returning();
      if (!after) throw new Error("product update returned no row");

      // Mark the draft published with state-machine guard. If the guard
      // failed (rowCount === 0) we ROLLBACK the product update too.
      const updated = await tx
        .update(enrichmentDraftsTable)
        .set({
          state: "published",
          finalText: final,
          publishedAt: new Date(),
          publishedBy: args.adminId,
        })
        .where(
          and(
            eq(enrichmentDraftsTable.id, draft.id),
            eq(enrichmentDraftsTable.state, "drafted"),
          ),
        );
      const rowCount =
        (updated as unknown as { rowCount?: number }).rowCount ??
        (updated as unknown as Array<unknown>).length ??
        0;
      if (rowCount === 0) {
        throw new Error("draft state guard failed (race?)");
      }

      // FR-PANEL-006 audit row.
      await tx.insert(auditLogsTable).values({
        actorType: "admin",
        actorId: args.adminId,
        action: "enrichment.publish",
        targetType: "product",
        targetId: draft.productId,
        metadata: JSON.stringify({
          draftId: draft.id,
          fieldName: field,
          modelId: draft.modelId,
          edited: final !== draft.generatedText,
          original_length: draft.generatedText.length,
          final_length: final.length,
        }),
      });

      void before;
      return { productId: draft.productId };
    });

    return { kind: "success", productId: txResult.productId, field };
  } catch (err) {
    logger.error({ err, draftId: draft.id, category: "enrichment.publish" }, "[enrichment] publish failed");
    return { kind: "failure", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Lightweight reject path — no product mutation, just state transition. */
export async function rejectDraftHandler(args: {
  draftId: number;
  adminId: number;
  reason: string | null;
}): Promise<PublishOutcome> {
  const draft = await getById(args.draftId);
  if (!draft) return { kind: "not_found" };
  if (draft.state !== "drafted") {
    return { kind: "wrong_state", current: draft.state };
  }
  const { markRejected } = await import("./draft-store");
  const rowCount = await markRejected({
    id: draft.id,
    adminId: args.adminId,
    reason: args.reason,
  });
  if (rowCount === 0) {
    return { kind: "wrong_state", current: "drafted" };
  }
  return { kind: "success", productId: draft.productId, field: draft.fieldName };
}

void markPublished;
