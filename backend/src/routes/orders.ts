import { CreateOrderBody } from "@workspace/api-zod";
import { db, ordersTable, productsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { safeDecrypt } from "../lib/encryption";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { limitParam, pageParam, stringParam } from "../lib/http";
import { derivePrimaryProvider } from "../lib/user-provider";
import { idempotency } from "../middlewares/idempotency";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
// 98-B3 (round-98 wave B): the hard-block refusal layer — mounted before
// the soft guard, see the mount comment at POST / below.
import { riskHardBlockMiddleware } from "../middlewares/risk-hard-block";
import { riskSoftBlockGuardMiddleware } from "../middlewares/risk-soft-block";
import { notifyNewOrder } from "../telegram";
import { CheckoutService } from "../services/checkout.service";
import { fireThrottledMaintenance } from "../lib/opportunistic";
import { runStockSweep } from "../jobs/stockWatcher";
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
  // Decrypt once — the response fields and the decrypt-failure flag below
  // read the same values.
  const deliveredEmail = credentialsLive ? safeDecrypt(order.deliveredEmail) : null;
  const deliveredPassword = credentialsLive ? safeDecrypt(order.deliveredPassword) : null;
  const deliveredExtraDetails = credentialsLive ? safeDecrypt(order.deliveredExtraDetails) : null;
  // R118-A1 F-7: buyer-side parity with the admin reveal flag
  // (routes/admin/orders.ts credentials endpoint). A COMPLETED order whose
  // raw credential columns are populated but no longer decrypt
  // (post-purchase ENCRYPTION_KEY rotation, or corrupted rows) previously
  // rendered as silent all-null delivered fields — the paying buyer's UI
  // said "no credentials" instead of "cannot decrypt — contact support".
  // Additive shape only: the flag appears exactly when the order is
  // completed, at least one raw credential column exists, and EVERY
  // decrypt came back null (a genuinely credential-less order has no raw
  // columns and must NOT be flagged).
  const hasRawCredentialColumns = !!(
    order.deliveredEmail ||
    order.deliveredPassword ||
    order.deliveredExtraDetails
  );
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
    delivered_email: deliveredEmail,
    delivered_password: deliveredPassword,
    delivered_extra_details: deliveredExtraDetails,
    delivered_usage_terms: credentialsLive ? (order.deliveredUsageTerms ?? null) : null,
    delivered_at: order.deliveredAt?.toISOString() ?? null,
    created_at: order.createdAt?.toISOString(),
    ...(credentialsLive &&
    hasRawCredentialColumns &&
    !deliveredEmail &&
    !deliveredPassword &&
    !deliveredExtraDetails
      ? { decrypt_failed: true }
      : {}),
  };
}

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // Round-3 (8-c §2.4): the storefront home page renders 4 rows but the
  // only available fetch returned the full 200-row list (with a
  // safeDecrypt per row server-side). ?limit= gives callers exactly what
  // they display. Default stays 200 (profile page), clamped to [1, 200].
  // R120-B6/A6-F1: the clamp moved into lib/http.ts limitParam (identical
  // idiom — no behavior change) and an optional ?page= (admin/orders.ts
  // clamp idiom, offset=(page-1)*limit) lets the profile page walk past
  // the 200-row cap — rows 201+ were previously unreachable. Default
  // page=1 → offset 0 → byte-identical response.
  const limit = limitParam(req, 200, 200);
  const offset = (pageParam(req) - 1) * limit;

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
    .limit(limit)
    .offset(offset);

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
//
// 98-B3 (round-98 wave B — R98 dead-code audit §1 [P2]): the hard-block
// refusal layer mounts BEFORE the soft guard in the same sandwich.
// Severity ordering: hard_block (critical-tier, non-dischargeable)
// answers before the soft guard's friction, so a buyer tagged both
// gets the honest "contact support" 423 instead of the soft guard's
// "re-login and retry" message + session-wipe side effects. Quadruple
// gate keeps default behavior unchanged: RISK_PIPELINE_ENABLED (unset
// in production) + modelEnabled + autoBlockEnabled.hardBlock + 1h
// event window.
router.post(
  "/",
  requireUser,
  riskHardBlockMiddleware(),
  riskSoftBlockGuardMiddleware(),
  idempotency({ routeKey: "orders.create" }),
  async (req, res) => {
    const { userId } = req as AuthenticatedRequest;

    const parse = CreateOrderBody.safeParse(req.body);
    if (!parse.success)
      return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
    // R120-B6/A6-F7: coupon_code now comes from the PARSED body only — the
    // old raw re-read of req.body.coupon_code was a split-brain (it
    // bypassed the tightened maxLength 64 + re-accepted shapes safeParse
    // had just rejected). Trim + uppercase normalization is unchanged.
    const { product_id, variant_id, coupon_code } = parse.data;
    const couponCode: string | undefined =
      typeof coupon_code === "string" ? coupon_code.trim().toUpperCase() : undefined;

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
                "تم استخدام الكوبون من قبل مستخدم آخر في نفس الوقت. حاول بدون الكوبون أو استخدم كوبوناً آخر.",
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

    // 2026-09-20 (free-infrastructure round): a purchase is one of the
    // ONLY events that changes inventory — trigger the low/zero-stock
    // sweep (was a 30-minute interval timer). Throttled 10 min,
    // fire-and-forget: never blocks the 201 response, never fails it.
    fireThrottledMaintenance("stock-sweep", 10 * 60 * 1000, runStockSweep);

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
