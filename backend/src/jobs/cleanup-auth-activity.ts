import { db, authActivityTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

const RETENTION_DAYS = 90;

/**
 * Delete auth_activity rows older than RETENTION_DAYS.
 *
 * Scheduled by `lib/web-scheduler.ts` (or a dedicated worker tier when
 * provisioned). The function is also runnable as a one-shot from the
 * CLI for manual cleanup — see the bottom of this file.
 */
export async function cleanupOldAuthActivity(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const result = await db
    .delete(authActivityTable)
    .where(lt(authActivityTable.createdAt, cutoffDate))
    .returning();

  logger.info(
    { category: "monitoring", deleted: result.length, retentionDays: RETENTION_DAYS },
    `[cleanup-auth-activity] cleaned ${result.length} rows older than ${RETENTION_DAYS} days`,
  );
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
