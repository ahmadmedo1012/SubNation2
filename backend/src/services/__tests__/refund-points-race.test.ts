/**
 * B2-01 (round-92 audit) — refund lost-update window on loyaltyPoints /
 * lifetimeSpend. The refund's optimistic-lock predicate covered ONLY
 * walletBalance while its write set spans walletBalance + loyaltyPoints +
 * lifetimeSpend + loyaltyTier: a concurrent points-only writer (referral
 * +50 on the user's referee topup approval, admin points-set) committed
 * between the refund tx's read and its UPDATE left the balance predicate
 * intact — the stale values silently erased the award. Points are
 * LYD-convertible at 100:1 → money.
 *
 * Fix: the predicate now re-asserts all three columns (M3 parity with
 * checkout.service). These tests interleave a writer into the exact
 * read→write window using the tx-proxy harness in ./helpers/tx-interleave
 * (approach documented in the audit's testing note for single-session
 * pglite: the interleaved mutation runs on the transaction's own session
 * after the SELECT resolves, so the guarded UPDATE re-evaluates its WHERE
 * against the mutated row — the same state a committed concurrent writer
 * produces under READ COMMITTED).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
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
import { interleaveWriterAfterSelect } from "./helpers/tx-interleave";

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

const ADMIN_ID = 42;

async function seedCompletedOrder(userBalance = "100.00", price = "30.00") {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: userBalance })
    .returning();
  const [product] = await db.insert(productsTable).values({ name: "Race Product", price }).returning();
  await db.insert(inventoryTable).values({
    productId: product.id,
    accountEmail: "acct0@test.local",
    accountPassword: "pw-0",
  });
  const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
  if (!result.ok) throw new Error("test seed failed: " + result.reason);
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  return { user: u, order: result.order };
}

/** The refund service's in-tx read of the user row selects exactly these
 * three field keys — used to identify the SELECT that opens the window. */
function isRefundUserSelect(fields: unknown): boolean {
  return (
    !!fields &&
    typeof fields === "object" &&
    "walletBalance" in (fields as object) &&
    "loyaltyPoints" in (fields as object) &&
    "lifetimeSpend" in (fields as object)
  );
}

describe("B2-01: refund optimistic lock covers loyaltyPoints + lifetimeSpend", () => {
  it("points-only writer interleaved between read and write → CONCURRENCY_ERROR, no refund applied", async () => {
    const { user, order } = await seedCompletedOrder("100.00", "30.00");
    // After checkout: balance 70, points 30, lifetimeSpend 30.
    expect(user.loyaltyPoints).toBe(30);

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isRefundUserSelect,
      // Simulates the topup.service.ts referral +50 (points-only writer —
      // walletBalance untouched, which is exactly what the old predicate
      // missed).
      writer: (realTx) =>
        realTx.execute(sql`UPDATE users SET loyalty_points = loyalty_points + 50 WHERE id = ${user.id}`),
    });
    try {
      await expect(
        RefundService.refundOrder(order.id, { adminId: ADMIN_ID, note: "race" }),
      ).rejects.toMatchObject({ code: "CONCURRENCY_ERROR", statusCode: 409 });
    } finally {
      restore();
    }

    // The whole refund rolled back: order not refunded, no refund ledger
    // row, balance still 70, and points are back to the pre-writer value
    // (the simulated concurrent writer rolled back with the tx — the
    // production guarantee under test is that the refund NEVER overwrites
    // a concurrently-modified row; the retry path below re-runs cleanly).
    const [orderAfter] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(orderAfter.status).toBe("completed");
    const [userAfter] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(userAfter.walletBalance))).toBe(70);
    expect(userAfter.loyaltyPoints).toBe(30);
    const refundRows = (await db.select().from(walletLedgerTable)).filter((l) => l.type === "refund");
    expect(refundRows).toHaveLength(0);

    // Retry (the real-world next step after a 409) succeeds on fresh state.
    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID, note: "retry" });
    const [userFinal] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(userFinal.walletBalance))).toBe(100);
  });

  it("lifetimeSpend-only writer interleaved → CONCURRENCY_ERROR (predicate covers all three columns)", async () => {
    const { user, order } = await seedCompletedOrder("100.00", "30.00");

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isRefundUserSelect,
      writer: (realTx) =>
        realTx.execute(sql`UPDATE users SET lifetime_spend = lifetime_spend + 5 WHERE id = ${user.id}`),
    });
    try {
      await expect(RefundService.refundOrder(order.id, { adminId: ADMIN_ID })).rejects.toMatchObject(
        { code: "CONCURRENCY_ERROR" },
      );
    } finally {
      restore();
    }
    const [orderAfter] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(orderAfter.status).toBe("completed");
  });

  it("balance-only writer interleaved → CONCURRENCY_ERROR (pre-existing guard intact)", async () => {
    const { order } = await seedCompletedOrder("100.00", "30.00");

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isRefundUserSelect,
      writer: (realTx) =>
        realTx.execute(sql`UPDATE users SET wallet_balance = wallet_balance + 10 WHERE id = ${order.userId}`),
    });
    try {
      await expect(RefundService.refundOrder(order.id, { adminId: ADMIN_ID })).rejects.toMatchObject(
        { code: "CONCURRENCY_ERROR" },
      );
    } finally {
      restore();
    }
  });

  it("no interleaved writer → refund succeeds (the 3-column predicate does not false-positive)", async () => {
    const { order } = await seedCompletedOrder("100.00", "30.00");
    const result = await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });
    expect(result.amount).toBe(30);
    const [orderAfter] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(orderAfter.status).toBe("refunded");
  });
});
