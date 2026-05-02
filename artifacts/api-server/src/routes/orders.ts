import { Router } from "express";
import { db, ordersTable, productsTable, inventoryTable, usersTable, flashSalesTable, couponsTable } from "@workspace/db";
import { eq, and, desc, count, gt, sql } from "drizzle-orm";
import { verifyToken } from "./auth";
import { CreateOrderBody } from "@workspace/api-zod";
import { randomBytes } from "crypto";
import { notifyNewOrder, notifyCouponMaxedOut } from "../telegram";

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
    coupon_code: (order.couponCode as string | null) ?? null,
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
  let appliedCoupon: any = null;
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

  // Increment coupon usage and notify if maxed out
  if (appliedCoupon) {
    const newUsedCount = appliedCoupon.usedCount + 1;
    await db.update(couponsTable)
      .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
      .where(eq(couponsTable.id, appliedCoupon.id));
    if (appliedCoupon.maxUses !== null && newUsedCount >= appliedCoupon.maxUses) {
      notifyCouponMaxedOut(appliedCoupon.code, appliedCoupon.maxUses);
    }
  }

  const [order] = await db.execute(sql`
    INSERT INTO orders (
      order_code, user_id, product_id, inventory_id,
      amount, wallet_balance_before, wallet_balance_after,
      status, delivered_email, delivered_password,
      delivered_extra_details, delivered_usage_terms, delivered_at,
      coupon_code, discount_amount
    ) VALUES (
      ${generateOrderCode()}, ${userId}, ${product_id}, ${inventoryItem.id},
      ${String(finalPrice)}, ${String(currentBalance)}, ${String(newBalance)},
      'completed', ${inventoryItem.accountEmail}, ${inventoryItem.accountPassword},
      ${inventoryItem.extraDetails}, ${product.usageTerms}, ${now},
      ${appliedCoupon?.code ?? null}, ${String(discountAmount)}
    ) RETURNING *
  `);

  notifyNewOrder(user.phone, product.name, finalPrice);

  const orderRow = order as any;
  return res.status(201).json({
    ...formatOrder(
      {
        id: orderRow.id, orderCode: orderRow.order_code,
        productId: orderRow.product_id, inventoryId: orderRow.inventory_id,
        amount: orderRow.amount,
        walletBalanceBefore: orderRow.wallet_balance_before,
        walletBalanceAfter: orderRow.wallet_balance_after,
        status: orderRow.status,
        deliveredEmail: orderRow.delivered_email,
        deliveredPassword: orderRow.delivered_password,
        deliveredExtraDetails: orderRow.delivered_extra_details,
        deliveredUsageTerms: orderRow.delivered_usage_terms,
        deliveredAt: orderRow.delivered_at,
        createdAt: orderRow.created_at,
      },
      product.name, product.imageUrl
    ),
    coupon_code: appliedCoupon?.code ?? null,
    discount_amount: discountAmount,
  });
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
