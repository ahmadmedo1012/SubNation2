import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
import { insertLedgerEntry } from "../../lib/ledger";

/**
 * Checkout integration tests (pglite-isolated).
 *
 * `runCheckout` is a faithful replica of the atomic transaction in
 * routes/orders.ts (atomic inventory claim → optimistic wallet-balance
 * lock → order insert → ledger entry). Replicating the txn here lets us
 * assert real Postgres transaction semantics (commit + ROLLBACK) against
 * pglite without standing up Express. The `failDelivery` hook injects a
 * mid-transaction throw to prove the rollback path.
 */
async function runCheckout(opts: {
  userId: number;
  productId: number;
  price: number;
  failDelivery?: boolean;
}): Promise<{ ok: boolean; reason?: string; orderId?: number }> {
  const { userId, productId, price } = opts;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return { ok: false, reason: "NO_USER" };

  const currentBalance = parseFloat(String(user.walletBalance));
  if (currentBalance < price) return { ok: false, reason: "INSUFFICIENT_BALANCE" };

  const [inv] = await db
    .select()
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)))
    .limit(1);
  if (!inv) return { ok: false, reason: "OUT_OF_STOCK" };

  const newBalance = +(currentBalance - price).toFixed(2);
  const now = new Date();

  try {
    const order = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(inventoryTable)
        .set({ isSold: true, soldAt: now })
        .where(and(eq(inventoryTable.id, inv.id), eq(inventoryTable.isSold, false)))
        .returning();
      if (!claimed) throw new Error("INVENTORY_CLAIMED");

      // Optimistic lock: only deduct if the balance is still what we read.
      const [updated] = await tx
        .update(usersTable)
        .set({ walletBalance: String(newBalance) })
        .where(and(eq(usersTable.id, userId), eq(usersTable.walletBalance, String(currentBalance))))
        .returning();
      if (!updated) throw new Error("CONCURRENCY_ERROR");

      // Injected runtime failure AFTER the balance deduction — must roll back.
      if (opts.failDelivery) throw new Error("DELIVERY_FAILED");

      const [o] = await tx
        .insert(ordersTable)
        .values({
          orderCode: `ORD-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          userId,
          productId,
          inventoryId: inv.id,
          amount: String(price),
          walletBalanceBefore: String(currentBalance),
          walletBalanceAfter: String(newBalance),
          status: "completed",
          deliveredEmail: inv.accountEmail,
          deliveredPassword: inv.accountPassword,
          deliveredAt: now,
        })
        .returning();

      await insertLedgerEntry(
        {
          userId,
          type: "purchase",
          amount: String(price),
          balanceBefore: String(currentBalance),
          balanceAfter: String(newBalance),
          referenceId: o.id,
          referenceType: "order",
          description: "Purchase (test)",
        },
        tx as unknown as typeof db,
      );

      return o;
    });
    return { ok: true, orderId: order.id };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

async function seedUser(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedProductWithStock(units: number, price = "10.00") {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Test Product", price })
    .returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `acct${i}@test.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("Checkout — success path", () => {
  it("deducts wallet, marks inventory sold, completes order, writes ledger — atomically", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");

    const result = await runCheckout({ userId: user.id, productId: product.id, price: 30 });
    expect(result.ok).toBe(true);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(20); // 50 - 30

    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.filter((i) => i.isSold)).toHaveLength(1); // exactly one unit consumed

    const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id));
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("completed");
    expect(orders[0].deliveredEmail).toBe("acct0@test.local");

    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("purchase");
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(20);
  });
});

describe("Checkout — insufficient funds", () => {
  it("rejects cleanly, leaves balance + inventory untouched, writes nothing", async () => {
    const user = await seedUser("10.00");
    const product = await seedProductWithStock(1, "30.00");

    const result = await runCheckout({ userId: user.id, productId: product.id, price: 30 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_BALANCE");

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(10); // unchanged
    const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });
});

describe("Checkout — atomic rollback on delivery failure", () => {
  it("rolls back the wallet deduction + inventory claim when the txn throws mid-flight", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");

    const result = await runCheckout({
      userId: user.id,
      productId: product.id,
      price: 30,
      failDelivery: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("DELIVERY_FAILED");

    // Everything must be as if the purchase never happened.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50); // NOT 20 — rolled back
    const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true); // claim rolled back
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });
});

describe("Checkout — concurrency race", () => {
  it("with funds for only one purchase, exactly one of two concurrent checkouts wins; balance never goes negative", async () => {
    const user = await seedUser("30.00"); // enough for ONE 30.00 purchase
    const product = await seedProductWithStock(2, "30.00"); // stock isn't the limiter — funds are

    const [a, b] = await Promise.all([
      runCheckout({ userId: user.id, productId: product.id, price: 30 }),
      runCheckout({ userId: user.id, productId: product.id, price: 30 }),
    ]);

    const wins = [a, b].filter((r) => r.ok).length;
    expect(wins).toBe(1); // optimistic lock lets only one succeed

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(0); // 30 - 30, never negative
    expect(parseFloat(String(u.walletBalance))).toBeGreaterThanOrEqual(0);

    expect(await db.select().from(ordersTable)).toHaveLength(1);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(1);
  });

  it("with stock for only one unit, two concurrent buyers — only one claims it", async () => {
    const u1 = await seedUser("50.00");
    const u2 = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00"); // single unit

    const [a, b] = await Promise.all([
      runCheckout({ userId: u1.id, productId: product.id, price: 30 }),
      runCheckout({ userId: u2.id, productId: product.id, price: 30 }),
    ]);

    expect([a, b].filter((r) => r.ok).length).toBe(1); // one claims, one OUT_OF_STOCK/claimed
    const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    expect(inv.filter((i) => i.isSold)).toHaveLength(1);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
  });
});
