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
 * Scheduling (2026-09-20 free-infrastructure round + r110 comment-truth
 * fix): there is NO cron registration for the reaper — the old hourly
 * :45 slot was removed to keep Neon's idle autosuspend intact. It runs
 * opportunistically instead: a throttled 60-min fire from the admin
 * copilot surface (routes/admin/copilot/ask.ts) plus the boot one-shot
 * (jobs/boot-one-shots.ts) that closes the restart gap. Both paths are
 * idempotent — the ctid-batch DELETE below re-evaluates its predicate
 * per batch.
 */

import { copilotPreviewsTable, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const DELETE_BATCH_SIZE = 1000;

/**
 * Bounded ctid-batch DELETE loop — F11 (round-94 A6), same shape as
 * risk-retention.ts (B7-P2-5): the first large reap (copilot adoption
 * switch-on) must not hold one unbounded statement lock on Neon's pooler.
 * Predicate embedded verbatim per batch (idempotent).
 */
async function batchedDelete(whereSql: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const result = await db.execute(
      sql.raw(`
      DELETE FROM copilot_previews
      WHERE ctid IN (
        SELECT ctid FROM copilot_previews p
        WHERE ${whereSql}
        LIMIT ${DELETE_BATCH_SIZE}
      )
      RETURNING id
    `),
    );
    const rows =
      (result as unknown as { rows?: Array<{ id: number }> }).rows ??
      (result as unknown as Array<{ id: number }>) ??
      [];
    deleted += rows.length;
    if (rows.length < DELETE_BATCH_SIZE) break;
  }
  return deleted;
}

export async function reapExpiredCopilotPreviews(): Promise<number> {
  const deleted = await batchedDelete(`p.expires_at < NOW() - INTERVAL '24 hours'`);
  if (deleted > 0) {
    logger.info(
      { category: "copilot.reaper", deleted },
      "copilot reaper removed expired preview row(s)",
    );
  }
  return deleted;
}

// F11: the purge moved to the raw batched DELETE above — reference the
// table so the import stays valid if the typed builder returns (same
// convention as risk-retention.ts).
void copilotPreviewsTable;
