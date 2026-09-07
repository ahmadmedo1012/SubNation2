import { db, sessionsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const DELETE_BATCH_SIZE = 1000;

/**
 * Round-5 (db-audit 2026-09-07): delete session rows whose expires_at
 * has passed.
 *
 * Why this matters: requireUser validates sessions against this table
 * (the H1 session-revocation fix), so every login inserts a row — but
 * nothing ever deleted them. Live production state: 38 rows for 12
 * users after 12 days, all still inside their 30-day window; from here
 * the table only grows. Expired rows are dead weight for every authed
 * request (the validity lookup scans by PK — fast, but the table and
 * the nightly logical backups carry garbage forever).
 *
 * Safety: an expired session is already rejected by requireUser and by
 * logout flows; deleting the row cannot cut any live traffic. ON DELETE
 * CASCADE from users.id keeps referential integrity for user deletion.
 *
 * Batching (B7-P2-5, round-92): the DELETE runs in bounded ctid batches
 * of 1000 so a large catch-up purge never holds a single long lock on
 * Neon's pooler.
 *
 * Idempotent, callable repeatedly (daily 05:00 UTC cron + a one-shot at
 * scheduler start). Returns the number of rows removed.
 */
export async function pruneExpiredSessions(): Promise<number> {
  let removed = 0;
  for (;;) {
    // .returning() rows (not result.rowCount) — pglite's driver result
    // doesn't carry rowCount, and the test harness runs on pglite.
    const result = await db.execute(sql`
      DELETE FROM sessions
      WHERE ctid IN (
        SELECT ctid FROM sessions
        WHERE expires_at < now()
        LIMIT ${DELETE_BATCH_SIZE}
      )
      RETURNING id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ id: string }> }).rows ??
      (result as unknown as Array<{ id: string }>) ??
      [];
    removed += rows.length;
    if (rows.length < DELETE_BATCH_SIZE) break;
  }
  if (removed > 0)
    logger.info({ category: "sessions.retention", removed }, "Expired sessions pruned");
  // Keep the drizzle table import meaningful for future typed migrations
  // of this job (same pattern as risk-retention.ts).
  void sessionsTable;
  return removed;
}
