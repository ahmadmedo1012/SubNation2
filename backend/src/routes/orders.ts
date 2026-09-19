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
import { riskSoftBlockGuardMiddleware } from "../middlewares/risk-soft-block";
import { notifyNewOrder } from "../telegram";
import { CheckoutService } from "../services/checkout.service";
import { toNumber } from "../lib/numeric";

const router = Router();

// A7 (round-94): explicit no-store on the user-scoped orders surface —
// order lists / credentials-bearing detail responses are per-user money
// state; an intermediary must never serve them from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

function formatOrder(
  order: typeof ordersTable.$inferSelect,
  productName: string,
  productImageUrl: string | null | undefined,
) {
  // B2-03 (round-92 audit): delivered credentials are only readable while
  // the order is "completed". RefundService nulls delivered_password /
  // delivered_email / delivered_extra_details inside the refund tx, but
  // this gate also covers every other non-completed state ("failed",
  // legacy rows) at the API boundary — the buyer must not be able to
  // re-read a password for money that was returned to them. safeDecrypt
  // itself returns null on GCM auth failure (B2-11) and passes legacy
  // plaintext through unchanged, so every field is null-safe by
  // construction.
  //
  // P0-sim (round-93 live simulation, 93-SIM-live-findings): delivered_email
  // and delivered_extra_details were previously returned RAW (still
  // encrypted) while delivered_password went through safeDecrypt — the
  // buyer saw `6ec3acc95e8...:...` hex ciphertext as their "email" on the
  // purchase-success screen, order detail, and admin panel. Both fields are
  // V1-M7-class encrypted-at-rest columns (or legacy plaintext), so they
  // go through the same safeDecrypt. delivered_usage_terms is catalog
  // text (products.usage_terms — never encrypted) but describes the
  // purchased account's usage rules: same lifecycle as the credentials,
  // so it is gated too rather than leaking post-refund.
  const credentialsLive = order.status === "completed";
  return {
    id: order.id,
    order_code: order.orderCode,
    product_id: order.productId,
    variant_id: order.variantId ?? null,
    // Catalog-2026-09-20: immutable copy of the purchased option's label
    // ("فردي — 3 أشهر") — safe to expose verbatim; it was written FOR the
    // customer at purchase time and never rewrites itself.
    variant_label: order.variantLabel ?? null,
    product_name: productName,
    product_image_url: productImageUrl ?? null,
    amount: toNumber(order.amount),
    coupon_code: order.couponCode ?? null,
    discount_amount: toNumber(order.discountAmount),
    status: order.status,
    delivered_email: credentialsLive ? safeDecrypt(order.deliveredEmail) : null,
    delivered_password: credentialsLive ? safeDecrypt(order.deliveredPassword) : null,
    delivered_extra_details: credentialsLive ? safeDecrypt(order.deliveredExtraDetails) : null,
    delivered_usage_terms: credentialsLive ? (order.deliveredUsageTerms ?? null) : null,
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
//
// F1 (round-94 A4): the soft-block guard sits BETWEEN requireUser and
// the idempotency middleware — a risk-tagged buyer is refused BEFORE
// anything is charged or cached, and a refusal must not consume the
// caller's Idempotency-Key (the retry after re-auth must be able to
// claim it). Order matters: guard first, idempotency second.
router.post(
  "/",
  requireUser,
  riskSoftBlockGuardMiddleware(),
  idempotency({ routeKey: "orders.create" }),
  async (req, res) => {
    const { userId } = req as AuthenticatedRequest;

    const parse = CreateOrderBody.safeParse(req.body);
    if (!parse.success)
      return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
    const { product_id, variant_id } = parse.data;
    const couponCode: string | undefined =
      typeof req.body.coupon_code === "string"
        ? req.body.coupon_code.trim().toUpperCase()
        : undefined;

    const result = await CheckoutService.purchase({
      userId,
      productId: product_id,
      variantId: variant_id ?? null,
      couponCode,
      // F10 (round-94 C4→C5 wiring): pass the raw Idempotency-Key header
      // through to the service — the durable in-tx guard (lib/idempotency.ts)
      // scopes it per-user, replays the original order on a retry, and
      // claims it atomically with the purchase. The HTTP middleware above
      // is the fast Redis layer; this is the transactional backstop.
      idempotencyKey: req.header("Idempotency-Key"),
    });

    if (!result.ok) {
      // Map service reasons → the exact HTTP status + message the inline
      // handler returned before, so responses stay byte-identical.
      switch (result.reason) {
        case "PRODUCT_NOT_FOUND":
          return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
        case "VARIANT_NOT_FOUND":
          // Catalog-2026-09-20: the named variant is missing/inactive or
          // belongs to another product — the client re-reads the variant
          // list and retries with a valid option.
          return res
            .status(400)
            .json(
              createErrorResponse(
                "الباقة المختارة غير متاحة حالياً. اختر باقة أخرى.",
                ErrorCode.INVALID_DATA,
              ),
            );
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
          // F4 (round-94 C4): the product's price/active/archive changed
          // between pricing and the purchase tx — nothing was mutated.
          // Distinguished from the generic wallet race by the stable
          // code riding the failure envelope so the client can re-price
          // and retry with the CURRENT price.
          if (result.code === "PRODUCT_STALE") {
            return res
              .status(409)
              .json(
                createErrorResponse(
                  "تغيّرت بيانات المنتج أثناء إتمام الشراء. أعد المحاولة بالسعر الحالي",
                  ErrorCode.CONFLICT,
                ),
              );
          }
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
        case "STALE_FLASH_SALE":
          // B2-06 (round-92 audit) — the flash sale that priced this purchase
          // ended (or changed) between pricing and the transaction. Retryable:
          // the client re-prices at the current price.
          return res
            .status(409)
            .json(
              createErrorResponse(
                "انتهى عرض التخفيض أثناء إتمام الشراء. أعد المحاولة بالسعر الحالي.",
                ErrorCode.CONFLICT,
              ),
            );
        case "INVENTORY_CORRUPT":
          // R93-DATA (round-93) — the claimed unit's credentials are
          // undecryptable with the current key (or empty). Nothing was
          // charged: the transaction failed closed BEFORE any mutation. The
          // buyer is pointed to support; the operator already received a
          // deduped inventory_corrupt alert with the product + unit id.
          return res
            .status(503)
            .json(
              createErrorResponse(
                "بيانات هذا المنتج تحتاج صيانة من الإدارة حالياً — لم يُخصم أي مبلغ من محفظتك. جرّب لاحقاً أو تواصل مع الدعم.",
                ErrorCode.SERVICE_UNAVAILABLE,
              ),
            );
      }
    }

    const { order, product, user, finalPrice, idempotentReplay } = result;

    // F10 (round-94 C4→C5 wiring): this call REPLAYED an order a previous
    // same-key purchase already created — nothing was charged or claimed
    // now. Contract: 200 (not 201 — nothing new was created), the
    // Idempotent-Replayed header for clients that want to distinguish,
    // and NO new-order notifications (the operator already got the card
    // when the order was originally created).
    if (idempotentReplay) {
      res.setHeader("Idempotent-Replayed", "true");
      return res.json(formatOrder(order, product.name, product.imageUrl));
    }

    notifyNewOrder({
      phone: user.phone,
      productName: product.name,
      amount: finalPrice,
      orderId: order.id,
      orderCode: order.orderCode ?? null,
      provider: derivePrimaryProvider(user),
    });

    return res.status(201).json(formatOrder(order, product.name, product.imageUrl));
  },
);

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
