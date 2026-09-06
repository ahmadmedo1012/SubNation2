import { CreateOrderBody } from "@workspace/api-zod";
import { db, ordersTable, productsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { safeDecrypt } from "../lib/encryption";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { stringParam } from "../lib/http";
import { derivePrimaryProvider } from "../lib/user-provider";
import { idempotency } from "../middlewares/idempotency";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { notifyNewOrder } from "../telegram";
import { CheckoutService } from "../services/checkout.service";
import { toNumber } from "../lib/numeric";

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
    amount: toNumber(order.amount),
    coupon_code: order.couponCode ?? null,
    discount_amount: toNumber(order.discountAmount),
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

  // Round-3 (8-c §2.4): the storefront home page renders 4 rows but the
  // only available fetch returned the full 200-row list (with a
  // safeDecrypt per row server-side). ?limit= gives callers exactly what
  // they display. Default stays 200 (profile page), clamped to [1, 200].
  const limitRaw = parseInt(String(req.query.limit ?? "200"), 10);
  const limit = Number.isNaN(limitRaw) ? 200 : Math.min(Math.max(limitRaw, 1), 200);

  const orders = await db
    .select({
      order: ordersTable,
      productName: productsTable.name,
      productImageUrl: productsTable.imageUrl,
    })
    .from(ordersTable)
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit);

  return res.json(orders.map((r) => formatOrder(r.order, r.productName ?? "", r.productImageUrl)));
});

// V4-P0 (contract audit 2026-09-06): the customer money path now mounts
// the idempotency middleware (subject = userId). A network-level retry
// or double-click of the same unit-order (the checkout loop sends N of
// them) replays the cached response instead of charging the wallet a
// second time. The frontend sends a fresh Idempotency-Key per unit
// order (checkout.tsx) so distinct units stay distinct.
router.post("/", requireUser, idempotency({ routeKey: "orders.create" }), async (req, res) => {
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
      case "INVALID_PRICE":
        // M1 defense-in-depth gate — non-finite/non-positive final price.
        // The client can't fix this; it's a data-integrity signal.
        return res
          .status(500)
          .json(
            createErrorResponse(
              "تعذر إتمام الشراء بسبب خطأ في بيانات السعر. تواصل مع الدعم.",
              ErrorCode.INTERNAL_ERROR,
            ),
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
      case "CONCURRENCY_ERROR":
        // H5 — optimistic wallet deduction lost a race with a concurrent
        // balance mutation. Retryable by design (re-reads the balance).
        return res
          .status(409)
          .json(
            createErrorResponse(
              "تعارض أثناء تنفيذ العملية. أعد المحاولة بعد لحظات.",
              ErrorCode.CONFLICT,
            ),
          );
      case "COUPON_EXHAUSTED":
        // F-006 (security audit 004) — atomic-with-check coupon
        // increment lost the race; another concurrent purchase already
        // consumed the last redemption slot.
        return res
          .status(409)
          .json(
            createErrorResponse(
              "تم استخدام الكوبون من قبل عميل آخر في نفس الوقت. حاول بدون الكوبون أو استخدم كوبوناً آخر.",
              ErrorCode.INVALID_DATA,
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
