/**
 * R115 Part 9 — refund reward-reversal precision.
 *
 * The pre-R115 reversal was heuristic: `min(floor(refundAmount), current
 * balance)` drew from ONE fungible pool — an order refund could revoke
 * REFERRAL points when the order's own award was spent (case C), and a
 * convert-then-refund cycle kept the converted value while clawing back
 * nothing (case D leak, R115-A4). The R115 reversal is per-order exact:
 * the order's points_ledger purchase_award row (or the frozen historical
 * formula for pre-ledger orders) defines the award; only its unrevoked
 * REMAINDER is revoked, floored at the current balance — unrelated points
 * are untouchable by construction. orders.refunded_at / refund_amount /
 * refunded_by_admin_id are written in the same tx (V1-M22).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  inventoryTable,
  ordersTable,
  pointsLedgerTable,
  productsTable,
  productVariantsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { RefundService } from "../refund.service";
import { insertPointsLedgerEntry } from "../../lib/points-ledger";

let seq = 0;
async function makeUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  seq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9500${String(seq).padStart(5, "0")}`, ...overrides })
    .returning();
  return u;
}

/** A completed paid order + its purchase_award ledger row (the R115 shape). */
async function seedCompletedOrder(opts: {
  userId: number;
  amount: string;
  award: number;
  withLedgerRow: boolean;
  adminId?: number;
}) {
  const [product] = await db
    .insert(productsTable)
    .values({ name: `P${seq}`, price: opts.amount, slug: `p-${seq}-${Math.random().toString(36).slice(2, 8)}` })
    .returning();
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode: `ORD-RP${String(seq).padStart(6, "0")}`,
      userId: opts.userId,
      productId: product.id,
      amount: opts.amount,
      status: "completed",
      deliveredEmail: "x@y.z",
      deliveredPassword: "ciphertext",
    })
    .returning();
  if (opts.withLedgerRow && opts.award > 0) {
    await insertPointsLedgerEntry({
      userId: opts.userId,
      type: "purchase_award",
      pointsDelta: opts.award,
      pointsBefore: 0,
      pointsAfter: opts.award,
      referenceId: order.id,
      referenceType: "order",
    });
  }
  return order;
}

async function pointsOf(userId: number): Promise<number> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u.loyaltyPoints;
}

describe("R115 refund reversal — per-order precision (Part 9)", () => {
  beforeAll(async () => {
    await initTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it("CASE A: order earned 20, user still has all 20 → exactly 20 revoked, reversal attributed", async () => {
    const user = await makeUser({ loyaltyPoints: 20, walletBalance: "0.00" });
    const order = await seedCompletedOrder({ userId: user.id, amount: "20.00", award: 20, withLedgerRow: true });

    const result = await RefundService.refundOrder(order.id, { adminId: 7 });
    expect(result.amount).toBe(20);

    expect(await pointsOf(user.id)).toBe(0);
    const reversal = await db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.referenceType, "order"));
    const rev = reversal.find((r) => r.type === "refund_reversal");
    expect(rev).toBeDefined();
    expect(rev!.pointsDelta).toBe(-20);
    expect(rev!.pointsBefore).toBe(20);
    expect(rev!.pointsAfter).toBe(0);
    expect(rev!.referenceId).toBe(order.id);
  });

  it("CASE B: order earned 20, user SPENT them (0 left) → revokes 0 — and never touches the wallet", async () => {
    const user = await makeUser({ loyaltyPoints: 0, walletBalance: "0.00" });
    const order = await seedCompletedOrder({ userId: user.id, amount: "20.00", award: 20, withLedgerRow: true });

    await RefundService.refundOrder(order.id, { adminId: 7 });

    // Points: floor at zero — nothing to revoke.
    expect(await pointsOf(user.id)).toBe(0);
    const reversals = await db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.type, "refund_reversal"));
    expect(reversals).toHaveLength(0); // delta 0 → no row (DB enforces delta <> 0)
    // Wallet still gets the full refund credit.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(20);
  });

  it("CASE C: order earned 20, user ALSO holds 50 referral points → revokes exactly 20; the referral 50 SURVIVES", async () => {
    // The referral award landed AFTER the purchase award: 20 → +50 = 70.
    const user = await makeUser({ loyaltyPoints: 20, walletBalance: "0.00" });
    const order = await seedCompletedOrder({ userId: user.id, amount: "20.00", award: 20, withLedgerRow: true });
    await insertPointsLedgerEntry({
      userId: user.id,
      type: "referral_credit",
      pointsDelta: 50,
      pointsBefore: 20,
      pointsAfter: 70,
      referenceId: 999,
      referenceType: "referral_event",
    });
    await db
      .update(usersTable)
      .set({ loyaltyPoints: 70 })
      .where(eq(usersTable.id, user.id));

    await RefundService.refundOrder(order.id, { adminId: 7 });

    // Pre-R115 this revoked min(20, 70) = 20 too — but ONLY BY COINCIDENCE of
    // ordering. The R115 guarantee: the remainder is THIS order's award
    // (20), so exactly 20 go — the 50 referral points survive at 50.
    expect(await pointsOf(user.id)).toBe(50);
    const rev = (
      await db.select().from(pointsLedgerTable).where(eq(pointsLedgerTable.type, "refund_reversal"))
    )[0];
    expect(rev.pointsDelta).toBe(-20);
    expect(rev.pointsAfter).toBe(50);
  });

  it("CASE C (the pre-R115 bug shape): order points SPENT (converted), referral points present → revokes NOTHING (referral points untouchable)", async () => {
    const user = await makeUser({ loyaltyPoints: 0, walletBalance: "0.00" });
    const order = await seedCompletedOrder({ userId: user.id, amount: "20.00", award: 20, withLedgerRow: true });
    // The 20 order points were CONVERTED away (the only outflow): 20 → 0.
    await insertPointsLedgerEntry({
      userId: user.id,
      type: "conversion_out",
      pointsDelta: -20,
      pointsBefore: 20,
      pointsAfter: 0,
      lydCredited: 0.2,
      referenceId: 9001,
      referenceType: "wallet_ledger",
    });
    // Then a referral award landed: 0 → 50. The balance holds ONLY
    // referral-origin points now.
    await insertPointsLedgerEntry({
      userId: user.id,
      type: "referral_credit",
      pointsDelta: 50,
      pointsBefore: 0,
      pointsAfter: 50,
      referenceId: 998,
      referenceType: "referral_event",
    });
    await db
      .update(usersTable)
      .set({ loyaltyPoints: 50, walletBalance: "0.20" })
      .where(eq(usersTable.id, user.id));

    await RefundService.refundOrder(order.id, { adminId: 7 });

    // THE test of the fix: pre-R115 revoked min(20, 50) = 20 referral points.
    // R115 FIFO: the conversion consumed the order's 20 (oldest first) —
    // the order's remainder is 0, so NOTHING is revoked and the 50
    // referral points survive untouched.
    expect(await pointsOf(user.id)).toBe(50);
    const reversals = await db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.type, "refund_reversal"));
    expect(reversals).toHaveLength(0);
  });

  it("CASE D: points CONVERTED to wallet before refund → wallet credit untouched, only the unspent award remainder revoked", async () => {
    // Order earned 100 pts; user converted ALL 100 → wallet +1.00, points 0.
    const user = await makeUser({ loyaltyPoints: 100, walletBalance: "0.00" });
    const order = await seedCompletedOrder({ userId: user.id, amount: "100.00", award: 100, withLedgerRow: true });
    await insertPointsLedgerEntry({
      userId: user.id,
      type: "conversion_out",
      pointsDelta: -100,
      pointsBefore: 100,
      pointsAfter: 0,
      lydCredited: 1,
      referenceId: 1,
      referenceType: "wallet_ledger",
    });
    await db
      .update(usersTable)
      .set({ loyaltyPoints: 0, walletBalance: "1.00" })
      .where(eq(usersTable.id, user.id));

    await RefundService.refundOrder(order.id, { adminId: 7 });

    // Documented policy: converted value is NOT clawed back from the wallet
    // (admin-gated business cost); the spent award revokes 0 points.
    expect(await pointsOf(user.id)).toBe(0);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(101); // 1.00 + 100.00 refund
  });

  it("PRE-LEDGER order (no purchase_award row): legacy fallback floor(amount) applies exactly", async () => {
    const user = await makeUser({ loyaltyPoints: 30, walletBalance: "0.00" });
    const order = await seedCompletedOrder({ userId: user.id, amount: "20.00", award: 20, withLedgerRow: false });

    await RefundService.refundOrder(order.id, { adminId: 7 });

    // floor(20.00) = 20 revoked from the 30 balance — derivable from the
    // order row itself (the frozen historical formula).
    expect(await pointsOf(user.id)).toBe(10);
    const rev = (
      await db.select().from(pointsLedgerTable).where(eq(pointsLedgerTable.type, "refund_reversal"))
    )[0];
    expect(rev.pointsDelta).toBe(-20);
  });

  it("V1-M22 columns: refunded_at + refund_amount + refunded_by_admin_id land with the flip", async () => {
    const user = await makeUser({ loyaltyPoints: 20, walletBalance: "0.00" });
    const order = await seedCompletedOrder({ userId: user.id, amount: "20.00", award: 20, withLedgerRow: true });

    await RefundService.refundOrder(order.id, { adminId: 42 });

    const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(row.status).toBe("refunded");
    expect(row.refundedAt).not.toBeNull();
    expect(parseFloat(String(row.refundAmount))).toBe(20);
    expect(row.refundedByAdminId).toBe(42);
  });

  it("structural exactly-once: a second reversal row for the same order is impossible (partial UNIQUE)", async () => {
    const user = await makeUser({ loyaltyPoints: 20, walletBalance: "0.00" });
    const order = await seedCompletedOrder({ userId: user.id, amount: "20.00", award: 20, withLedgerRow: true });
    await RefundService.refundOrder(order.id, { adminId: 7 });

    // The service guard already rejects (ALREADY_REFUNDED); the DB layer is
    // the belt: a raw second reversal insert for the same order violates
    // uniq_points_ledger_type_reference (arithmetic is valid on purpose so
    // the UNIQUE is the constraint under test).
    await expect(
      insertPointsLedgerEntry({
        userId: user.id,
        type: "refund_reversal",
        pointsDelta: -5,
        pointsBefore: 5,
        pointsAfter: 0,
        referenceId: order.id,
        referenceType: "order",
      }),
    ).rejects.toThrow();
  });
});
