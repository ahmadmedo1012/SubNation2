/**
 * Worker Heartbeat Module
 * Design §3.1.9 - Write worker:heartbeat to Redis every 15 s with TTL 60 s.
 *
 * Satisfies: R2.11, R2.8 (worker check)
 * Guardrails:
 *   - setInterval cleared on SIGTERM.
 *   - Heartbeat write wrapped in isolate("worker-heartbeat", ...) for error isolation.
 *   - Failures increment monitoringErrorsTotal{component:"worker-heartbeat"} but never crash the worker.
 *     (R7, round-93 A3: this was previously FALSE — isolate() re-threw sync
 *     errors and never caught async rejections, so heartbeat write failures
 *     were completely silent. It now genuinely reports + swallows both.)
 *   - The write itself is bounded by REDIS_COMMAND_TIMEOUT_MS (R2 family):
 *     during a Redis outage the old SETEX queued forever (offline queue) and
 *     each 15 s tick piled up a new pending promise; a timeout converts it
 *     into a REPORTED rejection.
 */

import type { RedisClientType } from "redis";
import { logger } from "../lib/logger";
import { withRedisCommandTimeout } from "../lib/redis-client";
import { isolate } from "../middlewares/instrumentation-isolation";

// Heartbeat configuration constants
const HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds
const HEARTBEAT_TTL_SEC = 60; // 60 seconds TTL
const HEARTBEAT_KEY = "worker:heartbeat";

// Version from RENDER_GIT_COMMIT (7-char short SHA)
const VERSION = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "unknown";

// Track the interval for cleanup
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Heartbeat payload structure.
 * ts: Unix timestamp in milliseconds
 * version: 7-character short SHA from RENDER_GIT_COMMIT
 */
interface HeartbeatPayload {
  ts: number;
  version: string;
}

/**
 * Write a single heartbeat to Redis.
 * Wrapped in isolate("worker-heartbeat", ...) for error isolation - never throws.
 */
async function writeHeartbeat(redis: RedisClientType): Promise<void> {
  const writeFn = async (): Promise<void> => {
    const payload: HeartbeatPayload = {
      ts: Date.now(),
      version: VERSION,
    };

    // Use SETEX for atomic set-with-TTL. Bounded (R2, round-93 A3):
    // during an outage node-redis queues this command and the promise
    // never settles; the race turns it into a rejection that isolate()
    // reports instead of a silently pending promise per 15 s tick.
    await withRedisCommandTimeout("worker_heartbeat_set", () =>
      redis.setEx(HEARTBEAT_KEY, HEARTBEAT_TTL_SEC, JSON.stringify(payload)),
    );

    logger.debug({ key: HEARTBEAT_KEY, ttl: HEARTBEAT_TTL_SEC }, "Heartbeat written");
  };

  // Wrap in isolate to catch errors and prevent propagation (R7: actually
  // true now — async rejections are reported + swallowed).
  await isolate("worker-heartbeat", writeFn)();
}

/**
 * Start the worker heartbeat.
 * Writes to Redis key `worker:heartbeat` every 15 seconds with TTL 60 seconds.
 *
 * @param redis - Redis client instance (must be connected)
 * @returns Object with stop() function for cleanup
 */
export function startHeartbeat(redis: RedisClientType): { stop: () => void } {
  // Prevent double-start
  if (heartbeatInterval) {
    logger.warn("Heartbeat already running, skipping start");
    return { stop: stopHeartbeat };
  }

  logger.info(
    { intervalMs: HEARTBEAT_INTERVAL_MS, ttlSec: HEARTBEAT_TTL_SEC, version: VERSION },
    "Starting worker heartbeat",
  );

  // Write initial heartbeat immediately
  writeHeartbeat(redis).catch(() => {
    // isolate() already reported + logged the failure (R7) — this catch
    // only exists to prevent an unhandled rejection.
  });

  // Schedule periodic heartbeats
  heartbeatInterval = setInterval(() => {
    writeHeartbeat(redis).catch(() => {
      // isolate() already reported + logged the failure (R7).
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Ensure interval doesn't keep process alive unnecessarily
  if (heartbeatInterval.unref) {
    heartbeatInterval.unref();
  }

  // Register SIGTERM handler for graceful cleanup
  const sigtermHandler = () => {
    logger.info("Received SIGTERM, stopping heartbeat");
    stopHeartbeat();
  };

  process.on("SIGTERM", sigtermHandler);

  return {
    stop: () => {
      process.off("SIGTERM", sigtermHandler);
      stopHeartbeat();
    },
  };
}

/**
 * Stop the worker heartbeat.
 * Clears the interval and logs the shutdown.
 * Safe to call multiple times.
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    logger.info("Worker heartbeat stopped");
  }
}
