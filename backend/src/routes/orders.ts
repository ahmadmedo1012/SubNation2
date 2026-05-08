import { Router } from "express";
import { db, ordersTable, productsTable, inventoryTable, usersTable, flashSalesTable, couponsTable } from "@workspace/db";
import { eq, and, desc, gt, sql } from "drizzle-orm";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { CreateOrderBody } from "@workspace/api-zod";
import { generateOrderCode } from "../lib/crypto";
import { stringParam } from "../lib/http";
import { notifyNewOrder, notifyCouponMaxedOut, isTelegramConfigured } from "../telegram";
import { logAdminAlert } from "../jobs/alertLogger";

const router = Router();

function formatOrder(order: typeof ordersTable.$inferSelect, productName: string, productImageUrl: string | null | undefined) {
  return {
    id: order.id,
    order_code: order.orderCode,
    product_id: order.productId,
    product_name: productName,
    product_image_url: productImageUrl ?? null,
    amount: parseFloat(String(order.amount)),
    coupon_code: order.couponCode ?? null,
    discount_amount: order.discountAmount ? parseFloat(String(order.discountAmount)) : 0,
    status: order.status,
    delivered_email: order.deliveredEmail ?? null,
    delivered_password: order.deliveredPassword ?? null,
    delivered_extra_details: order.deliveredExtraDetails ?? null,
    delivered_usage_terms: order.deliveredUsageTerms ?? null,
    delivered_at: order.deliveredAt?.toISOString() ?? null,
    created_at: order.createdAt?.toISOString(),
  };
}

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

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

router.post("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const parse = CreateOrderBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const { product_id } = parse.data;
  const couponCode: string | undefined = typeof req.body.coupon_code === "string"
    ? req.body.coupon_code.trim().toUpperCase() : undefined;

  const [product] = await db.select().from(productsTable)
    .where(and(eq(productsTable.id, product_id), eq(productsTable.isActive, true), eq(productsTable.isArchived, false))).limit(1);
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const now = new Date();
  const [flashSale] = await db.select().from(flashSalesTable)
    .where(and(eq(flashSalesTable.isActive, true), gt(flashSalesTable.endsAt, now))).limit(1);

  let basePrice = parseFloat(String(product.price));
  if (flashSale) {
    const discount = parseFloat(String(flashSale.discountPercent));
    basePrice = +(basePrice * (1 - discount / 100)).toFixed(2);
  }

  // Apply coupon
  let discountAmount = 0;
  let appliedCoupon: typeof couponsTable.$inferSelect | null = null;
  if (couponCode) {
    const [coupon] = await db.select().from(couponsTable)
      .where(eq(couponsTable.code, couponCode)).limit(1);
    if (!coupon || !coupon.isActive) {
      return res.status(400).json({ error: "كوبون غير صالح أو منتهي الصلاحية" });
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      return res.status(400).json({ error: "انتهت صلاحية هذا الكوبون" });
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({ error: "تم استخدام هذا الكوبون بالحد الأقصى" });
    }
    const minOrder = parseFloat(String(coupon.minOrderAmount));
    if (basePrice < minOrder) {
      return res.status(400).json({ error: `هذا الكوبون يتطلب حد أدنى ${minOrder.toFixed(2)} د.ل` });
    }
    if (coupon.type === "percentage") {
      discountAmount = +(basePrice * parseFloat(String(coupon.value)) / 100).toFixed(2);
    } else {
      discountAmount = +Math.min(parseFloat(String(coupon.value)), basePrice).toFixed(2);
    }
    appliedCoupon = coupon;
  }

  const finalPrice = +(basePrice - discountAmount).toFixed(2);

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

  if (appliedCoupon) {
    const newUsedCount = appliedCoupon.usedCount + 1;
    await db.update(couponsTable)
      .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
      .where(eq(couponsTable.id, appliedCoupon.id));
    if (appliedCoupon.maxUses !== null && newUsedCount >= appliedCoupon.maxUses) {
      if (isTelegramConfigured()) notifyCouponMaxedOut(appliedCoupon.code, appliedCoupon.maxUses);
      logAdminAlert(
        "coupon_maxed",
        `كوبون استُنفد: ${appliedCoupon.code}`,
        `وصل الكوبون إلى الحد الأقصى من الاستخدام (${appliedCoupon.maxUses} مرة) وأُوقف تلقائياً`,
      );
    }
  }

  // Use ORM insert instead of raw SQL
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
    deliveredExtraDetails: inventoryItem.extraDetails ?? null,
    deliveredUsageTerms: product.usageTerms ?? null,
    deliveredAt: now,
    couponCode: appliedCoupon?.code ?? null,
    discountAmount: String(discountAmount),
  }).returning();

  notifyNewOrder(user.phone, product.name, finalPrice);

  return res.status(201).json(formatOrder(order, product.name, product.imageUrl));
});

router.get("/:orderCode", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const orderCode = stringParam(req, "orderCode");

  const [result] = await db.select({
    order: ordersTable,
    productName: productsTable.name,
    productImageUrl: productsTable.imageUrl,
  }).from(ordersTable)
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(and(eq(ordersTable.orderCode, orderCode), eq(ordersTable.userId, userId))).limit(1);

  if (!result) return res.status(404).json({ error: "الطلب غير موجود" });
  return res.json(formatOrder(result.order, result.productName ?? "", result.productImageUrl));
});

export { router as ordersRouter };
