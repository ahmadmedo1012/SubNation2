import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  couponsTable,
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

    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
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

describe("CheckoutService — money-integrity gate (round-3 regression, M1)", () => {
  // The gate added in round 3: a non-finite or non-positive final price
  // fails closed BEFORE any balance comparison — a negative price
  // previously flipped `currentBalance < finalPrice` false and CREDITED
  // the wallet on every purchase. Legacy bad rows or a schema bypass
  // must never transact.
  // (Postgres rejects literal garbage like "not-a-number" at INSERT time,
  // so the storable-but-evil rows below are the real attack surface.)
  // R123-E5: V1-M29 added chk_products_price_pos (harness parity in
  // test/db.ts), so the evil rows below are no longer INSERTable while
  // it stands — exactly the defense-in-depth the stage ships. The
  // SERVICE gate is still the last line of defense for the one shape the
  // stage deliberately tolerates: legacy dirty rows (count-then-add
  // ALERTS + skips a dirty table, so the operator can reconcile — see
  // migrate.ts applyDomainCheckConstraintsStage). This block simulates
  // that legacy shape the same way migrate-v1m29.test.ts strips the
  // harness CHECKs back to the pre-stage state.
  it.each([
    ["negative price (wallet-credit attack)", "-30.00"],
    ["zero price (free goods)", "0.00"],
  ])("returns INVALID_PRICE for %s and writes nothing", async (_label, price) => {
    await db.execute(
      sql.raw("ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_price_pos"),
    );
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, price);

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result).toMatchObject({ ok: false, reason: "INVALID_PRICE" });

    // Balance untouched, no order, no ledger, inventory unsold.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => i.isSold === false)).toBe(true);
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
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
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
    // AUD103-5-F6 (r103): strengthen to the full zero-state battery — the
    // sibling INSUFFICIENT_BALANCE test asserts all of this, and stock
    // exhaustion must meet the same bar (asserting the reason alone hid
    // partial-state regressions).
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50); // untouched
    expect(await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id))).toHaveLength(
      0,
    );
    expect(
      await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, user.id)),
    ).toHaveLength(0);
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
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
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
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.filter((i) => i.isSold)).toHaveLength(1);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
  });

  it("F-006: coupon maxUses=1 cannot be redeemed twice concurrently", async () => {
    // Each buyer targets a DIFFERENT product to isolate the coupon race
    // from the inventory race. (pglite serialises transactions, so the
    // "concurrent" pre-select phase would otherwise pick the same row
    // and trip INVENTORY_CLAIMED before the coupon UPDATE runs.) The
    // only contention here is the maxUses=1 coupon. Without the
    // atomic-with-check increment, both transactions would pass the
    // validation read, both would increment, and usedCount would land
    // at 2. With the fix, exactly one increment succeeds (rowsAffected=1)
    // and the other transaction throws COUPON_EXHAUSTED.
    const u1 = await seedUser("50.00");
    const u2 = await seedUser("50.00");
    const productA = await seedProductWithStock(1, "30.00");
    const productB = await seedProductWithStock(1, "30.00");
    const [coupon] = await db
      .insert(couponsTable)
      .values({
        code: "ONESHOT",
        type: "percentage",
        value: "20.00",
        maxUses: 1,
        usedCount: 0,
        isActive: true,
      })
      .returning();

    const [a, b] = await Promise.all([
      CheckoutService.purchase({ userId: u1.id, productId: productA.id, couponCode: "ONESHOT" }),
      CheckoutService.purchase({ userId: u2.id, productId: productB.id, couponCode: "ONESHOT" }),
    ]);

    // Exactly one purchase wins; the other returns COUPON_EXHAUSTED.
    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    if (!losses[0].ok) {
      expect(losses[0].reason).toBe("COUPON_EXHAUSTED");
    }

    // Coupon counted exactly once. The audit's failure mode (final
    // usedCount=2) is what this assertion catches.
    const [c] = await db.select().from(couponsTable).where(eq(couponsTable.id, coupon.id));
    expect(c.usedCount).toBe(1);

    // Single ledger entry, single completed order — the loser's entire
    // transaction (including its inventory claim) rolled back.
    expect(await db.select().from(ordersTable)).toHaveLength(1);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(1);
  });

  it("F-006: unbounded coupon (maxUses=null) is unaffected by the new check", async () => {
    // The atomic-with-check predicate must NOT trip for unbounded coupons.
    // Two purchases of a maxUses=null coupon should both succeed (subject
    // only to balance and inventory).
    const u1 = await seedUser("50.00");
    const u2 = await seedUser("50.00");
    const productA = await seedProductWithStock(1, "30.00");
    const productB = await seedProductWithStock(1, "30.00");
    const [coupon] = await db
      .insert(couponsTable)
      .values({
        code: "UNLIMITED",
        type: "percentage",
        value: "10.00",
        maxUses: null, // unbounded
        usedCount: 0,
        isActive: true,
      })
      .returning();

    const [a, b] = await Promise.all([
      CheckoutService.purchase({ userId: u1.id, productId: productA.id, couponCode: "UNLIMITED" }),
      CheckoutService.purchase({ userId: u2.id, productId: productB.id, couponCode: "UNLIMITED" }),
    ]);

    expect([a, b].every((r) => r.ok)).toBe(true);
    const [c] = await db.select().from(couponsTable).where(eq(couponsTable.id, coupon.id));
    expect(c.usedCount).toBe(2);
  });
});
