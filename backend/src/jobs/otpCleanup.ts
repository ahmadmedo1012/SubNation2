import { db, otpsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "../lib/logger";

export async function cleanupExpiredOtps(): Promise<void> {
  const now = new Date();
  const result = await db.delete(otpsTable).where(lt(otpsTable.expiresAt, now)).returning();
  if (result.length > 0) {
    logger.info({ count: result.length }, "Cleaned up expired OTPs");
  }
}

export function startOtpCleanup(): void {
  setTimeout(() => cleanupExpiredOtps(), 60_000);
  setInterval(() => cleanupExpiredOtps(), 15 * 60 * 1000);
  logger.info("OTP cleanup job started");
}
