/**
 * F3 (round-98 A3) — refund must return the coupon redemption slot.
 *
 * The purchase tx increments `coupons.used_count` exactly once per order
 * (checkout.service.ts, atomic-with-check). Before this fix NO production
 * statement ever decremented it: a refunded sale kept consuming its slot
 * forever — a maxUses=1 coupon stayed exhausted after its only redemption
 * was refunded, and refund cycles on a maxUses=10 campaign silently
 * drained the real budget to 0 while used_count said 10.
 *
 * Fix: inside the SAME refund tx as the status flip (and covered by the
 * same exactly-once completed→refunded status guard), a guarded decrement
 * runs when orders.coupon_code is set:
 *   UPDATE coupons SET used_count = GREATEST(used_count - 1, 0)
 *   WHERE code = orders.coupon_code AND used_count > 0
 *
 * Pinned here:
 *   - refund restores the slot exactly once
 *   - a second refund (ALREADY_REFUNDED) never double-decrements — even
 *     when another buyer redeemed the returned slot in between
 *   - used_count = 0 stays 0 (GREATEST floor; no negative drift)
 *   - orders without a coupon_code trigger no coupon write at all
 *   - a coupon row deleted after purchase does not break the refund
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  couponsTable,
  db,
  initTestDb,
  resetTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { CheckoutService } from "../checkout.service";
import { RefundService } from "../refund.service";

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

const ADMIN_ID = 42;
const CODE = "SLOT10";

async function seedCoupon(overrides: Partial<typeof couponsTable.$inferInsert> = {}) {
  const [c] = await db
    .insert(couponsTable)
    .values({
      code: CODE,
      type: "percentage",
      value: "10.00",
      maxUses: 10,
      usedCount: 0,
      isActive: true,
      ...overrides,
    })
    .returning();
  return c;
}

async function seedUser(balance = "100.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedProductWithStock(units: number, price = "30.00") {
  const [p] = await db.insert(productsTable).values({ name: "Slot Product", price }).returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `slot${i}@test.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

/** Full checkout with the coupon — the only production path that burns a slot. */
async function purchaseWithCoupon(balance = "100.00") {
  const user = await seedUser(balance);
  const product = await seedProductWithStock(1);
  const result = await CheckoutService.purchase({
    userId: user.id,
    productId: product.id,
    couponCode: CODE,
  });
  if (!result.ok) throw new Error("test seed failed: " + result.reason);
  return result.order;
}

/** Manually-inserted completed order (no checkout), for legacy-shaped rows. */
async function seedCompletedOrder(opts: { couponCode: string | null; amount?: string }) {
  const user = await seedUser("50.00");
  const product = await seedProductWithStock(1);
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode: `SNSLOT${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      userId: user.id,
      productId: product.id,
      amount: opts.amount ?? "30.00",
      status: "completed",
      couponCode: opts.couponCode,
    })
    .returning();
  return order;
}

async function usedCount(code: string = CODE): Promise<number> {
  const [c] = await db.select().from(couponsTable).where(eq(couponsTable.code, code));
  return c.usedCount;
}

describe("F3 (round-98 A3): refund returns the coupon redemption slot", () => {
  it("refund restores used_count exactly once (same tx as the credit)", async () => {
    await seedCoupon({ maxUses: 10 });
    const order = await purchaseWithCoupon("100.00");

    // Checkout burned one slot: 0 → 1.
    expect(await usedCount()).toBe(1);

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    // The slot is back — and the refund side of the ledger is intact.
    expect(await usedCount()).toBe(0);
    const [orderAfter] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(orderAfter.status).toBe("refunded");
    const refundRows = (await db.select().from(walletLedgerTable)).filter(
      (l) => l.type === "refund",
    );
    expect(refundRows).toHaveLength(1);
  });

  it("maxUses=1 coupon: the refunded buyer gets their slot back (the audit's headline scenario)", async () => {
    await seedCoupon({ maxUses: 1 });
    const order = await purchaseWithCoupon("100.00");
    expect(await usedCount()).toBe(1); // exhausted

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    // Not exhausted anymore: the campaign budget matches reality again.
    expect(await usedCount()).toBe(0);
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, CODE));
    expect(coupon.usedCount).toBeLessThanOrEqual(coupon.maxUses!); // chk invariant holds
  });

  it("double-refund attempt does not double-decrement — even after another buyer took the returned slot", async () => {
    await seedCoupon({ maxUses: 10 });
    const orderA = await purchaseWithCoupon("100.00");
    expect(await usedCount()).toBe(1);

    // Refund order A: slot returned (1 → 0).
    await RefundService.refundOrder(orderA.id, { adminId: ADMIN_ID });
    expect(await usedCount()).toBe(0);

    // A different buyer redeems the returned slot in the meantime.
    const orderB = await purchaseWithCoupon("100.00");
    expect(await usedCount()).toBe(1);

    // Second refund of order A: rejected at the status guard — buyer B's
    // live redemption must NOT be decremented by the stale retry.
    await expect(RefundService.refundOrder(orderA.id, { adminId: ADMIN_ID })).rejects.toMatchObject(
      { code: "ALREADY_REFUNDED" },
    );
    expect(await usedCount()).toBe(1);

    // And refunding B legitimately returns B's own slot, not A's.
    await RefundService.refundOrder(orderB.id, { adminId: ADMIN_ID });
    expect(await usedCount()).toBe(0);
  });

  it("coupon with used_count = 0 stays 0 (GREATEST floor, no negative drift)", async () => {
    await seedCoupon({ usedCount: 0 });
    // Legacy-shaped row: completed order carrying the coupon code while
    // the slot was already consumed/reset elsewhere.
    const order = await seedCompletedOrder({ couponCode: CODE });

    const result = await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    // Refund itself is unaffected: wallet credited, status flipped.
    expect(result.amount).toBe(30);
    const [orderAfter] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(orderAfter.status).toBe("refunded");
    // The guarded decrement floors at zero instead of going negative.
    expect(await usedCount()).toBe(0);
  });

  it("order without coupon_code → no coupon write at all", async () => {
    await seedCoupon({ usedCount: 5 });
    const order = await seedCompletedOrder({ couponCode: null });

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    // Unrelated coupon untouched — the decrement is gated on coupon_code.
    expect(await usedCount()).toBe(5);
    const [orderAfter] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(orderAfter.status).toBe("refunded");
  });

  it("coupon row deleted after purchase does not break the refund", async () => {
    // No seedCoupon — the order references a code that no longer exists.
    const order = await seedCompletedOrder({ couponCode: "GONE" });

    const result = await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    // The guarded decrement matches 0 rows and stays silent: the budget
    // concern dies with the deleted row, the money path is unaffected.
    expect(result.amount).toBe(30);
    const [orderAfter] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(orderAfter.status).toBe("refunded");
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, order.userId));
    expect(parseFloat(String(u.walletBalance))).toBe(80); // 50 + 30
  });
});
