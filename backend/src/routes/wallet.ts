import { CreateTopupBody } from "@workspace/api-zod";
import {
  db,
  ordersTable,
  productsTable,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "@workspace/db";
import { and, count, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { pageParam } from "../lib/http";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
// 98-B3 (round-98 wave B): the hard-block refusal layer — mounted before
// the soft guard, see the mount comment at POST /topups below.
import { riskHardBlockMiddleware } from "../middlewares/risk-hard-block";
import { riskSoftBlockGuardMiddleware } from "../middlewares/risk-soft-block";
// 96-F1 (R96-A5 M2): POST /topups is the last unprotected money path —
// same Redis-backed replay guard checkout already mounts.
import { idempotency } from "../middlewares/idempotency";
// R134 (A7-F4): the shared body-hash definition. R158 (B-F2): the
// durable-reuse 409 envelope now comes from the ONE factory
// (byte-identical to the previous literals).
import { canonicalBodyHash, idempotencyReuseBody } from "../lib/idempotency-body-hash";
// R158 (B-F1): the topup-creation pipeline owner (validation battery →
// durable idempotency replay → advisory-lock transaction → auto-reject
// heuristic → operator/customer notify) — extracted from this handler.
import { TopupService } from "../services/topup.service";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { toNumber } from "../lib/numeric";

const router = Router();

// A7 (round-94): explicit no-store on the user-scoped wallet surface —
// balance/pending-topup responses are per-user money state; an
// intermediary (or the browser HTTP cache) must never serve them stale.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // Round-3 (8-c §2.6): user → orders → pending-count was 3 sequential
  // round trips; the two aggregates only depend on userId, so all three
  // queries now run concurrently.
  // B6-03 (R116) hygiene: projected user read — the summary only needs the
  // money/loyalty fields; a bare select() pulled every users column over
  // the wire for nothing.
  const [[user], recentOrders, [{ pendingCount }]] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        walletBalance: usersTable.walletBalance,
        loyaltyPoints: usersTable.loyaltyPoints,
        loyaltyTier: usersTable.loyaltyTier,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1),
    db
      .select({
        order: ordersTable,
        productName: productsTable.name,
        productImageUrl: productsTable.imageUrl,
      })
      .from(ordersTable)
      .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
      .where(eq(ordersTable.userId, userId))
      .orderBy(desc(ordersTable.createdAt))
      .limit(5),
    // Count only THIS user's pending topups
    db
      .select({ pendingCount: count() })
      .from(walletTopupsTable)
      .where(and(eq(walletTopupsTable.userId, userId), eq(walletTopupsTable.status, "pending"))),
  ]);
  if (!user)
    // AUD103-4-F2 (r103): one failure class, one shape — "user row missing
    // under a valid session" is 401 ACCOUNT_NOT_FOUND everywhere (auth/me
    // already used this; loyalty used to 404, wallet used UNAUTHORIZED).
    return res
      .status(401)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

  return res.json({
    balance: toNumber(user.walletBalance),
    loyalty_points: user.loyaltyPoints,
    loyalty_tier: user.loyaltyTier,
    pending_topups_count: Number(pendingCount),
    // B2-03 (round-92 audit, belt): delivered credentials are only readable
    // while the order is "completed" — RefundService nulls them in the
    // refund tx, but the gate also covers every other non-completed state
    // (mirrors formatOrder in routes/orders.ts).
    //
    // B6-03 (R116, credentials-on-demand): this summary STOPPED decrypting
    // the AES-GCM credential columns. The buyer's credential surface is
    // GET /api/orders + /api/orders/:orderCode (formatOrder decrypts
    // there); the wallet summary was a SECOND decrypt path whose only
    // consumer is the wallet page's card list — which never renders
    // delivered_* fields (grep-verified; the card shows product / amount /
    // status only). Rows now carry has_credentials instead, so the card
    // can badge availability without paying a per-refresh decrypt tax.
    // usage_terms / delivered_at stay as-is (plain columns, no decrypt).
    recent_orders: recentOrders.map((r) => ({
      id: r.order.id,
      order_code: r.order.orderCode,
      product_id: r.order.productId,
      product_name: r.productName ?? "",
      product_image_url: r.productImageUrl ?? null,
      amount: toNumber(r.order.amount),
      status: r.order.status,
      has_credentials: !!(
        r.order.deliveredEmail ||
        r.order.deliveredPassword ||
        r.order.deliveredExtraDetails
      ),
      delivered_email: null,
      delivered_password: null,
      delivered_extra_details: null,
      delivered_usage_terms:
        r.order.status === "completed" ? (r.order.deliveredUsageTerms ?? null) : null,
      delivered_at: r.order.deliveredAt?.toISOString() ?? null,
      created_at: r.order.createdAt?.toISOString(),
    })),
  });
});

router.get("/topups", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // R120-B6/A6-F1: the list was hard-capped at the first 200 topups with
  // no way to reach older history. Additive ?page= (admin/orders.ts clamp
  // idiom, offset=(page-1)*200) — default page=1 → offset 0 → identical.
  const offset = (pageParam(req) - 1) * 200;

  const topups = await db
    .select()
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.userId, userId))
    .orderBy(desc(walletTopupsTable.createdAt))
    .limit(200)
    .offset(offset);

  return res.json(topups.map(formatTopup));
});

// R115 (A8 P2): the user-facing wallet STATEMENT — every LYD movement
// (topups, purchases, refunds, loyalty conversions, referral credits)
// from wallet_ledger, newest first. Previously the wallet page showed
// only topup REQUESTS: a refund credit or a welcome bonus was invisible
// as a transaction ("where did my balance come from?" was unanswerable
// in the UI). Read-only, no-store (per-user money state).
const LEDGER_TYPE_LABELS: Record<string, string> = {
  topup: "شحن محفظة",
  purchase: "شراء",
  refund: "استرداد",
  adjustment: "تسوية رصيد",
  referral_credit: "مكافأة إحالة",
};

router.get("/ledger", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 100;
  // R120-B6/A6-F1: additive ?page= (admin/orders.ts clamp idiom,
  // offset=(page-1)*limit) — rows 201+ were unreachable before. Default
  // page=1 → offset 0 → byte-identical response. (limitParam from
  // lib/http.ts is intentionally NOT adopted here: its parseInt idiom
  // accepts "12.9"/"1e2" where this route's stricter Number.isInteger
  // idiom falls back to 100 — adoption would drift behavior (A6-F14).)
  const offset = (pageParam(req) - 1) * limit;

  const entries = await db
    .select()
    .from(walletLedgerTable)
    .where(eq(walletLedgerTable.userId, userId))
    .orderBy(desc(walletLedgerTable.createdAt), desc(walletLedgerTable.id))
    .limit(limit)
    .offset(offset);

  return res.json(
    entries.map((e) => ({
      id: e.id,
      type: e.type,
      type_label: LEDGER_TYPE_LABELS[e.type] ?? e.type,
      amount: parseFloat(String(e.amount)),
      balance_after: parseFloat(String(e.balanceAfter)),
      reference_type: e.referenceType,
      description: e.description,
      created_at: e.createdAt.toISOString(),
    })),
  );
});

// F1 (round-94 A4): soft-block guard on the topup-submission money
// path — a risk-tagged user's transfer requests are refused until they
// re-authenticate (friction, not lockout; the hard_block refusal layer
// now mounts immediately BEFORE this guard — 98-B3 round-98 wave B:
// severity ordering, the non-dischargeable critical-tier verdict answers
// first so a both-tagged user gets the honest "contact support" 423
// instead of friction side effects re-auth cannot discharge).
//
// 96-F1 (R96-A5 M2): idempotency now mounted after requireUser — the
// exact orders.ts:~112 pattern. A slow-network retry or impatient
// double-tap replays the cached 2xx instead of inserting a SECOND
// identical pending row (the approval-time reference dedup only helps
// when a payment_reference was entered — the field is optional). The
// risk guards stay BEFORE idempotency (a refusal must not consume the
// caller's Idempotency-Key; same ordering rationale as orders.ts).
//
// Quadruple gate keeps the default shape unchanged: RISK_PIPELINE_ENABLED
// (unset in production) + modelEnabled + autoBlockEnabled.hardBlock +
// the 1h event window.
router.post(
  "/topups",
  requireUser,
  riskHardBlockMiddleware(),
  riskSoftBlockGuardMiddleware(),
  idempotency({ routeKey: "wallet.topups.create" }),
  async (req, res) => {
    const { userId } = req as AuthenticatedRequest;

    const parse = CreateTopupBody.safeParse(req.body);
    if (!parse.success)
      return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
    const {
      amount,
      payment_method,
      payment_network,
      sender_phone,
      sender_account,
      payment_reference,
    } = parse.data;

    // R134 (A7-F4): the durable reuse predicate's input — hashed HERE at
    // the route layer off req.body (the SAME definition the Redis layer
    // uses; the services never re-derive it).
    const idemBodyHash = canonicalBodyHash(req.body);

    // R158 (B-F1): the creation pipeline (validation battery → durable
    // idempotency replay → advisory-lock transaction → auto-reject
    // heuristic → operator/customer notify → risk emit) lives in
    // TopupService.createPendingTopup — the same delegation the sibling
    // money paths already use (orders.ts → CheckoutService.purchase;
    // admin/users.ts → AdjustmentService). The route keeps the parse,
    // the request-context translation, and the response mapping below.
    const result = await TopupService.createPendingTopup({
      userId,
      amount,
      paymentMethod: payment_method,
      paymentNetwork: payment_network,
      senderPhone: sender_phone,
      senderAccount: sender_account,
      paymentReference: payment_reference,
      // F10 (round-94 C4→C5 wiring), checkout-parity: the raw
      // Idempotency-Key header passes through — the service scopes it
      // per-user, replays the original topup on a retry, and claims it
      // atomically with the pending row.
      idempotencyKey: req.header("Idempotency-Key"),
      idempotencyBodyHash: idemBodyHash,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
    });

    if (!result.ok) {
      // R158 (B-F2): the idempotency-reuse 409 — the shared factory
      // envelope (byte-identical to the Redis layer's; ONE shape across
      // both idempotency layers). The two former emission sites (the
      // pre-tx replay predicate + the post-tx race-loser re-check, both
      // now in the service) collapse into this single mapping.
      if (result.reason === "IDEMPOTENCY_KEY_REUSE") {
        return res.status(409).json(idempotencyReuseBody());
      }
      if (result.reason === "VALIDATION_ERROR") {
        return res.status(400).json(createErrorResponse(result.message, ErrorCode.INVALID_DATA));
      }
      if (result.reason === "IN_FLIGHT_CONFLICT") {
        return res
          .status(409)
          .json(
            createErrorResponse(
              "طلب مكرر قيد المعالجة — أعد المحاولة بعد لحظات",
              ErrorCode.CONFLICT,
            ),
          );
      }
      if (result.reason === "DUPLICATE_PENDING_REFERENCE") {
        // B4-R1: the same receipt (user + reference + amount) already
        // has a PENDING row — a resubmission under a different
        // idempotency key. 409 with the existing request's id so the
        // user can see it in their list; nothing was inserted (the tx
        // returned before the insert).
        return res.status(409).json(
          createErrorResponse(result.message, ErrorCode.CONFLICT, {
            reason: "DUPLICATE_PENDING_REFERENCE",
            existing_topup_id: result.existingTopupId,
          }),
        );
      }
      // TOPUP_LIMIT_EXCEEDED
      return res.status(429).json({
        error: "لديك طلبات قيد المراجعة، يرجى الانتظار حتى يتم اعتمادها",
        // V4-P1: the code field is what the frontend getErrorMessage maps
        // to the Arabic message — without it this fell to the raw string.
        code: ErrorCode.TOPUP_LIMIT_EXCEEDED,
        pending_count: result.pendingCount,
        limit: result.limit,
      });
    }

    // Same contract as the checkout replay (orders.ts): a REPLAYED topup
    // answers 200 (not 201 — nothing new was created), gets the
    // Idempotent-Replayed header, and returns the ORIGINAL formatted DTO —
    // the service already skipped every new-topup side effect (operator
    // card, customer notification, risk emit).
    if (result.idempotentReplay) {
      res.setHeader("Idempotent-Replayed", "true");
      return res.json(formatTopup(result.topup));
    }

    return res.status(201).json(formatTopup(result.topup));
  },
);

function formatTopup(topup: typeof walletTopupsTable.$inferSelect) {
  return {
    id: topup.id,
    amount: toNumber(topup.amount),
    payment_method: topup.paymentMethod,
    payment_network: topup.paymentNetwork ?? null,
    sender_phone: topup.senderPhone ?? null,
    sender_account: topup.senderAccount ?? null,
    payment_reference: topup.paymentReference ?? null,
    status: topup.status,
    admin_note: topup.adminNote ?? null,
    created_at: topup.createdAt?.toISOString(),
    reviewed_at: topup.reviewedAt?.toISOString() ?? null,
  };
}

export { router as walletRouter };
