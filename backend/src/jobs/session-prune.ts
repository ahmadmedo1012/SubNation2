import { db, sessionsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "../lib/logger";

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
 * Idempotent, callable repeatedly (daily 05:00 UTC cron + a one-shot at
 * scheduler start). Returns the number of rows removed.
 */
export async function pruneExpiredSessions(): Promise<number> {
  // .returning() (not result.rowCount) — pglite's driver result doesn't
  // carry rowCount, and the test harness runs on pglite.
  const deleted = await db
    .delete(sessionsTable)
    .where(lt(sessionsTable.expiresAt, new Date()))
    .returning({ id: sessionsTable.id });
  const removed = deleted.length;
  if (removed > 0)
    logger.info({ category: "sessions.retention", removed }, "Expired sessions pruned");
  return removed;
}
