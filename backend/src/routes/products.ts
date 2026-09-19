import {
  db,
  inventoryTable,
  ordersTable,
  productVariantsTable,
  productsTable,
} from "@workspace/db";
import { applyFlashSale, computeFlashSalePrice } from "../lib/pricing";
import { fireThrottledMaintenance } from "../lib/opportunistic";
import { deactivateExpiredFlashSales } from "../jobs/flashSaleWatcher";
import { and, asc, count, eq, inArray, min, sql } from "drizzle-orm";
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

// ── Variant projection (public DTO contract) ─────────────────────────────
/**
 * Public shape of a catalog variant — deliberately EXCLUDES every
 * internal field (cost_price, sku, supplier identity). The customer
 * sees: which option it is (labels), what it costs (LYD), whether the
 * flash sale discounts it. `is_available` mirrors the PRODUCT's stock
 * state: the fulfillment pool is per-product (variant-scoped units are
 * claimed first, then product-level units), so a variant is sellable
 * exactly when the product has stock.
 */
interface PublicVariantDto {
  id: number;
  plan_label: string | null;
  duration_label: string | null;
  /** Joined display label: "Individual — 3 Months" (single axis: "3 Months"). */
  label: string;
  price: number;
  sale_price: number | null;
  discount_percent: number | null;
  is_available: boolean;
}

/**
 * Load the active variants for a set of products in ONE query, grouped
 * in JS by product_id. Ordered by (sort_order, price) so the selector
 * renders cheapest-first deterministically.
 */
async function loadPublicVariants(
  productIds: number[],
  discountPercent: number,
  productAvailable: (productId: number) => boolean,
): Promise<Map<number, PublicVariantDto[]>> {
  const map = new Map<number, PublicVariantDto[]>();
  if (productIds.length === 0) return map;

  const rows = await db
    .select({
      id: productVariantsTable.id,
      productId: productVariantsTable.productId,
      planLabel: productVariantsTable.planLabel,
      durationLabel: productVariantsTable.durationLabel,
      priceLyd: productVariantsTable.priceLyd,
      sortOrder: productVariantsTable.sortOrder,
      isActive: productVariantsTable.isActive,
    })
    .from(productVariantsTable)
    .where(
      and(
        inArray(productVariantsTable.productId, productIds),
        eq(productVariantsTable.isActive, true),
      ),
    )
    .orderBy(asc(productVariantsTable.sortOrder), asc(productVariantsTable.priceLyd));

  for (const v of rows) {
    const price = parseFloat(String(v.priceLyd));
    const available = productAvailable(v.productId);
    const plan = v.planLabel?.trim() || null;
    const duration = v.durationLabel?.trim() || null;
    const label = [plan, duration].filter(Boolean).join(" — ") || "الخيار الافتراضي";
    const list = map.get(v.productId) ?? [];
    list.push({
      id: v.id,
      plan_label: plan,
      duration_label: duration,
      label,
      price,
      sale_price: discountPercent > 0 ? computeFlashSalePrice(price, discountPercent) : null,
      discount_percent: discountPercent > 0 ? discountPercent : null,
      is_available: available,
    });
    map.set(v.productId, list);
  }
  return map;
}

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
    // Hard ceiling — the storefront renders categories from this list;
    // 500 products is far beyond current catalog size but prevents an
    // unbounded scan if the catalog ever balloons.
    .limit(500)
    .$dynamic();

  if (sort === "price_asc") query = query.orderBy(productsTable.price);
  else if (sort === "price_desc") query = query.orderBy(sql`${productsTable.price} DESC`);
  else if (sort === "popular") query = query.orderBy(sql`${orderExpr} DESC`);
  else query = query.orderBy(sql`${productsTable.id} DESC`);

  const [rows, flashSale] = await Promise.all([query, getActiveFlashSale()]);
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;

  // Variants ride a single follow-up query for the whole page of
  // products (see loadPublicVariants) — kept OUT of the main join so
  // the limit(500) product ceiling stays exact and the hot list query
  // shape is unchanged for variant-less catalogs.
  const stockByProduct = new Map(rows.map((p) => [p.id, Number(p.stockCount ?? 0)]));
  const variantsByProduct = await loadPublicVariants(
    rows.map((p) => p.id),
    discountPercent,
    (pid) => (stockByProduct.get(pid) ?? 0) > 0,
  );

  const result = rows.map((p) => {
    const basePrice = parseFloat(String(p.price));
    const stockCount = Number(p.stockCount ?? 0);
    const variants = variantsByProduct.get(p.id) ?? [];
    // "تبدأ من" semantics: when variants exist, the card price is the
    // cheapest active variant's LYD price — the import maintains
    // products.price = MIN(variants.price_lyd) so both agree. The flash
    // sale is applied exactly ONCE on that base (per-variant sale prices
    // are already computed by loadPublicVariants and stay authoritative
    // for the detail page selector).
    const displayBase = variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : basePrice;
    const displayPrice =
      discountPercent > 0 ? computeFlashSalePrice(displayBase, discountPercent) : displayBase;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      image_url: p.imageUrl,
      price: displayBase,
      price_from: variants.length > 1,
      category: p.category,
      is_active: p.isActive,
      usage_terms: p.usageTerms,
      stock_count: stockCount,
      is_available: stockCount > 0,
      sale_price: discountPercent > 0 ? displayPrice : null,
      discount_percent: discountPercent > 0 ? discountPercent : null,
      order_count: Number(p.orderCount ?? 0),
      variants: variants.map((v) => ({
        id: v.id,
        plan_label: v.plan_label,
        duration_label: v.duration_label,
        label: v.label,
        price: v.price,
        sale_price: v.sale_price,
        discount_percent: v.discount_percent,
        is_available: v.is_available,
      })),
    };
  });

  return res.json(result);
});

export async function getProductStatsHandler(_req: Request, res: Response) {
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
        .from(inventoryTable),
      db
        .select({
          availableProducts: sql<number>`COUNT(DISTINCT ${inventoryTable.productId})::int`,
        })
        .from(inventoryTable)
        .where(eq(inventoryTable.isSold, false)),
      getActiveFlashSale(),
    ]);

  return res.json({
    total_products: Number(totalProducts ?? 0),
    available_products: Number(availableProducts ?? 0),
    total_units: Number(totalUnits ?? 0),
    lowest_price:
      lowestPrice !== null && lowestPrice !== undefined ? parseFloat(String(lowestPrice)) : null,
    has_flash_sale: !!flashSale,
  });
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
  const slug = String(req.params.slug ?? "")
    .trim()
    .toLowerCase();
  if (!slug || slug.length > 160) {
    return res
      .status(400)
      .json(createErrorResponse("معرف المنتج غير صالح", ErrorCode.INVALID_DATA));
  }

  // Round-3 (8-c §2.6): 4 sequential round trips → 2. The flash-sale row
  // doesn't depend on the product, so it rides the first Promise.all;
  // stock + order counts ride the second. Also routes the sale-price
  // arithmetic through computeFlashSalePrice (lib/pricing single source
  // — this file previously carried a 4th copy of the formula).
  const [[product], flashSale] = await Promise.all([
    db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.slug, slug), eq(productsTable.isArchived, false)))
      .limit(1),
    getActiveFlashSale(),
  ]);

  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const [[stockResult], [orderResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(inventoryTable)
      .where(and(eq(inventoryTable.productId, product.id), eq(inventoryTable.isSold, false))),
    db
      .select({ count: count() })
      .from(ordersTable)
      .where(and(eq(ordersTable.productId, product.id), eq(ordersTable.status, "completed"))),
  ]);

  const basePrice = parseFloat(String(product.price));
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
  const stockCount = Number(stockResult?.count ?? 0);
  const variants =
    (await loadPublicVariants([product.id], discountPercent, () => stockCount > 0)).get(
      product.id,
    ) ?? [];
  const displayBase = variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : basePrice;
  const salePrice =
    discountPercent > 0 ? computeFlashSalePrice(displayBase, discountPercent) : null;

  return res.json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    description_long: product.descriptionLong ?? null,
    faq: product.faq ?? null,
    seo_title: product.seoTitle ?? null,
    features: product.features ?? null,
    seo_description: product.seoDescription ?? null,
    image_url: product.imageUrl,
    price: displayBase,
    price_from: variants.length > 1,
    category: product.category,
    is_active: product.isActive,
    usage_terms: product.usageTerms,
    stock_count: stockCount,
    is_available: stockCount > 0,
    sale_price: salePrice,
    discount_percent: discountPercent > 0 ? discountPercent : null,
    order_count: Number(orderResult?.count ?? 0),
    variants: variants.map((v) => ({
      id: v.id,
      plan_label: v.plan_label,
      duration_label: v.duration_label,
      label: v.label,
      price: v.price,
      sale_price: v.sale_price,
      discount_percent: v.discount_percent,
      is_available: v.is_available,
    })),
  });
});

router.get("/:id", catalogCache, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // Round-3 (8-c §2.6): same 4→2 parallelization as /by-slug above.
  const [[product], flashSale] = await Promise.all([
    db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.id, id), eq(productsTable.isArchived, false)))
      .limit(1),
    getActiveFlashSale(),
  ]);

  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const [[stockResult], [orderResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(inventoryTable)
      .where(and(eq(inventoryTable.productId, id), eq(inventoryTable.isSold, false))),
    db
      .select({ count: count() })
      .from(ordersTable)
      .where(and(eq(ordersTable.productId, id), eq(ordersTable.status, "completed"))),
  ]);

  const basePrice = parseFloat(String(product.price));
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
  const stockCount = Number(stockResult?.count ?? 0);
  const variants =
    (await loadPublicVariants([product.id], discountPercent, () => stockCount > 0)).get(
      product.id,
    ) ?? [];
  const displayBase = variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : basePrice;
  const salePrice =
    discountPercent > 0 ? computeFlashSalePrice(displayBase, discountPercent) : null;

  return res.json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    description_long: product.descriptionLong ?? null,
    faq: product.faq ?? null,
    seo_title: product.seoTitle ?? null,
    features: product.features ?? null,
    seo_description: product.seoDescription ?? null,
    image_url: product.imageUrl,
    price: displayBase,
    price_from: variants.length > 1,
    category: product.category,
    is_active: product.isActive,
    usage_terms: product.usageTerms,
    stock_count: stockCount,
    is_available: stockCount > 0,
    sale_price: salePrice,
    discount_percent: discountPercent > 0 ? discountPercent : null,
    order_count: Number(orderResult?.count ?? 0),
    variants: variants.map((v) => ({
      id: v.id,
      plan_label: v.plan_label,
      duration_label: v.duration_label,
      label: v.label,
      price: v.price,
      sale_price: v.sale_price,
      discount_percent: v.discount_percent,
      is_available: v.is_available,
    })),
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
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [product] = await db
    .select({ category: productsTable.category })
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);

  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

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
