import cron from "node-cron";
import { db, inventoryTable, productsTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";
import { pruneExpiredOtps } from "../services/whatsapp-otp.service";

export function initCronJobs() {
  // 1. Every day at midnight: Low Stock Alert
  cron.schedule("0 0 * * *", async () => {
    logger.info("Running Low Stock Alert job");
    try {
      const lowStockProducts = await db
        .select({
          id: productsTable.id,
          name: productsTable.name,
          stockCount: count(inventoryTable.id),
        })
        .from(productsTable)
        .leftJoin(
          inventoryTable,
          sql`${productsTable.id} = ${inventoryTable.productId} AND ${inventoryTable.isSold} = false`,
        )
        .where(eq(productsTable.isArchived, false))
        .groupBy(productsTable.id, productsTable.name)
        .having(sql`count(${inventoryTable.id}) < 5`);

      for (const p of lowStockProducts) {
        await logAdminAlert(
          "low_stock",
          `مخزون منخفض: ${p.name}`,
          `المنتج "${p.name}" يحتوي على ${p.stockCount} عناصر فقط في المخزون. يرجى إعادة التعبئة.`,
        );
      }
      logger.info({ count: lowStockProducts.length }, "Low Stock Alert job finished");
    } catch (err) {
      logger.error({ err }, "Error in Low Stock Alert job");
      // Surface to Sentry with subsystem=scheduler + job_name tag so
      // the issue groups cleanly in the UI.
      captureSchedulerFailure("low_stock_alert", err, {
        cron_expression: "0 0 * * *",
      });
    }
  });

  // 2. Every hour: Health Check / Cleanup (Example)
  cron.schedule("0 * * * *", () => {
    logger.debug("Hourly cron heartbeat");
  });

  // 3. Every hour at minute 15: prune expired WhatsApp OTP rows.
  //
  // Idempotent. Safe to run repeatedly. The pruneExpiredOtps()
  // helper deletes rows whose created_at is older than 24h — at
  // that age the row is long past its 5-minute TTL AND any user
  // retrying with such a code would already have received an
  // "expired" or "consumed" verify error, so no active session
  // is ever at risk.
  //
  // Minute 15 (vs the heartbeat at :00) introduces natural jitter
  // so the two jobs never compete for DB resources at the same
  // instant if the heartbeat ever does real work. Logging is
  // count-only — no OTP codes, no phone numbers, no PII.
  cron.schedule("15 * * * *", async () => {
    logger.info({ category: "whatsapp.otp.cleanup" }, "OTP cleanup started");
    try {
      const removed = await pruneExpiredOtps();
      logger.info(
        { category: "whatsapp.otp.cleanup", removed },
        `OTP cleanup completed — ${removed} expired record(s) removed`,
      );
    } catch (err) {
      logger.error(
        { err, category: "whatsapp.otp.cleanup" },
        "OTP cleanup failed",
      );
      captureSchedulerFailure("whatsapp_otp_cleanup", err, {
        cron_expression: "15 * * * *",
      });
    }
  });

  logger.info("Cron jobs initialized");
}
