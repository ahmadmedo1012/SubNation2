import { db, inventoryTable, productsTable } from "@workspace/db";
import { withCatalogCache } from "../lib/catalog-cache";
import { fireThrottledMaintenance } from "../lib/opportunistic";
import { deactivateExpiredFlashSales } from "../jobs/flashSaleWatcher";
import { and, count, eq, min, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { intParam } from "../lib/http";
import { ErrorCode, createErrorResponse } from "../lib/errors";
// R136 (BE-3 extraction): the catalog service moved verbatim to
// services/catalog.service.ts (variant DTO machinery, detail DTO
// builders, the public list loader with Arabic-search expansion +
// relevance tiers, and the detail/recommendation cached loaders); the
// `cacheable` middleware factory moved verbatim to lib/http-cache.ts.
// This file keeps the thin route handlers and the
// getProductStatsHandler/getFlashSaleHandler/catalogCache/flashSaleCache
// exports routes/index.ts re-mounts at /catalog/stats + /flash-sale.
import { cacheable } from "../lib/http-cache";
import {
  deliverableUnitCondition,
  getActiveFlashSale,
  loadProductDetailById,
  loadProductDetailBySlug,
  loadProductList,
  loadProductRecommendations,
} from "../services/catalog.service";

const router = Router();

export const catalogCache = cacheable(60, 300);
export const flashSaleCache = cacheable(30, 60);

router.get("/", catalogCache, async (req, res) => {
  const { category, available_only, sort, search, fields } = req.query;

  // R104 (AG5-7): 30 s in-process response cache keyed by the validated
  // filter combo — the single most-repeated query set in the app (every
  // home/category page view + crawler hit). 200-only via loader-throw
  // semantics; admin CRUD bumps the generation. See lib/catalog-cache.ts
  // for the full safety analysis.
  // RT-1 (R104 red team): the KEY must be built from the SAME
  // normalized values the loader actually acts on — sort folds to the
  // 4-value whitelist (anything else = the default branch), search is
  // lowercased (the ILIKE is case-insensitive). Otherwise unique garbage
  // (?sort=<random>) mints a fresh full-payload LRU entry per request.
  const normalizedSort =
    sort === "price_asc" || sort === "price_desc" || sort === "popular" ? sort : "";
  // A2-F3 (R124): the projection is part of the loader's behavior, so
  // it belongs in the cache key (RT-1 discipline) — "list" and full
  // payloads are distinct cached shapes.
  const listView = fields === "list";
  const cacheKey = JSON.stringify([
    typeof category === "string" ? category.trim().toLowerCase() : "",
    typeof search === "string" ? search.trim().toLowerCase() : "",
    normalizedSort,
    available_only === "true",
    listView,
  ]);

  // B6-02 (R111, audit B6): the search key space is UNBOUNDED — every
  // unique ?search= mints a fresh LRU entry holding the FULL list payload
  // (~100-300 KB each), and the 5,000-entry LRU could hold 0.5-1.5 GB on
  // a 512 MB container via an unauthenticated route (self-DoS). The
  // no-search key space is bounded by construction (category slug ×
  // 4-value sort whitelist × available_only), so ONLY that shape is
  // cached. Search requests always run live — the ILIKE + LIMIT 500
  // query measured 6.5 ms on live data volumes, well within budget.
  const hasSearch = typeof search === "string" && search.trim().length > 0;

  // I-3 (R142, B6-02 edge parity): search responses stay uncacheable at
  // the EDGE too. catalogCache above stamps every list response with
  // `public, s-maxage=60, stale-while-revalidate=300`; an edge rule
  // honoring it would mint an unbounded ?search= key space (the exact
  // class B6-02 removed in-process) plus 60 s-stale results. Override
  // for the search shape — the house no-store value.
  if (hasSearch) res.set("Cache-Control", "no-store");

  // R136 (BE-3 extraction): the loader body moved verbatim to
  // services/catalog.service.ts (loadProductList). The route narrows the
  // raw query values to the same locals the inline closure captured.
  const loader = () =>
    loadProductList({
      category: typeof category === "string" ? category : undefined,
      search: typeof search === "string" ? search : undefined,
      hasSearch,
      availableOnly: available_only === "true",
      sort: typeof sort === "string" ? sort : undefined,
      listView,
    });

  const result = hasSearch ? await loader() : await withCatalogCache("list", cacheKey, 30, loader);

  return res.json(result);
});

export async function getProductStatsHandler(_req: Request, res: Response) {
  // R104 (AG5-7): 60 s in-process cache — the stats row is 4 aggregate
  // queries for a payload the client already treats as 10-min-fresh.
  // Admin CRUD bumps the generation (see lib/catalog-cache.ts).
  const payload = await withCatalogCache("stats", "stats", 60, async () => {
    // Aggregate everything in SQL — no in-memory spread, no full table scan in JS.
    // Round-3 (8-c §3.3): `available_products` used to fetch one row per
    // stocked product into JS just to take `.length` — COUNT(DISTINCT)
    // computes it in the database in one row.
    const [[{ totalProducts, lowestPrice }], [{ totalUnits }], [{ availableProducts }], flashSale] =
      await Promise.all([
        db
          .select({
            totalProducts: count(),
            lowestPrice: min(productsTable.price),
          })
          .from(productsTable)
          .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false))),
        db
          .select({
            totalUnits: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryTable.isSold} = false THEN 1 ELSE 0 END), 0)::int`,
          })
          .from(inventoryTable)
          // R102: total units = deliverable units (matches the public
          // stock definition — ghost rows don't count).
          .where(deliverableUnitCondition()),
        db
          .select({
            availableProducts: sql<number>`COUNT(DISTINCT ${inventoryTable.productId})::int`,
          })
          .from(inventoryTable)
          // R102: available products = ACTIVE, non-archived products with
          // deliverable stock. It used to count archived products too — the
          // live stats said "2 available" while both were archived TEST
          // artifacts invisible to the storefront.
          .innerJoin(
            productsTable,
            and(
              eq(productsTable.id, inventoryTable.productId),
              eq(productsTable.isActive, true),
              eq(productsTable.isArchived, false),
            ),
          )
          .where(and(eq(inventoryTable.isSold, false), deliverableUnitCondition())),
        getActiveFlashSale(),
      ]);

    return {
      total_products: Number(totalProducts ?? 0),
      available_products: Number(availableProducts ?? 0),
      total_units: Number(totalUnits ?? 0),
      lowest_price:
        lowestPrice !== null && lowestPrice !== undefined ? parseFloat(String(lowestPrice)) : null,
      has_flash_sale: !!flashSale,
    };
  });

  return res.json(payload);
}

export async function getFlashSaleHandler(_req: Request, res: Response) {
  // 2026-09-20 (free-infrastructure round): the flash-sale surface is
  // one of the two REAL-traffic triggers for the expired-sale sweep
  // (was a 5-minute interval timer). Throttled to 10 min in-process;
  // fire-and-forget so the read never waits on the UPDATE. The read
  // itself already reflects expiry via getActiveFlashSale's
  // `is_active AND ends_at > now()` predicate — the sweep only keeps
  // is_active honest for the admin list + the singleton index.
  fireThrottledMaintenance("flash-sale-sweep", 10 * 60 * 1000, deactivateExpiredFlashSales);
  // R104 (AG5-3): 30 s in-process cache — this endpoint is hit by the
  // site-wide banner (now a 10-min adaptive poll, but still the
  // most-shared response in the app) and by the flash-sales page.
  // The read predicate (`is_active AND ends_at > now()`) plus the
  // generation bump on admin flash-sale writes bound staleness.
  const payload = await withCatalogCache("flash-sale", "active", 30, getActiveFlashSale);
  return res.json({ flash_sale: payload });
}

// R166-B12: both URL forms are FIRST-CLASS public mounts — these canonical
// /api/products/{stats,flash-sale} mounts and the /api/catalog/stats +
// /api/flash-sale aliases (routes/index.ts) share the same handlers and
// edge-cache windows; the SPA merely happens to consume the alias forms.
router.get("/stats", catalogCache, getProductStatsHandler);
router.get("/flash-sale", flashSaleCache, getFlashSaleHandler);

// ── /api/products/by-slug/:slug ─────────────────────────────────────────────
// SEO-friendly product lookup. Used by the new /product/<slug> frontend
// route + sitemap-driven crawler hits. Same response shape as /:id so
// the frontend can swap the URL pattern transparently.
//
// MUST be registered BEFORE /:id — Express does first-match routing, so
// without this ordering /by-slug/foo would match /:id with id="foo" and
// return 400 from the intParam guard.
router.get("/by-slug/:slug", catalogCache, async (req, res) => {
  const slug = String(req.params.slug ?? "")
    .trim()
    .toLowerCase();
  if (!slug || slug.length > 160) {
    return res
      .status(400)
      .json(createErrorResponse("معرف المنتج غير صالح", ErrorCode.INVALID_DATA));
  }

  // R104 (AG5-7): 60 s in-process cache, 200-ONLY (a pinned 404 would
  // hide a freshly published product). Admin CRUD bumps the generation.
  // R136 (BE-3 extraction): the loader body moved verbatim to
  // services/catalog.service.ts (loadProductDetailBySlug).
  const cached = await withCatalogCache("detail-by-slug", slug, 60, () =>
    loadProductDetailBySlug(slug),
  );

  if (!cached.found)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
  return res.json(cached.dto);
});

router.get("/:id", catalogCache, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // R104 (AG5-7): 60 s in-process cache, 200-ONLY (same shape contract
  // as /by-slug above). R136 (BE-3 extraction): the loader body moved
  // verbatim to services/catalog.service.ts (loadProductDetailById).
  const cached = await withCatalogCache("detail-by-id", String(id), 60, () =>
    loadProductDetailById(id),
  );

  if (!cached.found)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
  return res.json(cached.dto);
});

// ── /api/products/:id/recommendations ────────────────────────────────────────
// Same-brand fallback list for the PDP ("منتجات ذات صلة"). R104 (AG5-7):
// 60 s in-process catalog cache, 200-only — the same contract as the
// detail endpoints above.
router.get("/:id/recommendations", catalogCache, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // R104 (AG5-7): 60 s in-process cache, 200-only (same contract as the
  // detail endpoints). R136 (BE-3 extraction): the loader body moved
  // verbatim to services/catalog.service.ts (loadProductRecommendations).
  const cached = await withCatalogCache("recommendations", String(id), 60, () =>
    loadProductRecommendations(id),
  );

  if (!cached.found)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
  return res.json(cached.items);
});

export { router as productsRouter };
