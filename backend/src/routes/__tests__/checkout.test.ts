import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
import { CheckoutService } from "../../services/checkout.service";

/**
 * Checkout integration tests (pglite-isolated) — exercise the REAL
 * production path via CheckoutService.purchase(). The rollback case mocks
 * the final in-transaction write (insertLedgerEntry) to throw, proving the
 * whole transaction (inventory claim + wallet deduction + order) rolls back.
 */

async function seedUser(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedProductWithStock(units: number, price = "10.00") {
  const [p] = await db.insert(productsTable).values({ name: "Test Product", price }).returning();
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
afterEach(() => {
  vi.restoreAllMocks();
});

describe("CheckoutService — success path", () => {
  it("deducts wallet, marks inventory sold, completes order, writes ledger — atomically", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.status).toBe("completed");
      expect(result.finalPrice).toBe(30);
    }

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(20); // 50 - 30

    const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    expect(inv.filter((i) => i.isSold)).toHaveLength(1);

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

describe("CheckoutService — insufficient funds", () => {
  it("rejects cleanly, leaves balance + inventory untouched, writes nothing", async () => {
    const user = await seedUser("10.00");
    const product = await seedProductWithStock(1, "30.00");

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INSUFFICIENT_BALANCE");

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(10);
    const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });
});

describe("CheckoutService — not-found / out-of-stock guards", () => {
  it("returns PRODUCT_NOT_FOUND for an unknown product", async () => {
    const user = await seedUser("50.00");
    const result = await CheckoutService.purchase({ userId: user.id, productId: 999999 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns OUT_OF_STOCK when the product has no unsold inventory", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(0, "30.00"); // no units
    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("OUT_OF_STOCK");
  });
});

describe("CheckoutService — atomic rollback on a mid-transaction failure", () => {
  it("rolls back wallet deduction + inventory claim when the final ledger write throws", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");

    // Force the LAST in-transaction write to fail, exercising the rollback.
    const ledger = await import("../../lib/ledger");
    vi.spyOn(ledger, "insertLedgerEntry").mockRejectedValueOnce(new Error("LEDGER_FAILED"));

    await expect(
      CheckoutService.purchase({ userId: user.id, productId: product.id }),
    ).rejects.toThrow();

    // Everything must be as if the purchase never happened.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50); // rolled back (not 20)
    const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });
});

describe("CheckoutService — concurrency races", () => {
  it("funds for one: two concurrent purchases → exactly one wins, balance never negative", async () => {
    const user = await seedUser("30.00");
    const product = await seedProductWithStock(2, "30.00"); // stock not the limiter

    const [a, b] = await Promise.all([
      CheckoutService.purchase({ userId: user.id, productId: product.id }),
      CheckoutService.purchase({ userId: user.id, productId: product.id }),
    ]);

    expect([a, b].filter((r) => r.ok).length).toBe(1);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(0);
    expect(parseFloat(String(u.walletBalance))).toBeGreaterThanOrEqual(0);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(1);
  });

  it("stock for one: two buyers → only one claims the single unit", async () => {
    const u1 = await seedUser("50.00");
    const u2 = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");

    const [a, b] = await Promise.all([
      CheckoutService.purchase({ userId: u1.id, productId: product.id }),
      CheckoutService.purchase({ userId: u2.id, productId: product.id }),
    ]);

    expect([a, b].filter((r) => r.ok).length).toBe(1);
    const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    expect(inv.filter((i) => i.isSold)).toHaveLength(1);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
  });
});
