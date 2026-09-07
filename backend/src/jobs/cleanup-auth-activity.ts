import { db, authActivityTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

const RETENTION_DAYS = 90;
const DELETE_BATCH_SIZE = 1000;

/**
 * Delete auth_activity rows older than RETENTION_DAYS (90-day policy).
 *
 * Scheduling (B7-P1-2, round-92): daily cron at 04:30 UTC
 * (`jobs/cron.ts` #10) + a boot one-shot in `lib/web-scheduler.ts` so a
 * restart that straddles the slot doesn't skip a whole day. The stale
 * comment claiming `lib/web-scheduler.ts` already scheduled it was the
 * audit finding — it was wired to NOTHING before this round.
 *
 * Batching (B7-P2-5): the DELETE runs in bounded ctid batches of 1000 so
 * a 90-day catch-up purge on Neon's pooler holds a connection/lock for
 * seconds, not minutes. Idempotent — safe to run repeatedly.
 *
 * The function is also runnable as a one-shot from the CLI for manual
 * cleanup — see the bottom of this file.
 */
export async function cleanupOldAuthActivity(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  let deleted = 0;
  // Bounded batch loop: `ctid IN (SELECT … LIMIT n)` until the batch
  // comes back short. Keeps each statement's lock footprint tiny and
  // lets autovacuum keep up between batches.
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM auth_activity
      WHERE ctid IN (
        SELECT ctid FROM auth_activity
        WHERE created_at < ${cutoffDate}
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

  logger.info(
    { category: "monitoring", deleted, retentionDays: RETENTION_DAYS },
    `[cleanup-auth-activity] cleaned ${deleted} rows older than ${RETENTION_DAYS} days`,
  );
  // Keep the drizzle table import meaningful for future typed migrations
  // of this job (same pattern as risk-retention.ts).
  void authActivityTable;
  return deleted;
}

// ── Manual one-shot ─────────────────────────────────────────────────────────
//
// `require.main === module` is the CJS idiom for "is this file being run
// directly?". This workspace is `"type": "module"` so that pattern silently
// never fires. The ESM equivalent compares the resolved module URL to the
// process entry point.
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  cleanupOldAuthActivity()
    .then(() => {
      logger.info({ category: "monitoring" }, "cleanup-auth-activity: completed");
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err, category: "monitoring" }, "cleanup-auth-activity: failed");
      // Capture before exit so the Sentry SDK's queue flushes (default
      // 2s drain on SIGTERM via the onUncaughtException integration).
      captureSchedulerFailure("cleanup_auth_activity", err);
      process.exit(1);
    });
}
