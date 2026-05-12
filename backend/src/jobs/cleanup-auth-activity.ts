import { db, authActivityTable } from "@workspace/db";
import { lt } from "drizzle-orm";

const RETENTION_DAYS = 90;

/**
 * Cleanup old auth_activity records older than RETENTION_DAYS
 * This should be scheduled to run daily (e.g., via node-cron or external scheduler)
 */
export async function cleanupOldAuthActivity(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const result = await db
    .delete(authActivityTable)
    .where(lt(authActivityTable.createdAt, cutoffDate))
    .returning();

  console.log(
    `[cleanup-auth-activity] Cleaned ${result.length} auth_activity records older than ${RETENTION_DAYS} days`,
  );
}

// For manual testing or one-time execution
if (require.main === module) {
  cleanupOldAuthActivity()
    .then(() => {
      console.log("Cleanup completed successfully");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Cleanup failed:", err);
      process.exit(1);
    });
}
