import { db, couponsTable } from "@workspace/db";
import { eq, and, isNotNull, gt, lte } from "drizzle-orm";
import { notifyCouponExpiringSoon, isTelegramConfigured } from "../telegram";
import { logger } from "../lib/logger";

// Track which coupons we already alerted about (per server session)
const alertedExpiring = new Set<number>();

async function checkExpiringCoupons(): Promise<void> {
  if (!isTelegramConfigured()) return;

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
      alertedExpiring.add(coupon.id);
      logger.info({ couponCode: coupon.code, hoursLeft }, "Coupon expiry alert sent");
    }

    // Clean up IDs of coupons that have already expired (no need to track them)
    if (alertedExpiring.size > 500) {
      const activeCouponIds = new Set(expiringSoon.map(c => c.id));
      for (const id of alertedExpiring) {
        if (!activeCouponIds.has(id)) alertedExpiring.delete(id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Coupon watcher error");
  }
}

export function startCouponWatcher(): void {
  // Run immediately on startup (after a short delay to let DB settle)
  setTimeout(() => checkExpiringCoupons(), 30_000);
  // Then run every hour
  setInterval(() => checkExpiringCoupons(), 60 * 60 * 1000);
  logger.info("Coupon expiry watcher started");
}
