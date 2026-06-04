/**
 * Forecast cron entry-point (011-inventory-demand-forecast, T046).
 *
 * Wired into the existing cron registry in `backend/src/jobs/cron.ts`
 * at 02:15 UTC. The first action is the worker-tier guard — the web
 * tier MUST NOT execute this job (constitution §V scheduling rule).
 *
 * Operators trigger an on-demand recompute via:
 *   pnpm --filter @workspace/api-server tsx src/jobs/forecast-runner.ts
 * which respects the same env gates.
 */

import { logger } from "../lib/logger";
import { runForecast } from "../services/forecast/forecast.service";

export async function runForecastIfPermitted(): Promise<void> {
  if (process.env.WORKER_TIER !== "true") {
    logger.warn(
      { category: "forecast.cron" },
      "[forecast-cron] skipped — WORKER_TIER !== 'true'; cron belongs on the worker tier per constitution §V",
    );
    return;
  }
  if (process.env.FORECAST_RUNNER_ENABLED !== "true") {
    logger.info(
      { category: "forecast.cron" },
      "[forecast-cron] skipped — FORECAST_RUNNER_ENABLED is not 'true'",
    );
    return;
  }
  await runForecast();
}
