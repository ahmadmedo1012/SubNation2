/**
 * RefundService — F-005 (security audit 004) bundle S-01.
 *
 * Atomic admin-side order refund. Replaces the previous behaviour of
 * `PATCH /api/admin/orders/bulk-status status=refunded`, which updated
 * `orders.status` only — leaving the customer's wallet untouched and
 * the ledger silent. A "refunded" order looked refunded but the user
 * never got their money back, and there was no audit trail to explain
 * the gap.
 *
 * Per-order refund flow (transactional):
 *   1. Re-read the order inside the tx; reject if it is not in a
 *      refundable state ("completed" — not "pending", "failed", or
 *      already "refunded"). Idempotent by status: a second refund for
 *      the same order returns ALREADY_REFUNDED.
 *   2. Re-read the user's current wallet balance (optimistic-lock
 *      pattern). If the user no longer exists (deleted account) the
 *      refund cannot be credited — reject as USER_NOT_FOUND.
 *   3. Compute the credit amount from `orders.amount` (the price the
 *      user actually paid, NOT the list price — coupons / flash sales
 *      already applied). UPDATE wallet with the optimistic-lock guard;
 *      throw on rowsAffected = 0.
 *   4. Insert a `wallet_ledger` row of type=`refund` referencing the
 *      order. balanceBefore + amount = balanceAfter — same shape as
 *      every other monetary entry.
 *   5. Flip `orders.status` to `refunded` with a status-guarded UPDATE
 *      (refundable → refunded). Two-step protection against concurrent
 *      refunds: the predicate-lock at step (5) means a parallel admin
 *      attempting the same refund will get rowsAffected = 0 and the
 *      whole transaction rolls back — the second admin sees
 *      ALREADY_REFUNDED, and the user is credited exactly once.
 *
 * The bulk endpoint maps to per-order calls so a partial-failure mode
 * is surfaced cleanly (some refunds succeeded, others failed with
 * specific reasons).
 *
 * Closes audit Finding F-005 (specs/004-security-audit/security.md).
 * F-008's idempotency requirement is satisfied at the route layer by
 * the idempotency middleware in `middlewares/idempotency.ts`.
 */

import { db, ordersTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { insertLedgerEntry } from "../lib/ledger";

export class RefundError extends Error {
  constructor(
    public statusCode: number,
    public code: RefundErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RefundError";
  }
}

export type RefundErrorCode =
  | "ORDER_NOT_FOUND"
  | "NOT_REFUNDABLE"
  | "ALREADY_REFUNDED"
  | "USER_NOT_FOUND"
  | "CONCURRENCY_ERROR";

export interface RefundResult {
  orderId: number;
  userId: number;
  amount: number;
  walletBalance: number;
}

export interface RefundOptions {
  adminId: number;
  note?: string;
}

export class RefundService {
  /**
   * Refund a single order. Atomic: status flip + wallet credit + ledger
   * entry all commit together or none.
   */
  static async refundOrder(orderId: number, options: RefundOptions): Promise<RefundResult> {
    const { adminId, note } = options;

    return db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          id: ordersTable.id,
          userId: ordersTable.userId,
          amount: ordersTable.amount,
          status: ordersTable.status,
          orderCode: ordersTable.orderCode,
        })
        .from(ordersTable)
        .where(eq(ordersTable.id, orderId))
        .limit(1);

      if (!order) {
        throw new RefundError(404, "ORDER_NOT_FOUND", "الطلب غير موجود");
      }

      if (order.status === "refunded") {
        throw new RefundError(409, "ALREADY_REFUNDED", "تم استرداد هذا الطلب من قبل");
      }
      if (order.status !== "completed") {
        throw new RefundError(
          400,
          "NOT_REFUNDABLE",
          "لا يمكن استرداد طلب لم يكتمل (الحالة الحالية لا تسمح بالاسترداد)",
        );
      }

      const amount = parseFloat(String(order.amount));

      const [user] = await tx
        .select({ walletBalance: usersTable.walletBalance })
        .from(usersTable)
        .where(eq(usersTable.id, order.userId))
        .limit(1);
      if (!user) {
        throw new RefundError(
          404,
          "USER_NOT_FOUND",
          "المستخدم المرتبط بالطلب غير موجود — لا يمكن إعادة الرصيد",
        );
      }

      const balanceBefore = parseFloat(String(user.walletBalance));
      const balanceAfter = +(balanceBefore + amount).toFixed(2);

      // Optimistic-lock wallet credit (same pattern as topup approval +
      // checkout debit).
      const walletUpdated = await tx
        .update(usersTable)
        .set({ walletBalance: String(balanceAfter) })
        .where(
          and(eq(usersTable.id, order.userId), eq(usersTable.walletBalance, String(balanceBefore))),
        )
        .returning({ id: usersTable.id });
      if (walletUpdated.length !== 1) {
        throw new RefundError(
          409,
          "CONCURRENCY_ERROR",
          "تغيّر رصيد المستخدم أثناء الاسترداد. حاول مرة أخرى.",
        );
      }

      // Status flip: completed → refunded. Status-guarded so concurrent
      // refunds from two admins serialize cleanly — second one sees
      // rowsAffected=0 and the whole tx rolls back; user is credited once.
      const statusFlipped = await tx
        .update(ordersTable)
        .set({ status: "refunded" })
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "completed")))
        .returning({ id: ordersTable.id });
      if (statusFlipped.length !== 1) {
        throw new RefundError(409, "ALREADY_REFUNDED", "تم استرداد هذا الطلب بواسطة عملية أخرى");
      }

      const description =
        (note ?? "").trim().length > 0
          ? `Refund for order ${order.orderCode}: ${(note ?? "").trim().slice(0, 400)}`
          : `Refund for order ${order.orderCode}`;

      await insertLedgerEntry(
        {
          userId: order.userId,
          type: "refund",
          amount: String(amount),
          balanceBefore: String(balanceBefore),
          balanceAfter: String(balanceAfter),
          referenceId: orderId,
          referenceType: "order",
          description: description.slice(0, 500),
        },
        tx as unknown as typeof db,
      );

      // Audit-trail breadcrumb for who did it. `adminId` reaches the
      // ledger via referenceId-on-adjustments elsewhere; refunds use
      // referenceId for the order (more useful for reconciliation), so
      // adminId rides the audit log layer at the route level instead.
      void adminId;

      return {
        orderId,
        userId: order.userId,
        amount,
        walletBalance: balanceAfter,
      };
    });
  }
}
