import { CreateOrderBody } from "@workspace/api-zod";
import {
  couponsTable,
  db,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { logAdminAlert } from "../jobs/alertLogger";
import { computePricing, isAppliedCoupon, isInvalidCoupon } from "../lib/pricing";
import { generateOrderCode } from "../lib/crypto";
import { safeDecrypt } from "../lib/encryption";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { stringParam } from "../lib/http";
import { insertLedgerEntry } from "../lib/ledger";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { notifyCouponMaxedOut, notifyNewOrder } from "../telegram";
import { computeTier } from "./loyalty";

const router = Router();

function formatOrder(
  order: typeof ordersTable.$inferSelect,
  productName: string,
  productImageUrl: string | null | undefined,
) {
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
    delivered_password: safeDecrypt(order.deliveredPassword),
    delivered_extra_details: order.deliveredExtraDetails ?? null,
    delivered_usage_terms: order.deliveredUsageTerms ?? null,
    delivered_at: order.deliveredAt?.toISOString() ?? null,
    created_at: order.createdAt?.toISOString(),
  };
}

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const orders = await db
    .select({
      order: ordersTable,
      productName: productsTable.name,
      productImageUrl: productsTable.imageUrl,
    })
    .from(ordersTable)
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt));

  return res.json(orders.map((r) => formatOrder(r.order, r.productName ?? "", r.productImageUrl)));
});

router.post("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const parse = CreateOrderBody.safeParse(req.body);
  if (!parse.success)
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  const { product_id } = parse.data;
  const couponCode: string | undefined =
    typeof req.body.coupon_code === "string"
      ? req.body.coupon_code.trim().toUpperCase()
      : undefined;

  const [product] = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.id, product_id),
        eq(productsTable.isActive, true),
        eq(productsTable.isArchived, false),
      ),
    )
    .limit(1);
  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  // ── Discount stack (flash sale → coupon → final) ─────────────────────
  // Single source of truth: lib/pricing.ts. The same helper is called
  // by the catalog route + admin pricing calculator, so the math here
  // and the simulated math in /admin/pricing stay bit-for-bit identical.
  const pricing = await computePricing({
    listPrice: parseFloat(String(product.price)),
    couponCode,
  });

  // Reject the request when the coupon failed validation. The shared
  // helper returns a structured InvalidCoupon with the Arabic-translated
  // user-facing message, preserving the same UX as the previous inline
  // checks (4 distinct rejection reasons, same wording).
  if (pricing.coupon && isInvalidCoupon(pricing.coupon)) {
    return res
      .status(400)
      .json(createErrorResponse(pricing.coupon.reasonAr, ErrorCode.INVALID_DATA));
  }

  const discountAmount = pricing.discountAmount;
  const finalPrice = pricing.finalPrice;
  const appliedCoupon = isAppliedCoupon(pricing.coupon) ? pricing.coupon.record : null;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user)
    return res
      .status(401)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

  const currentBalance = parseFloat(String(user.walletBalance));
  if (currentBalance < finalPrice) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً.",
          ErrorCode.INSUFFICIENT_BALANCE,
        ),
      );
  }

  const [inventoryItem] = await db
    .select()
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, product_id), eq(inventoryTable.isSold, false)))
    .limit(1);
  if (!inventoryItem)
    return res
      .status(404)
      .json(createErrorResponse("المنتج غير متوفر حالياً. حاول لاحقاً.", ErrorCode.OUT_OF_STOCK));

  // ── Atomic transaction: inventory claim + balance deduction + coupon + order ──
  const newBalance = +(currentBalance - finalPrice).toFixed(2);
  const now = new Date();
  const order = await db
    .transaction(async (tx) => {
      // Atomic inventory claim inside transaction to prevent race conditions
      const [inv] = await tx
        .update(inventoryTable)
        .set({ isSold: true, soldAt: now })
        .where(and(eq(inventoryTable.id, inventoryItem.id), eq(inventoryTable.isSold, false)))
        .returning();
      if (!inv) throw new Error("INVENTORY_CLAIMED");

      const newLifetimeSpend = +(parseFloat(String(user.lifetimeSpend)) + finalPrice).toFixed(2);
      const [updatedUser] = await tx
        .update(usersTable)
        .set({
          walletBalance: String(newBalance),
          lifetimeSpend: String(newLifetimeSpend),
          loyaltyPoints: user.loyaltyPoints + Math.floor(finalPrice),
          loyaltyTier: computeTier(newLifetimeSpend),
        })
        .where(and(eq(usersTable.id, userId), eq(usersTable.walletBalance, String(currentBalance))))
        .returning();
      if (!updatedUser) throw new Error("CONCURRENCY_ERROR");

      if (appliedCoupon) {
        const newUsedCount = appliedCoupon.usedCount + 1;
        await tx
          .update(couponsTable)
          .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
          .where(eq(couponsTable.id, appliedCoupon.id));
        if (appliedCoupon.maxUses !== null && newUsedCount >= appliedCoupon.maxUses) {
          notifyCouponMaxedOut(appliedCoupon.code, appliedCoupon.maxUses);
          logAdminAlert(
            "coupon_maxed",
            `كوبون استُنفد: ${appliedCoupon.code}`,
            `وصل الكوبون إلى الحد الأقصى من الاستخدام (${appliedCoupon.maxUses} مرة) وأُوقف تلقائياً`,
          );
        }
      }

      const [o] = await tx
        .insert(ordersTable)
        .values({
          orderCode: generateOrderCode(),
          userId,
          productId: product_id,
          inventoryId: inventoryItem.id,
          amount: String(finalPrice),
          walletBalanceBefore: String(currentBalance),
          walletBalanceAfter: String(newBalance),
          status: "completed",
          deliveredEmail: inventoryItem.accountEmail,
          deliveredPassword: safeDecrypt(inventoryItem.accountPassword),
          deliveredExtraDetails: inventoryItem.extraDetails ?? null,
          deliveredUsageTerms: product.usageTerms ?? null,
          deliveredAt: now,
          couponCode: appliedCoupon?.code ?? null,
          discountAmount: String(discountAmount),
        })
        .returning();

      // Ledger entry committed atomically with balance mutation. If this
      // fails the whole purchase rolls back, keeping the audit trail in sync.
      await insertLedgerEntry(
        {
          userId,
          type: "purchase",
          amount: String(finalPrice),
          balanceBefore: String(currentBalance),
          balanceAfter: String(newBalance),
          referenceId: o.id,
          referenceType: "order",
          description: `Purchase: ${product.name}`,
        },
        tx as unknown as typeof db,
      );

      return o;
    })
    .catch((err) => {
      if (err.message === "INVENTORY_CLAIMED") {
        return null;
      }
      throw err;
    });

  if (!order) {
    return res
      .status(409)
      .json(
        createErrorResponse(
          "المنتج تم حجزه بواسطة مستخدم آخر. حاول مرة أخرى.",
          ErrorCode.OUT_OF_STOCK,
        ),
      );
  }

  notifyNewOrder(user.phone, product.name, finalPrice);

  return res.status(201).json(formatOrder(order, product.name, product.imageUrl));
});

router.get("/:orderCode", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const orderCode = stringParam(req, "orderCode");

  const [result] = await db
    .select({
      order: ordersTable,
      productName: productsTable.name,
      productImageUrl: productsTable.imageUrl,
    })
    .from(ordersTable)
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(and(eq(ordersTable.orderCode, orderCode), eq(ordersTable.userId, userId)))
    .limit(1);

  if (!result)
    return res.status(404).json(createErrorResponse("الطلب غير موجود", ErrorCode.ORDER_NOT_FOUND));
  return res.json(formatOrder(result.order, result.productName ?? "", result.productImageUrl));
});

export { router as ordersRouter };
