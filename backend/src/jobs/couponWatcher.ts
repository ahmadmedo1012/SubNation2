import { db, couponsTable } from "@workspace/db";
import { eq, and, isNotNull, gt, lte } from "drizzle-orm";
import { notifyCouponExpiringSoon } from "../telegram";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

/** Handle returned by startCouponWatcher (B7-P2-11: stoppable + re-entry safe). */
export interface CouponWatcherHandle {
  /** Idempotent: stops the interval + initial timeout. */
  stop: () => void;
}

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

// B7-P2-11: re-entry guard — a hung query must not stack concurrent runs;
// the next tick is skipped while one is still in flight.
let checkInFlight = false;

async function runCheckExpiringCoupons(): Promise<void> {
  if (checkInFlight) {
    logger.warn("[couponWatcher] previous check still in flight — skipping tick");
    return;
  }
  checkInFlight = true;
  try {
    await checkExpiringCoupons();
  } finally {
    checkInFlight = false;
  }
}

/**
 * One watcher pass. Exported for tests (the interval scheduler itself is
 * not triggerable in the harness) — pins the B7-P2-1 dedupeKey contract.
 */
export async function checkExpiringCoupons(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
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

    for (const coupon of expiringSoon) {
      if (alertedExpiring.has(coupon.id)) continue;
      const expiresAt = coupon.expiresAt!;
      const hoursLeft = (expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000);
      notifyCouponExpiringSoon(coupon.code, expiresAt, hoursLeft);
      const hrs = hoursLeft.toFixed(1);
      const expStr = expiresAt.toLocaleString("ar-LY", { timeZone: "Africa/Tripoli" });
      // B7-P2-1 (round-92): dedupeKey survives process restarts. The
      // in-memory Set below resets on every Render cold start, which used
      // to re-fire the Telegram + drawer alert for every coupon inside its
      // 24h expiry window on every restart — the same duplicate-alert
      // class round-5 fixed for stock alerts.
      await logAdminAlert(
        "coupon_expiring",
        `كوبون يوشك على الانتهاء: ${coupon.code}`,
        `ينتهي خلال ${hrs} ساعة — في ${expStr}`,
        { dedupeKey: `coupon:expiring:${coupon.id}` },
      );
      alertedExpiring.add(coupon.id);
      logger.info({ couponCode: coupon.code, hoursLeft }, "Coupon expiry alert sent");
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

let running = false;
let stopCurrent: (() => void) | null = null;

export function startCouponWatcher(): CouponWatcherHandle {
  if (running) {
    logger.warn("[couponWatcher] already running — ignoring re-start");
    return { stop: () => stopCurrent?.() };
  }
  running = true;
  // Run immediately on startup (after a short delay to let DB settle)
  const initial = setTimeout(() => void runCheckExpiringCoupons(), 30_000);
  // Then run every hour
  const interval = setInterval(() => void runCheckExpiringCoupons(), 60 * 60 * 1000);
  // B7-P2-11: timers must not keep the process alive on their own.
  initial.unref?.();
  interval.unref?.();

  stopCurrent = () => {
    clearTimeout(initial);
    clearInterval(interval);
    running = false;
    stopCurrent = null;
    logger.info("[couponWatcher] stopped");
  };
  const stop = stopCurrent;
  logger.info("Coupon expiry watcher started");
  return { stop: () => stop() };
}
