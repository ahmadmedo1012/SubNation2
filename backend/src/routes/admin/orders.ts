import { db, ordersTable, productsTable, usersTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { safeDecrypt } from "../../lib/encryption";
import { queryString } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { idempotency } from "../../middlewares/idempotency";
import { RefundError, RefundService } from "../../services/refund.service";
import { fireThrottledMaintenance } from "../../lib/opportunistic";
import { runStockSweep } from "../../jobs/stockWatcher";

const router = Router();

// Must match the order_status pg enum (shared/db/src/schema/orders.ts).
const ORDER_STATUS_VALUES = ["pending", "completed", "failed", "refunded"] as const;

router.get("/orders", requireAdmin, async (req, res) => {
  // A5-03 (round-94): `?status=` feeds the order_status pg-enum column —
  // an out-of-enum value used to reach Postgres as 22P02 → 500. Validate
  // up front: bad value → 400 INVALID_DATA with the allowed values.
  const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
  if (statusRaw !== undefined && !(ORDER_STATUS_VALUES as readonly string[]).includes(statusRaw)) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "حالة طلب غير صالحة (المسموح: pending, completed, failed, refunded)",
          ErrorCode.INVALID_DATA,
        ),
      );
  }
  const conditions = statusRaw !== undefined ? [eq(ordersTable.status, statusRaw as any)] : [];

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
    const like = `%${search.toLowerCase()}%`;
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
      // P0-sim (round-93 live simulation, 93-SIM-live-findings): the admin
      // order table had the SAME asymmetry as formatOrder — decrypted
      // password next to raw (still-encrypted) delivered_email /
      // delivered_extra_details, so the expanded order cell showed hex
      // ciphertext where the account email/details should be. Admins DO
      // get to see credentials for completed orders (support/reconciliation
      // tool); RefundService nulls the columns in the refund tx, so
      // refunded orders show null here. safeDecrypt passes legacy
      // plaintext through unchanged (B2-11 for auth failures).
      delivered_email: safeDecrypt(r.order.deliveredEmail),
      delivered_password: safeDecrypt(r.order.deliveredPassword),
      delivered_extra_details: safeDecrypt(r.order.deliveredExtraDetails),
      coupon_code: r.order.couponCode ?? null,
      discount_amount: r.order.discountAmount ? parseFloat(String(r.order.discountAmount)) : 0,
      created_at: r.order.createdAt?.toISOString(),
    })),
  );
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
    const { ids, status, note } = req.body ?? {};
    const ALLOWED: readonly string[] = ORDER_STATUS_VALUES;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json(createErrorResponse("ids مطلوبة", ErrorCode.INVALID_DATA));
    if (!status || !ALLOWED.includes(status))
      return res.status(400).json(createErrorResponse("حالة غير صالحة", ErrorCode.INVALID_DATA));
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
          // Per-refund socket notification — same shape the legacy path used.
          import("../../lib/socket")
            .then(({ emitToUser }) => {
              emitToUser(result.userId, "order-updated", {
                id: result.orderId,
                status,
                order_code: codeById.get(result.orderId) ?? null,
              });
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

      // 2026-09-20 (free-infrastructure round): a refund RETURNS inventory
      // — one of the only events that changes stock. Trigger the
      // low/zero-stock sweep (throttled 10 min; was a 30-minute timer).
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
    const flippedRows = await db
      .update(ordersTable)
      .set({ status: status as any })
      .where(guard)
      .returning({
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
