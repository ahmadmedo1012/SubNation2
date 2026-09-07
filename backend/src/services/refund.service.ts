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
import { logAdminAlert, type AlertType } from "../jobs/alertLogger";
import { insertLedgerEntry } from "../lib/ledger";
import { computeTier } from "../lib/loyalty-tiers";

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

    let revokedLiveCredentials = false;
    let orderCodeForAlert: string | null = null;

    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          id: ordersTable.id,
          userId: ordersTable.userId,
          amount: ordersTable.amount,
          status: ordersTable.status,
          orderCode: ordersTable.orderCode,
          deliveredPassword: ordersTable.deliveredPassword,
          deliveredEmail: ordersTable.deliveredEmail,
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
        .select({
          walletBalance: usersTable.walletBalance,
          loyaltyPoints: usersTable.loyaltyPoints,
          lifetimeSpend: usersTable.lifetimeSpend,
        })
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

      // Loyalty reversal — mirror of checkout.service award: refunded money
      // must not keep its points, lifetime spend, or tier. Floor at zero so a
      // partially-spent balance can't go negative.
      const pointsToRevoke = Math.min(Math.floor(amount), user.loyaltyPoints);
      const newPoints = user.loyaltyPoints - pointsToRevoke;
      const newLifetimeSpend = +Math.max(
        0,
        parseFloat(String(user.lifetimeSpend)) - amount,
      ).toFixed(2);

      // B2-01 (round-92 audit): extend the optimistic-lock predicate to the
      // FULL write set — walletBalance AND loyaltyPoints AND lifetimeSpend.
      // The old predicate matched only walletBalance, so a concurrent
      // points-only writer (referral +50 on a referee's topup approval,
      // admin points-set) committed between this tx's read and its UPDATE
      // left the balance predicate intact and the stale points value
      // silently erased the award — the exact M3 lost-update class round-4
      // fixed for checkout (points are LYD-convertible at 100:1 → money).
      // Numeric equality is value-based in Postgres ("100.50" = '100.5'),
      // so the String(parseFloat(...)) round-trip below matches regardless
      // of the stored scale.
      const walletUpdated = await tx
        .update(usersTable)
        .set({
          walletBalance: String(balanceAfter),
          loyaltyPoints: newPoints,
          lifetimeSpend: String(newLifetimeSpend),
          loyaltyTier: computeTier(newLifetimeSpend),
        })
        .where(
          and(
            eq(usersTable.id, order.userId),
            eq(usersTable.walletBalance, String(balanceBefore)),
            eq(usersTable.loyaltyPoints, user.loyaltyPoints),
            eq(usersTable.lifetimeSpend, String(parseFloat(String(user.lifetimeSpend)))),
          ),
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

      // B2-03 (round-92 audit): revoke the delivered credentials inside the
      // refund transaction. Previously a refund restored the wallet AND left
      // delivered_password/delivered_email readable forever — every refund of
      // a delivered digital good was a buy → view → refund → keep-the-account
      // giveaway. Nulling the columns (same tx → atomic with the credit) makes
      // the buyer's copy unusable going forward; the inventory row keeps its
      // is_sold/sold_at history for reconciliation. (The account itself must
      // still be rotated upstream — see the ops alert emitted post-commit.)
      if (order.deliveredPassword !== null || order.deliveredEmail !== null) {
        await tx
          .update(ordersTable)
          .set({ deliveredPassword: null, deliveredEmail: null })
          .where(eq(ordersTable.id, orderId))
          .returning({ id: ordersTable.id });
        revokedLiveCredentials = true;
        orderCodeForAlert = order.orderCode;
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

    // B2-03: operations signal — the refund just revoked credentials that the
    // buyer has ALREADY seen. The password may still work upstream until the
    // account is rotated; tell ops to rotate it. Emitted AFTER the tx commits
    // (a pre-commit emission would survive a rollback as a false positive —
    // logAdminAlert writes through its own connection, not this tx). Dedupe
    // key makes repeated refunds of the same order alert once per window.
    if (revokedLiveCredentials) {
      void logAdminAlert(
        // AlertType is a closed TS union over a free varchar(30) column; the
        // alerts drawer falls back to the "system" badge for unknown types,
        // so a new type string is safe without touching jobs/alertLogger.ts
        // (owned by another agent this round).
        "refunded_live_credentials" as unknown as AlertType,
        `استرداد طلب ببيانات تسليم حية: ${orderCodeForAlert ?? orderId}`,
        `استُرد الطلب #${orderId} بينما كانت بيانات التسليم قد سُلّمت للعميل ومُحيت الآن من قاعدة البيانات — يلزم تدوير كلمة مرور الحساب المصدر فوراً لمنع إساءة الاستخدام.`,
        { dedupeKey: `refund:creds:${orderId}` },
      );
    }

    return result;
  }
}
