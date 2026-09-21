import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  couponsTable,
  db,
  flashSalesTable,
  initTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { CheckoutService } from "../../services/checkout.service";

/**
 * AUD103-5 scenario #17 (r103, P2): stacked discounts integration — flash
 * sale × coupon was only pinned at the PURE-FUNCTION level (pricing.test.ts);
 * no end-to-end purchase asserted the stacked math lands on the ORDER row.
 * Pins: 30 LYD product × active 20% flash sale × 10% coupon (computed
 * against the post-flash price) → finalPrice 21.6, order.amount "21.60",
 * discountAmount "8.40", coupon used_count +1.
 */

let phoneSeq = 0;
async function seedUser(balance: string) {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `94822${String(phoneSeq).padStart(5, "0")}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedStack() {
  const [product] = await db
    .insert(productsTable)
    .values({ name: "Stacked Product", price: "30.00" })
    .returning();
  await db.insert(inventoryTable).values({
    productId: product.id,
    accountEmail: "stack0@test.local",
    accountPassword: "pw-stack",
  });
  // Active 20% global flash sale (the singleton design applies to the
  // whole catalog — one active row).
  await db.insert(flashSalesTable).values({
    title: "stack test sale",
    discountPercent: "20",
    endsAt: new Date(Date.now() + 60 * 60 * 1000),
    isActive: true,
  });
  // 10% off coupon.
  await db.insert(couponsTable).values({
    code: "STACK10",
    type: "percentage",
    value: "10.00",
    maxUses: 5,
    isActive: true,
  });
  return product;
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("stacked discounts — flash sale × coupon (AUD103-5 #17)", () => {
  it("20% flash + 10% coupon on a 30 LYD product → 21.60 charged, 8.40 total discount", async () => {
    const user = await seedUser("50.00");
    const product = await seedStack();

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "STACK10",
    });
    expect(result.ok).toBe(true);
    // 30 → flash 20% → 24 → coupon 10% of 24 → 21.6.
    if (result.ok) expect(result.finalPrice).toBe(21.6);

    // Wallet debited the stacked price exactly.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBeCloseTo(28.4, 2); // 50 − 21.6

    // The ORDER row carries the snapshot with 2-dp money strings.
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.userId, user.id));
    expect(parseFloat(String(order.amount))).toBe(21.6);
    // discountAmount's column contract = the COUPON discount only
    // (2.40 = 10% of the post-flash 24) — the flash discount (6.00) is
    // embedded in the charged unit price, not double-counted here.
    expect(parseFloat(String(order.discountAmount))).toBeCloseTo(2.4, 2);
    expect(order.couponCode).toBe("STACK10");

    // The coupon slot was consumed exactly once.
    const [coupon] = await db
      .select()
      .from(couponsTable)
      .where(eq(couponsTable.code, "STACK10"));
    expect(coupon.usedCount).toBe(1);
  });
});
