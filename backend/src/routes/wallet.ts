import { CreateTopupBody } from "@workspace/api-zod";
import {
  db,
  ordersTable,
  productsTable,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "@workspace/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { pageParam } from "../lib/http";
import { logger } from "../lib/logger";
import { roundLydString } from "../lib/money";
import { normalizeLibyanPhone } from "../lib/crypto";
import { scoreEventFireAndForget } from "../lib/risk-emit";
import { derivePrimaryProvider } from "../lib/user-provider";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
// 98-B3 (round-98 wave B): the hard-block refusal layer — mounted before
// the soft guard, see the mount comment at POST /topups below.
import { riskHardBlockMiddleware } from "../middlewares/risk-hard-block";
import { riskSoftBlockGuardMiddleware } from "../middlewares/risk-soft-block";
// 96-F1 (R96-A5 M2): POST /topups is the last unprotected money path —
// same Redis-backed replay guard checkout already mounts.
import { idempotency } from "../middlewares/idempotency";
import {
  claimIdempotencyKey,
  findIdempotentOrderId,
  isIdempotencyKeyViolation,
  scopeIdempotencyKey,
} from "../lib/idempotency";
import { notifyNewTopup } from "../telegram";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { toNumber } from "../lib/numeric";

const router = Router();

/**
 * B2-F2 (R111, round-111 B2 audit): wallet_topups.payment_network is
 * varchar(50) with NO schema bound, and the field was free-form — an
 * over-long or arbitrary string 500'd (22001) on the money path instead
 * of answering 400. Allowlist = the networks the wallet UI offers plus
 * every value present in the live table (verified 2026-09-24):
 * libyana / madar (frontend), sadad + lypay (legacy rows). Normalized
 * (trimmed + lowercased) BEFORE the membership check so " Madar " is
 * canonicalized, not rejected — the same normalization discipline the
 * payment_reference F-03 fix applies.
 */
const PAYMENT_NETWORK_ALLOWLIST = new Set(["libyana", "madar", "sadad", "lypay"]);

/** B2-F2: sender_phone column is varchar(20) — bound for EVERY method. */
const SENDER_PHONE_MAX = 20;
/** B2-F2: sender_account column is varchar(255). */
const SENDER_ACCOUNT_MAX = 255;

// A7 (round-94): explicit no-store on the user-scoped wallet surface —
// balance/pending-topup responses are per-user money state; an
// intermediary (or the browser HTTP cache) must never serve them stale.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

/**
 * SEC-92-09 (round-92 audit): minimal HTML escape for Telegram's
 * parse_mode=HTML — same character set as telegram.ts's escapeHtml.
 * Escaping &, <, > prevents user-supplied topup fields (sender_phone,
 * payment_network) from breaking the message render or being interpreted
 * as markup.
 */
function escapeTelegramHtml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

    // F-03 (round-93 A2 §"Duplicate-transfer double-credit"): normalize the
    // transfer receipt/reference HERE so every downstream dedup layer
    // (V1-M9 partial unique index, the B2-02 in-tx exact check, the advisory
    // lock, the composite soft-dedup) compares canonical values — a raw
    // "  REF-1  " would dodge every exact-match guard while still being the
    // same transfer. Handler-enforced semantic bound (the same pattern the
    // CreateTopupBody openapi description documents for the other conditional
    // rules): trimmed + ≤ 100 chars; the generated zod schema remains the
    // looser 255-char outer perimeter. Blank-after-trim → null (the partial
    // index exempts blank refs as the legacy class).
    const paymentReference =
      typeof payment_reference === "string" && payment_reference.trim().length > 0
        ? payment_reference.trim()
        : null;
    if (paymentReference !== null && paymentReference.length > 100) {
      return res
        .status(400)
        .json(
          createErrorResponse("مرجع الدفع طويل جداً (الحد الأقصى 100 حرف)", ErrorCode.INVALID_DATA),
        );
    }

    if (amount <= 0 || amount > 10000) {
      return res
        .status(400)
        .json(createErrorResponse("قيمة الشحن غير صالحة", ErrorCode.INVALID_DATA));
    }

    const method = payment_method ?? "mobile_transfer";

    // B2-F2: normalize + allowlist the network before any use (it is
    // stored verbatim below, rendered on the Telegram approval card, and
    // compared by the composite dedup — canonical values keep all three
    // honest).
    let network: string | null = null;
    if (payment_network !== undefined && payment_network !== null) {
      network = String(payment_network).trim().toLowerCase() || null;
    }
    if (network !== null && !PAYMENT_NETWORK_ALLOWLIST.has(network)) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "شبكة الدفع غير صالحة (المسموح: ليبيانا، مدار)",
            ErrorCode.INVALID_DATA,
          ),
        );
    }

    if (method === "mobile_transfer" && !network) {
      return res
        .status(400)
        .json(createErrorResponse("يرجى اختيار الشبكة", ErrorCode.INVALID_DATA));
    }
    // B2-F2: sender_account is only required for lypay, but ANY method may
    // carry one — bound it to the column so a long value is a 400, not a
    // 22001 500 on the money path.
    if (sender_account !== undefined && sender_account !== null) {
      if (String(sender_account).trim().length === 0 && method === "lypay") {
        return res
          .status(400)
          .json(createErrorResponse("يرجى إدخال رقم حساب المُرسل", ErrorCode.INVALID_DATA));
      }
      if (String(sender_account).length > SENDER_ACCOUNT_MAX) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              `رقم حساب المُرسل طويل جداً (الحد الأقصى ${SENDER_ACCOUNT_MAX} حرف)`,
              ErrorCode.INVALID_DATA,
            ),
          );
      }
    }
    if (method === "lypay" && (sender_account === undefined || sender_account === null)) {
      return res
        .status(400)
        .json(createErrorResponse("يرجى إدخال رقم حساب المُرسل", ErrorCode.INVALID_DATA));
    }

    // B2-F2: sender_phone is validated as a Libyan number for
    // mobile_transfer below, but a lypay submission may carry ANY string
    // (the Telegram approval-card comment) — bound both to the varchar(20)
    // column before the shape check so neither can overflow.
    if (sender_phone !== undefined && sender_phone !== null) {
      if (String(sender_phone).length > SENDER_PHONE_MAX) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              `رقم هاتف المُرسل طويل جداً (الحد الأقصى ${SENDER_PHONE_MAX} رقماً)`,
              ErrorCode.INVALID_DATA,
            ),
          );
      }
    }

    // B4-R1 (R111, round-111 B4 audit — the last wallet-credit inflation
    // path): a blank payment_reference is exempt from EVERY dedup layer
    // (V1-M9 partial unique + B2-02 exact check + composite soft-dedup all
    // key on the reference), so two ref-less pendings for one real
    // transfer were both approvable — 200 LYD credited for one 100 LYD
    // transfer. The wallet form's receipt field (PaymentReferenceField)
    // makes the reference the natural input; the server now REQUIRES it
    // for mobile_transfer (the bank-transfer channel where receipts
    // exist). lypay keeps it optional (gateway receipts are not
    // consistently exposed to users). Enforcement is at CREATION only —
    // pre-existing blank-ref rows (live: 2 pending) stay approvable via
    // TopupService.approve untouched.
    if (method === "mobile_transfer" && paymentReference === null) {
      return res.status(400).json(
        createErrorResponse(
          // R126-L2 (A8 F4): «رمز التحويل» — the storefront field label
          // (wallet.tsx PaymentReferenceField) and the R116-S2 «رمز»
          // terminology canon; was «مرجع التحويل».
          "رمز التحويل (رقم العملية من إيصال التحويل) مطلوب لطلبات شحن المحفظة",
          ErrorCode.INVALID_DATA,
        ),
      );
    }

    if (method === "mobile_transfer" && sender_phone) {
      if (!normalizeLibyanPhone(sender_phone)) {
        return res
          .status(400)
          .json(createErrorResponse("رقم هاتف المُرسل غير صالح", ErrorCode.INVALID_DATA));
      }
    }

    // ── R104 (AG9-1, F10 mirror): durable idempotency for topup CREATION ──
    //
    // The HTTP middleware above is the fast Redis layer; without Redis
    // (the production shape) it is a pass-through, so a double-submit /
    // post-timeout retry created DUPLICATE pending rows. Money still
    // only moves at approval (dedup battery: advisory lock + in-tx
    // exact check + V1-M9 partial unique + composite soft-dedup), but
    // that battery requires a payment_reference — an OPTIONAL field —
    // so two ref-less pending rows for one real transfer could both be
    // approved by an operator. The DB-backed claim closes that window:
    // a retry of the same Idempotency-Key now replays the original
    // pending row instead of inserting a second one.
    const scopedIdemKey = scopeIdempotencyKey(userId, req.header("Idempotency-Key"));
    if (scopedIdemKey) {
      const replayedTopupId = await findIdempotentOrderId(scopedIdemKey, "topup.create");
      if (replayedTopupId !== null) {
        const [existing] = await db
          .select()
          .from(walletTopupsTable)
          .where(
            and(eq(walletTopupsTable.id, replayedTopupId), eq(walletTopupsTable.userId, userId)),
          )
          .limit(1);
        if (existing) {
          // Same contract as the checkout replay (orders.ts): 200 (not
          // 201 — nothing new was created), Idempotent-Replayed header,
          // the ORIGINAL formatted DTO, and NO new operator notification.
          res.setHeader("Idempotent-Replayed", "true");
          return res.json(formatTopup(existing));
        }
        // Key points at a topup this user no longer owns (cascade-deleted
        // user row): fall through; the in-tx claim surfaces a still-live
        // stale key as a classified conflict below.
      }
    }

    // Anti-abuse: max 3 pending requests per user.
    //
    // B2-09 (round-92 audit): the count-then-insert pair runs inside ONE
    // transaction guarded by a per-user advisory lock. The old
    // check-then-insert allowed N parallel POSTs to all count 0 pending and
    // all insert (cap bypassed — no direct money impact since each request
    // still needs manual approval, but the anti-abuse invariant was soft).
    // The advisory lock serializes same-user submissions; count + auto-reject
    // heuristic + insert now see a consistent snapshot and commit atomically.
    const MAX_PENDING = 3;
    const submission = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"topup:" + userId}, 0))`,
      );

      // B4-R1: creation-time duplicate-receipt guard. With the reference
      // now mandatory, the remaining duplicate shape is the SAME receipt
      // resubmitted under a DIFFERENT idempotency key (or no key at all —
      // legacy clients) — two identical pending cards in the operator
      // queue for one real transfer. Same user + same reference + same
      // (rounded) amount + still pending → 409 with an honest message.
      // Same reference with a DIFFERENT amount is left through: the
      // approval battery (exact-ref check + V1-M9 partial unique) still
      // guarantees the second approval 409s, and blocking it here would
      // false-positive on a bank that reuses receipt strings. Runs inside
      // the per-user advisory lock, so a double-submit race cannot slip
      // two rows past this check.
      if (paymentReference !== null) {
        const dup = await tx
          .select({ id: walletTopupsTable.id })
          .from(walletTopupsTable)
          .where(
            and(
              eq(walletTopupsTable.userId, userId),
              eq(walletTopupsTable.paymentReference, paymentReference),
              eq(walletTopupsTable.amount, roundLydString(amount)),
              eq(walletTopupsTable.status, "pending"),
            ),
          )
          .limit(1);
        if (dup.length > 0) {
          return { kind: "duplicate" as const, existingId: dup[0].id };
        }
      }

      const [{ pendingCount }] = await tx
        .select({ pendingCount: count() })
        .from(walletTopupsTable)
        .where(and(eq(walletTopupsTable.userId, userId), eq(walletTopupsTable.status, "pending")));

      if (Number(pendingCount) >= MAX_PENDING) {
        return { kind: "limited" as const, pendingCount: Number(pendingCount) };
      }

      const [{ rejectedCount }] = await tx
        .select({ rejectedCount: count() })
        .from(walletTopupsTable)
        .where(and(eq(walletTopupsTable.userId, userId), eq(walletTopupsTable.status, "rejected")));

      // (Typed to the topup_status enum — replaces the legacy `as any`.)
      let initialStatus: "pending" | "rejected" = "pending";
      let initialAdminNote: string | null = null;

      // Recharge Verification Heuristic: Auto-reject serial abusers
      if (Number(rejectedCount) >= 3) {
        initialStatus = "rejected";
        initialAdminNote = "رفض تلقائي: تاريخ من الطلبات المرفوضة المتكررة (احتيال محتمل)";
      }

      const [topup] = await tx
        .insert(walletTopupsTable)
        .values({
          userId,
          // R102 (money display-vs-storage parity): zod accepts up to 3+
          // decimals but numeric(10,2) rounds SILENTLY — the operator
          // would approve 10.555 while 10.56 is what gets credited.
          // Round at the boundary so the approval card, the credited
          // amount, and the ledger agree. AUD103 (r103): roundLydString —
          // +toFixed(2) missed the exact half-cent case (binary
          // 10.554999… → "10.55"); the epsilon-corrected rounding yields
          // the intended 10.56.
          amount: roundLydString(amount),
          paymentMethod: method,
          paymentNetwork: network,
          senderPhone: sender_phone ?? null,
          senderAccount: sender_account ?? null,
          paymentReference,
          status: initialStatus,
          adminNote: initialAdminNote,
        })
        .returning();

      // R104 (AG9-1): claim the key INSIDE this transaction — commits
      // atomically with the pending row; a rollback releases it for the
      // client's retry. A concurrent same-key winner throws 23505.
      if (scopedIdemKey) {
        try {
          await claimIdempotencyKey(
            tx as unknown as typeof db,
            scopedIdemKey,
            topup.id,
            "topup.create",
          );
        } catch (err) {
          // R108 (FH-A7 P3-2): the manual `code === "23505"` check missed
          // drizzle-wrapped errors (node-postgres exposes the SQLSTATE on
          // the wrapped .cause — see lib/idempotency.ts); the race loser
          // got a raw 500 instead of the designed replay envelope.
          if (isIdempotencyKeyViolation(err)) {
            return { kind: "replayed" as const };
          }
          throw err;
        }
      }

      return { kind: "ok" as const, topup, initialStatus };
    });

    if (submission.kind === "replayed") {
      // Lost the same-key race to a concurrent duplicate (double-click
      // with two in-flight POSTs): the winner's row is the real one —
      // replay it exactly like the pre-tx path above.
      if (scopedIdemKey) {
        const winnerId = await findIdempotentOrderId(scopedIdemKey, "topup.create");
        if (winnerId !== null) {
          const [existing] = await db
            .select()
            .from(walletTopupsTable)
            .where(and(eq(walletTopupsTable.id, winnerId), eq(walletTopupsTable.userId, userId)))
            .limit(1);
          if (existing) {
            res.setHeader("Idempotent-Replayed", "true");
            return res.json(formatTopup(existing));
          }
        }
      }
      return res
        .status(409)
        .json(
          createErrorResponse("طلب مكرر قيد المعالجة — أعد المحاولة بعد لحظات", ErrorCode.CONFLICT),
        );
    }

    if (submission.kind === "duplicate") {
      // B4-R1: the same receipt (user + reference + amount) already has a
      // PENDING row — a resubmission under a different idempotency key.
      // 409 with the existing request's id so the user can see it in their
      // list; nothing was inserted (the tx returned before the insert).
      return res
        .status(409)
        .json(
          createErrorResponse(
            `يوجد طلب شحن قيد المراجعة بنفس المرجع والمبلغ (#${submission.existingId}) — انتظر مراجعته أو أرسل تحويلاً جديداً`,
            ErrorCode.CONFLICT,
            { reason: "DUPLICATE_PENDING_REFERENCE", existing_topup_id: submission.existingId },
          ),
        );
    }

    if (submission.kind === "limited") {
      return res.status(429).json({
        error: "لديك طلبات قيد المراجعة، يرجى الانتظار حتى يتم اعتمادها",
        // V4-P1: the code field is what the frontend getErrorMessage maps
        // to the Arabic message — without it this fell to the raw string.
        code: ErrorCode.TOPUP_LIMIT_EXCEEDED,
        pending_count: submission.pendingCount,
        limit: MAX_PENDING,
      });
    }

    const { topup, initialStatus } = submission;
    // AUD103-2-F6 (r103): display-vs-storage parity — everything the
    // operator card, the user notification, and the risk pipeline SEE
    // downstream must be the STORED (rounded) amount, not the raw
    // submission (10.555 → stored/credited 10.56 — the approval card used
    // to show the un-rounded value to the human checkpoint).
    const storedAmount = Number(topup.amount);

    // ── Telegram approval request (fire-and-forget) ────────────────────────
    // Operators approve/reject directly from the admin group via inline
    // buttons; the webhook at /api/webhook/telegram executes the decision
    // (allowlist-gated by TELEGRAM_ADMIN_IDS). Never blocks the user.
    if ((initialStatus as string) === "pending") {
      void (async () => {
        try {
          const botToken = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
          const chatId = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
          if (!botToken || !chatId) return;
          // SEC-92-09 (round-92 audit): this message previously used the
          // legacy "Markdown" parse_mode with UNESCAPED user-controlled
          // fields. sender_phone is only validated for mobile_transfer (a
          // lypay submission can carry any string — now length-bounded,
          // B2-F2), and payment_network is allowlisted (B2-F2) — one
          // metacharacter (*, _, `, [) made Telegram's
          // parser reject the whole sendMessage, silently dropping the
          // approve/reject keyboard from the operator group. HTML mode +
          // escaping (same pattern as telegram.ts's dispatch pipeline) makes
          // the approval card render for ANY input the user submits.
          const text =
            `💰 <b>طلب شحن جديد #${topup.id}</b>\n` +
            `• الهاتف: <code>${sender_phone ? escapeTelegramHtml(sender_phone) : "—"}</code>\n` +
            `• المبلغ: <b>${storedAmount} د.ل</b>\n` +
            `• الطريقة: ${escapeTelegramHtml(method)}` +
            `${network ? ` (${escapeTelegramHtml(network)})` : ""}\n` +
            // F-03 (round-93 A2): the receipt reference rides the approval card
            // so the operator can compare it against the bank statement — the
            // duplicate guards (exact + composite) are only actionable when
            // the human in the loop can SEE the value they dedupe on.
            (paymentReference
              ? `• المرجع: <code>${escapeTelegramHtml(paymentReference)}</code>\n`
              : "");
          const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "✅ موافقة", callback_data: `topup_app:${topup.id}` },
                    { text: "❌ رفض", callback_data: `topup_rej:${topup.id}` },
                  ],
                ],
              },
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok)
            logger.warn({ status: res.status }, "[wallet] telegram approval notify failed");
        } catch (err) {
          logger.warn({ err }, "[wallet] telegram approval notify threw");
        }
      })();
    }

    // B6-03 (R116) hygiene: projected identity read — notifyNewTopup needs
    // phone and derivePrimaryProvider needs telegramId/firebaseUid (the
    // other identity fields ride the projection for future notify use; a
    // bare select() pulled every users column for nothing).
    const [currentUser] = await db
      .select({
        id: usersTable.id,
        phone: usersTable.phone,
        displayName: usersTable.displayName,
        authProvider: usersTable.authProvider,
        googleId: usersTable.googleId,
        telegramId: usersTable.telegramId,
        firebaseUid: usersTable.firebaseUid,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (currentUser)
      notifyNewTopup({
        phone: currentUser.phone,
        amount: storedAmount,
        network: method === "lypay" ? "LyPay" : (network ?? ""),
        topupId: topup.id,
        provider: derivePrimaryProvider(currentUser),
      });

    // Risk pipeline (003-anomaly-detection) — emit topup_attempt. Never
    // blocks; gated on RISK_PIPELINE_ENABLED inside scoreEvent.
    scoreEventFireAndForget({
      eventType: "topup_attempt",
      userId,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
      phone: currentUser?.phone ?? null,
      ruleContext: {
        event: {
          eventType: "topup_attempt",
          ipAddress: req.ip ?? null,
          amount: storedAmount,
        },
        user: { id: userId },
      },
    });

    return res.status(201).json(formatTopup(topup));
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
