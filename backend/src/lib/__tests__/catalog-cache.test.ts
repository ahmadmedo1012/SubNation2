import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R111-FIX-T / W5 (R111-T1 §4 rank-2) — test harness for
 * src/lib/catalog-cache.ts, the in-process TTL cache on the PUBLIC catalog
 * read paths. Until now this file had ZERO test references, which matters
 * twice over:
 *
 *   1. It is the R104 read-through that keeps the catalog (list = 4 queries,
 *      stats = 4, detail = 6) off Postgres on every page view + crawler hit.
 *   2. It carries B6-02's proven self-DoS surface: the LRU under it is
 *      bounded by ENTRY COUNT (5,000), not bytes, and the route keys the
 *      list cache by the raw search combo — every unique `?search=` mints
 *      another full-payload entry. The Wave-B #13 fix (search skip + byte
 *      budget) will land against THIS harness.
 *
 * What is pinned here (current, real behavior):
 *   - a 200-shaped loader result is cached; repeats don't re-run the loader
 *   - TTL: a hit inside the window, a re-load after it
 *   - bumpCatalogCache() orphans every previous entry (generation namespace)
 *   - scopes partition the key space
 *   - search-shaped keys: each unique combo = its own entry (the honest
 *     B6-02 reality — no dedup, no byte budget today)
 *   - LRU eviction at the 5,000-entry cap, including the touch-promotion
 *   - a throwing loader stores nothing (transient errors never pin)
 *   - a null loader result is a permanent miss (the flash-sale shape)
 *
 * Environment: REDIS_URL is unset and initRedisClient() never runs, so
 * cacheWrap exercises its REAL in-memory LRU fallback — exactly the
 * production shape B6-02 analyzed (no-Redis deployments). The LRU Map and
 * the generation counter are module state, so every test re-imports the
 * module fresh via vi.resetModules().
 */

async function importCatalogCache() {
  return import("../catalog-cache");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withCatalogCache — read-through behavior (R104 AG5-3/AG5-7/AG10)", () => {
  it("caches a 200-shaped loader result — repeated calls never re-run the loader", async () => {
    const { withCatalogCache } = await importCatalogCache();
    const loader = vi.fn(async () => ({ products: ["a", "b"], total: 2 }));

    const first = await withCatalogCache("list", "home one", 30, loader);
    const second = await withCatalogCache("list", "home one", 30, loader);
    const third = await withCatalogCache("list", "home one", 30, loader);

    expect(first).toEqual({ products: ["a", "b"], total: 2 });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("TTL: still cached at 29s, re-loaded after the 30s window expires", async () => {
    vi.useFakeTimers();
    const { withCatalogCache } = await importCatalogCache();
    let n = 0;
    const loader = vi.fn(async () => ({ n: (n += 1) }));

    await withCatalogCache("list", "ttl one", 30, loader);
    await vi.advanceTimersByTimeAsync(29_000);
    const withinWindow = await withCatalogCache("list", "ttl one", 30, loader);
    expect(withinWindow).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(1);

    // 31s total — past the 30s TTL (the hit at 29s does NOT refresh it:
    // cacheWrap returns early without re-setting).
    await vi.advanceTimersByTimeAsync(2_000);
    const afterWindow = await withCatalogCache("list", "ttl one", 30, loader);
    expect(afterWindow).toEqual({ n: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("bumpCatalogCache() orphans every previous entry — the next read runs live", async () => {
    const { withCatalogCache, bumpCatalogCache } = await importCatalogCache();
    const loader = vi.fn(async () => ({ v: 1 }));

    await withCatalogCache("list", "gen one", 60, loader);
    await withCatalogCache("list", "gen one", 60, loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // Admin product/variant/flash-sale/pricing mutations call this — the
    // generation counter makes every previous key unreachable instantly.
    bumpCatalogCache();

    const fresh = await withCatalogCache("list", "gen one", 60, loader);
    expect(fresh).toEqual({ v: 1 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("scopes partition the key space — the same key under two scopes is two entries", async () => {
    const { withCatalogCache } = await importCatalogCache();
    const listLoader = vi.fn(async () => ({ scope: "list" }));
    const statsLoader = vi.fn(async () => ({ scope: "stats" }));

    const a = await withCatalogCache("list", "shared one", 60, listLoader);
    const b = await withCatalogCache("stats", "shared one", 60, statsLoader);
    expect(a).toEqual({ scope: "list" });
    expect(b).toEqual({ scope: "stats" });

    // Both are served from their own scope's entry — no cross-scope bleed.
    await withCatalogCache("list", "shared one", 60, listLoader);
    await withCatalogCache("stats", "shared one", 60, statsLoader);
    expect(listLoader).toHaveBeenCalledTimes(1);
    expect(statsLoader).toHaveBeenCalledTimes(1);
  });

  it("B6-02 module reality: withCatalogCache itself still keys by whatever the caller passes — the AMPLIFICATION fix lives at the ROUTE layer (R111 landed)", async () => {
    const { withCatalogCache } = await importCatalogCache();

    // The route (products.ts GET /api/products) built its cache key from
    // the normalized filter combo — JSON.stringify([category, search,
    // sort, available_only]) with the search term lowercased. SINCE R111
    // (B6-02 Wave-B) the ROUTE never routes a search-bearing request
    // through withCatalogCache at all — search always runs live (the
    // ILIKE + LIMIT 500 query measured 6.5 ms). This test pins the
    // MODULE's own keying behavior (still caller-driven, deliberately:
    // the module cannot know which key dimensions are unbounded), and
    // the byte-budget test below pins the second line of defense.
    const routeKeyFor = (search: string) =>
      JSON.stringify(["", search.trim().toLowerCase(), "", false]);

    const loadCounts = new Map<string, number>();
    const load = (term: string) => {
      const loader = vi.fn(async () => ({ products: [{ hit: term }] }));
      return withCatalogCache("list", routeKeyFor(term), 30, loader).then((v) => {
        loadCounts.set(term, (loadCounts.get(term) ?? 0) + loader.mock.calls.length);
        return v;
      });
    };

    const terms = ["netflix", "spotify", "net flix"];
    for (const term of terms) await load(term);
    // Each unique search term ran its own loader…
    expect([...loadCounts.values()]).toEqual([1, 1, 1]);

    // …and every one of them stays resident simultaneously (repeat reads
    // are served from cache) — bounded now by the ROUTE's search-skip
    // (this shape can no longer be minted by /api/products) AND the
    // byte budget in lib/cache.ts (pinned below).
    for (const term of terms) await load(term);
    expect([...loadCounts.values()]).toEqual([1, 1, 1]);
  });

  it("B6-02 byte budget (R111): the LRU evicts oldest-touched entries once the tracked byte total exceeds the budget", async () => {
    // The budget lives in lib/cache.ts (MEMORY_BYTE_BUDGET = 12 MB).
    // Fill the cache with entries big enough that a handful crosses the
    // budget, then prove eviction by byte size — even though the ENTRY
    // count is nowhere near 5,000. (Real-world shape: ~40 full-catalog
    // payloads ≈ 100-300 KB each.)
    const { cacheSet, cacheGet } = await import("../cache").then((m) => ({
      cacheSet: m.cacheSet,
      cacheGet: m.cacheGet,
    }));

    // 32 entries × ~300 KB payload → ~600 KB accounted each (the byte
    // counter is conservative: UTF-16 ×2 + entry overhead) ≈ 19 MB
    // against the 12 MB budget. The Map must never hold all 32 — the
    // earliest fall out as later ones land. (getRedisClient() is null in
    // the test env → the memory LRU runs.)
    const big = "x".repeat(300 * 1024);
    for (let i = 0; i < 32; i += 1) {
      await cacheSet(`budget key ${String(i).padStart(2, "0")}`, { blob: big }, 60);
    }

    // The EARLIEST key was evicted (byte pressure, not entry count —
    // only 32 of 5,000 slots used): re-reading it must MISS (null)…
    expect(await cacheGet<string>("budget key 00")).toBeNull();
    expect(await cacheGet<string>("budget key 01")).toBeNull();
    // …while the NEWEST keys are all resident.
    expect(await cacheGet<string>("budget key 31")).not.toBeNull();
    expect(await cacheGet<string>("budget key 30")).not.toBeNull();
    // And the surviving set fits the budget: 12 MB / ~600 KB ≈ 20
    // residents (pin the inclusive shape, not the exact survivor index).
    let resident = 0;
    for (let i = 0; i < 32; i += 1) {
      if ((await cacheGet<string>(`budget key ${String(i).padStart(2, "0")}`)) !== null) {
        resident += 1;
      }
    }
    expect(resident).toBeGreaterThan(15); // most of the budget is usable
    expect(resident).toBeLessThan(32); // but it is NOT unbounded
  });

  it("LRU eviction at the 5,000-entry cap — the oldest falls out; a read promotes recency", async () => {
    const { withCatalogCache } = await importCatalogCache();
    const loadCounts = new Map<string, number>();
    const load = (key: string) =>
      withCatalogCache("list", key, 60, async () => {
        loadCounts.set(key, (loadCounts.get(key) ?? 0) + 1);
        return { key };
      });

    // Fill the LRU to exactly its cap (MEMORY_LIMIT = 5_000 in lib/cache.ts).
    for (let i = 0; i < 5_000; i += 1) await load(`k ${i}`);
    expect(loadCounts.get("k 0")).toBe(1);
    expect(loadCounts.get("k 4999")).toBe(1);

    // Touch k 0 — a read re-inserts it at the LRU's newest end.
    await load("k 0");
    expect(loadCounts.get("k 0")).toBe(1);

    // The 5,001st distinct entry evicts the OLDEST INSERTION — which is now
    // k 1, because k 0 was just touched.
    await load("k new one");

    // Re-reading settles which entries are still resident (a hit does NOT
    // re-run the loader; an evicted key does).
    await load("k 0");
    await load("k 1");
    await load("k 4999");
    await load("k new one");

    expect(loadCounts.get("k 0")).toBe(1); // HIT — survived via the LRU touch
    expect(loadCounts.get("k 1")).toBe(2); // MISS — evicted by the 5,001st insert
    expect(loadCounts.get("k 4999")).toBe(1); // HIT — untouched by all this
    expect(loadCounts.get("k new one")).toBe(1); // HIT — the new resident
  });

  it("a throwing loader stores NOTHING — the next call retries live (a transient 500/404 never pins)", async () => {
    const { withCatalogCache } = await importCatalogCache();
    const boom = vi.fn(async () => {
      throw new Error("db down");
    });

    await expect(withCatalogCache("list", "err one", 30, boom)).rejects.toThrow("db down");
    expect(boom).toHaveBeenCalledTimes(1);

    // The same key runs the (now healthy) loader live — nothing was cached
    // by the failure, so no error response can be pinned for 30-60s.
    const okLoader = vi.fn(async () => ({ ok: true }));
    const result = await withCatalogCache("list", "err one", 30, okLoader);
    expect(result).toEqual({ ok: true });
    expect(okLoader).toHaveBeenCalledTimes(1);
  });

  it("a null loader result is a permanent miss (null ≡ not-cached) — the flash-sale shape", async () => {
    const { withCatalogCache } = await importCatalogCache();
    // getActiveFlashSale() resolves null when no sale is running — the exact
    // shape the "flash-sale" scope stores. cacheWrap treats a null read as a
    // miss, so EVERY call re-runs the loader (the entry is overwritten in
    // place, so this costs a re-query, not LRU growth). Pinned as-is — the
    // R111 byte budget preserves this contract (a null-sized overwrite
    // charges ~64 bytes).
    const loader = vi.fn(async () => null);

    const first = await withCatalogCache("flash-sale", "active", 30, loader);
    const second = await withCatalogCache("flash-sale", "active", 30, loader);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
