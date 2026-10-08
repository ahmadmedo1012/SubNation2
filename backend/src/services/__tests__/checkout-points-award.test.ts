import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  flashSalesTable,
  inventoryTable,
  ordersTable,
  pointsLedgerTable,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { CheckoutService } from "../checkout.service";
import { interleaveWriterAfterSelect } from "./helpers/tx-interleave";

/**
 * R123 (E1, test battery) — checkout purchase_award wiring (V1-M21).
 *
 * The award chain inside the purchase transaction had ZERO direct
 * coverage: refund-reversal-precision seeds its own points rows, and the
 * checkout suites pin charge/claim/coupon state but never the
 * points_ledger row the R115 policy promises. Pinned here, against the
 * REAL CheckoutService over pglite:
 *
 *   1. a paid purchase debits the wallet AND credits loyaltyPoints +
 *      lifetimeSpend through the 3-column optimistic-locked UPDATE, with
 *      EXACTLY ONE purchase_award points_ledger row (correct delta /
 *      before / after / referenceId=orderId / referenceType="order");
 *   2. a 0-point purchase (post-discount below the award floor —
 *      floor(finalPrice) = 0) writes NO points row and leaves
 *      loyaltyPoints untouched;
 *   3. the optimistic lock fires on an interleaved points-only writer
 *      (the referral +50 shape) → CONCURRENCY_ERROR + FULL rollback
 *      (wallet, order, ledger, inventory claim — no partial tx), using
 *      the tx-interleave harness idiom from refund-points-race.test.ts.
 */

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_800_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedPurchaseFixture(args: { balance?: string; price: string; withFlash?: number }) {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: args.balance ?? "100.00" })
    .returning();
  const [product] = await db
    .insert(productsTable)
    .values({ name: "Award Product", price: args.price })
    .returning();
  await db.insert(inventoryTable).values({
    productId: product.id,
    accountEmail: "acct0@test.local",
    accountPassword: "pw-0",
  });
  if (args.withFlash !== undefined) {
    await db.insert(flashSalesTable).values({
      title: "Award flash",
      discountPercent: String(args.withFlash),
      endsAt: new Date(Date.now() + 3_600_000),
      isActive: true,
    });
  }
  return { user, product };
}

async function userRow(userId: number) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u!;
}

async function pointsRows(userId: number) {
  return db.select().from(pointsLedgerTable).where(eq(pointsLedgerTable.userId, userId));
}

/** The checkout tx's FIRST select is the F4 product-freshness re-check —
 * its resolved read opens the read→write window for the guarded UPDATE. */
function isProductFreshnessSelect(fields: unknown): boolean {
  return (
    !!fields &&
    typeof fields === "object" &&
    "price" in (fields as object) &&
    "isActive" in (fields as object) &&
    "isArchived" in (fields as object)
  );
}

describe("R123 (E1): checkout purchase_award wiring (V1-M21)", () => {
  it("a paid purchase debits wallet + credits loyaltyPoints/lifetimeSpend with EXACTLY ONE purchase_award row", async () => {
    const { user, product } = await seedPurchaseFixture({ price: "30.00" });

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    if (!result.ok) throw new Error("purchase failed: " + result.reason);

    // The 3-column guarded UPDATE: wallet debited, points awarded,
    // lifetime spend advanced — one mutation, all three consistent.
    const after = await userRow(user.id);
    expect(parseFloat(String(after.walletBalance))).toBe(70);
    expect(after.loyaltyPoints).toBe(30);
    expect(parseFloat(String(after.lifetimeSpend))).toBe(30);
    expect(after.loyaltyTier).toBe("bronze");

    // The wallet ledger row (purchase debit, atomic with the above).
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: "purchase",
      amount: "30.00",
      balanceBefore: "100.00",
      balanceAfter: "70.00",
      referenceId: result.order.id,
      referenceType: "order",
    });

    // THE award pin: exactly one purchase_award attribution row for THIS
    // order — correct delta, arithmetic-true before/after, and the order
    // as its reference (the partial UNIQUE (type, reference_id) makes a
    // double award structurally impossible; this pins the writer).
    const points = await pointsRows(user.id);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      userId: user.id,
      type: "purchase_award",
      pointsDelta: 30,
      pointsBefore: 0,
      pointsAfter: 30,
      referenceId: result.order.id,
      referenceType: "order",
    });
    expect(points[0].pointsAfter).toBe(points[0].pointsBefore + points[0].pointsDelta);
  });

  it("a 0-point purchase (post-discount below the award floor) writes NO points row and leaves loyaltyPoints untouched", async () => {
    // Flash 95% on a 10.00 list price → final 0.50 → floor(0.50) = 0
    // points: the award floor (loyalty-policy purchaseAwardPoints) means
    // sub-1-LYD paid prices earn nothing — and nothing must be WRITTEN.
    const { user, product } = await seedPurchaseFixture({
      balance: "10.00",
      price: "10.00",
      withFlash: 95,
    });

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    if (!result.ok) throw new Error("purchase failed: " + result.reason);
    expect(result.finalPrice).toBe(0.5);

    const after = await userRow(user.id);
    expect(parseFloat(String(after.walletBalance))).toBe(9.5);
    expect(after.loyaltyPoints).toBe(0);
    expect(parseFloat(String(after.lifetimeSpend))).toBe(0.5);

    // No attribution row for a zero award — the ledger stays empty.
    expect(await pointsRows(user.id)).toHaveLength(0);
  });

  it("an interleaved loyaltyPoints mutation (referral +50 shape) → CONCURRENCY_ERROR + full rollback, no partial tx", async () => {
    const { user, product } = await seedPurchaseFixture({ price: "30.00" });

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isProductFreshnessSelect,
      // Simulates the topup.service referral credit (+50 points only —
      // walletBalance untouched) landing between the outer user read and
      // the guarded UPDATE. The stale loyaltyPoints predicate must fail
      // the UPDATE → 0 rows → CONCURRENCY_ERROR, and the WHOLE purchase
      // rolls back (r4 money-integrity M3: points are LYD-convertible).
      writer: (realTx) =>
        realTx.execute(
          sql`UPDATE users SET loyalty_points = loyalty_points + 50 WHERE id = ${user.id}`,
        ),
    });
    let result: Awaited<ReturnType<typeof CheckoutService.purchase>>;
    try {
      result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    } finally {
      restore();
    }

    expect(result).toMatchObject({ ok: false, reason: "CONCURRENCY_ERROR" });

    // Full rollback — nothing partial survived the failed purchase:
    const after = await userRow(user.id);
    expect(parseFloat(String(after.walletBalance))).toBe(100); // wallet NOT debited
    expect(after.loyaltyPoints).toBe(0); // award not applied (writer rolled back with the tx)
    expect(parseFloat(String(after.lifetimeSpend))).toBe(0);
    expect(await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id))).toHaveLength(
      0,
    );
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    expect(await pointsRows(user.id)).toHaveLength(0);
    const [unit] = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(unit.isSold).toBe(false); // the claim reverted too

    // The real-world next step after the retryable 409: a fresh purchase
    // on the now-current state succeeds and awards exactly once.
    const retry = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(retry.ok).toBe(true);
    const final = await userRow(user.id);
    expect(final.loyaltyPoints).toBe(30);
    expect(await pointsRows(user.id)).toHaveLength(1);
  });
});
