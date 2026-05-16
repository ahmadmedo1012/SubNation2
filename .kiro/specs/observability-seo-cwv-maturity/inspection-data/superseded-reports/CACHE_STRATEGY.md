# Cache Strategy

Discipline for the `backend/src/lib/cache.ts` primitive and Redis-backed
caching in general. Anti-cache decisions matter more than cache decisions.

## 1. The primitive

```ts
import { cacheGet, cacheSet, cacheDelete, cacheWrap, cacheInvalidatePrefix } from "@/lib/cache";

// Read-through
const product = await cacheWrap(`product:${id}`, 60, () => db.fetchProduct(id));

// Write-through (cache.set after a primary-storage write)
await db.update(productsTable).set({...}).where(eq(productsTable.id, id));
await cacheSet(`product:${id}`, fresh, 60);

// Invalidation (after writes that affect a list, e.g. sitemap)
await cacheInvalidatePrefix("sitemap:");
```

Backed by Redis when available, by an in-memory LRU (5 000-entry bound,
TTL eviction) otherwise. Same API regardless. Callers never branch.

## 2. What to cache

The general rule: **read-mostly data with a clear invalidation point**.

| Candidate | TTL | Invalidator | Notes |
|---|---|---|---|
| Product detail by id | 60 s | product POST / PATCH / DELETE in `routes/admin/products.ts` | already wired via `bumpSitemapCache`; the cache lib makes the same pattern available for product reads |
| Product list (paged) | 60 s | same | only worth caching if the list is hit ≥ 10 times / minute; otherwise Neon handles it fine |
| Sitemap.xml body | 60 s | product write | already wired in `routes/seo.ts` (in-process cache; can be promoted to Redis if multi-instance) |
| Category counts | 60 s | product / order writes | hot on the home page |
| User wallet balance | 5 s | user balance update path | only if the read rate justifies the invalidation complexity (probably not) |
| `/api/healthz/firebase` body | 30 s | never | the underlying check is a constant-time read of Firebase Admin state |

## 3. What NOT to cache

| ❌ Don't cache | Why |
|---|---|
| Auth tokens / sessions | session lifecycle is too short and the cost of a stale value is dangerous (a user keeps a logged-out token) |
| Admin operations / mutations | mutation responses should always reflect the post-write state |
| Real-time data (Socket.IO event payloads) | by definition not cacheable — already real-time |
| User-specific PII | per-user keys explode cardinality; not worth it |
| OTP codes | security-sensitive; codes must hit Redis directly with their own TTL |
| Wallet ledger entries | financial truth source; cache invalidation bugs translate to duplicated topups |

## 4. TTL discipline

| TTL | When |
|---|---|
| 5–10 s | "near real-time" — for high-traffic reads where 5 s of staleness is acceptable |
| 60 s (default) | most catalog reads. Strikes a balance between hit rate and freshness. |
| 5 min (300 s) | list-of-things-that-rarely-change (categories, brands, FAQ) |
| 1 h (3600 s) | static config (feature flags, public app settings) |
| `0` (no expiry) | NEVER use this on user-facing data; reserved for boot-time config |

Always pair a TTL with an invalidator at the write site. **A cache without
an invalidation strategy is a bug.**

## 5. Stampede protection

The default `cacheWrap` is single-flight only inside one Node process. For
true cross-instance stampede protection (e.g. expensive product list build
that's hit by 10 instances on every cache miss):

```ts
const lockKey = `lock:${cacheKey}`;
const acquired = await redis.set(lockKey, "1", { NX: true, EX: 5 });
if (acquired) {
  try {
    const fresh = await loader();
    await cacheSet(cacheKey, fresh, ttl);
    return fresh;
  } finally {
    await redis.del(lockKey);
  }
} else {
  // Another instance is computing — sleep + retry the cache read.
  await new Promise((r) => setTimeout(r, 100));
  return cacheGet(cacheKey);
}
```

Adopt this pattern on a per-call-site basis only when stampede is
demonstrated by metrics.

## 6. Cache key naming

Format: `<resource>:<identity>[:<facet>]`. Examples:

```
product:42
product-list:category=streaming:page=1
sitemap:body
faq:body
user:42:loyalty-tier
```

Always namespace by **resource type first** so `cacheInvalidatePrefix("product:")`
clears all product-shaped entries on a bulk catalogue operation.

## 7. Observability

- Every Redis op emits `redis_ops_total{op,status}` via `trackRedisOp` —
  cache hit/miss is observable as `op="get"` plus the cache caller's own
  Pino log line.
- A future iteration can add `cache_hits_total` / `cache_misses_total`
  counters; the current implementation is intentionally minimal until a
  call site needs them.

## 8. Memory-fallback boundary

When Redis is unavailable, every cache call falls back to the in-process
LRU. Two important corollaries:

1. **State is per-instance** — under multi-instance deploys, a write on
   instance A doesn't invalidate instance B's cache. This is acceptable
   for free-tier single-instance deployments. Once you scale horizontally,
   Redis is non-negotiable.
2. **No persistence across restarts** — on Render free tier, web service
   instances cycle on inactivity. Memory cache restarts cold. This
   pressures the cold-start path; if it becomes a problem, materialise the
   hot keys into Redis so they survive restarts.
