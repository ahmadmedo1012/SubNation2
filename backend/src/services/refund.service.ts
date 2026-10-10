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
 *   6. Return the coupon redemption slot the order consumed at checkout
 *      (F3, round-98 A3): guarded `used_count` decrement on
 *      `orders.coupon_code`, inside the same transaction and covered by
 *      the same exactly-once status guard as the credit.
 *
 * The bulk endpoint maps to per-order calls so a partial-failure mode
 * is surfaced cleanly (some refunds succeeded, others failed with
 * specific reasons).
 *
 * Closes audit Finding F-005 (specs/004-security-audit/security.md).
 * F-008's idempotency requirement is satisfied at the route layer by
 * the idempotency middleware in `middlewares/idempotency.ts`.
 */

import {
  couponsTable,
  db,
  ordersTable,
  providerFulfillmentsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { logAdminAlert, type AlertType } from "../jobs/alertLogger";
import { roundLyd } from "../lib/money";
import { insertLedgerEntry } from "../lib/ledger";
import { computeTier } from "../lib/loyalty-policy";
import {
  findRefundReversal,
  insertPointsLedgerEntry,
  remainingAwardForOrder,
} from "../lib/points-ledger";
import { getFulfillmentProvider } from "./providers/registry";

/**
 * R102 (provider-readiness): the provider order reference for a refunded
 * order, from the fulfillment audit trail (latest succeeded attempt).
 * Null when the order was fulfilled manually (no provider order id) or
 * the trail is absent — both mean "nothing to release".
 */
async function lookupProviderOrderId(orderId: number): Promise<string | null> {
  const [row] = await db
    .select({ providerOrderId: providerFulfillmentsTable.providerOrderId })
    .from(providerFulfillmentsTable)
    .where(
      and(
        eq(providerFulfillmentsTable.orderId, orderId),
        eq(providerFulfillmentsTable.status, "succeeded"),
      ),
    )
    .orderBy(sql`${providerFulfillmentsTable.attempt} DESC`)
    .limit(1);
  return row?.providerOrderId ?? null;
}

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
          couponCode: ordersTable.couponCode,
          deliveredPassword: ordersTable.deliveredPassword,
          deliveredEmail: ordersTable.deliveredEmail,
          deliveredExtraDetails: ordersTable.deliveredExtraDetails,
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
      // B4-F5 (R128): roundLyd, not +toFixed(2) — identical on today's
      // already-2dp operands, hazard-proof for a future writer (lib/money.ts).
      const balanceAfter = roundLyd(balanceBefore + amount);

      // R115 (Part 9): PRECISE reversal — revoke exactly the unspent
      // remainder of THIS order's award, never points from other sources.
      //
      // remainingAwardForOrder replays the user's points_ledger as a FIFO
      // source pool: conversions spend the OLDEST points first, so the
      // order's own award is "still in the pool" only to the extent the
      // user did not convert it away. Three outcomes:
      //   precise:true  → revoke min(remaining, balance)
      //   precise:false + award row (post-admin-rebalance) → bounded cap:
      //                     revoke min(awarded − alreadyRevoked, balance)
      //   no award row (pre-V1-M21 order) → legacy frozen formula
      //                     floor(orders.amount) — derivable from the row
      // Spent points are NOT clawed back from the wallet (converted value
      // is gone money — admin-gated business cost, documented in
      // docs/loyalty/FINAL_LOYALTY_POLICY.md). Unrelated points (referral,
      // welcome, admin grants) are untouchable by construction.
      const awardRow = await remainingAwardForOrder(
        order.userId,
        orderId,
        tx as unknown as typeof db,
      );
      const priorReversal = await findRefundReversal(orderId, tx as unknown as typeof db);
      const alreadyRevoked = priorReversal ? -priorReversal.pointsDelta : 0;
      let awardRemainder: number;
      if (awardRow.precise) {
        awardRemainder = awardRow.remaining;
      } else if (awardRow.remaining > 0 || alreadyRevoked > 0) {
        // Award row exists but attribution was broken by a later admin
        // rebalance — bounded cap semantics.
        awardRemainder = awardRow.remaining;
      } else {
        // No award row at all — pre-ledger order: the frozen historical
        // formula, derivable from orders.amount itself.
        awardRemainder = Math.max(0, Math.floor(amount) - alreadyRevoked);
      }
      const pointsToRevoke = Math.min(awardRemainder, user.loyaltyPoints);
      const pointsBeforeReversal = user.loyaltyPoints;
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
      // R115 (V1-M22): the flip also writes the first-class refund
      // reconciliation columns (refunded_at / refund_amount / refunded_by).
      const statusFlipped = await tx
        .update(ordersTable)
        .set({
          status: "refunded",
          refundedAt: new Date(),
          refundAmount: String(amount),
          refundedByAdminId: adminId,
        })
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "completed")))
        .returning({ id: ordersTable.id });
      if (statusFlipped.length !== 1) {
        throw new RefundError(409, "ALREADY_REFUNDED", "تم استرداد هذا الطلب بواسطة عملية أخرى");
      }

      // F3 (round-98 A3): return the coupon redemption slot this order
      // burned at checkout. The purchase tx increments used_count exactly
      // once per order (checkout.service.ts); without a symmetric decrement
      // every refund permanently shrank the campaign budget — a refunded
      // sale kept consuming a slot (a maxUses=1 coupon stayed exhausted
      // forever; refund cycles on a maxUses=10 campaign silently drained
      // the real budget to 0 while used_count said 10).
      //
      // Exactly-once via the same status guard above: the guarded flip from
      // "completed" is the single admission ticket into this branch — a
      // concurrent or repeated refund throws at the flip and the whole tx
      // (wallet credit included) rolls back before reaching this write.
      // `used_count > 0` keeps the floor at zero for legacy rows whose slot
      // was already consumed elsewhere; a deleted coupon row simply matches
      // nothing — the budget concern dies with the row.
      if (order.couponCode !== null) {
        await tx
          .update(couponsTable)
          .set({ usedCount: sql`GREATEST(${couponsTable.usedCount} - 1, 0)` })
          .where(and(eq(couponsTable.code, order.couponCode), gt(couponsTable.usedCount, 0)));
      }

      // B2-03 (round-92 audit): revoke the delivered credentials inside the
      // refund transaction. Previously a refund restored the wallet AND left
      // delivered_password/delivered_email readable forever — every refund of
      // a delivered digital good was a buy → view → refund → keep-the-account
      // giveaway. Nulling the columns (same tx → atomic with the credit) makes
      // the buyer's copy unusable going forward; the inventory row keeps its
      // is_sold/sold_at history for reconciliation. (The account itself must
      // still be rotated upstream — see the ops alert emitted post-commit.)
      //
      // P0-sim chain (round-93 live simulation, 93-SIM-live-findings):
      // delivered_extra_details is credential material too — for code-only
      // inventory, checkout stores the delivered CODE in that column
      // (admin/products.ts: `extraDetails: code`), and for credential rows
      // it carries the account's extra secret material. It was NOT nulled
      // here, so a refunded order kept a live credential sitting in the
      // orders row (sim-verified STILL-SET after refund). delivered_usage_
      // terms is deliberately NOT nulled: it is product-catalog text
      // (products.usage_terms — visible on the storefront before purchase,
      // never per-unit material); the API boundary (formatOrder) gates it
      // behind status === "completed" instead.
      if (
        order.deliveredPassword !== null ||
        order.deliveredEmail !== null ||
        order.deliveredExtraDetails !== null
      ) {
        await tx
          .update(ordersTable)
          .set({
            deliveredPassword: null,
            deliveredEmail: null,
            deliveredExtraDetails: null,
          })
          .where(eq(ordersTable.id, orderId))
          .returning({ id: ordersTable.id });
        revokedLiveCredentials = true;
        orderCodeForAlert = order.orderCode;
      }

      const description =
        (note ?? "").trim().length > 0
          ? `Refund for order ${order.orderCode}: ${(note ?? "").trim().slice(0, 400)}`
          : `Refund for order ${order.orderCode}`;

      // R115 (Part 8/9): attribute the reversal in points_ledger — same
      // tx, referencing THIS order. delta is strictly negative; a zero
      // revoke (award already fully spent) writes NO row (the ledger's
      // delta<>0 CHECK) — the orders.refund_* columns then carry the
      // story. The partial UNIQUE (refund_reversal, order) makes a double
      // reversal structurally impossible even if two refunds raced past
      // the status guard.
      if (pointsToRevoke > 0) {
        await insertPointsLedgerEntry(
          {
            userId: order.userId,
            type: "refund_reversal",
            pointsDelta: -pointsToRevoke,
            pointsBefore: pointsBeforeReversal,
            pointsAfter: newPoints,
            referenceId: orderId,
            referenceType: "order",
          },
          tx as unknown as typeof db,
        );
      }

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

      // Audit-trail breadcrumb for who did it. R115: adminId is now also
      // persisted first-class on the order (orders.refunded_by_admin_id,
      // V1-M22); refunds keep referenceId = orderId here (more useful for
      // reconciliation) and the audit log layer at the route level stays
      // the secondary trail.

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

    // R102 (provider-readiness): optional provider-side recovery — if the
    // fulfilling provider supports release (returned-to-provider refunds),
    // notify it AFTER the refund tx commits. Fire-and-forget BY DESIGN:
    // a provider outage must never fail the already-committed refund; the
    // attempt is recoverable via the provider_fulfillments audit trail and
    // a later reconciliation pass. ManualProvider exposes no release()
    // (B2-03: revoke-not-return), so this whole block is a no-op today.
    const refundProvider = getFulfillmentProvider();
    if (typeof refundProvider.release === "function") {
      const providerOrderId = await lookupProviderOrderId(orderId).catch(() => null);
      if (providerOrderId) {
        void refundProvider
          .release(providerOrderId)
          .catch((err) =>
            logAdminAlert(
              "system",
              `فشل إخطار المورد بالاسترداد: ${orderCodeForAlert ?? orderId}`,
              `استُرد الطلب #${orderId} لكن نداء release للمورد فشل — الاسترداد مُلتزم محلياً؛ سيتولى التسوية اللاحقة. الخطأ: ${
                err instanceof Error ? err.message : String(err)
              }`,
              { dedupeKey: `refund:release_failed:${orderId}` },
            ),
          );
      }
    }

    return result;
  }
}
