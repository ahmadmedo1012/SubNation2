/**
 * Cross-process cache primitive.
 *
 * Backed by Redis when `getRedisClient()` returns a connected client, by an
 * in-memory LRU otherwise. The same `cacheGet / cacheSet / cacheDelete /
 * cacheWrap` surface is used everywhere — callers don't branch on which
 * backend is active.
 *
 * Memory fallback is a bounded LRU with TTL eviction, sized for a single
 * web instance. It exists to keep dev / unprovisioned environments
 * responsive; it is NOT a substitute for Redis under multi-instance
 * deployments (each instance would have its own private state).
 *
 * Observability:
 *   - cache hits/misses log on debug level; counter wiring is a follow-up.
 *   - cache backend is observable from `/api/healthz/redis` (Redis path)
 *     and from `redis_degraded_mode_total{reason}` on /api/metrics.
 */

import { getRedisClient, trackRedisOp } from "./redis-client";

// ── In-memory LRU fallback ───────────────────────────────────────────────────

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
}

const MEMORY_LIMIT = 5_000;
const memory = new Map<string, MemoryEntry<unknown>>();

function memoryGet<T>(key: string): T | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
    memory.delete(key);
    return null;
  }
  // LRU touch
  memory.delete(key);
  memory.set(key, entry);
  return entry.value as T;
}

function memorySet<T>(key: string, value: T, ttlSec: number): void {
  if (memory.size >= MEMORY_LIMIT) {
    // Evict oldest insertion (Map iteration order = insertion order).
    const oldest = memory.keys().next();
    if (!oldest.done) memory.delete(oldest.value);
  }
  memory.set(key, {
    value,
    expiresAt: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0,
  });
}

function memoryDelete(key: string): void {
  memory.delete(key);
}

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * Get a value by key. Returns null on miss. JSON-decoded.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await trackRedisOp("get", () => redis.get(key));
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        // Stored value isn't JSON — surface as raw string.
        return raw as unknown as T;
      }
    } catch {
      // Redis hiccup — fall through to memory.
    }
  }
  return memoryGet<T>(key);
}

/**
 * Set a value. ttlSec=0 means no expiry. Always JSON-encodes.
 */
export async function cacheSet<T>(key: string, value: T, ttlSec = 60): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const payload = JSON.stringify(value);
      await trackRedisOp("set", () =>
        ttlSec > 0 ? redis.setEx(key, ttlSec, payload) : redis.set(key, payload),
      );
      return;
    } catch {
      // fall through
    }
  }
  memorySet(key, value, ttlSec);
}

/**
 * Delete by exact key. Cross-backend.
 */
export async function cacheDelete(key: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    try {
      await trackRedisOp("del", () => redis.del(key));
    } catch {
      // fall through
    }
  }
  memoryDelete(key);
}

/**
 * Read-through pattern: return cached value if present, else compute via
 * `loader`, store, return. Stampede-resistant only at the level of a single
 * process — for true single-flight across instances, layer a Redis
 * `SET NX EX` lock on top.
 *
 * @example
 *   const product = await cacheWrap(`product:${id}`, 60, () => db.fetchProduct(id));
 */
export async function cacheWrap<T>(
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null && cached !== undefined) return cached;
  const fresh = await loader();
  await cacheSet(key, fresh, ttlSec);
  return fresh;
}

/**
 * Bulk-invalidate all cache keys matching a SCAN pattern. No-op on the
 * memory backend (full scan there is O(n) but the bound is 5k keys, so
 * that's acceptable).
 */
export async function cacheInvalidatePrefix(prefix: string): Promise<number> {
  const redis = getRedisClient();
  let removed = 0;
  if (redis) {
    try {
      // SCAN streamed in batches of 100 to avoid blocking the event loop on
      // large key spaces.
      let cursor = "0";
      do {
        const result = (await trackRedisOp("scan", () =>
          redis.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 }),
        )) as { cursor: string; keys: string[] };
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await trackRedisOp("del", () => redis.del(result.keys));
          removed += result.keys.length;
        }
      } while (cursor !== "0");
    } catch {
      // fall through to memory clear
    }
  }
  // Memory pass — always run (cheap).
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) {
      memory.delete(key);
      removed += 1;
    }
  }
  return removed;
}
