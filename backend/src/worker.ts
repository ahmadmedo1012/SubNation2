import { startCouponWatcher } from "./jobs/couponWatcher";
import { initCronJobs } from "./jobs/cron";
import { startOtpCleanup } from "./jobs/otpCleanup";
import { startStockWatcher } from "./jobs/stockWatcher";
import { logger } from "./lib/logger";
import { initSentry } from "./lib/sentry";

initSentry();

async function startWorker() {
  logger.info("Starting background worker");
  startCouponWatcher();
  startStockWatcher();
  startOtpCleanup();
  initCronJobs();
  logger.info("Background worker started");
}

startWorker().catch((err) => {
  logger.error({ err }, "Failed to start worker");
  process.exit(1);
});
