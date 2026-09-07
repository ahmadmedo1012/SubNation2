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
 * Production policy (R1, round-93 A3 audit — corrected to match reality):
 *   - REDIS_URL absent + NODE_ENV=production → log a clearly-tagged warning
 *     ("redis_missing_in_production") every boot, fall back to in-memory
 *     stores. This is OK for a single-instance deployment but unsafe for
 *     horizontal scaling (each instance has its own rate-limit window).
 *   - REDIS_URL set + connection failure or SLOW boot → degraded mode:
 *     never process.exit(1), and never hang the boot. node-redis 5's
 *     reconnectStrategy that always returns a number makes `connect()`
 *     NEVER settle (live-verified against redis@5.12.1) — so the boot wait
 *     is bounded by `REDIS_CONNECT_TIMEOUT_MS` (default 8s) via
 *     Promise.race. On timeout we continue WITHOUT Redis (in-memory
 *     fallbacks) while the client object stays alive and keeps retrying
 *     in the background; the `ready` listener flips the singleton back
 *     into service the moment Redis actually connects (self-healing, no
 *     restart needed).
 *
 * Runtime policy (R2, round-93 A3):
 *   - `getRedisClient()` only returns a client that is actually READY
 *     (`isReady`). During a runtime outage the callers see null and take
 *     their in-memory / pass-through fallbacks immediately — commands are
 *     never queued against a dead socket from the hot paths.
 *   - For the gray zone (socket "ready" but the server black-holes),
 *     `withRedisCommandTimeout()` bounds any single command with a
 *     `REDIS_COMMAND_TIMEOUT_MS` race (default 500ms) so a hung Redis op
 *     becomes a fast rejection the caller can fall back from — instead of
 *     an eternally pending promise that hangs an HTTP request.
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
import { getRegistry, redisErrorsTotal, redisOpsTotal, safeInc, safeObserve } from "./metrics";

let redisClient: RedisClientType | null = null;
let initPromise: Promise<RedisClientType | null> | null = null;
let initialised = false;
let pingWatchdog: NodeJS.Timeout | null = null;

// ── R1/R2 (round-93 A3): timeout knobs ────────────────────────────────────
//
// Boot budget: how long `initRedisClient()` may wait for the first
// connection before continuing in degraded (no-Redis) mode. The socket's
// own reconnectStrategy keeps retrying forever — this race is the ONLY
// thing that makes the boot settle when Redis is unreachable.
const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
// Per-command budget for hot-path Redis ops (rate-limit store, cache,
// idempotency). Convert "hangs forever" into "rejects fast, caller falls
// back". Kept small: these paths have in-memory fallbacks.
const DEFAULT_COMMAND_TIMEOUT_MS = 500;

function redisConnectTimeoutMs(): number {
  const raw = Number(process.env.REDIS_CONNECT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONNECT_TIMEOUT_MS;
}

function redisCommandTimeoutMs(): number {
  const raw = Number(process.env.REDIS_COMMAND_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COMMAND_TIMEOUT_MS;
}

/** Rejection used when a Redis command exceeds REDIS_COMMAND_TIMEOUT_MS. */
export class RedisCommandTimeoutError extends Error {
  constructor(
    public readonly opLabel: string,
    public readonly timeoutMs: number,
  ) {
    super(`Redis command "${opLabel}" timed out after ${timeoutMs}ms`);
    this.name = "RedisCommandTimeoutError";
  }
}

/**
 * R2 (round-93 A3): race a Redis command against a deadline.
 *
 * node-redis queues commands while the socket is down (offline queue) — a
 * queued `get`/`set`/`incr` NEVER settles, so any awaiting request hangs.
 * This wrapper converts the hang into a fast `RedisCommandTimeoutError`
 * rejection that callers can catch and fall back from (in-memory store,
 * pass-through). The underlying command is left running: if the socket
 * recovers it flushes and executes (counters/reads are safe to run late).
 *
 * Metrics: timeout increments `redis_ops_total{op,status="timeout"}` and
 * `redis_errors_total{reason="command_timeout"}`.
 */
export async function withRedisCommandTimeout<T>(
  opLabel: string,
  fn: () => Promise<T>,
  timeoutMs: number = redisCommandTimeoutMs(),
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RedisCommandTimeoutError(opLabel, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } catch (err) {
    if (err instanceof RedisCommandTimeoutError) {
      safeInc(redisOpsTotal, { op: opLabel, status: "timeout" });
      safeInc(redisErrorsTotal, { reason: "command_timeout" });
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Lazily register a per-process Redis ping latency histogram so /api/metrics
// surfaces real latency without waiting for an explicit health probe.
const PING_HISTOGRAM_NAME = "redis_ping_latency_seconds";
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 1_000;
const DEGRADED_COUNTER_NAME = "redis_degraded_mode_total";

function ensurePingHistogram() {
  const reg = getRegistry();
  let hist = reg.getSingleMetric(PING_HISTOGRAM_NAME) as Histogram<string> | undefined;
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
  let counter = reg.getSingleMetric(DEGRADED_COUNTER_NAME) as Counter<string> | undefined;
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
    // Capture to Sentry with subsystem tag.
    captureSubsystemException("redis", err, {
      redis_url_present: Boolean(process.env.REDIS_URL),
      production: isProduction,
    });
    // H12 (deep-audit 2026-09-06): do NOT process.exit(1) here. This is
    // a SINGLE-instance deployment — killing the process on any Redis
    // blip takes down the entire site (SPA included) and enters a
    // Render restart crash-loop; a brief degraded window (socket
    // client auto-reconnects with backoff) is strictly cheaper.
    // The `redis_disconnect` alert rule pages the operator off the
    // redis_errors_total delta, so the outage is never silent.
    logger.error(
      { err, category: "monitoring", redis: { mode: "degraded_reconnecting" } },
      "Redis client error — staying up, client reconnects with backoff",
    );
    ensureDegradedCounter().inc({ reason: "client_error_stayed_up" });
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

  // R1 (round-93 A3): recovery hook. Fires on the FIRST successful connect
  // and on every reconnect. If the boot already continued in degraded mode
  // (connect race timed out), this is the moment the singleton becomes
  // usable again — `getRedisClient()` starts returning the client and every
  // lazy consumer (rate-limit store, cache, idempotency, health) picks it
  // up without a process restart.
  let wasBootDegraded = false;
  redisClient.on("ready", () => {
    safeInc(redisOpsTotal, { op: "ready", status: "success" });
    startPingWatchdog();
    if (wasBootDegraded) {
      wasBootDegraded = false;
      logger.warn(
        { category: "monitoring", redis: { mode: "recovered_after_degraded_boot" } },
        "[redis] recovered after degraded boot — Redis singleton is back in service",
      );
    }
  });

  // R1 (round-93 A3): bound the boot wait. `connect()` with a numeric-only
  // reconnectStrategy NEVER settles when Redis is unreachable (verified
  // against redis@5.12.1: the socket's connect loop retries forever). Race
  // it against REDIS_CONNECT_TIMEOUT_MS; on timeout continue in degraded
  // mode. The client object is intentionally KEPT (not nulled) so its
  // reconnect loop can still land — the "ready" listener above flips the
  // singleton back into service when it does.
  const connectTimeoutMs = redisConnectTimeoutMs();
  let bootRaceTimer: NodeJS.Timeout | undefined;
  const connectPromise = redisClient.connect();

  initPromise = Promise.race([
    connectPromise,
    new Promise<never>((_, reject) => {
      bootRaceTimer = setTimeout(
        () => reject(new RedisCommandTimeoutError("boot_connect", connectTimeoutMs)),
        connectTimeoutMs,
      );
    }),
  ])
    .then(() => {
      // Connected within the boot budget.
      clearTimeout(bootRaceTimer);
      logger.info({ category: "monitoring", redis: { mode: "connected" } }, "[redis] connected");
      initialised = true;
      return redisClient;
    })
    .catch((err) => {
      clearTimeout(bootRaceTimer);
      const timedOut = err instanceof RedisCommandTimeoutError;
      safeInc(redisErrorsTotal, {
        reason: timedOut ? "connect_timeout" : "connection_failed",
      });
      // H12: same crash-loop rationale as the error handler — boot-time
      // failure degrades loudly (in-memory fallback + alert + Sentry)
      // instead of exit(1). Render would restart us into the same dead
      // Redis; staying up keeps the money path (Postgres) alive.
      captureSubsystemException("redis", err, { boot: true });
      logger.fatal(
        {
          err,
          category: "monitoring",
          redis: {
            mode: "degraded_boot",
            connectTimeoutMs,
            backgroundRetry: true,
          },
        },
        timedOut
          ? "[redis] connect() did not settle within the boot budget — continuing in degraded mode (in-memory fallback). The client keeps retrying in the background and recovers automatically on the 'ready' event."
          : "Failed to connect to Redis — degraded mode (in-memory fallback), NOT exiting",
      );
      wasBootDegraded = true;
      initialised = true;
      ensureDegradedCounter().inc({
        reason: timedOut ? "connect_timeout_degraded" : "connect_failed_degraded",
      });
      // NOTE: redisClient is deliberately left non-null (see comment above
      // the race) — but getRedisClient() only hands it out once isReady.
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
        reason:
          err instanceof Error && err.message === "redis_ping_timeout"
            ? "ping_timeout"
            : "ping_error",
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
 * Synchronous accessor. Returns the client ONLY when it is actually
 * ready to serve commands (`isReady`); null otherwise (dev fallback,
 * degraded boot, or mid-run outage).
 *
 * R2 (round-93 A3): previously this returned the raw object — callers
 * then queued commands into the offline queue during an outage and hung
 * forever. Handing out a non-ready client is strictly worse than null:
 * every consumer of this getter already has a null-branch fallback
 * (in-memory cache, pass-through idempotency, memory rate-limit store).
 */
export function getRedisClient(): RedisClientType | null {
  if (!redisClient) return null;
  return redisClient.isReady ? redisClient : null;
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

/** True if Redis is currently connected and ready (not in fallback mode). */
export function isRedisConnected(): boolean {
  return redisClient !== null && redisClient.isReady;
}

/**
 * Expose the degraded-mode counter for sibling modules (e.g. the scheduler
 * coordinator marks `lost_leadership` here so the dashboard metric the
 * code docs promise actually exists).
 */
export function noteRedisDegradedMode(reason: string): void {
  ensureDegradedCounter().inc({ reason });
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
