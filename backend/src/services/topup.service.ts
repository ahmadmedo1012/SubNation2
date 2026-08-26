import { db, referralEventsTable, usersTable, walletTopupsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { insertLedgerEntry } from "../lib/ledger";
import { POINTS_PER_REFERRAL } from "../lib/loyalty-tiers";
import { emitToAdmins, emitToUser } from "../lib/socket";
import { createNotification } from "../notify";
import { notifyTopupApproved, notifyTopupRejected } from "../telegram";

// ── Topup Service ─────────────────────────────────────────────────────────────

export class TopupService {
  /** Create and immediately approve a topup (for automated gateways) */
  static async createApprovedTopup(userId: number, amount: number, provider: string, ref: string) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (!user) throw new ServiceError(404, "المستخدم غير موجود");

    const topup = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(walletTopupsTable)
        .values({
          userId,
          amount: String(amount),
          paymentMethod: "automated",
          paymentNetwork: provider,
          paymentReference: ref,
          status: "approved",
          reviewedAt: new Date(),
          adminNote: "شحن تلقائي عبر بوابة الدفع",
        })
        .returning();

      // F-007 (security audit 004) — same optimistic-lock pattern as the
      // manual approve() path. Re-read the wallet balance inside the
      // transaction; lock the UPDATE on `walletBalance = balanceBefore`
      // so a concurrent purchase or another topup approval cannot drop
      // this credit silently. If the predicate fails the whole tx
      // (including the inserted topup row) rolls back; the gateway
      // retry will succeed against the new balance state.
      const [freshUser] = await tx
        .select({ walletBalance: usersTable.walletBalance })
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .limit(1);
      if (!freshUser) throw new ServiceError(404, "المستخدم غير موجود");

      const balanceBefore = parseFloat(String(freshUser.walletBalance));
      const newBalance = +(balanceBefore + amount).toFixed(2);
      const updated = await tx
        .update(usersTable)
        .set({
          walletBalance: String(newBalance),
        })
        .where(and(eq(usersTable.id, user.id), eq(usersTable.walletBalance, String(balanceBefore))))
        .returning({ id: usersTable.id });
      if (updated.length !== 1) {
        throw new ServiceError(409, "تغيّر رصيد المستخدم أثناء الشحن. حاول مرة أخرى.");
      }

      // Atomic ledger entry — rolls back with the rest if it fails.
      await insertLedgerEntry(
        {
          userId: user.id,
          type: "topup",
          amount: String(amount),
          balanceBefore: String(balanceBefore),
          balanceAfter: String(newBalance),
          referenceId: t.id,
          referenceType: "wallet_topup",
          description: `Automated topup (${provider}): ${amount.toFixed(2)} د.ل`,
        },
        tx as unknown as typeof db,
      );

      return t;
    });

    notifyTopupApproved({ phone: user.phone, amount, topupId: topup.id });
    await createNotification(
      user.id,
      "wallet",
      `تم شحن ${amount.toFixed(2)} د.ل تلقائياً`,
      `تمت إضافة الرصيد عبر ${provider} بنجاح`,
      "/wallet",
    );
    emitToUser(user.id, "topup-updated", { id: topup.id, status: "approved", amount });
    emitToAdmins("admin-stats-update", { type: "topup-automated" });

    return topup;
  }
  /** Approve a pending topup: credit wallet, update loyalty, handle referrals */
  static async approve(topupId: number, adminNote: string | null) {
    const [topup] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, topupId))
      .limit(1);

    if (!topup) throw new ServiceError(404, "طلب الشحن غير موجود");
    if (topup.status !== "pending") throw new ServiceError(400, "الطلب تمت معالجته مسبقاً");

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, topup.userId))
      .limit(1);

    await db
      .transaction(async (tx) => {
        // Re-check inside tx to prevent double-approve race
        const [current] = await tx
          .select({ status: walletTopupsTable.status })
          .from(walletTopupsTable)
          .where(eq(walletTopupsTable.id, topupId))
          .limit(1);
        if (current?.status !== "pending") throw new ServiceError(409, "الطلب تمت معالجته مسبقاً");

        // The status flip is also guarded at the UPDATE level. The
        // SELECT above is the fast-fail check; this WHERE clause is
        // the actual race protection — two concurrent approves both
        // pass the SELECT (READ COMMITTED), then serialize on the
        // row lock; the second UPDATE matches 0 rows and throws,
        // preventing double-credit of the wallet.
        const flipped = await tx
          .update(walletTopupsTable)
          .set({ status: "approved", adminNote, reviewedAt: new Date() })
          .where(and(eq(walletTopupsTable.id, topupId), eq(walletTopupsTable.status, "pending")))
          .returning({ id: walletTopupsTable.id });
        if (flipped.length !== 1) {
          throw new ServiceError(409, "الطلب تمت معالجته مسبقاً");
        }

        if (user) {
          // F-007 (security audit 004) — re-read the user's wallet balance
          // INSIDE the transaction. Two distinct lookups: the outer SELECT
          // at line 84 happens before the tx and may be stale by the time
          // we apply the credit. The fresh read below + optimistic lock on
          // the UPDATE are what prevent the lost-update race.
          //
          // Scenario: balance=100. Concurrent approvals of topup A (+50)
          // and topup B (+50). Without the optimistic lock, both UPDATEs
          // read balance=100, both set balance=150, one credit silently
          // disappears. With the lock, the second UPDATE matches 0 rows
          // (because walletBalance != balanceBefore by then) and throws,
          // rolling back the topup-status flip too — admin retries.
          //
          // The same shape is used in checkout.service.ts:122 for the
          // purchase debit; this fix brings topup approval into parity.
          const [freshUser] = await tx
            .select({ walletBalance: usersTable.walletBalance })
            .from(usersTable)
            .where(eq(usersTable.id, user.id))
            .limit(1);
          if (!freshUser) throw new ServiceError(404, "المستخدم غير موجود");

          const balanceBefore = parseFloat(String(freshUser.walletBalance));
          const topupAmount = parseFloat(String(topup.amount));
          const newBalance = +(balanceBefore + topupAmount).toFixed(2);
          const updated = await tx
            .update(usersTable)
            .set({
              walletBalance: String(newBalance),
            })
            .where(
              and(eq(usersTable.id, user.id), eq(usersTable.walletBalance, String(balanceBefore))),
            )
            .returning({ id: usersTable.id });
          if (updated.length !== 1) {
            throw new ServiceError(409, "تغيّر رصيد المستخدم أثناء الموافقة. حاول مرة أخرى.");
          }

          // Atomic ledger entry — rolls back if anything below fails.
          await insertLedgerEntry(
            {
              userId: user.id,
              type: "topup",
              amount: String(topupAmount),
              balanceBefore: String(balanceBefore),
              balanceAfter: String(newBalance),
              referenceId: topup.id,
              referenceType: "wallet_topup",
              description: `Topup approved: ${topupAmount.toFixed(2)} د.ل`,
            },
            tx as unknown as typeof db,
          );

          // Referral credit
          if (user.referredBy) {
            const [existingCredit] = await tx
              .select()
              .from(referralEventsTable)
              .where(eq(referralEventsTable.refereeId, user.id))
              .limit(1);

            if (existingCredit && existingCredit.status === "pending") {
              await tx
                .update(referralEventsTable)
                .set({ status: "credited", creditedAt: new Date() })
                .where(eq(referralEventsTable.refereeId, user.id));

              const [referrer] = await tx
                .select()
                .from(usersTable)
                .where(eq(usersTable.id, user.referredBy))
                .limit(1);
              if (referrer) {
                // Atomic SQL increment — prevents lost-update race when two
                // concurrent topups for distinct referees share the same
                // referrer. Same pattern as admin/referrals.ts:115.
                await tx
                  .update(usersTable)
                  .set({
                    loyaltyPoints: sql`${usersTable.loyaltyPoints} + ${POINTS_PER_REFERRAL}`,
                  })
                  .where(eq(usersTable.id, referrer.id));
              }
            }
          }
        }
      })
      .catch((err) => {
        if (err instanceof ServiceError) throw err;
        throw err;
      });

    // Post-tx notifications (non-critical, best-effort). Ledger entry is now
    // committed inside the transaction above for atomicity.
    if (user) {
      if (user.referredBy) {
        const [referrer] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, user.referredBy))
          .limit(1);
        if (referrer) {
          await createNotification(
            referrer.id,
            "loyalty",
            "حصلت على 50 نقطة من إحالة!",
            "تمت مكافأتك بنجاح لأن صديقك أتم أول شحن",
            "/loyalty",
          );
        }
      }
      notifyTopupApproved({
        phone: user.phone,
        amount: parseFloat(String(topup.amount)),
        topupId: topup.id,
      });
      await createNotification(
        user.id,
        "wallet",
        `تم قبول شحن ${parseFloat(String(topup.amount)).toFixed(2)} د.ل`,
        "تمت إضافة الرصيد إلى محفظتك بنجاح",
        "/wallet",
      );
      emitToUser(user.id, "topup-updated", {
        id: topup.id,
        status: "approved",
        amount: topup.amount,
      });
      emitToAdmins("admin-stats-update", { type: "topup-approved" });
    }

    return { success: true, message: "تمت الموافقة على طلب الشحن وإضافة الرصيد" };
  }

  /** Reject a pending topup */
  static async reject(topupId: number, adminNote: string | null) {
    const [topup] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, topupId))
      .limit(1);

    if (!topup) throw new ServiceError(404, "طلب الشحن غير موجود");
    if (topup.status !== "pending") throw new ServiceError(400, "الطلب تمت معالجته مسبقاً");

    // Same race-protection as approve: the WHERE status='pending'
    // clause + rowsAffected check makes a double-click idempotent.
    const flipped = await db
      .update(walletTopupsTable)
      .set({ status: "rejected", adminNote, reviewedAt: new Date() })
      .where(and(eq(walletTopupsTable.id, topupId), eq(walletTopupsTable.status, "pending")))
      .returning({ id: walletTopupsTable.id });
    if (flipped.length !== 1) {
      throw new ServiceError(409, "الطلب تمت معالجته مسبقاً");
    }

    const [rejUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, topup.userId))
      .limit(1);

    if (rejUser) {
      notifyTopupRejected({
        phone: rejUser.phone,
        amount: parseFloat(String(topup.amount)),
        topupId: topup.id,
      });
      await createNotification(
        rejUser.id,
        "wallet",
        `تم رفض طلب الشحن (${parseFloat(String(topup.amount)).toFixed(2)} د.ل)`,
        "تواصل مع الدعم إذا كنت ترى أن هذا خطأ",
        "/support",
      );
      emitToUser(rejUser.id, "topup-updated", { id: topup.id, status: "rejected" });
      emitToAdmins("admin-stats-update", { type: "topup-rejected" });
    }

    return { success: true, message: "تم رفض طلب الشحن" };
  }
}

// ── Service Error ─────────────────────────────────────────────────────────────

export class ServiceError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
