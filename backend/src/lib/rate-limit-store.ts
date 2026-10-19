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
 * rate-limit-redis v6 (R172): the store's `init()` became ASYNC — it captures
 * `windowMs` and pre-loads the EVALSHA Lua scripts over the wire, and every
 * op awaits the cached script-SHA promises. Two consequences wired here:
 *   - init must be FORWARDED (v5 could run un-inited because it read TTLs off
 *     the keys; v6's increment builds its command from `windowMs` and the SHA
 *     promises and throws before reaching Redis without it);
 *   - a failed script-load leaves rejected SHA promises cached on the store,
 *     so after a fallback we RE-ARM by re-running init (a fresh promise pair),
 *     keeping the degraded-boot recovery story intact (the v5 behavior).
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

  // The limiter's configuration, captured at init for the v6 re-arm path.
  let limiterOptions: Parameters<NonNullable<Store["init"]>>[0] | null = null;

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

  /**
   * rate-limit-redis v6 (R172): run (or re-run) the async init — captures
   * windowMs and re-loads the EVALSHA script-SHA promises. Fire-and-forget:
   * express-rate-limit calls init() synchronously, and a failed load must
   * never break the limiter (the rejected SHA promises make every following
   * op fall back to memory; the re-arm in noteFallback replaces them).
   */
  const armRedisStore = (): void => {
    if (!limiterOptions) return;
    void Promise.resolve(redisStore.init(limiterOptions)).catch(() => {
      // Swallowed on purpose: the failure path is the store's own fallback
      // (each op that awaits the rejected SHA promise lands in noteFallback,
      // which re-arms and applies the cooldown). An unhandled rejection
      // here would crash the process for a dead Redis at boot.
    });
  };

  let redisCooldownUntil = 0;
  let lastFallbackLogAt = 0;

  const noteFallback = (err: unknown): void => {
    redisCooldownUntil = Date.now() + REDIS_FAILURE_COOLDOWN_MS;
    // Re-arm the v6 script cache for the next window: the cached SHA
    // promises may be rejected (dead Redis at init time) and would otherwise
    // stay rejected forever — the cooldown lapse would re-open a door to a
    // store that can never engage again (the exact degraded-boot
    // regression the R2 contract forbids).
    armRedisStore();
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
      // rate-limit-redis v6 (R172): forward the async init — v6's increment
      // builds EVALSHA commands from windowMs + the script-SHA promises and
      // throws before touching Redis without it. See armRedisStore().
      limiterOptions = options;
      armRedisStore();
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
