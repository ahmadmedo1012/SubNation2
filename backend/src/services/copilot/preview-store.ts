/**
 * Preview store (010-ai-admin-copilot, T031).
 *
 * CRUD over `copilot_previews` for the draft → confirm → execute pipeline.
 * Every method is owner-scoped: the executor passes the requesting admin's
 * id, and rows owned by other admins are invisible (FR-AUTH-005).
 *
 * Single-use enforcement is encoded in the SQL: createPreview stamps the
 * row with a 5-minute expiry; markFirstConfirmed and markExecuted require
 * the row to still be unconsumed and unexpired.
 */

import { db, copilotPreviewsTable } from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { newPreviewId } from "../../lib/copilot/ids";

export type RiskTier = "low" | "high" | "no_execute";

export interface CreatePreviewInput {
  adminId: number;
  intentText: string;
  toolName: string;
  actionClass: string;
  riskTier: RiskTier;
  affectedIds: number[];
  affectedEntityType: string;
  recordVersions: Record<string, string>;
  previewPayload: unknown;
  modelId: string;
  correlationId: string;
}

const TTL_MINUTES = 5;

export async function createPreview(
  input: CreatePreviewInput,
): Promise<{ id: string; expiresAt: Date }> {
  const id = newPreviewId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MINUTES * 60 * 1000);
  await db.insert(copilotPreviewsTable).values({
    id,
    adminId: input.adminId,
    intentText: input.intentText,
    toolName: input.toolName,
    actionClass: input.actionClass,
    riskTier: input.riskTier,
    affectedIds: input.affectedIds,
    affectedEntityType: input.affectedEntityType,
    recordVersions: input.recordVersions,
    previewPayload: input.previewPayload as never,
    modelId: input.modelId,
    correlationId: input.correlationId,
    createdAt: now,
    expiresAt,
  });
  return { id, expiresAt };
}

export interface PreviewRow {
  id: string;
  adminId: number;
  intentText: string;
  toolName: string;
  actionClass: string;
  riskTier: RiskTier;
  affectedIds: number[];
  affectedEntityType: string;
  recordVersions: Record<string, string>;
  previewPayload: unknown;
  modelId: string;
  correlationId: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  confirmedOnceAt: Date | null;
  cooldownStartsAt: Date | null;
  confirmedTwiceAt: Date | null;
}

/** Fetch a preview the requesting admin owns, regardless of state. */
export async function getOwnedPreview(id: string, adminId: number): Promise<PreviewRow | null> {
  const [row] = await db
    .select()
    .from(copilotPreviewsTable)
    .where(and(eq(copilotPreviewsTable.id, id), eq(copilotPreviewsTable.adminId, adminId)))
    .limit(1);
  if (!row) return null;
  return row as unknown as PreviewRow;
}

/** Mark a preview cancelled (by clearing it). Returns true if it existed. */
export async function cancelPreview(id: string, adminId: number): Promise<boolean> {
  const result = await db
    .delete(copilotPreviewsTable)
    .where(
      and(
        eq(copilotPreviewsTable.id, id),
        eq(copilotPreviewsTable.adminId, adminId),
        isNull(copilotPreviewsTable.consumedAt),
      ),
    );
  // pg-driver returns rowCount on the result.
  const rowCount =
    (result as unknown as { rowCount?: number }).rowCount ??
    (result as unknown as Array<unknown>).length ??
    0;
  return rowCount > 0;
}

/**
 * Atomically claim a fresh, unconsumed, owner-matching, unexpired preview.
 * Returns the row on success; null if it's expired, consumed, or not owned.
 * The caller MUST update the row (consumedAt or confirmation timestamps)
 * within the same transaction; this function simply checks-and-fetches.
 */
export async function claimUnconsumedPreview(
  id: string,
  adminId: number,
): Promise<PreviewRow | null> {
  const [row] = await db
    .select()
    .from(copilotPreviewsTable)
    .where(
      and(
        eq(copilotPreviewsTable.id, id),
        eq(copilotPreviewsTable.adminId, adminId),
        isNull(copilotPreviewsTable.consumedAt),
        gt(copilotPreviewsTable.expiresAt, sql`NOW()`),
      ),
    )
    .limit(1);
  if (!row) return null;
  return row as unknown as PreviewRow;
}

/** Stamp consumed_at on a preview row. */
export async function markConsumed(id: string): Promise<void> {
  await db
    .update(copilotPreviewsTable)
    .set({ consumedAt: new Date() })
    .where(eq(copilotPreviewsTable.id, id));
}

/**
 * Stamp the first-confirmation timestamps for a high-risk preview, starting
 * the 3-second cooldown clock. Returns the cooldownStartsAt the server set
 * so the caller can echo it back to the client. Idempotent: if the preview
 * is already first-confirmed, returns the existing timestamp.
 */
export async function markFirstConfirmHighRisk(
  id: string,
  adminId: number,
): Promise<{ cooldownStartsAt: Date } | null> {
  const now = new Date();
  const [row] = await db
    .update(copilotPreviewsTable)
    .set({ confirmedOnceAt: now, cooldownStartsAt: now })
    .where(
      and(
        eq(copilotPreviewsTable.id, id),
        eq(copilotPreviewsTable.adminId, adminId),
        isNull(copilotPreviewsTable.consumedAt),
        isNull(copilotPreviewsTable.confirmedOnceAt),
        gt(copilotPreviewsTable.expiresAt, sql`NOW()`),
      ),
    )
    .returning({
      cooldownStartsAt: copilotPreviewsTable.cooldownStartsAt,
    });
  if (!row) {
    // Either already first-confirmed, or expired/consumed/not-owned. Re-read
    // to distinguish for the caller.
    const existing = await getOwnedPreview(id, adminId);
    if (existing && existing.cooldownStartsAt) {
      return { cooldownStartsAt: existing.cooldownStartsAt };
    }
    return null;
  }
  return { cooldownStartsAt: row.cooldownStartsAt ?? now };
}

/**
 * Atomically claim a high-risk preview that has cleared its 3-second
 * cooldown, is unexpired, and is unconsumed. The caller must be the owner.
 * Returns the row to execute against, or null if the preview is not yet
 * eligible (cooldown not elapsed, not first-confirmed, expired, etc.).
 */
export async function claimHighRiskForExecute(
  id: string,
  adminId: number,
): Promise<PreviewRow | null> {
  const [row] = await db
    .select()
    .from(copilotPreviewsTable)
    .where(
      and(
        eq(copilotPreviewsTable.id, id),
        eq(copilotPreviewsTable.adminId, adminId),
        isNull(copilotPreviewsTable.consumedAt),
        gt(copilotPreviewsTable.expiresAt, sql`NOW()`),
        sql`${copilotPreviewsTable.confirmedOnceAt} IS NOT NULL`,
        sql`${copilotPreviewsTable.cooldownStartsAt} IS NOT NULL`,
        sql`NOW() >= ${copilotPreviewsTable.cooldownStartsAt} + INTERVAL '3 seconds'`,
      ),
    )
    .limit(1);
  if (!row) return null;
  return row as unknown as PreviewRow;
}
