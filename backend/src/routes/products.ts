import {
  db,
  inventoryTable,
  ordersTable,
  productVariantsTable,
  productsTable,
} from "@workspace/db";
import { applyFlashSale, computeFlashSalePrice } from "../lib/pricing";
import { withCatalogCache } from "../lib/catalog-cache";
import { fireThrottledMaintenance } from "../lib/opportunistic";
import { deactivateExpiredFlashSales } from "../jobs/flashSaleWatcher";
import { and, asc, count, eq, inArray, isNotNull, min, or, sql } from "drizzle-orm";
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
 * flash sale discounts it.
 *
 * R102 (inventory truthfulness): `is_available` is now VARIANT-scoped,
 * mirroring the checkout claim's two-pool semantics exactly — a variant
 * is sellable when its own scoped pool has a deliverable unit OR the
 * product's generic pool (variant_id IS NULL) has one. (It used to
 * mirror the PRODUCT-level stock flag, which misled once variant-scoped
 * pools exist: an option with zero scoped stock showed available and
 * failed at checkout.)
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
 * R102 (inventory truthfulness): a unit counts as STOCK only when it is
 * DELIVERABLE — at least one credential field present (email, password,
 * or extra details). Checkout's R93-DATA gate refuses to sell a unit with
 * zero credential fields (INVENTORY_CORRUPT at pay time), so counting
 * such rows as stock advertised availability the platform could never
 * honor (the copilot +N ghost-stock incident class). Decryption health
 * stays a checkout-time concern — SQL can't see GCM auth failures.
 */
const deliverableUnitCondition = () =>
  or(
    isNotNull(inventoryTable.accountPassword),
    isNotNull(inventoryTable.accountEmail),
    isNotNull(inventoryTable.extraDetails),
  );

/**
 * Load the active variants for a set of products in ONE query, grouped
 * in JS by product_id. Ordered by (sort_order, price) so the selector
 * renders cheapest-first deterministically. R102: availability is
 * computed here per-variant from the SAME two-pool semantics the
 * checkout claim uses (variant-scoped first, then generic) — the
 * product-level callback parameter is gone.
 */
async function loadPublicVariants(
  productIds: number[],
  discountPercent: number,
): Promise<Map<number, PublicVariantDto[]>> {
  const map = new Map<number, PublicVariantDto[]>();
  if (productIds.length === 0) return map;

  const [rows, stockRows] = await Promise.all([
    db
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
      .orderBy(asc(productVariantsTable.sortOrder), asc(productVariantsTable.priceLyd)),
    // R102: per-pool deliverable stock counts — (product, variant) scoped
    // pools plus the generic (variant_id IS NULL) pool per product.
    db
      .select({
        productId: inventoryTable.productId,
        variantId: inventoryTable.variantId,
        stockCount: sql<number>`COUNT(*)::int`.as("stock_count"),
      })
      .from(inventoryTable)
      .where(
        and(
          inArray(inventoryTable.productId, productIds),
          eq(inventoryTable.isSold, false),
          deliverableUnitCondition(),
        ),
      )
      .groupBy(inventoryTable.productId, inventoryTable.variantId),
  ]);

  const genericByProduct = new Map<number, number>();
  const scopedByVariant = new Map<number, number>();
  for (const s of stockRows) {
    if (s.variantId === null) {
      genericByProduct.set(s.productId, (genericByProduct.get(s.productId) ?? 0) + s.stockCount);
    } else {
      scopedByVariant.set(s.variantId, (scopedByVariant.get(s.variantId) ?? 0) + s.stockCount);
    }
  }

  for (const v of rows) {
    const price = parseFloat(String(v.priceLyd));
    // Two-pool availability, mirroring the checkout claim exactly.
    const available =
      (scopedByVariant.get(v.id) ?? 0) > 0 || (genericByProduct.get(v.productId) ?? 0) > 0;
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
  const cacheKey = JSON.stringify([
    typeof category === "string" ? category.trim().toLowerCase() : "",
    typeof search === "string" ? search.trim().toLowerCase() : "",
    normalizedSort,
    available_only === "true",
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
  const loader = async () => {
    // Build SQL filter conditions — pushdown to the database.
    const conditions = [eq(productsTable.isActive, true), eq(productsTable.isArchived, false)];
    if (typeof category === "string" && category.trim()) {
      conditions.push(sql`LOWER(${productsTable.category}) = LOWER(${category.trim()})`);
    }
    if (hasSearch) {
      conditions.push(sql`${productsTable.name} ILIKE ${"%" + search.trim() + "%"}`);
    }

    // Aggregate stock + order counts as a single subquery join, no JS-side reduce.
    // R102 (inventory truthfulness): stock counts DELIVERABLE units only
    // (≥1 credential field) — matches what checkout can actually sell.
    const stockSub = db
      .select({
        productId: inventoryTable.productId,
        stockCount: sql<number>`COUNT(*)::int`.as("stock_count"),
      })
      .from(inventoryTable)
      .where(and(eq(inventoryTable.isSold, false), deliverableUnitCondition()))
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
    const variantsByProduct = await loadPublicVariants(
      rows.map((p) => p.id),
      discountPercent,
    );

    const products = rows.map((p) => {
      const basePrice = parseFloat(String(p.price));
      const stockCount = Number(p.stockCount ?? 0);
      const variants = variantsByProduct.get(p.id) ?? [];
      // "تبدأ من" semantics: when variants exist, the card price is the
      // cheapest active variant's LYD price — the import maintains
      // products.price = MIN(variants.price_lyd) so both agree. The flash
      // sale is applied exactly ONCE on that base (per-variant sale prices
      // are already computed by loadPublicVariants and stay authoritative
      // for the detail page selector).
      const displayBase =
        variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : basePrice;
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

    return products;
  };

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
  const cached = await withCatalogCache("detail-by-slug", slug, 60, async () => {
    // Round-3 (8-c §2.6): 4 sequential round trips → 2. The flash-sale row
    // doesn't depend on the product, so it rides the first Promise.all;
    // stock + order counts ride the second. Also routes the sale-price
    // arithmetic through computeFlashSalePrice (lib/pricing single source
    // — this file previously carried a 4th copy of the formula).
    const [[product], flashSale] = await Promise.all([
      db
        .select()
        .from(productsTable)
        .where(
          and(
            eq(productsTable.slug, slug),
            // 110-F (R110 — 109-n P3): the detail routes filtered only
            // is_archived, so a deactivated product (is_active=false)
            // stayed fetchable by slug while the list route/sitemap
            // already hid it. Mirror the list WHERE — deactivated now
            // 404s exactly like archived (same for the /:id route below).
            eq(productsTable.isActive, true),
            eq(productsTable.isArchived, false),
          ),
        )
        .limit(1),
      getActiveFlashSale(),
    ]);

    if (!product) return { found: false as const };

    const [[stockResult], [orderResult]] = await Promise.all([
      db
        .select({ count: count() })
        .from(inventoryTable)
        .where(
          and(
            eq(inventoryTable.productId, product.id),
            eq(inventoryTable.isSold, false),
            deliverableUnitCondition(),
          ),
        ),
      db
        .select({ count: count() })
        .from(ordersTable)
        .where(and(eq(ordersTable.productId, product.id), eq(ordersTable.status, "completed"))),
    ]);

    const basePrice = parseFloat(String(product.price));
    const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
    const stockCount = Number(stockResult?.count ?? 0);
    const variants =
      (await loadPublicVariants([product.id], discountPercent)).get(product.id) ?? [];
    const displayBase = variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : basePrice;
    const salePrice =
      discountPercent > 0 ? computeFlashSalePrice(displayBase, discountPercent) : null;

    return {
      found: true as const,
      dto: {
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
      },
    };
  });

  if (!cached.found)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
  return res.json(cached.dto);
});

router.get("/:id", catalogCache, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // R104 (AG5-7): 60 s in-process cache, 200-ONLY (same shape contract
  // as /by-slug above).
  const cached = await withCatalogCache("detail-by-id", String(id), 60, async () => {
    // Round-3 (8-c §2.6): same 4→2 parallelization as /by-slug above.
    const [[product], flashSale] = await Promise.all([
      db
        .select()
        .from(productsTable)
        .where(
          and(
            eq(productsTable.id, id),
            // 110-F (R110): deactivated 404s like archived — see /by-slug.
            eq(productsTable.isActive, true),
            eq(productsTable.isArchived, false),
          ),
        )
        .limit(1),
      getActiveFlashSale(),
    ]);

    if (!product) return { found: false as const };

    const [[stockResult], [orderResult]] = await Promise.all([
      db
        .select({ count: count() })
        .from(inventoryTable)
        .where(
          and(
            eq(inventoryTable.productId, id),
            eq(inventoryTable.isSold, false),
            deliverableUnitCondition(),
          ),
        ),
      db
        .select({ count: count() })
        .from(ordersTable)
        .where(and(eq(ordersTable.productId, id), eq(ordersTable.status, "completed"))),
    ]);

    const basePrice = parseFloat(String(product.price));
    const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
    const stockCount = Number(stockResult?.count ?? 0);
    const variants =
      (await loadPublicVariants([product.id], discountPercent)).get(product.id) ?? [];
    const displayBase = variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : basePrice;
    const salePrice =
      discountPercent > 0 ? computeFlashSalePrice(displayBase, discountPercent) : null;

    return {
      found: true as const,
      dto: {
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
      },
    };
  });

  if (!cached.found)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
  return res.json(cached.dto);
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

  // R104 (AG5-7): 60 s in-process cache, 200-only (same contract as the
  // detail endpoints).
  const cached = await withCatalogCache("recommendations", String(id), 60, async () => {
    const [product] = await db
      .select({ category: productsTable.category })
      .from(productsTable)
      .where(eq(productsTable.id, id))
      .limit(1);

    if (!product) return { found: false as const };

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

    return {
      found: true as const,
      items: recommendations.map((r) => ({
        id: r.id,
        name: r.name,
        image_url: r.imageUrl,
        price: parseFloat(String(r.price)),
      })),
    };
  });

  if (!cached.found)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
  return res.json(cached.items);
});

export { router as productsRouter };
