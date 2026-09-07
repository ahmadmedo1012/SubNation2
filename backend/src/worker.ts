// IMPORTANT: First import — see ./instrument for rationale.
import "./instrument";

import { fileURLToPath } from "node:url";
import { startCouponWatcher } from "./jobs/couponWatcher";
import { initCronJobs } from "./jobs/cron";
import { startFlashSaleWatcher } from "./jobs/flashSaleWatcher";
import { startStockWatcher } from "./jobs/stockWatcher";
import { logger } from "./lib/logger";
import { getRedisClient, initRedisClient } from "./lib/redis-client";
import { alertingService } from "./services/alerting.service";
import { startHeartbeat } from "./worker/heartbeat";

// B7-P1-6: hard ceiling for graceful drain — a hung close must not wedge
// the deploy (Render escalates to SIGKILL regardless).
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Install the worker's SIGTERM/SIGINT handlers (B7-P1-6).
 *
 * Drain order: stop schedulers (heartbeat / alerting / watchers) first,
 * then drain shared resources (DB pool, Sentry queue), then exit(0).
 * A force-exit timer bounds the whole sequence. `exit` is injectable so
 * tests can register handlers and fire them via `process.emit("SIGTERM")`
 * without killing the test runner.
 *
 * Returns a `dispose()` that unregisters the handlers (test hygiene —
 * production never calls it; process exit makes it moot).
 */
export function installWorkerSignalHandlers(resources: {
  stopSchedulers: () => void;
  drain: () => Promise<void>;
  forceExitAfterMs?: number;
  exit?: (code: number) => never;
}): { dispose: () => void } {
  let shuttingDown = false;
  const forceExitMs = resources.forceExitAfterMs ?? GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  const exit = resources.exit ?? ((code: number) => process.exit(code));

  const handleSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "[worker] received shutdown signal — draining");

    const forceExit = setTimeout(() => {
      logger.warn({ forceExitMs }, "[worker] graceful shutdown timed out — forcing exit");
      exit(1);
    }, forceExitMs);
    forceExit.unref?.();

    void (async () => {
      try {
        resources.stopSchedulers();
      } catch (err) {
        logger.error({ err }, "[worker] scheduler stop error during shutdown");
      }
      try {
        await resources.drain();
      } catch (err) {
        logger.error({ err }, "[worker] drain error during shutdown");
      }
    })().finally(() => exit(0));
  };

  const onTerm = () => handleSignal("SIGTERM");
  const onInt = () => handleSignal("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);

  return {
    dispose: () => {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    },
  };
}

async function startWorker() {
  logger.info("Starting background worker");

  // Connect Redis singleton (heartbeat + alerting both depend on it).
  await initRedisClient();
  const redis = getRedisClient();

  const stopFns: Array<() => void> = [];

  if (redis) {
    const heartbeat = startHeartbeat(redis);
    stopFns.push(heartbeat.stop);
  } else {
    // B7-P1-7: a Redis outage at worker boot used to process.exit(1) —
    // crash-looping the worker on Render (each restart hits the same dead
    // Redis) and contradicting the web tier's H12 policy
    // (redis-client.ts: stay up, degrade loudly, reconnect/restart later).
    // Boot into DEGRADED mode instead: alerting rule evals fail safe
    // (no-Redis → no alerts fired), cron + watchers run normally, and the
    // heartbeat stays dark until the process restarts post-recovery.
    logger.error(
      { category: "monitoring", redis: { mode: "degraded_boot" } },
      "[worker] Redis unavailable at boot — starting in DEGRADED mode (no heartbeat; alerting/cron/watchers continue). Restart the worker once Redis recovers to restore the heartbeat.",
    );
  }

  // Phase 4: alerting evaluator runs in the worker process so a horizontally-
  // scaled web tier never produces duplicate alerts.
  alertingService.start();

  const watchers = [
    startCouponWatcher(),
    startStockWatcher(),
    // Round-3 (8-c §8.1): the dedicated worker previously started only
    // coupon + stock watchers + cron — flashSaleWatcher ran ONLY in the
    // web scheduler. In worker-only mode (DISABLE_WEB_SCHEDULERS=true),
    // expired flash sales stayed is_active forever and the active-
    // singleton partial unique index BLOCKED creating the next sale.
    // Worker/web parity: whichever process is scheduled runs it.
    startFlashSaleWatcher(),
  ];
  initCronJobs();

  logger.info("Background worker started");

  installWorkerSignalHandlers({
    stopSchedulers: () => {
      for (const stop of stopFns) stop();
      alertingService.stop();
      for (const watcher of watchers) watcher.stop();
    },
    drain: async () => {
      try {
        // Dynamic import: keeps the (test-aliased) module out of the
        // import-time graph; on the harness `pool` is simply absent.
        const { pool } = await import("@workspace/db");
        if (pool && typeof pool.end === "function") await pool.end();
      } catch (err) {
        logger.warn({ err }, "[worker] DB pool end error during shutdown");
      }
      try {
        const Sentry = await import("@sentry/node");
        await Sentry.close(2000);
      } catch {
        // Sentry flush is best-effort.
      }
    },
  });
}

// ESM main-module guard (same pattern as jobs/cleanup-auth-activity.ts):
// `startWorker()` must only auto-run when this file is the process entry
// point — not when tests import installWorkerSignalHandlers.
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  startWorker().catch((err) => {
    logger.error({ err }, "Failed to start worker");
    process.exit(1);
  });
}
