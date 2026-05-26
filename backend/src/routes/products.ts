import { db, inventoryTable, ordersTable, productsTable } from "@workspace/db";
import { applyFlashSale } from "../lib/pricing";
import { and, count, eq, min, sql } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { intParam } from "../lib/http";
import { ErrorCode, createErrorResponse } from "../lib/errors";

const router = Router();

/**
 * Edge-cacheable Cache-Control header for public read endpoints.
 *
 *   max-age=0                       — browsers always revalidate (React Query
 *                                     handles client-side freshness explicitly)
 *   s-maxage=<seconds>              — CDN/edge proxy caches for this window
 *   stale-while-revalidate=<window> — edge can serve stale up to this window
 *                                     while revalidating in the background
 *
 * Render's edge honours s-maxage. For routes that change rarely (catalog),
 * 60s edge cache + 300s SWR collapses ~80% of read traffic from Postgres at
 * the cost of at most 60s staleness. Flash-sale countdown gets a tighter
 * 30/60 because the visible countdown ticks faster.
 */
function cacheable(maxSec: number, swrSec: number) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.set(
      "Cache-Control",
      `public, max-age=0, s-maxage=${maxSec}, stale-while-revalidate=${swrSec}`,
    );
    next();
  };
}

export const catalogCache = cacheable(60, 300);
export const flashSaleCache = cacheable(30, 60);

/**
 * Public-facing flash-sale shape used by /api/products,
 * /api/products/flash-sale and the frontend banner. Underlying lookup
 * is delegated to lib/pricing.ts so the math + lookup criteria stay
 * in lockstep with the order pipeline and the admin calculator.
 */
async function getActiveFlashSale(): Promise<{
  id: number;
  title: string;
  discount_percent: number;
  ends_at: string;
} | null> {
  const { flashSale } = await applyFlashSale(0);
  if (!flashSale) return null;
  return {
    id: flashSale.id,
    title: flashSale.title,
    discount_percent: flashSale.discountPercent,
    ends_at: flashSale.endsAt,
  };
}

router.get("/", catalogCache, async (req, res) => {
  const { category, available_only, sort, search } = req.query;

  // Build SQL filter conditions — pushdown to the database.
  const conditions = [eq(productsTable.isActive, true), eq(productsTable.isArchived, false)];
  if (typeof category === "string" && category.trim()) {
    conditions.push(sql`LOWER(${productsTable.category}) = LOWER(${category.trim()})`);
  }
  if (typeof search === "string" && search.trim()) {
    conditions.push(sql`${productsTable.name} ILIKE ${"%" + search.trim() + "%"}`);
  }

  // Aggregate stock + order counts as a single subquery join, no JS-side reduce.
  const stockSub = db
    .select({
      productId: inventoryTable.productId,
      stockCount: sql<number>`COUNT(*)::int`.as("stock_count"),
    })
    .from(inventoryTable)
    .where(eq(inventoryTable.isSold, false))
    .groupBy(inventoryTable.productId)
    .as("stock_sub");

  const orderSub = db
    .select({
      productId: ordersTable.productId,
      orderCount: sql<number>`COUNT(*)::int`.as("order_count"),
    })
    .from(ordersTable)
    .where(eq(ordersTable.status, "completed"))
    .groupBy(ordersTable.productId)
    .as("order_sub");

  const stockExpr = sql<number>`COALESCE(${stockSub.stockCount}, 0)`;
  const orderExpr = sql<number>`COALESCE(${orderSub.orderCount}, 0)`;

  if (available_only === "true") {
    conditions.push(sql`COALESCE(${stockSub.stockCount}, 0) > 0`);
  }

  let query = db
    .select({
      id: productsTable.id,
      slug: productsTable.slug,
      name: productsTable.name,
      description: productsTable.description,
      imageUrl: productsTable.imageUrl,
      price: productsTable.price,
      category: productsTable.category,
      isActive: productsTable.isActive,
      usageTerms: productsTable.usageTerms,
      stockCount: stockExpr,
      orderCount: orderExpr,
    })
    .from(productsTable)
    .leftJoin(stockSub, eq(stockSub.productId, productsTable.id))
    .leftJoin(orderSub, eq(orderSub.productId, productsTable.id))
    .where(and(...conditions))
    .$dynamic();

  if (sort === "price_asc") query = query.orderBy(productsTable.price);
  else if (sort === "price_desc") query = query.orderBy(sql`${productsTable.price} DESC`);
  else if (sort === "popular") query = query.orderBy(sql`${orderExpr} DESC`);
  else query = query.orderBy(sql`${productsTable.id} DESC`);

  const [rows, flashSale] = await Promise.all([query, getActiveFlashSale()]);
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;

  const result = rows.map((p) => {
    const basePrice = parseFloat(String(p.price));
    const salePrice =
      discountPercent > 0 ? +(basePrice * (1 - discountPercent / 100)).toFixed(2) : null;
    const stockCount = Number(p.stockCount ?? 0);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      image_url: p.imageUrl,
      price: basePrice,
      category: p.category,
      is_active: p.isActive,
      usage_terms: p.usageTerms,
      stock_count: stockCount,
      is_available: stockCount > 0,
      sale_price: salePrice,
      discount_percent: discountPercent > 0 ? discountPercent : null,
      order_count: Number(p.orderCount ?? 0),
    };
  });

  return res.json(result);
});

export async function getProductStatsHandler(_req: Request, res: Response) {
  // Aggregate everything in SQL — no in-memory spread, no full table scan in JS.
  const [[{ totalProducts, lowestPrice }], [{ totalUnits }], inventoryCounts, flashSale] =
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
        .from(inventoryTable),
      db
        .select({ productId: inventoryTable.productId })
        .from(inventoryTable)
        .where(eq(inventoryTable.isSold, false))
        .groupBy(inventoryTable.productId),
      getActiveFlashSale(),
    ]);

  return res.json({
    total_products: Number(totalProducts ?? 0),
    available_products: inventoryCounts.length,
    total_units: Number(totalUnits ?? 0),
    lowest_price:
      lowestPrice !== null && lowestPrice !== undefined ? parseFloat(String(lowestPrice)) : null,
    has_flash_sale: !!flashSale,
  });
}

export async function getFlashSaleHandler(_req: Request, res: Response) {
  const flashSale = await getActiveFlashSale();
  return res.json({ flash_sale: flashSale });
}

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
  const slug = String(req.params.slug ?? "").trim().toLowerCase();
  if (!slug || slug.length > 160) {
    return res.status(400).json(createErrorResponse("معرف المنتج غير صالح", ErrorCode.INVALID_DATA));
  }

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.slug, slug), eq(productsTable.isArchived, false)))
    .limit(1);

  if (!product) return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const [stockResult] = await db
    .select({ count: count() })
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, product.id), eq(inventoryTable.isSold, false)));

  const [orderResult] = await db
    .select({ count: count() })
    .from(ordersTable)
    .where(and(eq(ordersTable.productId, product.id), eq(ordersTable.status, "completed")));

  const flashSale = await getActiveFlashSale();
  const basePrice = parseFloat(String(product.price));
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
  const salePrice =
    discountPercent > 0 ? +(basePrice * (1 - discountPercent / 100)).toFixed(2) : null;
  const stockCount = Number(stockResult?.count ?? 0);

  return res.json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: basePrice,
    category: product.category,
    is_active: product.isActive,
    usage_terms: product.usageTerms,
    stock_count: stockCount,
    is_available: stockCount > 0,
    sale_price: salePrice,
    discount_percent: discountPercent > 0 ? discountPercent : null,
    order_count: Number(orderResult?.count ?? 0),
  });
});

router.get("/:id", catalogCache, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, id), eq(productsTable.isArchived, false)))
    .limit(1);

  if (!product) return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const [stockResult] = await db
    .select({ count: count() })
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, id), eq(inventoryTable.isSold, false)));

  const [orderResult] = await db
    .select({ count: count() })
    .from(ordersTable)
    .where(and(eq(ordersTable.productId, id), eq(ordersTable.status, "completed")));

  const flashSale = await getActiveFlashSale();
  const basePrice = parseFloat(String(product.price));
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
  const salePrice =
    discountPercent > 0 ? +(basePrice * (1 - discountPercent / 100)).toFixed(2) : null;
  const stockCount = Number(stockResult?.count ?? 0);

  return res.json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: basePrice,
    category: product.category,
    is_active: product.isActive,
    usage_terms: product.usageTerms,
    stock_count: stockCount,
    is_available: stockCount > 0,
    sale_price: salePrice,
    discount_percent: discountPercent > 0 ? discountPercent : null,
    order_count: Number(orderResult?.count ?? 0),
  });
});

// ── /api/products/by-slug/:slug ─────────────────────────────────────────────
// SEO-friendly product lookup. Used by the new /product/<slug> frontend
// route + sitemap-driven crawler hits. Same response shape as /:id so
// the frontend can swap the URL pattern transparently.
//
// Mounted BEFORE /:id at the parent /products router level so Express's
// route matcher hits "by-slug" before the numeric :id catch-all.
router.get("/:id/recommendations", catalogCache, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [product] = await db
    .select({ category: productsTable.category })
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);

  if (!product) return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const recommendations = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      imageUrl: productsTable.imageUrl,
      price: productsTable.price,
    })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.category, product.category as string),
        eq(productsTable.isActive, true),
        eq(productsTable.isArchived, false),
        sql`${productsTable.id} != ${id}`,
      ),
    )
    .limit(4);

  return res.json(
    recommendations.map((r) => ({
      id: r.id,
      name: r.name,
      image_url: r.imageUrl,
      price: parseFloat(String(r.price)),
    })),
  );
});

export { router as productsRouter };
