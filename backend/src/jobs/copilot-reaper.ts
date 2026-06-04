/**
 * Copilot reaper (010-ai-admin-copilot, T036).
 *
 * Deletes copilot_previews rows whose expires_at is more than 24 hours in
 * the past. The 24-hour grace window is intentional — once a preview is
 * past TTL it can no longer execute, but we keep the row for a day so
 * audit views and the daily reconciliation worker can still join against
 * copilot_actions.preview_id (FK is `ON DELETE SET NULL`, so even after
 * the reaper runs the audit row stays valid; we just lose the original
 * preview payload).
 *
 * Constitution §V scheduling rule says cron belongs on the worker tier.
 * The web tier still imports the function (so dev workflows can call it
 * directly), but the cron registration in cron.ts only fires when this
 * process is the worker. The repo currently runs cron from the web tier;
 * when the worker tier becomes the sole owner this comment becomes the
 * thing to read.
 */

import { copilotPreviewsTable, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export async function reapExpiredCopilotPreviews(): Promise<number> {
  const result = await db
    .delete(copilotPreviewsTable)
    .where(sql`${copilotPreviewsTable.expiresAt} < NOW() - INTERVAL '24 hours'`);
  // pg-driver returns rowCount on the result object.
  const rowCount =
    (result as unknown as { rowCount?: number }).rowCount ??
    (result as unknown as Array<unknown>).length ??
    0;
  return rowCount;
}
