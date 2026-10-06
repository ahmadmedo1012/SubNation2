import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-2 (R118-A6) — cacheWrap single-flight regression suite.
 *
 * Until R118, cacheWrap had NO in-flight dedup: concurrent misses on the
 * same key each ran the loader (the catalog list loader alone is 4
 * queries), so every catalog TTL expiry (30 s) or bumpCatalogCache()
 * generation bump turned N concurrent requests into an N× loader burst
 * precisely at the moment of an admin edit. The fix adds a per-process
 * `Map<string, Promise<unknown>>` registry: the first miss stores its
 * loader promise, same-key missers await the shared promise, and the
 * entry is deleted in a `finally` before the promise settles.
 *
 * Pinned here:
 *   1. concurrent same-key misses → loader invoked EXACTLY once, both
 *      callers receive the same value (incl. a 25-way stampede);
 *   2. after settle the registry entry is gone (no leak) and the value
 *      is served from cache — single-flight must not break caching;
 *   3. loader failure → the rejection reaches EVERY awaiter, the entry
 *      is cleared, and the next call retries live (nothing pins);
 *   4. different keys never dedupe against each other.
 *
 * Environment: REDIS_URL is unset and initRedisClient() never runs, so
 * cacheWrap exercises its REAL in-memory LRU fallback (same harness
 * shape as catalog-cache.test.ts). The registry is module state, so
 * every test re-imports the module fresh via vi.resetModules().
 */

async function importCache() {
  return import("../cache");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cacheWrap single-flight (F-2, R118-A6)", () => {
  it("two concurrent misses on the same key run the loader exactly once and share the result", async () => {
    const { cacheWrap, __inflightLoadCountForTests } = await importCache();
    const loader = vi.fn(async () => {
      // Hold the load open so the second caller provably arrives while
      // the first is still in flight (not just microtask-adjacent).
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { value: "fresh" };
    });

    const [a, b] = await Promise.all([
      cacheWrap("sf:same-key", 30, loader),
      cacheWrap("sf:same-key", 30, loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ value: "fresh" });
    expect(b).toEqual({ value: "fresh" });
    // The registry entry did not outlive the load (no leak).
    expect(__inflightLoadCountForTests()).toBe(0);
  });

  it("a 25-way stampede on one key still invokes the loader exactly once (the admin-edit burst shape)", async () => {
    const { cacheWrap, __inflightLoadCountForTests } = await importCache();
    const loader = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { products: ["a"], total: 1 };
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => cacheWrap("sf:stampede", 30, loader)),
    );

    expect(loader).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual({ products: ["a"], total: 1 });
    expect(__inflightLoadCountForTests()).toBe(0);
  });

  it("after the shared load settles the entry is removed and the value is served from cache (no stale promise reuse)", async () => {
    const { cacheWrap, __inflightLoadCountForTests, cacheGet } = await importCache();
    const loader = vi.fn(async () => ({ n: 1 }));

    await Promise.all([
      cacheWrap("sf:settle", 60, loader),
      cacheWrap("sf:settle", 60, loader),
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(__inflightLoadCountForTests()).toBe(0);

    // A sequential call after settle is a CACHE hit — the dedup must not
    // have broken the read-through (loader still 1 invocation)…
    const again = await cacheWrap("sf:settle", 60, loader);
    expect(again).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
    // …and the value itself is resident in the cache backend.
    expect(await cacheGet("sf:settle")).toEqual({ n: 1 });

    // After the TTL expires the load re-runs live (a leaked registry
    // entry would keep serving the settled promise forever instead).
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(61_000);
    const refreshed = await cacheWrap("sf:settle", 60, loader);
    expect(refreshed).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(__inflightLoadCountForTests()).toBe(0);
  });

  it("loader failure: both concurrent awaiters see the rejection, the entry is cleared, and the next call retries live", async () => {
    const { cacheWrap, __inflightLoadCountForTests, cacheGet } = await importCache();
    const boom = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("db down");
    });

    // allSettled: both awaiters must RECEIVE the rejection (not one
    // rejection + one swallowed undefined) — and neither rejection may
    // go unhandled.
    const settled = await Promise.allSettled([
      cacheWrap("sf:error", 30, boom),
      cacheWrap("sf:error", 30, boom),
    ]);
    expect(settled[0].status).toBe("rejected");
    expect(settled[1].status).toBe("rejected");
    if (settled[0].status === "rejected")
      expect((settled[0].reason as Error).message).toBe("db down");
    if (settled[1].status === "rejected")
      expect((settled[1].reason as Error).message).toBe("db down");
    expect(boom).toHaveBeenCalledTimes(1);
    expect(__inflightLoadCountForTests()).toBe(0);
    // Nothing was stored by the failure (no error pinning).
    expect(await cacheGet("sf:error")).toBeNull();

    // The same key retries live on the next call — the cleared entry is
    // the guarantee that a transient error never wedges the key.
    const okLoader = vi.fn(async () => ({ ok: true }));
    const recovered = await cacheWrap("sf:error", 30, okLoader);
    expect(recovered).toEqual({ ok: true });
    expect(okLoader).toHaveBeenCalledTimes(1);
  });

  it("different keys never dedupe against each other — both loaders run", async () => {
    const { cacheWrap, __inflightLoadCountForTests } = await importCache();
    const loaderA = vi.fn(async () => ({ key: "a" }));
    const loaderB = vi.fn(async () => ({ key: "b" }));

    const [a, b] = await Promise.all([
      cacheWrap("sf:key-a", 30, loaderA),
      cacheWrap("sf:key-b", 30, loaderB),
    ]);

    expect(a).toEqual({ key: "a" });
    expect(b).toEqual({ key: "b" });
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
    expect(__inflightLoadCountForTests()).toBe(0);
  });
});
