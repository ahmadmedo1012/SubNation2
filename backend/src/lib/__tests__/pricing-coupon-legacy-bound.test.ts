/**
 * F8 (round-98 A3) — legacy percentage coupons with value >= 100.
 *
 * The create side rejects `value >= 100` (routes/coupons.ts) and /validate
 * rejects non-positive finals, but `resolveCoupon` had no bound: a legacy
 * row (seeded before the create-side bound) sailed through into
 * computeCouponDiscount → discountAmount >= basePrice → negative
 * finalPrice → the checkout money-integrity gate 500s (INVALID_PRICE,
 * fail-closed but operator-hostile, with a "contact support" message).
 *
 * Fix: resolveCoupon rejects percentage rows with value >= 100 using the
 * same InvalidCoupon shape below_min_order uses — a clean 400
 * INVALID_COUPON at the route carrying the Arabic reasonAr, consistent
 * with /coupons/validate. Deliberately NOT clamped: silently capping a
 * 150% coupon at ~100% would change money semantics without an operator
 * ever noticing.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  couponsTable,
  db,
  initTestDb,
  productsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { computePricing, isInvalidCoupon } from "../pricing";
import { CheckoutService } from "../../services/checkout.service";

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

async function seedCoupon(overrides: Partial<typeof couponsTable.$inferInsert> = {}) {
  const [c] = await db
    .insert(couponsTable)
    .values({
      code: "LEGACY",
      type: "percentage",
      value: "150.00",
      maxUses: 100,
      usedCount: 0,
      isActive: true,
      ...overrides,
    })
    .returning();
  return c;
}

describe("F8 (round-98 A3): legacy percentage coupons with value >= 100 are rejected, not clamped", () => {
  it("value = 150 → resolveCoupon returns the rejection (not a negative finalPrice)", async () => {
    await seedCoupon({ code: "LEGACY150", value: "150.00" });

    const result = await computePricing({ listPrice: 30, couponCode: "LEGACY150" });

    expect(result.coupon).not.toBeNull();
    expect(isInvalidCoupon(result.coupon)).toBe(true);
    if (isInvalidCoupon(result.coupon)) {
      expect(result.coupon.reason).toBe("invalid_value");
      expect(result.coupon.reasonAr).toContain("100%");
      expect(result.coupon.record?.code).toBe("LEGACY150");
    }
    // Fail-closed but CLEAN: no discount applied, final = base, never negative.
    expect(result.discountAmount).toBe(0);
    expect(result.finalPrice).toBe(30);
  });

  it("value = 100 (exactly 100%) is rejected too — 100%-off has no positive final price", async () => {
    await seedCoupon({ code: "LEGACY100", value: "100.00" });

    const result = await computePricing({ listPrice: 30, couponCode: "LEGACY100" });

    expect(isInvalidCoupon(result.coupon)).toBe(true);
    expect(result.discountAmount).toBe(0);
    expect(result.finalPrice).toBe(30);
  });

  it("valid percentage coupon below the bound still applies (regression)", async () => {
    await seedCoupon({ code: "OK20", value: "20.00" });

    const result = await computePricing({ listPrice: 30, couponCode: "OK20" });

    expect(isInvalidCoupon(result.coupon)).toBe(false);
    expect(result.discountAmount).toBe(6);
    expect(result.finalPrice).toBe(24);
  });

  it("fixed-type coupons are unaffected by the percentage bound (pre-existing min() semantics)", async () => {
    await seedCoupon({ code: "FIX150", type: "fixed", value: "150.00" });

    const result = await computePricing({ listPrice: 30, couponCode: "FIX150" });

    // fixed: min(150, 30) = 30 → final 0 — unchanged computeCouponDiscount
    // semantics; the checkout INVALID_PRICE gate keeps guarding this class.
    expect(isInvalidCoupon(result.coupon)).toBe(false);
    expect(result.discountAmount).toBe(30);
    expect(result.finalPrice).toBe(0);
  });

  it("end-to-end: checkout with a legacy 150% coupon fails as a clean INVALID_COUPON, not a 500 INVALID_PRICE", async () => {
    await seedCoupon({ code: "LEGACY150", value: "150.00" });
    const [user] = await db
      .insert(usersTable)
      .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: "100.00" })
      .returning();
    const [product] = await db
      .insert(productsTable)
      .values({ name: "Legacy Bound Product", price: "30.00" })
      .returning();

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "LEGACY150",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The route maps this to 400 INVALID_DATA with the Arabic message —
      // the same envelope below_min_order uses. Before the fix this was
      // reason: "INVALID_PRICE" → 500.
      expect(result.reason).toBe("INVALID_COUPON");
      expect(result.message).toContain("100%");
    }
    // Nothing was charged and no slot was burned.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, "LEGACY150"));
    expect(coupon.usedCount).toBe(0);
  });
});
