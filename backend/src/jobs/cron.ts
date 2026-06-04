import cron from "node-cron";
import { db, inventoryTable, productsTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { logAdminAlert } from "./alertLogger";
import { reapExpiredCopilotPreviews } from "./copilot-reaper";
import { runForecastIfPermitted } from "./forecast-runner";
import { runForecastRetention } from "./forecast-retention";
import { reapExpiredRiskEvents } from "./risk-retention";
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
      logger.error({ err, category: "whatsapp.otp.cleanup" }, "OTP cleanup failed");
      captureSchedulerFailure("whatsapp_otp_cleanup", err, {
        cron_expression: "15 * * * *",
      });
    }
  });

  // 4. Every 5 minutes: copilot preview reaper (010-ai-admin-copilot).
  //    Deletes copilot_previews rows older than 24h past their expiry. The
  //    audit chain stays intact because copilot_actions.preview_id is
  //    `ON DELETE SET NULL`.
  cron.schedule("*/5 * * * *", async () => {
    try {
      const removed = await reapExpiredCopilotPreviews();
      if (removed > 0) {
        logger.info(
          { category: "copilot.reaper", removed },
          `copilot reaper removed ${removed} expired preview row(s)`,
        );
      }
    } catch (err) {
      logger.error({ err, category: "copilot.reaper" }, "copilot reaper failed");
      captureSchedulerFailure("copilot_reaper", err, {
        cron_expression: "*/5 * * * *",
      });
    }
  });

  // 5. Daily at 03:30 UTC: risk_events 90-day retention (003-anomaly-detection).
  //    Unlabeled events older than 90 days are deleted. Labeled events get
  //    a 97-day grace so retroactive review still resolves the label join.
  cron.schedule("30 3 * * *", async () => {
    try {
      const result = await reapExpiredRiskEvents();
      if (result.unlabeledDeleted + result.labeledExpiredDeleted > 0) {
        logger.info(
          {
            category: "risk.retention",
            unlabeled: result.unlabeledDeleted,
            labeled: result.labeledExpiredDeleted,
          },
          "risk-events retention purge complete",
        );
      }
    } catch (err) {
      logger.error({ err, category: "risk.retention" }, "risk-events retention failed");
      captureSchedulerFailure("risk_retention", err, {
        cron_expression: "30 3 * * *",
      });
    }
  });

  // 6. Daily at 02:15 UTC: inventory demand forecast (011-inventory-demand-
  //    forecast). Refuses to run unless WORKER_TIER=true AND
  //    FORECAST_RUNNER_ENABLED=true (the runner enforces the gate).
  //    02:15 lands outside the existing low_stock (00:00), OTP cleanup
  //    (every :15), and copilot-reaper (every 5 min) windows so no two
  //    heavy jobs compete for DB resources.
  cron.schedule("15 2 * * *", async () => {
    try {
      await runForecastIfPermitted();
    } catch (err) {
      logger.error({ err, category: "forecast.cron" }, "forecast cron failed");
      captureSchedulerFailure("forecast_runner", err, {
        cron_expression: "15 2 * * *",
      });
    }
  });

  // 7. Daily at 03:30 UTC: forecast retention + capture-rate measurement
  //    (011-inventory-demand-forecast). Purges forecasts > 90 days, reaps
  //    orphaned in_flight runs, computes the rolling 14-day capture rate
  //    and pauses alerts when SC-008's kill criterion trips. Same time as
  //    risk retention — both are read-mostly + small-write jobs that fit
  //    comfortably in the same minute.
  cron.schedule("30 3 * * *", async () => {
    if (process.env.WORKER_TIER !== "true") return;
    try {
      await runForecastRetention();
    } catch (err) {
      logger.error({ err, category: "forecast.retention" }, "forecast retention failed");
      captureSchedulerFailure("forecast_retention", err, {
        cron_expression: "30 3 * * *",
      });
    }
  });

  logger.info("Cron jobs initialized");
}
