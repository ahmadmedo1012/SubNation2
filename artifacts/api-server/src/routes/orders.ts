import { Router } from "express";
import { db, ordersTable, productsTable, inventoryTable, usersTable, flashSalesTable } from "@workspace/db";
import { eq, and, desc, count, gt } from "drizzle-orm";
import { verifyToken } from "./auth";
import { CreateOrderBody } from "@workspace/api-zod";
import { randomBytes } from "crypto";

const router = Router();

function requireAuth(req: any, res: any): number | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "غير مصرح" });
    return null;
  }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "جلسة منتهية" });
    return null;
  }
  return payload.userId;
}

function generateOrderCode(): string {
  return "SN" + randomBytes(4).toString("hex").toUpperCase();
}

function formatOrder(order: any, productName: string, productImageUrl: string | null | undefined) {
  return {
    id: order.id,
    order_code: order.orderCode,
    product_id: order.productId,
    product_name: productName,
    product_image_url: productImageUrl ?? null,
    amount: parseFloat(String(order.amount)),
    status: order.status,
    delivered_email: order.deliveredEmail ?? null,
    delivered_password: order.deliveredPassword ?? null,
    delivered_extra_details: order.deliveredExtraDetails ?? null,
    delivered_usage_terms: order.deliveredUsageTerms ?? null,
    delivered_at: order.deliveredAt?.toISOString() ?? null,
    created_at: order.createdAt?.toISOString(),
  };
}

router.get("/", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const orders = await db.select({
    order: ordersTable,
    productName: productsTable.name,
    productImageUrl: productsTable.imageUrl,
  }).from(ordersTable)
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt));

  return res.json(orders.map(r => formatOrder(r.order, r.productName ?? "", r.productImageUrl)));
});

router.post("/", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parse = CreateOrderBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const { product_id } = parse.data;

  const [product] = await db.select().from(productsTable)
    .where(and(eq(productsTable.id, product_id), eq(productsTable.isActive, true), eq(productsTable.isArchived, false))).limit(1);
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const now = new Date();
  const [flashSale] = await db.select().from(flashSalesTable)
    .where(and(eq(flashSalesTable.isActive, true), gt(flashSalesTable.endsAt, now))).limit(1);

  let finalPrice = parseFloat(String(product.price));
  if (flashSale) {
    const discount = parseFloat(String(flashSale.discountPercent));
    finalPrice = +(finalPrice * (1 - discount / 100)).toFixed(2);
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return res.status(401).json({ error: "المستخدم غير موجود" });

  const currentBalance = parseFloat(String(user.walletBalance));
  if (currentBalance < finalPrice) {
    return res.status(400).json({ error: "رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً." });
  }

  const [inventoryItem] = await db.select().from(inventoryTable)
    .where(and(eq(inventoryTable.productId, product_id), eq(inventoryTable.isSold, false))).limit(1);
  if (!inventoryItem) return res.status(404).json({ error: "المنتج غير متوفر حالياً. حاول لاحقاً." });

  await db.update(inventoryTable).set({ isSold: true, soldAt: now }).where(eq(inventoryTable.id, inventoryItem.id));

  const newBalance = +(currentBalance - finalPrice).toFixed(2);
  await db.update(usersTable).set({
    walletBalance: String(newBalance),
    lifetimeSpend: String(+(parseFloat(String(user.lifetimeSpend)) + finalPrice).toFixed(2)),
    loyaltyPoints: user.loyaltyPoints + Math.floor(finalPrice),
  }).where(eq(usersTable.id, userId));

  const [order] = await db.insert(ordersTable).values({
    orderCode: generateOrderCode(),
    userId,
    productId: product_id,
    inventoryId: inventoryItem.id,
    amount: String(finalPrice),
    walletBalanceBefore: String(currentBalance),
    walletBalanceAfter: String(newBalance),
    status: "completed",
    deliveredEmail: inventoryItem.accountEmail,
    deliveredPassword: inventoryItem.accountPassword,
    deliveredExtraDetails: inventoryItem.extraDetails,
    deliveredUsageTerms: product.usageTerms,
    deliveredAt: now,
  }).returning();

  return res.status(201).json(formatOrder(order, product.name, product.imageUrl));
});

router.get("/:orderCode", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const [result] = await db.select({
    order: ordersTable,
    productName: productsTable.name,
    productImageUrl: productsTable.imageUrl,
  }).from(ordersTable)
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(and(eq(ordersTable.orderCode, req.params.orderCode), eq(ordersTable.userId, userId))).limit(1);

  if (!result) return res.status(404).json({ error: "الطلب غير موجود" });
  return res.json(formatOrder(result.order, result.productName ?? "", result.productImageUrl));
});

export { router as ordersRouter };
