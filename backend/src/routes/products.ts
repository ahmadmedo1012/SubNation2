import { db, flashSalesTable, inventoryTable, ordersTable, productsTable } from "@workspace/db";
import { and, count, eq, gt, min, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { intParam } from "../lib/http";

const router = Router();

async function getActiveFlashSale() {
  const now = new Date();
  const [sale] = await db
    .select()
    .from(flashSalesTable)
    .where(and(eq(flashSalesTable.isActive, true), gt(flashSalesTable.endsAt, now)))
    .limit(1);
  if (!sale) return null;
  return {
    id: sale.id,
    title: sale.title,
    discount_percent: parseFloat(String(sale.discountPercent)),
    ends_at: sale.endsAt.toISOString(),
  };
}

router.get("/", async (req, res) => {
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

router.get("/stats", getProductStatsHandler);
router.get("/flash-sale", getFlashSaleHandler);

router.get("/:id", async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, id), eq(productsTable.isArchived, false)))
    .limit(1);

  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

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

router.get("/:id/recommendations", async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [product] = await db
    .select({ category: productsTable.category })
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);

  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

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
