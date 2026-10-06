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
 *
 * R2 (round-93 A3): every Redis op is raced against REDIS_COMMAND_TIMEOUT_MS
 * via `withRedisCommandTimeout`. Previously the `.catch` fallbacks below
 * could never fire during an outage — node-redis QUEUES commands while the
 * socket is down, so the promise never rejects, it just hangs, and the
 * awaiting request hung with it. The timeout converts the hang into a fast
 * rejection which the existing catch blocks turn into the memory fallback.
 */

import { getRedisClient, trackRedisOp, withRedisCommandTimeout } from "./redis-client";

// ── In-memory LRU fallback ───────────────────────────────────────────────────

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
  /** Approximate byte cost (JSON length) — feeds the byte budget below. */
  byteSize: number;
}

const MEMORY_LIMIT = 5_000;
/**
 * B6-02 (R111, audit B6): total byte budget for the in-memory LRU. The
 * 512 MB Render/Oracle container cannot let 5,000 full-catalog payloads
 * (~100-300 KB each) accumulate — 0.5-1.5 GB would OOM the process. The
 * entry-count cap stays (cheap, first line of defense); the byte budget
 * is the second line: after every insert, evict oldest-touched entries
 * until the tracked total fits. 12 MB is ~40 catalog pages or thousands
 * of small objects — far above the legitimate working set (bounded
 * catalog keys + sitemap + alerting dedup).
 */
const MEMORY_BYTE_BUDGET = 12 * 1024 * 1024;
const memory = new Map<string, MemoryEntry<unknown>>();
let memoryBytes = 0;

/** Cheap conservative size estimate: JSON length when feasible, else a
 * flat floor (covers small objects without a stringify round-trip for
 * primitives). Strings dominate real payloads; the stringify cost on
 * set is acceptable vs. an OOM. */
function estimateByteSize(value: unknown): number {
  try {
    const raw = JSON.stringify(value);
    return raw ? raw.length * 2 + 64 : 64;
  } catch {
    return 4096;
  }
}

function evictOne(): boolean {
  const oldest = memory.keys().next();
  if (oldest.done) return false;
  const entry = memory.get(oldest.value);
  if (entry) memoryBytes -= entry.byteSize;
  memory.delete(oldest.value);
  return true;
}

function memoryGet<T>(key: string): T | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
    memoryBytes -= entry.byteSize;
    memory.delete(key);
    return null;
  }
  // LRU touch
  memory.delete(key);
  memory.set(key, entry);
  return entry.value as T;
}

function memorySet<T>(key: string, value: T, ttlSec: number): void {
  // Replace-in-place: charge only the delta.
  const previous = memory.get(key);
  if (previous) memoryBytes -= previous.byteSize;
  if (memory.size >= MEMORY_LIMIT) {
    evictOne();
  }
  const byteSize = estimateByteSize(value);
  // B6-02 byte budget: evict oldest-touched until the new total fits.
  // A single value larger than the whole budget is stored alone (it
  // evicts everything else) — pathological but bounded.
  while (memoryBytes + byteSize > MEMORY_BYTE_BUDGET && memory.size > 0) {
    if (!evictOne()) break;
  }
  memory.set(key, { value, expiresAt: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0, byteSize });
  memoryBytes += byteSize;
}

function memoryDelete(key: string): void {
  const entry = memory.get(key);
  if (entry) {
    memoryBytes -= entry.byteSize;
    memory.delete(key);
  }
}

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * Get a value by key. Returns null on miss. JSON-decoded.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await withRedisCommandTimeout("cache_get", () =>
        trackRedisOp("get", () => redis.get(key)),
      );
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
      await withRedisCommandTimeout("cache_set", () =>
        trackRedisOp("set", () =>
          ttlSec > 0 ? redis.setEx(key, ttlSec, payload) : redis.set(key, payload),
        ),
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
      await withRedisCommandTimeout("cache_del", () => trackRedisOp("del", () => redis.del(key)));
    } catch {
      // fall through
    }
  }
  memoryDelete(key);
}

// ── Single-flight in-flight load registry (F-2, R118-A6) ────────────────────
//
// Concurrent misses on the same key previously each ran the loader: after
// every catalog TTL expiry (30 s) or bumpCatalogCache() generation bump
// (10 admin mutation sites), N concurrent requests each executed the full
// loader — the catalog list loader alone is 4 queries, so 50 concurrent
// users produced a 200-query burst precisely at the moment of an admin
// edit (the #1 scaling cliff on the public path).
//
// The registry dedupes loads per process: the first miss stores its
// loader promise, every other same-key miss awaits THAT promise, and the
// entry is deleted in a `finally` that runs before the shared promise
// settles — so the map can never outlive an in-flight load (no leak) and
// a post-settle caller always re-reads the cache instead of a stale
// promise. Per-process by design (same topology assumption as the memory
// LRU above); cross-instance single-flight would need a Redis
// `SET NX EX` layer — deliberately out of scope.
//
// Pattern precedent: routes/health.ts `inflight` (the /healthz/summary
// aggregate has shared its load since round-93 A3).
const inflightLoads = new Map<string, Promise<unknown>>();

/** Test seam: number of currently in-flight loads (leak detection). */
export function __inflightLoadCountForTests(): number {
  return inflightLoads.size;
}

/**
 * Read-through pattern: return cached value if present, else compute via
 * `loader`, store, return. Stampede-resistant within a single process
 * (F-2, R118-A6: concurrent misses on the same key share ONE loader run
 * via the in-flight registry above) — for true single-flight across
 * instances, layer a Redis `SET NX EX` lock on top.
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
  // F-2 single-flight: the check-then-set below is synchronous (no await
  // between), so of the concurrent missers exactly the first to resume
  // after its cacheGet creates the shared load; the rest await it.
  const existing = inflightLoads.get(key);
  if (existing) return existing as Promise<T>;
  const shared = (async () => {
    try {
      const fresh = await loader();
      await cacheSet(key, fresh, ttlSec);
      return fresh;
    } finally {
      inflightLoads.delete(key);
    }
  })();
  inflightLoads.set(key, shared);
  return shared;
}
