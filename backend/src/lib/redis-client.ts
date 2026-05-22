/**
 * Singleton Redis client for the SubNation backend.
 *
 * Connections are shared by:
 *   - rate-limit-redis (general commands)
 *   - the alerting service (dedup + global rate-limit keys)
 *   - the worker heartbeat
 *   - the extended /api/healthz/{redis,neon,worker,socket} endpoints
 *
 * Socket.IO's Redis adapter requires its own dedicated pub/sub clients
 * (createClient + duplicate) — that lives in lib/socket.ts and is intentionally
 * separate from this singleton.
 *
 * Production policy:
 *   - REDIS_URL absent + NODE_ENV=production → log a clearly-tagged warning
 *     ("redis_missing_in_production") every boot, fall back to in-memory
 *     stores. This is OK for a single-instance deployment but unsafe for
 *     horizontal scaling (each instance has its own rate-limit window).
 *   - REDIS_URL set + connection failure → process.exit(1). The platform
 *     fails closed rather than serving traffic with degraded rate-limit /
 *     dedup state.
 *
 * Observability:
 *   - `redis_ops_total{op,status}` increments on connect / reconnecting /
 *     end / per-command via `trackRedisOp(op, fn)`.
 *   - `redis_errors_total{reason}` increments on every error class.
 *   - `redis_ping_latency_seconds` histogram is updated by a 30 s ping
 *     watchdog so /api/metrics surfaces real Redis latency without waiting
 *     for an explicit health-endpoint call.
 *   - When fallback mode kicks in, a single `redis_degraded_mode` counter
 *     fires once per process so degraded mode is observable, not silent.
 */

import { Counter, Histogram } from "prom-client";
import { createClient, type RedisClientType } from "redis";
import { logger } from "./logger";
import { captureSubsystemException } from "./sentry";
import {
  getRegistry,
  redisErrorsTotal,
  redisOpsTotal,
  safeInc,
  safeObserve,
} from "./metrics";

let redisClient: RedisClientType | null = null;
let initPromise: Promise<RedisClientType | null> | null = null;
let initialised = false;
let pingWatchdog: NodeJS.Timeout | null = null;

// Lazily register a per-process Redis ping latency histogram so /api/metrics
// surfaces real latency without waiting for an explicit health probe.
const PING_HISTOGRAM_NAME = "redis_ping_latency_seconds";
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 1_000;
const DEGRADED_COUNTER_NAME = "redis_degraded_mode_total";

function ensurePingHistogram() {
  const reg = getRegistry();
  let hist = reg.getSingleMetric(PING_HISTOGRAM_NAME) as
    | Histogram<string>
    | undefined;
  if (!hist) {
    hist = new Histogram({
      name: PING_HISTOGRAM_NAME,
      help: "Latency of Redis PING (seconds) sampled by the in-process watchdog",
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [reg],
    });
  }
  return hist;
}

function ensureDegradedCounter() {
  const reg = getRegistry();
  let counter = reg.getSingleMetric(DEGRADED_COUNTER_NAME) as
    | Counter<string>
    | undefined;
  if (!counter) {
    counter = new Counter({
      name: DEGRADED_COUNTER_NAME,
      help: "Number of times the Redis singleton entered degraded (in-memory fallback) mode",
      labelNames: ["reason"] as const,
      registers: [reg],
    });
  }
  return counter;
}

/**
 * Lazily create the singleton client. Safe to call many times: the second and
 * subsequent calls return the same in-flight promise.
 */
export function initRedisClient(): Promise<RedisClientType | null> {
  if (initPromise) return initPromise;

  const isProduction = process.env.NODE_ENV === "production";

  if (!process.env.REDIS_URL) {
    // CASE 1: REDIS_URL is intentionally absent. We fall back to in-memory
    // stores. Loudly log once with a stable tag so operators / alerting can
    // distinguish this from "Redis configured but failing".
    if (isProduction) {
      logger.warn(
        {
          category: "monitoring",
          redis: { mode: "missing_in_production", fallback: "in_memory" },
        },
        "[redis] REDIS_URL is missing in production — falling back to in-memory stores. Multi-instance deployments will have inconsistent rate-limit / dedup / Socket.IO state.",
      );
      ensureDegradedCounter().inc({ reason: "missing_in_production" });
    } else {
      logger.info(
        { category: "monitoring", redis: { mode: "missing_in_dev" } },
        "[redis] REDIS_URL not set — using in-memory rate limiting (dev-only).",
      );
      ensureDegradedCounter().inc({ reason: "missing_in_dev" });
    }
    initialised = true;
    initPromise = Promise.resolve(null);
    return initPromise;
  }

  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500),
      // Defensive timeouts so a hung Redis cannot pin a request handler.
      connectTimeout: 10_000,
    },
  }) as RedisClientType;

  redisClient.on("error", (err) => {
    safeInc(redisErrorsTotal, { reason: "client_error" });
    // Capture to Sentry with subsystem tag. In production this is
    // followed by process.exit(1) so we capture FIRST and rely on
    // the Sentry SDK's queue-flush before the process actually dies
    // (Sentry node SDK has a default 2s flush on SIGTERM).
    captureSubsystemException("redis", err, {
      redis_url_present: Boolean(process.env.REDIS_URL),
      production: isProduction,
    });
    if (isProduction) {
      // CASE 2: REDIS_URL was configured (operator promised Redis would work)
      // but the client errored. Fail closed rather than silently degrade —
      // the alternative is serving traffic with broken rate-limits.
      logger.fatal({ err, category: "monitoring" }, "Redis client error - required for production");
      process.exit(1);
    }
    logger.warn({ err, category: "monitoring" }, "Redis client error - falling back to in-memory rate limiting");
    redisClient = null;
    ensureDegradedCounter().inc({ reason: "outage_in_dev" });
  });

  redisClient.on("connect", () => {
    safeInc(redisOpsTotal, { op: "connect", status: "success" });
  });

  redisClient.on("reconnecting", () => {
    safeInc(redisOpsTotal, { op: "reconnect", status: "success" });
    safeInc(redisErrorsTotal, { reason: "reconnect" });
  });

  redisClient.on("end", () => {
    safeInc(redisOpsTotal, { op: "disconnect", status: "success" });
    safeInc(redisErrorsTotal, { reason: "disconnect" });
  });

  initPromise = redisClient
    .connect()
    .then(() => {
      logger.info({ category: "monitoring", redis: { mode: "connected" } }, "[redis] connected");
      initialised = true;
      startPingWatchdog();
      return redisClient;
    })
    .catch((err) => {
      safeInc(redisErrorsTotal, { reason: "connection_failed" });
      if (isProduction) {
        logger.fatal({ err, category: "monitoring" }, "Failed to connect to Redis - required for production");
        process.exit(1);
      }
      logger.warn({ err, category: "monitoring" }, "Failed to connect to Redis - falling back to in-memory rate limiting");
      redisClient = null;
      initialised = true;
      ensureDegradedCounter().inc({ reason: "connect_failed_in_dev" });
      return null;
    });

  return initPromise;
}

/**
 * Start a 30 s ping watchdog. Each successful ping observes its latency on
 * `redis_ping_latency_seconds`. Each failure increments
 * `redis_errors_total{reason="ping_timeout"}`. Cleared on stopPingWatchdog().
 */
function startPingWatchdog() {
  if (pingWatchdog) return;
  pingWatchdog = setInterval(async () => {
    if (!redisClient) return;
    const start = process.hrtime.bigint();
    try {
      await Promise.race([
        redisClient.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("redis_ping_timeout")), PING_TIMEOUT_MS),
        ),
      ]);
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      safeObserve(ensurePingHistogram() as never, {} as never, durationSec);
      safeInc(redisOpsTotal, { op: "ping", status: "success" });
    } catch (err) {
      safeInc(redisOpsTotal, { op: "ping", status: "error" });
      safeInc(redisErrorsTotal, {
        reason: err instanceof Error && err.message === "redis_ping_timeout" ? "ping_timeout" : "ping_error",
      });
    }
  }, PING_INTERVAL_MS);
  // Don't keep the process alive solely for this timer.
  pingWatchdog.unref?.();
}

export function stopPingWatchdog(): void {
  if (pingWatchdog) {
    clearInterval(pingWatchdog);
    pingWatchdog = null;
  }
}

/**
 * Synchronous accessor. Returns the connected client, or null if Redis is not
 * available (dev fallback) or has not finished initialising yet.
 */
export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

/**
 * Throwing accessor for code paths that absolutely require Redis (alerting
 * dedup keys, etc.).
 */
export function requireRedisClient(): RedisClientType {
  if (!redisClient) {
    throw new Error(
      "Redis client not initialized. Ensure initRedisClient() has been awaited before use.",
    );
  }
  return redisClient;
}

/** True once initRedisClient() has either connected or fallen back. */
export function isRedisInitialised(): boolean {
  return initialised;
}

/** True if Redis is currently connected (not in fallback mode). */
export function isRedisConnected(): boolean {
  return redisClient !== null;
}

/**
 * Wrap a Redis op so its outcome shows up in `redis_ops_total{op,status}`.
 *
 * Callers should prefer this over calling `redisClient.x()` directly when
 * the op runs in a hot path that we want surfaced on /api/metrics.
 *
 * @example
 *   const value = await trackRedisOp("get", () => redis.get("key"));
 */
export async function trackRedisOp<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    safeInc(redisOpsTotal, { op, status: "success" });
    return result;
  } catch (err) {
    safeInc(redisOpsTotal, { op, status: "error" });
    safeInc(redisErrorsTotal, { reason: "command" });
    throw err;
  }
}
