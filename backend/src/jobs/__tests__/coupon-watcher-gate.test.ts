import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { db, initTestDb, resetTestDb, adminAlertsTable, couponsTable } from "../../test/db";

// A6-P2-1 (round-93): mock the Telegram module so the notify-gating
// contract is observable — notifyCouponExpiringSoon must fire only when
// logAdminAlert reports the alert as fresh.
vi.mock("../../telegram", () => ({
  notifyCouponExpiringSoon: vi.fn(),
}));

import { notifyCouponExpiringSoon } from "../../telegram";
import { checkExpiringCoupons, resetCouponWatcherMemoryForTests } from "../couponWatcher";

const notifyMock = vi.mocked(notifyCouponExpiringSoon);

/**
 * 93-A6 (round-93) — couponWatcher: Telegram notify gating (P2#1) and
 * expired-coupon auto-disable (P3 §3).
 *
 *   1. notifyCouponExpiringSoon used to fire BEFORE logAdminAlert's dedupe
 *      check — every restart inside a coupon's 24h expiry window re-pinged
 *      the operator's phone while the drawer insert was suppressed.
 *   2. Expired coupons kept is_active=true forever: redemption was still
 *      guarded in-tx at checkout, but the admin list showed them as
 *      "active" and nothing ever cleared the flag. The watcher now flips
 *      them (idempotent — the UPDATE re-applies its own predicate).
 *
 * TZ note (A6 §3, verified): expires_at is timestamptz; both the disable
 * predicate and the 24h warning window compare absolute instants against
 * `now` — no local-time arithmetic anywhere in the watcher.
 */

beforeAll(async () => {
  await initTestDb();
}, 30_000);

beforeEach(async () => {
  await resetTestDb();
  resetCouponWatcherMemoryForTests();
  notifyMock.mockClear();
});

interface SeedCoupon {
  code: string;
  isActive: boolean;
  expiresAt: Date;
}

async function seedCoupon(input: SeedCoupon): Promise<number> {
  const [row] = await db
    .insert(couponsTable)
    .values({
      code: input.code,
      type: "percentage",
      value: "10.00",
      isActive: input.isActive,
      expiresAt: input.expiresAt,
    })
    .returning({ id: couponsTable.id });
  return row.id;
}

describe("couponWatcher — Telegram notify gating (A6-P2-1)", () => {
  it("fresh expiring coupon notifies once; a cold restart inside the window does not re-ping", async () => {
    const id = await seedCoupon({
      code: "SOON12",
      isActive: true,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    });

    await checkExpiringCoupons();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("coupon_expiring");
    expect(alerts[0].dedupeKey).toBe(`coupon:expiring:${id}`);

    // Restart simulation: in-memory Set gone, DB row minutes old.
    resetCouponWatcherMemoryForTests();
    await checkExpiringCoupons();

    expect(notifyMock).toHaveBeenCalledTimes(1); // NOT re-pinged
    expect(await db.select().from(adminAlertsTable)).toHaveLength(1); // NOT re-inserted
  });

  it("coupon beyond the 24h window: no alert, no notify, still active", async () => {
    await seedCoupon({
      code: "LATER5D",
      isActive: true,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });

    await checkExpiringCoupons();

    expect(notifyMock).not.toHaveBeenCalled();
    expect(await db.select().from(adminAlertsTable)).toHaveLength(0);
    const [c] = await db.select().from(couponsTable);
    expect(c.isActive).toBe(true);
  });
});

describe("couponWatcher — expired coupon auto-disable (A6 P3, round-93)", () => {
  it("flips an active expired coupon to inactive, once, with a deduped alert", async () => {
    const id = await seedCoupon({
      code: "GONE2H",
      isActive: true,
      expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    await checkExpiringCoupons();

    const [c] = await db.select().from(couponsTable);
    expect(c.isActive).toBe(false);
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("coupon_expired");
    expect(alerts[0].dedupeKey).toBe(`coupon:expired:${id}`);

    // Second pass: the flip is idempotent (only ACTIVE coupons past
    // expiry match) and the alert is dedupe-key guarded.
    await checkExpiringCoupons();
    const [c2] = await db.select().from(couponsTable);
    expect(c2.isActive).toBe(false);
    expect(await db.select().from(adminAlertsTable)).toHaveLength(1);
    expect(notifyMock).not.toHaveBeenCalled(); // disable event has no Telegram channel
  });

  it("already-inactive expired coupon is left alone and never alerted", async () => {
    await seedCoupon({
      code: "INACTIVE",
      isActive: false,
      expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    await checkExpiringCoupons();

    expect(await db.select().from(adminAlertsTable)).toHaveLength(0);
    const [c] = await db.select().from(couponsTable);
    expect(c.isActive).toBe(false);
  });
});
