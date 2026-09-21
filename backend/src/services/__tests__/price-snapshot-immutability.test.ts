import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  couponsTable,
  db,
  initTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { CheckoutService } from "../../services/checkout.service";
import { RefundService } from "../../services/refund.service";

/**
 * AUD103-5 scenario #3 (r103, P2): price-snapshot immutability — the code
 * was verified frozen (no UPDATE ever touches orders.amount), but no
 * BEHAVIORAL test mutated a product's price after a committed order and
 * asserted that the order and its refund stay on the PURCHASE-TIME price.
 * This pins the invariant end-to-end: purchase at 30 with a 10% coupon
 * (amount 27) → admin re-prices the product to 999 → refund credits
 * exactly 27 and the ledger/order amounts never move.
 */

const ADMIN_ID = 1;

let phoneSeq = 0;
async function seedUser(balance: string) {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `94711${String(phoneSeq).padStart(5, "0")}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedCoupon() {
  const [c] = await db
    .insert(couponsTable)
    .values({
      code: "SNAPSHOT10",
      type: "percentage",
      value: "10.00",
      maxUses: 10,
      isActive: true,
    })
    .returning();
  return c;
}

async function seedProductWithStock(price: string) {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Snapshot Product", price })
    .returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "snap0@test.local",
    accountPassword: "pw-snap",
  });
  return p;
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("price snapshot immutability (AUD103-5 #3)", () => {
  it("an order's amount and refund survive a post-purchase price change untouched", async () => {
    await seedCoupon();
    const user = await seedUser("50.00");
    const product = await seedProductWithStock("30.00");

    // Purchase at the ORIGINAL price with a 10% coupon: 30 − 3 = 27.
    const purchase = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "SNAPSHOT10",
    });
    expect(purchase.ok).toBe(true);
    if (purchase.ok) expect(purchase.finalPrice).toBe(27);
    const [u1] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u1.walletBalance))).toBe(23); // 50 − 27

    // ── The admin re-prices the product AFTER the purchase ──────────────
    await db
      .update(productsTable)
      .set({ price: "999.00" })
      .where(eq(productsTable.id, product.id));

    // The committed order still carries its purchase-time snapshot…
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.userId, user.id));
    expect(order).toBeDefined();
    expect(parseFloat(String(order.amount))).toBe(27);
    expect(parseFloat(String(order.discountAmount))).toBe(3);

    // …and the refund credits EXACTLY the snapshot amount — not the new
    // price, not the pre-coupon price.
    const refund = await RefundService.refundOrder(order.id, {
      adminId: ADMIN_ID,
      note: "snapshot test",
    });
    expect(parseFloat(String(refund.amount))).toBe(27);

    const [u2] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u2.walletBalance))).toBe(50); // 23 + 27

    // Ledger mirrors: one purchase (−27) + one refund (+27).
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id))
      .orderBy(walletLedgerTable.id);
    expect(ledger).toHaveLength(2);
    expect(ledger[0].type).toBe("purchase");
    expect(parseFloat(String(ledger[0].amount))).toBe(27);
    expect(ledger[1].type).toBe("refund");
    expect(parseFloat(String(ledger[1].amount))).toBe(27);
  });
});
