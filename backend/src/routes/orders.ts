import { CreateOrderBody } from "@workspace/api-zod";
import { db, ordersTable, productsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { safeDecrypt } from "../lib/encryption";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { stringParam } from "../lib/http";
import { derivePrimaryProvider } from "../lib/user-provider";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { notifyNewOrder } from "../telegram";
import { CheckoutService } from "../services/checkout.service";

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

  const result = await CheckoutService.purchase({
    userId,
    productId: product_id,
    couponCode,
  });

  if (!result.ok) {
    // Map service reasons → the exact HTTP status + message the inline
    // handler returned before, so responses stay byte-identical.
    switch (result.reason) {
      case "PRODUCT_NOT_FOUND":
        return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
      case "INVALID_COUPON":
        return res
          .status(400)
          .json(createErrorResponse(result.message ?? "كوبون غير صالح", ErrorCode.INVALID_DATA));
      case "USER_NOT_FOUND":
        return res
          .status(401)
          .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));
      case "INSUFFICIENT_BALANCE":
        return res
          .status(400)
          .json(
            createErrorResponse(
              "رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً.",
              ErrorCode.INSUFFICIENT_BALANCE,
            ),
          );
      case "OUT_OF_STOCK":
        return res
          .status(404)
          .json(
            createErrorResponse("المنتج غير متوفر حالياً. حاول لاحقاً.", ErrorCode.OUT_OF_STOCK),
          );
      case "INVENTORY_CLAIMED":
        return res
          .status(409)
          .json(
            createErrorResponse(
              "المنتج تم حجزه بواسطة مستخدم آخر. حاول مرة أخرى.",
              ErrorCode.OUT_OF_STOCK,
            ),
          );
    }
  }

  const { order, product, user, finalPrice } = result;

  notifyNewOrder({
    phone: user.phone,
    productName: product.name,
    amount: finalPrice,
    orderId: order.id,
    orderCode: order.orderCode ?? null,
    provider: derivePrimaryProvider(user),
  });

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
