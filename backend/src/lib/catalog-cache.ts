import { cacheWrap } from "./cache";

/**
 * R104 (AG5-3 / AG5-7 / AG10) — in-process TTL cache for the PUBLIC
 * catalog read paths.
 *
 * WHY: the catalog is read-heavy and public, yet every page view and
 * crawler hit reached Postgres (list = 4 queries, stats = 4, flash-sale
 * = 1, detail = 6). On a Render free instance backed by a 0.25 CU Neon
 * compute, that repetition is pure waste — the client already tolerates
 * MORE staleness than this cache adds (React Query staleTime 3 min for
 * the list, 10 min for stats; edge s-maxage=60 on the same routes).
 *
 * SAFETY (AG10 caching-safety verdict, verified at HEAD):
 *   - Price authority is CHECKOUT, never display: the purchase
 *     transaction re-reads product/variant/flash-sale LIVE and rejects
 *     moved state (PRODUCT_STALE / VARIANT_STALE / STALE_FLASH_SALE) —
 *     a stale display can never produce a wrong charge.
 *   - Only 200-shaped payloads are cached (loaders throw → nothing
 *     stored; a transient 500/404 never pins).
 *   - Admin mutations (product/variant CRUD, flash-sale changes,
 *     pricing recompute) call bumpCatalogCache() — a generation
 *     counter that orphans every previous key instantly. The 30-60 s
 *     TTL self-heals anything the bump misses (e.g. stock changes from
 *     purchases: stock DISPLAY is advisory; the atomic inventory claim
 *     at checkout is the authority and always runs LIVE).
 *   - Authenticated/money surfaces (/api/cart, /api/orders, /api/wallet,
 *     everything under /api/admin) are deliberately NOT routed through
 *     this helper.
 *
 * Single-instance note: the generation counter is in-process — correct
 * for the current single-web-instance topology (Render free = 1
 * instance). If a second instance ever appears, the 30-60 s TTL bounds
 * cross-instance staleness; wire cacheWrap's Redis layer (already
 * built) for cross-instance generation bumps at that point.
 */

let generation = 0;

/** Invalidate every catalog cache entry (generation bump). Called by
 * admin product/variant/flash-sale/pricing mutations — mirrors
 * bumpSitemapCache() semantics. */
export function bumpCatalogCache(): void {
  generation += 1;
}

/** Read-through catalog cache: `catalog:{scope}:v{generation}:{key}`. */
export function withCatalogCache<T>(
  scope: string,
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  return cacheWrap(`catalog:${scope}:v${generation}:${key}`, ttlSec, loader);
}
