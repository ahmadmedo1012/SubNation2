import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * AUD103-1-F2 / AUD103-8-F7 (r103): retention for `notifications`.
 *
 * Finding: notifications was the ONLY ops-facing table with zero retention
 * — one row per wallet/order/support/loyalty event per user, forever. Its
 * admin twin `admin_alerts` got a full retention policy (14d stale→read /
 * 30d read→delete) for exactly this "operations surface must stay small"
 * reason; the user-facing table was simply missed.
 *
 * Policy: READ rows older than 90 days are deleted; UNREAD rows older than
 * 180 days are deleted (unread rows are the user's badge content — they
 * age out far slower, but not never).
 *
 * Batching (B7-P2-5 family, same shape as idempotency-retention): bounded
 * ctid batches of 1000 so a catch-up purge holds a connection/lock for
 * seconds, not minutes. Idempotent by construction — safe to fire at both
 * the cron slot and the boot one-shot (B7-P2-12 restart-gap pattern).
 * Library code only: scheduling is owned by cron.ts + boot-one-shots.ts.
 */
const READ_RETENTION_DAYS = 90;
const UNREAD_RETENTION_DAYS = 180;
const DELETE_BATCH_SIZE = 1000;

export async function pruneOldNotifications(): Promise<number> {
  const readCutoff = new Date();
  readCutoff.setDate(readCutoff.getDate() - READ_RETENTION_DAYS);
  const unreadCutoff = new Date();
  unreadCutoff.setDate(unreadCutoff.getDate() - UNREAD_RETENTION_DAYS);

  let deleted = 0;
  // Bounded batch loop: `ctid IN (SELECT … LIMIT n)` until the batch comes
  // back short. Keeps each statement's lock footprint tiny.
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM notifications
      WHERE ctid IN (
        SELECT ctid FROM notifications
        WHERE (is_read = true AND created_at < ${readCutoff})
           OR (is_read = false AND created_at < ${unreadCutoff})
        LIMIT ${DELETE_BATCH_SIZE}
      )
      RETURNING id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ id: number }> }).rows ??
      (result as unknown as Array<{ id: number }>) ??
      [];
    deleted += rows.length;
    if (rows.length < DELETE_BATCH_SIZE) break;
  }

  if (deleted > 0) {
    logger.info(
      {
        category: "notifications.retention",
        deleted,
        readRetentionDays: READ_RETENTION_DAYS,
        unreadRetentionDays: UNREAD_RETENTION_DAYS,
      },
      `[notifications-retention] pruned ${deleted} notification row(s)`,
    );
  }
  return deleted;
}
