/**
 * R2 (round-93 A3 audit) — resilient express-rate-limit store.
 *
 * The previous wiring handed `rate-limit-redis` a raw `sendCommand` bound to
 * the singleton client. During a runtime Redis outage node-redis QUEUES the
 * commands (offline queue) and the awaited `increment()` never settles —
 * every `/api` request hung forever inside the limiter while `/healthz` and
 * `/metrics` stayed green (silent full-site outage). The wiring also only
 * read `getRedisClient()` once at module-eval time — before `initRedisClient()`
 * had ever run — so the Redis store could never actually engage.
 *
 * This store fixes both:
 *   1. LAZY per-op client resolution — `getRedisClient()` is read on every
 *      operation, and it only returns a READY client, so the store engages
 *      the moment Redis connects (even after a degraded boot) and
 *      disengages the moment it drops.
 *   2. BOUNDED commands — every sendCommand races
 *      `withRedisCommandTimeout` (REDIS_COMMAND_TIMEOUT_MS, default 500ms).
 *      A hang becomes a fast rejection.
 *
 * Failure policy: on timeout/error/absence, fall back to a private
 * `MemoryStore` (single-instance semantics — the exact behaviour the
 * deployment already has without Redis) and let the request proceed.
 * Availability of the money path outranks cross-process accuracy of the
 * rate-limit window. After a Redis failure a short cooldown skips Redis
 * entirely so requests don't each pay the 500ms race penalty while the
 * socket is in a gray state.
 *
 * One instance per limiter (express-rate-limit v8 rejects shared store
 * instances with ERR_ERL_STORE_REUSE — create via the factory each time).
 */

import { MemoryStore, type Store } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { getRedisClient, withRedisCommandTimeout } from "./redis-client";
import { logger } from "./logger";
import { safeInc, redisErrorsTotal, redisOpsTotal } from "./metrics";

/** Skip Redis for this long after a failed op (gray-state cooldown). */
const REDIS_FAILURE_COOLDOWN_MS = 10_000;

/** Rate-limit the "fell back to memory" warning to one log per minute. */
const FALLBACK_LOG_INTERVAL_MS = 60_000;

export function createResilientRateLimitStore(): Store {
  // Private in-memory fallback — same class express-rate-limit uses by
  // default; windowMs arrives via init(options) from the owning limiter.
  const memoryStore = new MemoryStore();

  // The Redis-backed store. sendCommand resolves the CURRENT singleton
  // client per call (lazy engagement) and bounds each command with the
  // shared command timeout (R2).
  const redisStore = new RedisStore({
    prefix: "rl:",
    sendCommand: (...args: string[]) => {
      const client = getRedisClient();
      if (!client) {
        // Not ready (never connected / degraded boot / mid-run outage):
        // fail fast — the caller falls back to the memory store without
        // paying the command-timeout race.
        throw new Error("rate_limit_store: redis client not ready");
      }
      return withRedisCommandTimeout("rate_limit", () => client.sendCommand(args));
    },
  });

  let redisCooldownUntil = 0;
  let lastFallbackLogAt = 0;

  const noteFallback = (err: unknown): void => {
    redisCooldownUntil = Date.now() + REDIS_FAILURE_COOLDOWN_MS;
    safeInc(redisOpsTotal, { op: "rate_limit", status: "fallback" });
    safeInc(redisErrorsTotal, { reason: "rate_limit_fallback" });
    const now = Date.now();
    if (now - lastFallbackLogAt >= FALLBACK_LOG_INTERVAL_MS) {
      lastFallbackLogAt = now;
      logger.warn(
        { err, category: "monitoring", redis: { mode: "rate_limit_memory_fallback" } },
        "[rate-limit] Redis store op failed — falling back to in-memory rate limiting for this window (requests continue)",
      );
    }
  };

  const shouldTryRedis = (): boolean =>
    Date.now() >= redisCooldownUntil && getRedisClient() !== null;

  return {
    init(options) {
      memoryStore.init(options);
    },
    async increment(key) {
      if (shouldTryRedis()) {
        try {
          return await redisStore.increment(key);
        } catch (err) {
          noteFallback(err);
        }
      }
      return memoryStore.increment(key);
    },
    async decrement(key) {
      if (shouldTryRedis()) {
        try {
          await redisStore.decrement(key);
          return;
        } catch (err) {
          noteFallback(err);
        }
      }
      await memoryStore.decrement(key);
    },
    async resetKey(key) {
      if (shouldTryRedis()) {
        try {
          await redisStore.resetKey(key);
          return;
        } catch (err) {
          noteFallback(err);
        }
      }
      await memoryStore.resetKey(key);
    },
  } satisfies Store;
}
