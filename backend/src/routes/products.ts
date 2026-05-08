import { Router, type Request, type Response } from "express";
import { db, productsTable, inventoryTable, ordersTable, flashSalesTable } from "@workspace/db";
import { eq, and, count, gt } from "drizzle-orm";
import { intParam } from "../lib/http";

const router = Router();

async function getActiveFlashSale() {
  const now = new Date();
  const [sale] = await db.select().from(flashSalesTable)
    .where(and(eq(flashSalesTable.isActive, true), gt(flashSalesTable.endsAt, now))).limit(1);
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

  const products = await db.select().from(productsTable)
    .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)));

  const flashSale = await getActiveFlashSale();

  const inventoryCounts = await db.select({
    productId: inventoryTable.productId,
    count: count(),
  }).from(inventoryTable)
    .where(eq(inventoryTable.isSold, false))
    .groupBy(inventoryTable.productId);

  const stockMap = new Map(inventoryCounts.map(r => [r.productId, r.count]));

  const orderCounts = await db.select({
    productId: ordersTable.productId,
    count: count(),
  }).from(ordersTable)
    .where(eq(ordersTable.status, "completed"))
    .groupBy(ordersTable.productId);

  const orderMap = new Map(orderCounts.map(r => [r.productId, r.count]));

  let result = products.map(p => {
    const stockCount = stockMap.get(p.id) ?? 0;
    const basePrice = parseFloat(String(p.price));
    const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
    const salePrice = discountPercent > 0 ? +(basePrice * (1 - discountPercent / 100)).toFixed(2) : null;
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
      order_count: orderMap.get(p.id) ?? 0,
    };
  });

  if (category && typeof category === "string") {
    result = result.filter(p => p.category?.toLowerCase() === category.toLowerCase());
  }
  if (available_only === "true") {
    result = result.filter(p => p.is_available);
  }
  if (search && typeof search === "string") {
    const q = search.toLowerCase();
    result = result.filter(p => p.name.toLowerCase().includes(q));
  }

  if (sort === "price_asc") result.sort((a, b) => a.price - b.price);
  else if (sort === "price_desc") result.sort((a, b) => b.price - a.price);
  else if (sort === "popular") result.sort((a, b) => b.order_count - a.order_count);
  else result.sort((a, b) => b.id - a.id);

  return res.json(result);
});

export async function getProductStatsHandler(_req: Request, res: Response) {
  const products = await db.select().from(productsTable)
    .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)));

  const inventoryCounts = await db.select({
    productId: inventoryTable.productId,
    count: count(),
  }).from(inventoryTable)
    .where(eq(inventoryTable.isSold, false))
    .groupBy(inventoryTable.productId);

  const stockMap = new Map(inventoryCounts.map(r => [r.productId, Number(r.count)]));
  const totalUnits = Array.from(stockMap.values()).reduce((a, b) => a + b, 0);
  const availableProducts = products.filter(p => (stockMap.get(p.id) ?? 0) > 0).length;
  const prices = products.map(p => parseFloat(String(p.price)));
  const lowestPrice = prices.length ? Math.min(...prices) : null;
  const flashSale = await getActiveFlashSale();

  return res.json({
    total_products: products.length,
    available_products: availableProducts,
    total_units: totalUnits,
    lowest_price: lowestPrice,
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

  const [product] = await db.select().from(productsTable)
    .where(and(eq(productsTable.id, id), eq(productsTable.isArchived, false))).limit(1);

  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const [stockResult] = await db.select({ count: count() }).from(inventoryTable)
    .where(and(eq(inventoryTable.productId, id), eq(inventoryTable.isSold, false)));

  const [orderResult] = await db.select({ count: count() }).from(ordersTable)
    .where(and(eq(ordersTable.productId, id), eq(ordersTable.status, "completed")));

  const flashSale = await getActiveFlashSale();
  const basePrice = parseFloat(String(product.price));
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
  const salePrice = discountPercent > 0 ? +(basePrice * (1 - discountPercent / 100)).toFixed(2) : null;
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

export { router as productsRouter };
