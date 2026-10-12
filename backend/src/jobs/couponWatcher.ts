import { db, couponsTable } from "@workspace/db";
import { eq, and, isNotNull, gt, lte, lt } from "drizzle-orm";
import { notifyCouponExpiringSoon } from "../telegram";
import { logAdminAlertBatch } from "./alertLogger";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

// Track which coupons we already alerted about (per server session)
const alertedExpiring = new Set<number>();

/**
 * Test seam: the in-memory Set is per-process state that survives across
 * tests in the same file — clear it to simulate a cold restart (the
 * DB-level dedupeKey is then the only guard left, which is exactly what
 * the B7-P2-1 tests pin).
 */
export function resetCouponWatcherMemoryForTests(): void {
  alertedExpiring.clear();
}

/**
 * Coupon expiry sweep — OPPORTUNISTIC since the 2026-09-20
 * free-infrastructure round (was: an hourly interval timer).
 *
 * TRIGGERS now (no timer): POST /api/coupons/validate (the checkout
 * apply-coupon moment, throttled 15 min), the admin coupons list
 * (throttled 1 min), and the leader boot one-shot (web-scheduler.ts).
 * Redemption was already expiry-guarded in-tx at checkout — this
 * sweep only keeps is_active honest for admin lists + emits the
 * expiring-soon operator nudge.
 */
export async function checkExpiringCoupons(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    // A6 P3 (round-93, jobs audit §3): auto-disable coupons whose
    // expires_at has passed. Before this, expired coupons kept
    // is_active=true forever (redemption was still guarded in-tx at
    // checkout, but the admin coupons list showed them as "active") —
    // nothing ever cleared the flag. The UPDATE re-applies its own
    // predicate (only ACTIVE coupons past expiry), so the flip is
    // naturally idempotent and safe under double-scheduling. TZ note:
    // expires_at is timestamptz and the comparison is against absolute
    // `now` — same instant math the redemption path uses (verified
    // A6 §3).
    const expired = await db
      .update(couponsTable)
      .set({ isActive: false })
      .where(
        and(
          eq(couponsTable.isActive, true),
          isNotNull(couponsTable.expiresAt),
          lt(couponsTable.expiresAt, now),
        ),
      )
      .returning({ id: couponsTable.id, code: couponsTable.code });

    // PERF #5 (R136): the per-coupon logAdminAlert loop (advisory-lock tx
    // each: lock + SELECT + INSERT = 3 RTTs) is now ONE batched call for
    // every disabled coupon — same rows, same dedupe keys, same outcomes
    // (the dedupeKey still guards the double-scheduler window where two
    // passes could select the same row before either UPDATE lands).
    if (expired.length > 0) {
      await logAdminAlertBatch(
        expired.map((coupon) => ({
          type: "coupon_expired" as const,
          title: `انتهى كوبون وأُوقف تلقائياً: ${coupon.code}`,
          message:
            "تجاوز الكوبون وقت انتهائه فأُوقف تلقائياً — لن يقبل استخدامات جديدة.",
          opts: { dedupeKey: `coupon:expired:${coupon.id}` },
        })),
      );
      logger.info(
        { category: "coupons", disabled: expired.length, codes: expired.map((c) => c.code) },
        "couponWatcher: auto-disabled expired coupon(s)",
      );
    }

    const expiringSoon = await db
      .select()
      .from(couponsTable)
      .where(
        and(
          eq(couponsTable.isActive, true),
          isNotNull(couponsTable.expiresAt),
          gt(couponsTable.expiresAt, now),
          lte(couponsTable.expiresAt, in24h),
        ),
      );

    const expiringEntries: Array<{
      couponId: number;
      code: string;
      title: string;
      message: string;
      expiresAt: Date;
      hoursLeft: number;
    }> = [];
    for (const coupon of expiringSoon) {
      if (alertedExpiring.has(coupon.id)) continue;
      const expiresAt = coupon.expiresAt!;
      const hoursLeft = (expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000);
      const hrs = hoursLeft.toFixed(1);
      const expStr = expiresAt.toLocaleString("ar-LY", { timeZone: "Africa/Tripoli" });
      // B7-P2-1 (round-92): dedupeKey survives process restarts. The
      // in-memory Set below resets on every Render cold start, which used
      // to re-fire the Telegram + drawer alert for every coupon inside its
      // 24h expiry window on every restart — the same duplicate-alert
      // class round-5 fixed for stock alerts.
      //
      // A6-P2-1 (round-93): log FIRST, notify SECOND — the Telegram send
      // now gates on the dedupe outcome, so a restart inside the window
      // no longer re-pings the operator's phone while the drawer insert
      // is correctly suppressed.
      expiringEntries.push({
        couponId: coupon.id,
        code: coupon.code,
        title: `كوبون يوشك على الانتهاء: ${coupon.code}`,
        message: `ينتهي خلال ${hrs} ساعة — في ${expStr}`,
        expiresAt,
        hoursLeft,
      });
    }

    if (expiringEntries.length > 0) {
      // PERF #5 (R136): ONE batched drawer write (dedupe SELECT +
      // multi-row INSERT) for every expiring coupon instead of the
      // per-coupon advisory-lock transactions — same keys, same
      // outcomes, same notify gating.
      const outcomes = await logAdminAlertBatch(
        expiringEntries.map((e) => ({
          type: "coupon_expiring" as const,
          title: e.title,
          message: e.message,
          opts: { dedupeKey: `coupon:expiring:${e.couponId}` },
        })),
      );
      expiringEntries.forEach((e, i) => {
        if (!outcomes[i].suppressed) {
          notifyCouponExpiringSoon(e.code, e.expiresAt, e.hoursLeft);
        }
        alertedExpiring.add(e.couponId);
        logger.info({ couponCode: e.code, hoursLeft: e.hoursLeft }, "Coupon expiry alert sent");
      });
    }

    // Clean up IDs of coupons that have already expired (no need to track them)
    if (alertedExpiring.size > 500) {
      const activeCouponIds = new Set(expiringSoon.map((c) => c.id));
      for (const id of alertedExpiring) {
        if (!activeCouponIds.has(id)) alertedExpiring.delete(id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Coupon watcher error");
    captureSchedulerFailure("coupon_watcher", err);
  }
}
