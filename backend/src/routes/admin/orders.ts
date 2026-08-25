import { db, ordersTable, productsTable, usersTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { safeDecrypt } from "../../lib/encryption";
import { queryString } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { idempotency } from "../../middlewares/idempotency";
import { RefundError, RefundService } from "../../services/refund.service";

const router = Router();

router.get("/orders", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(
    Math.max(Number.parseInt(queryString(req, "limit", "100"), 10) || 100, 1),
    200,
  );
  const page = Math.max(Number.parseInt(queryString(req, "page", "1"), 10) || 1, 1);
  const conditions =
    status && typeof status === "string" ? [eq(ordersTable.status, status as any)] : [];

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
      delivered_email: r.order.deliveredEmail ?? null,
      delivered_password: safeDecrypt(r.order.deliveredPassword),
      delivered_extra_details: r.order.deliveredExtraDetails ?? null,
      coupon_code: r.order.couponCode ?? null,
      discount_amount: r.order.discountAmount ? parseFloat(String(r.order.discountAmount)) : 0,
      created_at: r.order.createdAt?.toISOString(),
    })),
  );
});

// Must match the order_status pg enum (shared/db/src/schema/orders.ts).
const ORDER_STATUS_VALUES = ["pending", "completed", "failed", "refunded"] as const;

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
    const { ids, status, note } = req.body ?? {};
    const ALLOWED: readonly string[] = ORDER_STATUS_VALUES;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json(createErrorResponse("ids مطلوبة", ErrorCode.INVALID_DATA));
    if (!status || !ALLOWED.includes(status))
      return res.status(400).json(createErrorResponse("حالة غير صالحة", ErrorCode.INVALID_DATA));
    const numIds: number[] = ids.map(Number).filter((n) => !isNaN(n));
    if (numIds.length === 0)
      return res.status(400).json(createErrorResponse("لا معرّفات صالحة", ErrorCode.INVALID_DATA));

    const adminId = (req as { adminId?: number }).adminId;
    if (typeof adminId !== "number") {
      return res
        .status(401)
        .json(createErrorResponse("جلسة المسؤول مطلوبة", ErrorCode.UNAUTHORIZED));
    }

    if (status === "refunded") {
      // F-005 — per-order atomic refund. We loop sequentially rather
      // than Promise.all to keep error handling clean and to avoid
      // optimistic-lock thrash if multiple refunds touch the same user.
      const successes: number[] = [];
      const failures: Array<{ orderId: number; code: string; message: string }> = [];
      for (const orderId of numIds) {
        try {
          const result = await RefundService.refundOrder(orderId, {
            adminId,
            note: typeof note === "string" ? note : undefined,
          });
          successes.push(result.orderId);
          // Per-refund socket notification — same shape the legacy path used.
          import("../../lib/socket")
            .then(({ emitToUser }) => {
              emitToUser(result.userId, "order-updated", { id: result.orderId, status });
              emitToUser(result.userId, "wallet-updated", {
                walletBalance: result.walletBalance,
              });
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

    // Non-refund status transitions — direct UPDATE preserved.
    await db
      .update(ordersTable)
      .set({ status: status as any })
      .where(sql`id = ANY(${numIds})`);

    // Notify affected users
    const updatedOrders = await db
      .select({ id: ordersTable.id, userId: ordersTable.userId })
      .from(ordersTable)
      .where(sql`id = ANY(${numIds})`);

    for (const o of updatedOrders) {
      import("../../lib/socket")
        .then(({ emitToUser }) => {
          emitToUser(o.userId, "order-updated", { id: o.id, status });
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
      count: numIds.length,
    });

    return res.json({ success: true, updated: numIds.length });
  },
);

export { router as adminOrdersRouter };
