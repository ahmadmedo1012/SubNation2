// R136 (BE-3 extraction): moved verbatim from routes/products.ts — the
// edge-cache Cache-Control middleware factory (`cacheable`).
// routes/products.ts keeps the catalogCache/flashSaleCache instances
// (routes/index.ts re-mounts them at /catalog/stats + /flash-sale) and
// now imports the factory from here.
import type { NextFunction, Request, Response } from "express";

/**
 * Edge-cacheable Cache-Control header for public read endpoints.
 *
 *   max-age=0                       — browsers always revalidate (React Query
 *                                     handles client-side freshness explicitly)
 *   s-maxage=<seconds>              — CDN/edge proxy caches for this window
 *   stale-while-revalidate=<window> — edge can serve stale up to this window
 *                                     while revalidating in the background
 *
 * The CDN edge (Cloudflare, proxied) honours s-maxage. For routes that
 * change rarely (catalog), 60s edge cache + 300s SWR collapses ~80% of
 * read traffic from Postgres at the cost of at most 60s staleness.
 * Flash-sale countdown gets a tighter 30/60 because the visible countdown
 * ticks faster.
 */
export function cacheable(maxSec: number, swrSec: number) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.set(
      "Cache-Control",
      `public, max-age=0, s-maxage=${maxSec}, stale-while-revalidate=${swrSec}`,
    );
    next();
  };
}
