import { db, notificationsTable, ordersTable, productsTable, usersTable } from "@workspace/db";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { safeDecrypt } from "../../lib/encryption";
import { escapeLikeTerm, intParam, queryString } from "../../lib/http";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { hasPermission, PERMISSION_SCOPES } from "../../lib/permissions";
import { idempotency } from "../../middlewares/idempotency";
import { RefundError, RefundService } from "../../services/refund.service";
import { fireThrottledMaintenance } from "../../lib/opportunistic";
import { runStockSweep } from "../../jobs/stockWatcher";
import { logAdminAlert } from "../../jobs/alertLogger";
import { createNotification } from "../../notify";
import { captureSubsystemException } from "../../lib/sentry";

const router = Router();

// ── R117 (A1-P4): per-admin credentials-reveal volume gate ─────────────────
//
// The reveal endpoint is orders-scoped and audited, but the global
// apiLimiter (600/min, IP-keyed) never throttles a compromised ADMIN
// SESSION — an orders-scoped cookie could sweep every order's
// credentials at machine speed with nothing but audit rows as the
// trace. A sliding-window per-admin budget makes bulk exfiltration
// LOUD: over-budget reveals answer 429 and raise a deduped admin alert
// naming the admin (so the compromise is visible in the bell, not just
// in the audit trail).
//
// In-memory by design: the production topology is single-instance
// (same store class as every rate limiter in this repo); a Map of
// number[] keyed by admin id is bounded by the admin population with
// expired windows dropped opportunistically.
const CREDENTIALS_VIEW_WINDOW_MS = 10 * 60 * 1000;
const CREDENTIALS_VIEW_MAX = 60;
const credentialsViewTimes = new Map<number, number[]>();

/** Records a reveal attempt for the admin and returns false when the
 *  sliding-window budget is exhausted. */
function recordCredentialsViewAndGate(adminId: number): boolean {
  const now = Date.now();
  const windowStart = now - CREDENTIALS_VIEW_WINDOW_MS;
  const times = (credentialsViewTimes.get(adminId) ?? []).filter((t) => t > windowStart);
  times.push(now);
  credentialsViewTimes.set(adminId, times);
  // Opportunistic hygiene: drop admins whose windows fully expired so
  // the map stays bounded by ACTIVE revealers, not all-time admins.
  if (credentialsViewTimes.size > 50) {
    for (const [id, stamps] of credentialsViewTimes) {
      if (stamps.every((t) => t <= windowStart)) credentialsViewTimes.delete(id);
    }
  }
  return times.length <= CREDENTIALS_VIEW_MAX;
}

/** R117: test seam — reset the volume-gate window between cases. */
export function __resetCredentialsViewGateForTests(): void {
  credentialsViewTimes.clear();
}

// AUD103-4-F13 (r103): no-store parity with the 98-F3 pattern —
// this surface carries delivered credentials + buyer PII (phones, emails); an intermediary must never
// serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Must match the order_status pg enum (shared/db/src/schema/orders.ts).
const ORDER_STATUS_VALUES = ["pending", "completed", "failed", "refunded"] as const;
type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

// R116 hygiene (admin/orders typed status): both the ?status= list filter
// and the bulk-status PATCH body fed the pg-enum column through stringly
// comparisons + `as any` downcasts. One zod enum is now the single
// validation point — a parsed value is a member of the pg enum by
// construction, so Postgres can never see a 22P02 from this router.
const ORDER_STATUS_SCHEMA = z.enum(ORDER_STATUS_VALUES);

// A9-1 (R116): Arabic labels for the durable order-status notification —
// mirrors statusLabel() in frontend/src/lib/utils.ts (r111 ledger:
// refunded rides the «استرداد» root).
const ORDER_STATUS_NOTIFICATION_LABELS: Record<OrderStatus, string> = {
  pending: "قيد الانتظار",
  completed: "مكتمل",
  failed: "فشل",
  refunded: "تم استرداده",
};

/**
 * A9-1 (R116): durable notification for an admin-driven status change.
 * The socket `order-updated` emit is transient — an offline buyer never
 * sees it — while the notifications row surfaces in NotificationBell on
 * the next visit. createNotification is non-fatal by contract (warn +
 * carry on), so this can never block the status change itself.
 */
function notifyOrderStatusChanged(userId: number, orderCode: string, status: OrderStatus) {
  return createNotification(
    userId,
    "order",
    `طلبك ${orderCode} ${ORDER_STATUS_NOTIFICATION_LABELS[status]}`,
    undefined,
    // Storefront order detail route (App.tsx): /orders/:orderCode.
    `/orders/${orderCode}`,
  );
}

/**
 * F-9 (R118-A6): batched twin of notifyOrderStatusChanged for the BULK
 * status path — ONE multi-row INSERT into notifications instead of N
 * sequential single-row INSERTs. The old per-order `await` loop made an
 * N-order batch (≤200 by the B2-F4 clamp) pay N ~100 ms round trips —
 * a 200-order flip was ≈ 20 s of pure insert latency against the far
 * DB. createNotification stays the single-row path (it is notify.ts's
 * public surface — owned by another agent this round — and cannot take
 * a values[] batch without widening that surface).
 *
 * Contract parity with createNotification, per buyer:
 *   - same row shape (type "order", Arabic title via the shared status
 *     labels, link to the storefront order detail);
 *   - same non-fatal failure semantics (warn + Sentry capture + carry
 *     on — a notification failure can never fail the status change);
 *   - same post-insert "notification-new" socket emit (fire-and-
 *     forget, carrying the inserted row id).
 *
 * Accepted delta (deliberate): one failed batch insert now skips ALL N
 * notification rows instead of just one — a notifications-table
 * failure is a global outage either way, and the status change +
 * socket emits still go through.
 */
async function notifyOrderStatusChangedBatch(
  orders: Array<{ userId: number; orderCode: string }>,
  status: OrderStatus,
): Promise<void> {
  if (orders.length === 0) return;
  const rows = orders.map((o) => ({
    userId: o.userId,
    type: "order" as const,
    title: `طلبك ${o.orderCode} ${ORDER_STATUS_NOTIFICATION_LABELS[status]}`,
    // Storefront order detail route (App.tsx): /orders/:orderCode.
    link: `/orders/${o.orderCode}`,
  }));
  try {
    const inserted = await db
      .insert(notificationsTable)
      .values(rows)
      .returning({ id: notificationsTable.id, userId: notificationsTable.userId });
    // Mirror createNotification's post-insert emit so the buyer's
    // NotificationBell refreshes live instead of on the next poll.
    // (id, userId) pairs ride the insert result, so multi-row returning
    // order is irrelevant.
    import("../../lib/socket")
      .then(({ emitToUser }) => {
        for (const row of inserted) {
          emitToUser(row.userId, "notification-new", { id: row.id, type: "order" });
        }
      })
      .catch((err) =>
        logger.warn({ err }, "bulk status notification socket emit failed (non-fatal)"),
      );
  } catch (err) {
    logger.warn(
      {
        category: "notifications",
        err: err instanceof Error ? err.message : String(err),
        count: rows.length,
        status,
      },
      "notifyOrderStatusChangedBatch: batched insert failed (non-fatal — request continues)",
    );
    captureSubsystemException("notifications", err, { count: rows.length, status });
  }
}

/**
 * B2-F4 (R111, round-111 B2 audit): bulk-status accepted an unbounded
 * `ids[]` — ~90k ids built a giant IN(...) plus a per-id sequential
 * refund loop (each with its own transaction + notifications), an
 * easy accidental self-DoS on the admin surface. Capped at the admin
 * orders list page size (200, the same clamp GET /orders applies to
 * `limit`): a batch can never meaningfully exceed what one screen can
 * select, and the 400 is explicit rather than a timeout.
 */
const BULK_STATUS_MAX_IDS = 200;

router.get("/orders", requireAdmin, async (req, res) => {
  // A5-03 (round-94): `?status=` feeds the order_status pg-enum column —
  // an out-of-enum value used to reach Postgres as 22P02 → 500. Validate
  // up front: bad value → 400 INVALID_DATA with the allowed values.
  // R116: the check is the shared zod enum (typed — no `as any` cast into
  // the column anymore).
  const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
  const conditions = [];
  if (statusRaw !== undefined) {
    const statusParsed = ORDER_STATUS_SCHEMA.safeParse(statusRaw);
    if (!statusParsed.success) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "حالة طلب غير صالحة (المسموح: pending, completed, failed, refunded)",
            ErrorCode.INVALID_DATA,
          ),
        );
    }
    conditions.push(eq(ordersTable.status, statusParsed.data));
  }

  // A2 (round-94): keep the limit/page clamps from the R93 pagination fix.
  const limit = Math.min(
    Math.max(Number.parseInt(queryString(req, "limit", "100"), 10) || 100, 1),
    200,
  );
  const page = Math.max(Number.parseInt(queryString(req, "page", "1"), 10) || 1, 1);

  // V4: the admin command palette sends ?search= — previously ignored
  // (silently unfiltered results). Match order code, user phone/email/
  // name, or product name (case-insensitive).
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search.length > 0) {
    // AUD103-3-F4 (r103): escape LIKE wildcards before wrapping — a bare
    // "%" in the palette search must not match every row.
    const like = `%${escapeLikeTerm(search.toLowerCase())}%`;
    conditions.push(
      sql`(
        LOWER(${ordersTable.orderCode}) LIKE ${like}
        OR LOWER(COALESCE(${usersTable.phone}, '')) LIKE ${like}
        OR LOWER(COALESCE(${usersTable.email}, '')) LIKE ${like}
        OR LOWER(COALESCE(${usersTable.displayName}, '')) LIKE ${like}
        OR LOWER(COALESCE(${productsTable.name}, '')) LIKE ${like}
      )`,
    );
  }

  const orders = await db
    .select({
      order: ordersTable,
      userPhone: usersTable.phone,
      userDisplayName: usersTable.displayName,
      userEmail: usersTable.email,
      userAuthProvider: usersTable.authProvider,
      userGoogleId: usersTable.googleId,
      userTelegramId: usersTable.telegramId,
      userFirebaseUid: usersTable.firebaseUid,
      productName: productsTable.name,
    })
    .from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id))
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return res.json(
    orders.map((r) => ({
      id: r.order.id,
      order_code: r.order.orderCode,
      user_phone: r.userPhone ?? "",
      // ── Identity enrichment for the admin display helper. The
      //    frontend lib/admin/user-display.ts uses these to pick the
      //    best human-readable name + render provider badges.
      user_display_name: r.userDisplayName ?? null,
      user_email: r.userEmail ?? null,
      user_auth_provider: r.userAuthProvider ?? null,
      user_has_google: !!r.userGoogleId,
      user_has_telegram: !!r.userTelegramId,
      user_has_firebase: !!r.userFirebaseUid,
      user_has_whatsapp: r.userAuthProvider === "whatsapp_phone",
      product_name: r.productName ?? "",
      amount: parseFloat(String(r.order.amount)),
      status: r.order.status,
      // B6-03 (R116, credentials-on-demand): the list NO LONGER decrypts
      // the three AES-GCM credential columns — one list refresh used to
      // run up to 600 decrypts (3 × 200 rows), and a key mismatch turned
      // that into 600 warn lines. Rows now carry only a has_credentials
      // boolean (any of deliveredEmail/Password/ExtraDetails non-null); the
      // plaintext is served per-order by GET /orders/:id/credentials, which
      // also audits the reveal. RefundService still nulls the columns in
      // the refund tx, so refunded orders report has_credentials: false.
      has_credentials: !!(
        r.order.deliveredEmail ||
        r.order.deliveredPassword ||
        r.order.deliveredExtraDetails
      ),
      coupon_code: r.order.couponCode ?? null,
      discount_amount: r.order.discountAmount ? parseFloat(String(r.order.discountAmount)) : 0,
      created_at: r.order.createdAt?.toISOString(),
    })),
  );
});

/**
 * B6-03 (R116, credentials-on-demand): per-order credential reveal.
 *
 * The admin list route used to decrypt deliveredEmail/Password/
 * ExtraDetails for EVERY row on every refresh (up to 600 AES-GCM
 * decrypts + a 600-line safeDecrypt failure-warn flood per refresh under
 * a key mismatch). The list now returns only `has_credentials`; this
 * route is the ONLY admin surface that decrypts, and it does so for a
 * single order — deliberately an explicit, per-order action an operator
 * takes when a buyer asks for support/reconciliation.
 *
 * Contract:
 *   - requireAdmin (the parent mount adds the `orders` permission scope)
 *   - strict digit-exact :id validation (intParam — the sibling-route
 *     idiom)
 *   - 404 when the order id doesn't exist
 *   - Cache-Control: no-store (router-level middleware — credential
 *     material must never sit in an intermediary's cache)
 *   - every successful reveal writes an `order.credentials_view` audit
 *     row (who opened WHICH order's credentials — the trail B6-03 asks
 *     for now that the list no longer blanket-decrypts)
 *   - refunded orders return has_credentials:false + all nulls
 *     (RefundService nulls the columns in the refund tx); safeDecrypt
 *     passes legacy plaintext through unchanged (B2-11).
 */
router.get("/orders/:id/credentials", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // R117 (A1-P4): volume gate BEFORE any decrypt or DB row leaves the
  // process — over-budget answers 429 (Rate-Limited class) and raises a
  // deduped admin alert. fire-and-forget: the 429 is the enforcement,
  // the alert is the visibility.
  const adminReq = req as AdminAuthenticatedRequest;
  if (!recordCredentialsViewAndGate(adminReq.adminId)) {
    void logAdminAlert(
      "system",
      "نشاط غير معتاد في عرض بيانات الاعتماد",
      `المشرف «${adminReq.adminUsername ?? adminReq.adminId}» تجاوز حد عرض بيانات اعتماد الطلبات (${CREDENTIALS_VIEW_MAX} عرضًا في ${CREDENTIALS_VIEW_WINDOW_MS / 60000} دقائق) — قد تكون الجلسة مخترقة. راجع سجل التدقيق order.credentials_view فورًا.`,
      { dedupeKey: `credentials-sweep:${adminReq.adminId}`, dedupeWindowMs: 60 * 60 * 1000 },
    ).catch(() => undefined);
    return res
      .status(429)
      .setHeader("Retry-After", "300")
      .json(
        createErrorResponse(
          "تم تجاوز الحد المسموح من عمليات عرض بيانات الاعتماد — حاول لاحقًا",
          ErrorCode.RATE_LIMITED,
        ),
      );
  }

  const [order] = await db
    .select({
      id: ordersTable.id,
      orderCode: ordersTable.orderCode,
      status: ordersTable.status,
      deliveredEmail: ordersTable.deliveredEmail,
      deliveredPassword: ordersTable.deliveredPassword,
      deliveredExtraDetails: ordersTable.deliveredExtraDetails,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .limit(1);

  if (!order)
    return res.status(404).json(createErrorResponse("الطلب غير موجود", ErrorCode.NOT_FOUND));

  // Awaited (not `void`): writeAuditLog never throws by contract, and
  // awaiting keeps the audit row committed before the credential
  // material leaves the process — deterministic for the audit-trail test.
  await writeAuditLog(req, "order.credentials_view", "order", id, {
    order_code: order.orderCode,
    status: order.status,
  });

  const hasCredentials = !!(
    order.deliveredEmail ||
    order.deliveredPassword ||
    order.deliveredExtraDetails
  );
  const deliveredEmail = safeDecrypt(order.deliveredEmail);
  const deliveredPassword = safeDecrypt(order.deliveredPassword);
  const deliveredExtraDetails = safeDecrypt(order.deliveredExtraDetails);

  return res.json({
    id: order.id,
    order_code: order.orderCode,
    status: order.status,
    has_credentials: hasCredentials,
    delivered_email: deliveredEmail,
    delivered_password: deliveredPassword,
    delivered_extra_details: deliveredExtraDetails,
    // R117 (A1-P6): honest decrypt-failure signal. Under an
    // ENCRYPTION_KEY mismatch the raw columns are populated
    // (has_credentials:true) but every GCM auth fails → all nulls. The
    // pre-R117 shape rendered that as "لا توجد بيانات" (empty panel),
    // telling the operator the order HAD no credentials when the truth
    // is the key cannot decrypt them. This flag lets the UI say so.
    ...(hasCredentials && !deliveredEmail && !deliveredPassword && !deliveredExtraDetails
      ? { decrypt_failed: true }
      : {}),
  });
});

/**
 * S-01 (security audit 004) — Findings F-005 + F-008 closure.
 *
 * Bulk status update for admin orders.
 *
 * `status === "refunded"` no longer routes through the legacy raw UPDATE.
 * Each order ID is processed individually by `RefundService.refundOrder`,
 * which atomically:
 *   - flips orders.status from "completed" → "refunded" (status-guarded)
 *   - credits the user's wallet (optimistic-lock UPDATE)
 *   - inserts a wallet_ledger entry of type=refund
 *
 * Partial failures are surfaced explicitly: if 4 of 5 orders refund and
 * 1 fails (already refunded, user deleted, concurrency conflict), the
 * response carries `{ success: 4, failed: [...] }` so the admin UI can
 * communicate exactly what happened.
 *
 * For non-refund statuses (pending / completed / failed) the legacy
 * direct-UPDATE path is preserved — those transitions don't touch the
 * ledger so there's no Constitution Principle I exposure.
 *
 * The whole route is mounted behind the idempotency middleware so a
 * double-clicked "Refund 5 orders" button does not double-credit any
 * user (closes F-008).
 */
router.patch(
  "/orders/bulk-status",
  requireAdmin,
  idempotency({ routeKey: "admin.orders.bulk-status" }),
  async (req, res) => {
    const { ids, note } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json(createErrorResponse("ids مطلوبة", ErrorCode.INVALID_DATA));
    // B2-F4: element cap BEFORE any per-id work (dedup loop, IN(...) —
    // the refund path even runs one transaction + notification per id).
    if (ids.length > BULK_STATUS_MAX_IDS)
      return res
        .status(400)
        .json(
          createErrorResponse(
            `عدد الطلبات كبير جداً — الحد الأقصى ${BULK_STATUS_MAX_IDS} طلب في الدفعة الواحدة`,
            ErrorCode.INVALID_DATA,
          ),
        );
    // R116 hygiene: zod-validated status — the parsed value is a member
    // of the pg enum by construction (removes the stringly `as any`
    // downcast at the UPDATE below).
    const statusParsed = ORDER_STATUS_SCHEMA.safeParse((req.body ?? {}).status);
    if (!statusParsed.success)
      return res.status(400).json(createErrorResponse("حالة غير صالحة", ErrorCode.INVALID_DATA));
    const status: OrderStatus = statusParsed.data;
    // M4 — the old `.map(Number).filter(!isNaN)` silently DROPPED
    // non-numeric ids and reported them as updated. A client sending
    // ["12", 13] had both processed (string coercion), while ["abc", 13]
    // reported `updated: 1` with no mention of the dropped id. Now the
    // invalid entries are surfaced explicitly in the response so the
    // admin UI can render "N skipped" instead of a silent lie.
    const seen = new Set<number>();
    const numIds: number[] = [];
    const skippedInvalid: unknown[] = [];
    for (const raw of ids) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0 || seen.has(n)) {
        skippedInvalid.push(raw);
        continue;
      }
      seen.add(n);
      numIds.push(n);
    }
    if (numIds.length === 0)
      return res.status(400).json(createErrorResponse("لا معرّفات صالحة", ErrorCode.INVALID_DATA));

    const adminId = (req as { adminId?: number }).adminId;
    if (typeof adminId !== "number") {
      return res
        .status(401)
        .json(createErrorResponse("جلسة المسؤول مطلوبة", ErrorCode.UNAUTHORIZED));
    }

    if (status === "refunded") {
      // A6-01 (R116): a mass refund is a wallet-MONEY write — each id
      // routes through RefundService (optimistic wallet credit + ledger
      // row). The router mount gates this surface on the `orders` scope,
      // but money writes need `finance` exactly like every other money
      // surface (B1-3 pattern from routes/admin/users.ts:294 — topup
      // approve/reject, wallet adjustments, loyalty edits). A
      // scoped-to-orders admin can still view orders + change
      // pending/failed labels; crediting wallets is the finance line.
      // 403 (not 401): the caller IS authenticated, just under-scoped.
      const actingPerms = (req as AdminAuthenticatedRequest).adminPermissions ?? [];
      if (!hasPermission(actingPerms, PERMISSION_SCOPES.FINANCE)) {
        return res
          .status(403)
          .json(
            createErrorResponse(
              "استرداد الطلبات يتطلب صلاحية «المعاملات المالية» (finance)",
              ErrorCode.FORBIDDEN,
            ),
          );
      }
      // F-005 — per-order atomic refund. We loop sequentially rather
      // than Promise.all to keep error handling clean and to avoid
      // optimistic-lock thrash if multiple refunds touch the same user.
      //
      // F-15 (round-94 A1, socket contract): every order-updated emit
      // now carries order_code — the storefront identifies orders by
      // SN… code everywhere; the plain numeric id forced "طلبك رقم #42"
      // toasts that no UI surface could resolve. One upfront code lookup
      // for the batch (no per-refund N+1).
      const codeRows = await db
        .select({ id: ordersTable.id, orderCode: ordersTable.orderCode })
        .from(ordersTable)
        .where(inArray(ordersTable.id, numIds));
      const codeById = new Map(codeRows.map((r) => [r.id, r.orderCode]));
      const successes: number[] = [];
      const failures: Array<{ orderId: number; code: string; message: string }> = [];
      for (const orderId of numIds) {
        try {
          const result = await RefundService.refundOrder(orderId, {
            adminId,
            note: typeof note === "string" ? note : undefined,
          });
          successes.push(result.orderId);
          // A9-1 (R116): durable notification — the socket emit is
          // transient, the notifications row survives to the next visit
          // (createNotification is non-fatal by contract).
          const refundCode = codeById.get(result.orderId);
          if (refundCode) {
            await notifyOrderStatusChanged(result.userId, refundCode, status);
          }
          // Per-refund socket notification — same shape the legacy path used.
          import("../../lib/socket")
            .then(({ emitToUser }) => {
              emitToUser(result.userId, "order-updated", {
                id: result.orderId,
                status,
                order_code: codeById.get(result.orderId) ?? null,
              });
              // R104 (AG3-5): the `wallet-updated` emit is REMOVED — no
              // client listener has ever existed (grep-verified), so the
              // event was a dead no-op. The user's wallet/orders views
              // refresh via SessionActivityManager's visibility resync
              // and normal staleness.
            })
            .catch((err) => logger.warn({ err }, "socket notify failed (refund)"));
        } catch (err) {
          if (err instanceof RefundError) {
            failures.push({ orderId, code: err.code, message: err.message });
          } else {
            // Anything else is a programming error / DB outage — let it
            // propagate so the admin sees a 500 and the request is not
            // silently swallowed.
            throw err;
          }
        }
      }

      import("../../lib/socket")
        .then(({ emitToAdmins }) => {
          emitToAdmins("admin-stats-update", {
            type: "order-bulk-update",
            status,
            succeeded: successes.length,
            failed: failures.length,
          });
        })
        .catch((err) => logger.warn({ err }, "socket admin-stats notify failed"));

      void writeAuditLog(req, "order.bulk_refund", "order", null, {
        ids: numIds,
        succeeded: successes,
        failed: failures.map((f) => ({ orderId: f.orderId, code: f.code })),
        count_requested: numIds.length,
        count_succeeded: successes.length,
        count_failed: failures.length,
      });

      // 2026-09-20 (free-infrastructure round): a refund fires the stock
      // sweep — B2-03 semantics mean it does NOT return the unit (the
      // buyer already saw the credentials; is_sold stays true), but the
      // refund DOES surface the product in the operator's re-stock
      // workflow, so re-evaluating low/zero-stock right after a refund
      // batch is still the honest moment. Trigger the sweep (throttled
      // 10 min; was a 30-minute timer).
      if (successes.length > 0) {
        fireThrottledMaintenance("stock-sweep", 10 * 60 * 1000, runStockSweep);
      }

      // Honour the legacy success shape when the entire batch refunds:
      // existing admin UI calls expect `{ success: true, updated: <n> }`.
      // When there are failures, surface them so the admin UI can render
      // a per-order breakdown.
      if (failures.length === 0) {
        return res.json({ success: true, updated: successes.length });
      }
      return res.status(207).json({
        success: failures.length === 0,
        updated: successes.length,
        failed: failures,
      });
    }

    // Non-refund status transitions — direct UPDATE preserved, but with
    // state-machine guards:
    //
    // (a) r4 red-team F-1: the raw UPDATE previously allowed
    // `refunded → completed`, which re-armed RefundService's only
    // double-refund protection (the status column). An order that has
    // been refunded can NEVER be un-refunded through this endpoint —
    // refunds are terminal.
    //
    // (b) F3 (round-94 A4): the same hole one step removed —
    // `failed/pending → completed` then `completed → refunded` credited
    // the wallet with NO corresponding purchase debit (failed/pending
    // orders never charged anyone; the purchase tx writes "completed"
    // directly). "completed" is therefore purchase-tx-only: the only
    // rows a bulk update may set to completed are the ones ALREADY
    // completed (an idempotent no-op re-affirmation). Everything else
    // is skipped with an honest reason, mirroring the refunded guard.
    //
    // (c) F2 (round-98 A3): the mirror image of (b) — the old guard for
    // pending/failed targets was `ne(status, "refunded")`, so a bulk
    // demotion `completed → pending/failed` was allowed. That killed the
    // buyer's credential access (formatOrder gates every delivered_*
    // field on status === "completed") AND made the order permanently
    // un-refundable: RefundService requires completed, and guard (b)
    // blocks re-entering completed — the sanctioned money-return path
    // was dead for that order, with no side effect fired (user paid,
    // lost access). "completed" can now only be left via RefundService
    // (completed → refunded, terminal), so pending/failed targets accept
    // exactly the pending/failed source states (pending ↔ failed stay
    // mutually reachable).
    //
    // The UPDATE is also rows-affected honest (r4 red-team F-4): the
    // response reports how many rows ACTUALLY transitioned, not
    // `numIds.length` (valid-but-nonexistent or guarded ids are
    // counted as skipped, not as updated).
    const guard =
      status === "completed"
        ? and(inArray(ordersTable.id, numIds), eq(ordersTable.status, "completed"))
        : and(inArray(ordersTable.id, numIds), inArray(ordersTable.status, ["pending", "failed"]));
    const flippedRows = await db.update(ordersTable).set({ status }).where(guard).returning({
      id: ordersTable.id,
      userId: ordersTable.userId,
      orderCode: ordersTable.orderCode,
    });
    const updatedCount = flippedRows.length;

    // Distinguish WHY each missed id was skipped so the admin sees an
    // honest breakdown instead of a lumped count.
    const flippedIdSet = new Set(flippedRows.map((r) => r.id));
    const missedIds = numIds.filter((id) => !flippedIdSet.has(id));
    let skippedRefunded = 0;
    let skippedBlockedCompletion = 0;
    let skippedCompletedSource = 0;
    if (missedIds.length > 0) {
      const missedRows = await db
        .select({ id: ordersTable.id, status: ordersTable.status })
        .from(ordersTable)
        .where(inArray(ordersTable.id, missedIds));
      for (const row of missedRows) {
        if (row.status === "refunded") skippedRefunded += 1;
        else if (row.status === "completed")
          skippedCompletedSource += 1; // completed → pending/failed blocked (F2)
        else skippedBlockedCompletion += 1; // pending/failed → completed blocked (F3)
      }
    }
    const skippedMissing =
      missedIds.length - skippedRefunded - skippedBlockedCompletion - skippedCompletedSource;

    // Notify affected users
    const updatedOrders = flippedRows;

    // F-9 (R118-A6): the durable notification rows ride ONE batched
    // INSERT (notifyOrderStatusChangedBatch) instead of the old
    // per-order awaited loop (N sequential single-row INSERTs). The
    // A9-1 (R116) durable-notification guarantee itself is unchanged —
    // an offline buyer still finds out their order moved.
    await notifyOrderStatusChangedBatch(updatedOrders, status);
    for (const o of updatedOrders) {
      import("../../lib/socket")
        .then(({ emitToUser }) => {
          // F-15 (round-94 A1): order_code rides the payload — the
          // storefront's toast/order-detail identify orders by code.
          emitToUser(o.userId, "order-updated", {
            id: o.id,
            status,
            order_code: o.orderCode,
          });
        })
        .catch((err) => logger.warn({ err }, "socket notify failed (bulk status)"));
    }
    import("../../lib/socket")
      .then(({ emitToAdmins }) => {
        emitToAdmins("admin-stats-update", { type: "order-bulk-update", status });
      })
      .catch((err) => logger.warn({ err }, "socket admin-stats notify failed"));

    void writeAuditLog(req, "order.bulk_status_update", "order", null, {
      ids: numIds,
      new_status: status,
      count_updated: updatedCount,
      count_requested: numIds.length,
      skipped_invalid: skippedInvalid.length,
      skipped_refunded: skippedRefunded,
      skipped_blocked_completion: skippedBlockedCompletion,
      skipped_completed_source: skippedCompletedSource,
      skipped_missing: skippedMissing,
    });

    // `updated` now reflects actual rows transitioned. Orders in terminal
    // (refunded) or purchase-tx-owned (completed) states and ids that
    // don't exist are counted separately instead of being reported as
    // successes.
    return res.json({
      success: true,
      updated: updatedCount,
      ...(skippedInvalid.length > 0 ? { skipped_invalid: skippedInvalid.length } : {}),
      ...(skippedRefunded > 0
        ? { skipped_refunded: skippedRefunded, reason: "REFUNDED_IS_TERMINAL" }
        : {}),
      ...(skippedBlockedCompletion > 0
        ? {
            skipped_blocked_completion: skippedBlockedCompletion,
            reason: "COMPLETED_IS_PURCHASE_ONLY",
          }
        : {}),
      ...(skippedCompletedSource > 0
        ? {
            skipped_completed_source: skippedCompletedSource,
            reason: "COMPLETED_NOT_DEMOTABLE",
          }
        : {}),
      ...(skippedMissing > 0 ? { skipped_missing: skippedMissing } : {}),
    });
  },
);

export { router as adminOrdersRouter };
