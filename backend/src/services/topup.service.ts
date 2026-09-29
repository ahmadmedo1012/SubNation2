import { db, referralEventsTable, usersTable, walletTopupsTable } from "@workspace/db";
import { and, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { insertLedgerEntry } from "../lib/ledger";
import { POINTS_PER_REFERRAL, WELCOME_BONUS_LYD } from "../lib/loyalty-policy";
import { insertPointsLedgerEntry } from "../lib/points-ledger";
import { roundLyd } from "../lib/money";
import { emitToAdmins, emitToUser } from "../lib/socket";
import { createNotification } from "../notify";
import { notifyTopupApproved, notifyTopupRejected } from "../telegram";

// ── Topup Service ─────────────────────────────────────────────────────────────

/**
 * B2-02 (round-92 audit): detect a Postgres unique-constraint violation
 * (SQLSTATE 23505) on the wallet_topups payment_reference partial unique
 * index (`uniq_wallet_topups_payment_reference`, status='approved' — added
 * by the V1-M9 migration). Drizzle wraps driver errors in
 * DrizzleQueryError, preserving the driver error on `.cause` — the
 * SQLSTATE lives on the driver error (node-postgres exposes it directly,
 * pglite on the wrapped cause), so both levels are checked. The constraint
 * name is checked when present so an unrelated 23505 (e.g. a future
 * constraint on this table) is not misreported as a duplicate reference.
 */
function isDuplicatePaymentReferenceViolation(err: unknown): boolean {
  const wrapper = err as { code?: string; constraint?: string; cause?: unknown } | null;
  const driver = (wrapper?.cause ?? err) as { code?: string; constraint?: string } | null;
  const source = driver?.code === "23505" ? driver : wrapper;
  if (!source || source.code !== "23505") return false;
  if (!source.constraint) return true;
  return /payment_reference/i.test(source.constraint);
}

export class TopupService {
  /**
   * Create and immediately approve a topup (for automated gateways).
   *
   * F5 (round-94 A4): this entry point previously accepted (userId,
   * amount, provider, ref) with ZERO of the validation battery that
   * approve() carries — no finiteness/ bounds, no required reference,
   * no advisory lock, no in-tx duplicate check, and no 23505 mapping.
   * No production caller today (tests only), but the first payment
   * gateway wired here would have accepted `amount=-50` (a wallet
   * DEBIT mislabeled topup), `Infinity` (raw 500 from numeric), and a
   * gateway retry on the same reference would hit the V1-M9 partial
   * unique index as an unclassified 23505 → 500 → infinite retry loop.
   *
   * Now mirrors approve()'s guard battery:
   *   - amount: finite, 0 < amount ≤ 5,000 LYD (gateway-appropriate
   *     bound — the manual approve() window is 0.01..10,000 for
   *     operator-reviewed receipts; an automated gateway has no human
   *     in the loop, so the ceiling is tighter);
   *   - ref: required non-blank (a gateway callback without a
   *     reference carries no dedup signal);
   *   - pg_advisory_xact_lock on the reference + in-tx duplicate
   *     check + the 23505 catch → stable 409 (same operator/gateway
   *     -facing message approve() returns), so a gateway retry maps
   *     to a classified conflict instead of a 500 retry storm.
   */
  static async createApprovedTopup(userId: number, amount: number, provider: string, ref: string) {
    // ── Input guards (fail before any DB touch) ─────────────────────────
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) {
      throw new ServiceError(400, "مبلغ الشحن التلقائي غير صالح (يجب أن يكون بين 0.01 و 5000 د.ل)");
    }
    const cleanRef = typeof ref === "string" ? ref.trim() : "";
    if (!cleanRef) {
      throw new ServiceError(400, "مرجع الدفع مطلوب للشحن التلقائي");
    }
    if (cleanRef.length > 255) {
      throw new ServiceError(400, "مرجع الدفع طويل جداً");
    }
    // All money writes go through 2-dp rounding — numeric(10,2) parity.
    // AUD103 (r103): roundLyd instead of +toFixed(2) — the binary float
    // 10.555 is 10.5549999…, so toFixed(2) yielded 10.55 while the R102
    // contract (and Postgres numeric) intend 10.56 for the half-cent case.
    const creditAmount = roundLyd(amount);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (!user) throw new ServiceError(404, "المستخدم غير موجود");

    let topup;
    try {
      topup = await db.transaction(async (tx) => {
        // B2-02 parity: serialize same-reference gateway callbacks.
        // Two concurrent retries of one gateway notification both pass
        // the duplicate SELECT below; the advisory lock makes the
        // second wait, after which the in-tx check + the partial
        // unique index both see the first approval.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${cleanRef}, 0))`);

        // B2-02 parity: duplicate payment_reference guard, re-run INSIDE
        // the transaction — a previously APPROVED topup with the same
        // reference means this callback is a replay of money already
        // credited. Clean 409 before any mutation.
        const dup = await tx
          .select({ id: walletTopupsTable.id })
          .from(walletTopupsTable)
          .where(
            and(
              eq(walletTopupsTable.paymentReference, cleanRef),
              eq(walletTopupsTable.status, "approved"),
            ),
          )
          .limit(1);
        if (dup.length > 0) {
          throw new ServiceError(
            409,
            "مرجع الدفع مستخدم مسبقاً في طلب شحن آخر معتمد — لا يمكن اعتماد نفس التحويل مرتين",
          );
        }

        const [t] = await tx
          .insert(walletTopupsTable)
          .values({
            userId,
            amount: String(creditAmount),
            paymentMethod: "automated",
            paymentNetwork: provider,
            paymentReference: cleanRef,
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
        const newBalance = +(balanceBefore + creditAmount).toFixed(2);
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
          throw new ServiceError(409, "تغيّر رصيد المستخدم أثناء الشحن. حاول مرة أخرى.");
        }

        // Atomic ledger entry — rolls back with the rest if it fails.
        await insertLedgerEntry(
          {
            userId: user.id,
            type: "topup",
            amount: String(creditAmount),
            balanceBefore: String(balanceBefore),
            balanceAfter: String(newBalance),
            referenceId: t.id,
            referenceType: "wallet_topup",
            description: `Automated topup (${provider}): ${creditAmount.toFixed(2)} د.ل`,
          },
          tx as unknown as typeof db,
        );

        return t;
      });
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      // B2-02 parity: the commit tripped the partial unique index
      // uniq_wallet_topups_payment_reference — a same-reference gateway
      // callback committed between our in-tx check and this insert.
      // Map the raw 23505 to the same stable 409 the gateway retry
      // logic can key on (instead of a raw 500 retry storm).
      if (isDuplicatePaymentReferenceViolation(err)) {
        throw new ServiceError(
          409,
          "مرجع الدفع مستخدم مسبقاً في طلب شحن آخر معتمد — لا يمكن اعتماد نفس التحويل مرتين",
        );
      }
      throw err;
    }

    notifyTopupApproved({ phone: user.phone, amount: creditAmount, topupId: topup.id });
    await createNotification(
      user.id,
      "wallet",
      `تم شحن ${creditAmount.toFixed(2)} د.ل تلقائياً`,
      `تمت إضافة الرصيد عبر ${provider} بنجاح`,
      "/wallet",
    );
    emitToUser(user.id, "topup-updated", {
      id: topup.id,
      status: "approved",
      amount: creditAmount,
    });
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

    // The same bank-transfer reference can back multiple pending topups (a
    // user resubmits the same receipt; MAX_PENDING=3 permits it), and two
    // operators can tap ✅ on both nearly simultaneously. Approving both
    // credits the wallet 2× for one real transfer. (Empty/null references
    // carry no dedup signal and are allowed.)
    //
    // B4-R1 (R111, round-111 B4 audit): blank references are now a CLOSED
    // class — POST /api/wallet/topups REQUIRES a non-blank payment_reference
    // for mobile_transfer at CREATION, so every new pending row carries a
    // dedup signal and the battery in this transaction (exact-ref check +
    // V1-M9 partial unique + composite soft-dedup) plus the route's
    // creation-time same-receipt guard closes the "two approvable ref-less
    // pendings" window. APPROVAL deliberately keeps accepting blank refs: the live
    // table holds pre-fix blank-ref rows (2 pending as of 2026-09-24) whose
    // operators must still be able to review them — enforcing the
    // requirement here would strand real customer money in un-approvable
    // limbo. Do NOT add a ref requirement to this method.
    const ref = (topup.paymentReference ?? "").trim();

    // B2-04: whether THIS approve actually awarded the referral bonus —
    // drives the post-tx referrer notification (previously fired on every
    // approve of a referred user's topup, even with no award).
    let referralCredited = false;
    let welcomeGranted = false;

    try {
      await db.transaction(async (tx) => {
        // B2-02 (belt): serialize same-reference approvals. Two concurrent
        // approvals of two different rows pass every row-level guard (the
        // status flips are on DIFFERENT rows); this advisory lock makes the
        // second transaction wait, after which the in-tx duplicate check +
        // the partial unique index both see the first approval. Released
        // automatically at tx end (xact-scoped). Different references hash
        // to different locks → no cross-reference contention.
        if (ref.length > 0) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ref}, 0))`);
        }

        // Re-check inside tx to prevent double-approve race
        const [current] = await tx
          .select({ status: walletTopupsTable.status })
          .from(walletTopupsTable)
          .where(eq(walletTopupsTable.id, topupId))
          .limit(1);
        if (current?.status !== "pending") throw new ServiceError(409, "الطلب تمت معالجته مسبقاً");

        // B2-02: duplicate payment_reference guard, re-run INSIDE the
        // transaction (previously a TOCTOU — the SELECT ran before the tx,
        // so two concurrent approvals both passed it and both credited).
        // The authoritative guard is the DB partial unique index
        // uniq_wallet_topups_payment_reference (V1-M9); this check turns the
        // common sequential case into a clean, specific 409 before any
        // mutation happens.
        if (ref.length > 0) {
          const dup = await tx
            .select({ id: walletTopupsTable.id })
            .from(walletTopupsTable)
            .where(
              and(
                eq(walletTopupsTable.paymentReference, ref),
                eq(walletTopupsTable.status, "approved"),
                ne(walletTopupsTable.id, topupId),
              ),
            )
            .limit(1);
          if (dup.length > 0) {
            throw new ServiceError(
              409,
              "مرجع الدفع مستخدم مسبقاً في طلب شحن آخر معتمد — لا يمكن اعتماد نفس التحويل مرتين",
            );
          }
        }

        // F-03 (round-93 A2 §"Duplicate-transfer double-credit", SIM P3):
        // composite soft-dedup — the exact-reference guards above are blind
        // when the SAME bank transfer is resubmitted with different/typo'd
        // references (MAX_PENDING=3 permits three pending submissions of one
        // transfer, and the operator group receives one approval card per
        // submission — each ✅ credits the wallet once for a single real
        // transfer). While approving a topup that carries BOTH a reference
        // AND a sender phone, reject when an ALREADY-APPROVED sibling from
        // the same user matches (amount, payment_network, sender_phone)
        // within 24h with a DIFFERENT reference of its own (same-reference
        // siblings are the exact check's domain above).
        //
        // Deliberately conservative per the round-93 fix plan, in two ways:
        //   - A2's empty-ref fallback was NOT taken — a ref-less repeat
        //     topup (same amount + channel within a day) is a legitimate
        //     daily pattern for some customers, and a false-positive
        //     rejection on a money route is an operator-visible dead end.
        //     The composite only engages when the receipt signal (ref) is
        //     present.
        //   - The sender_phone dimension must be present on the topup being
        //     approved: without it, (user, amount, network) alone cannot
        //     distinguish a duplicate submission from a legitimate repeat
        //     transfer (pinned as legal by the B2-02 suite — "different
        //     references both approve"). The mobile_transfer form always
        //     collects the sender phone, which is exactly the channel the
        //     A2 exploit runs through.
        // Sibling ids ride the message so the operator can compare the two
        // receipts before retrying or rejecting.
        if (ref.length > 0 && topup.senderPhone) {
          const compositeConds = [
            eq(walletTopupsTable.userId, topup.userId),
            eq(walletTopupsTable.amount, topup.amount),
            eq(walletTopupsTable.status, "approved"),
            ne(walletTopupsTable.id, topupId),
            isNotNull(walletTopupsTable.paymentReference),
            ne(walletTopupsTable.paymentReference, ref),
            eq(walletTopupsTable.senderPhone, topup.senderPhone),
            gte(walletTopupsTable.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ];
          if (topup.paymentNetwork) {
            compositeConds.push(eq(walletTopupsTable.paymentNetwork, topup.paymentNetwork));
          }
          const suspiciousSiblings = await tx
            .select({ id: walletTopupsTable.id })
            .from(walletTopupsTable)
            .where(and(...compositeConds))
            .limit(3);
          if (suspiciousSiblings.length > 0) {
            const siblingIds = suspiciousSiblings.map((s) => `#${s.id}`).join("، ");
            throw new ServiceError(
              409,
              `مرجع دفع مكرر (DUPLICATE_PAYMENT_REFERENCE): يوجد طلب شحن معتمد مطابق لنفس المبلغ والشبكة والمُرسل خلال 24 ساعة — تحقق من التحويل قبل إعادة المحاولة (الطلبات: ${siblingIds})`,
              "DUPLICATE_PAYMENT_REFERENCE",
            );
          }
        }

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
            .select({
              walletBalance: usersTable.walletBalance,
              referredBy: usersTable.referredBy,
              welcomeBonusGranted: usersTable.welcomeBonusGranted,
            })
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

            // B2-04 (round-92 audit): guard the status flip with
            // status='pending' (mirror of admin/referrals.ts). A user with
            // two pending topups approved concurrently both passed the SELECT
            // above while the event was still 'pending', both ran the UNGUARDED
            // flip, and both ran the atomic +50 → +100 points for one referral
            // (50 points = 0.50 LYD at the 100:1 conversion). With the guarded
            // flip, only the winner of the UPDATE awards; the loser sees 0
            // flipped rows and skips the increment entirely.
            if (existingCredit && existingCredit.status === "pending") {
              const flippedReferral = await tx
                .update(referralEventsTable)
                .set({ status: "credited", creditedAt: new Date() })
                .where(
                  and(
                    eq(referralEventsTable.refereeId, user.id),
                    eq(referralEventsTable.status, "pending"),
                  ),
                )
                .returning({ id: referralEventsTable.id });

              if (flippedReferral.length === 1) {
                referralCredited = true;
                const [referrer] = await tx
                  .select()
                  .from(usersTable)
                  .where(eq(usersTable.id, user.referredBy))
                  .limit(1);
                if (referrer) {
                  // Atomic SQL increment — prevents lost-update race when two
                  // concurrent topups for distinct referees share the same
                  // referrer. Same pattern as admin/referrals.ts:115.
                  // R115: the award is attributed in points_ledger (same tx,
                  // reference = the referral_event row the guarded flip won).
                  const [refUpdated] = await tx
                    .update(usersTable)
                    .set({
                      loyaltyPoints: sql`${usersTable.loyaltyPoints} + ${POINTS_PER_REFERRAL}`,
                    })
                    .where(eq(usersTable.id, referrer.id))
                    .returning({ loyaltyPoints: usersTable.loyaltyPoints });
                  if (refUpdated) {
                    await insertPointsLedgerEntry(
                      {
                        userId: referrer.id,
                        type: "referral_credit",
                        pointsDelta: POINTS_PER_REFERRAL,
                        pointsBefore: refUpdated.loyaltyPoints - POINTS_PER_REFERRAL,
                        pointsAfter: refUpdated.loyaltyPoints,
                        referenceId: flippedReferral[0].id,
                        referenceType: "referral_event",
                      },
                      tx as unknown as typeof db,
                    );
                  }
                }
              }
            }
          }

          // R115 (welcome-bonus policy B): the referred user's
          // WELCOME_BONUS_LYD wallet credit lands on the FIRST APPROVED
          // TOPUP — all channels uniformly (previously Google/WhatsApp
          // paid instantly at signup and Telegram never paid). The
          // guarded flip (WHERE welcome_bonus_granted = false) is
          // exactly-once under concurrency; V1-M21 backfilled the flag
          // for pre-R115 recipients so nobody is double-paid.
          if (freshUser.referredBy && !freshUser.welcomeBonusGranted) {
            const [welcomeUpdated] = await tx
              .update(usersTable)
              .set({
                walletBalance: sql`(${usersTable.walletBalance} + ${WELCOME_BONUS_LYD})`,
                welcomeBonusGranted: true,
              })
              .where(
                and(
                  eq(usersTable.id, user.id),
                  eq(usersTable.welcomeBonusGranted, false),
                ),
              )
              .returning({ walletBalance: usersTable.walletBalance });
            if (welcomeUpdated) {
              welcomeGranted = true;
              const balanceAfterWelcome = parseFloat(String(welcomeUpdated.walletBalance));
              const balanceBeforeWelcome = +(balanceAfterWelcome - WELCOME_BONUS_LYD).toFixed(2);
              await insertLedgerEntry(
                {
                  userId: user.id,
                  type: "referral_credit",
                  amount: WELCOME_BONUS_LYD.toFixed(2),
                  balanceBefore: String(balanceBeforeWelcome),
                  balanceAfter: String(balanceAfterWelcome),
                  referenceId: topup.id,
                  referenceType: "welcome_bonus",
                  description: "مكافأة ترحيبية — أول شحن معتمد (كود إحالة)",
                },
                tx as unknown as typeof db,
              );
            }
          }
        }
      });
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      // B2-02 (authoritative guard): the status-flip/commit tripped the
      // partial unique index uniq_wallet_topups_payment_reference — a
      // same-reference approval committed between our in-tx check and
      // this write. Map the raw 23505 to the same operator-facing 409.
      if (isDuplicatePaymentReferenceViolation(err)) {
        throw new ServiceError(
          409,
          "مرجع الدفع مستخدم مسبقاً في طلب شحن آخر معتمد — لا يمكن اعتماد نفس التحويل مرتين",
        );
      }
      throw err;
    }

    // Post-tx notifications (non-critical, best-effort). Ledger entry is now
    // committed inside the transaction above for atomicity.
    if (user) {
      // B2-04: only notify the referrer when THIS approval actually awarded
      // the bonus (a subsequent topup approval, or one that lost the
      // guarded flip, must not re-announce a 50-point award that did not
      // happen).
      if (referralCredited && user.referredBy) {
        const [referrer] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, user.referredBy))
          .limit(1);
        if (referrer) {
          await createNotification(
            referrer.id,
            "loyalty",
            `حصلت على ${POINTS_PER_REFERRAL} نقطة من إحالة!`,
            "تمت مكافأتك بنجاح لأن صديقك أتم أول شحن",
            "/loyalty",
          );
        }
      }
      // R115: the referee learns their welcome credit landed with this
      // topup (policy B — granted above in the same tx).
      if (welcomeGranted) {
        await createNotification(
          user.id,
          "loyalty",
          `وصلتك مكافأة الترحيب ${WELCOME_BONUS_LYD.toFixed(2)} د.ل`,
          "أُضيفت مكافأة كود الإحالة إلى محفظتك مع أول شحن معتمد",
          "/wallet",
        );
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
  /**
   * F-03 (round-93 A2): optional machine-readable code riding alongside the
   * Arabic message. mapServiceErrorToCode still derives the generic envelope
   * ErrorCode from statusCode at the HTTP layer (409 → CONFLICT — the
   * retry-hint semantics the frontend maps), so this is purely additive:
   * tests and future route wiring can key on the specific cause
   * (DUPLICATE_PAYMENT_REFERENCE) without re-shaping the class.
   */
  code?: string;
  constructor(
    public statusCode: number,
    message: string,
    code?: string,
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}
