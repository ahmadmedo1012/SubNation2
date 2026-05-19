// IMPORTANT: First import — see ./instrument for rationale.
import "./instrument";

import { startCouponWatcher } from "./jobs/couponWatcher";
import { initCronJobs } from "./jobs/cron";
import { startStockWatcher } from "./jobs/stockWatcher";
import { logger } from "./lib/logger";
import { getRedisClient, initRedisClient, requireRedisClient } from "./lib/redis-client";
import { alertingService } from "./services/alerting.service";
import { startHeartbeat } from "./worker/heartbeat";

async function startWorker() {
  logger.info("Starting background worker");

  // Connect Redis singleton (heartbeat + alerting both depend on it).
  await initRedisClient();
  const redis = getRedisClient();
  if (!redis) {
    logger.fatal(
      "Redis client not available in worker process — cannot run heartbeat or alerting service",
    );
    process.exit(1);
  }

  const heartbeatCleanup = startHeartbeat(requireRedisClient());

  // Phase 4: alerting evaluator runs in the worker process so a horizontally-
  // scaled web tier never produces duplicate alerts.
  alertingService.start();

  startCouponWatcher();
  startStockWatcher();
  initCronJobs();

  logger.info("Background worker started");

  const sigtermHandler = () => {
    logger.info("Received SIGTERM, stopping worker");
    heartbeatCleanup.stop();
    alertingService.stop();
    process.exit(0);
  };

  process.on("SIGTERM", sigtermHandler);
}

startWorker().catch((err) => {
  logger.error({ err }, "Failed to start worker");
  process.exit(1);
});
