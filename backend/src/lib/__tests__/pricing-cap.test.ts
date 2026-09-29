/**
 * R115 Part 14 — the combined-discount cap (pricing.max_total_discount_pct).
 *
 * Flash sales (≤95%) and percentage coupons (<100%) could previously stack
 * to ~99.7% off — every feature individually "reasonable", the stack
 * guaranteed loss-making. The cap is enforced at the single choke point
 * (lib/pricing.ts resolveCoupon): a coupon that pushes flash% + coupon%
 * (vs list) past the configured cap is rejected with a clean reason the
 * routes surface as 400 — never a silent clamp, never a checkout 500.
 * Loyalty/referral liabilities are program costs, NOT transactional
 * discounts, and are deliberately outside this cap.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  couponsTable,
  db,
  flashSalesTable,
  initTestDb,
  resetTestDb,
} from "../../test/db";
import { computePricing, isAppliedCoupon, isInvalidCoupon } from "../pricing";
import {
  DEFAULT_MAX_TOTAL_DISCOUNT_PCT,
  __resetPricingConfigCache,
  savePricingConfig,
} from "../pricing-config";

async function seedFlash(pct: number) {
  await db.insert(flashSalesTable).values({
    title: `Flash ${pct}%`,
    discountPercent: String(pct),
    endsAt: new Date(Date.now() + 60 * 60 * 1000),
    isActive: true,
  });
}

async function seedCoupon(code: string, value: string, type: "percentage" | "fixed" = "percentage") {
  await db.insert(couponsTable).values({ code, type, value, isActive: true });
}

describe("R115 combined-discount cap", () => {
  beforeAll(async () => {
    await initTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    __resetPricingConfigCache();
  });

  it("default cap is the no-loss line at 100% markup (50%)", () => {
    expect(DEFAULT_MAX_TOTAL_DISCOUNT_PCT).toBe(50);
  });

  it("coupon alone within the cap applies normally", async () => {
    await seedCoupon("C25", "25");
    const r = await computePricing({ listPrice: 100, couponCode: "C25" });
    expect(isAppliedCoupon(r.coupon)).toBe(true);
    expect(r.finalPrice).toBe(75);
  });

  it("flash 30% + coupon 25%-of-remaining = 47.5% combined → allowed (under 50)", async () => {
    await seedFlash(30);
    await seedCoupon("C25B", "25");
    const r = await computePricing({ listPrice: 100, couponCode: "C25B" });
    expect(isAppliedCoupon(r.coupon)).toBe(true);
    // base 70 → coupon 17.5 → final 52.5 (combined 47.5% off list)
    expect(r.basePrice).toBe(70);
    expect(r.finalPrice).toBe(52.5);
  });

  it("flash 40% + coupon 30%-of-remaining = 58% combined → REJECTED with total_discount_cap (clean, final = post-flash base)", async () => {
    await seedFlash(40);
    await seedCoupon("C30", "30");
    const r = await computePricing({ listPrice: 100, couponCode: "C30" });
    expect(isInvalidCoupon(r.coupon)).toBe(true);
    if (r.coupon && isInvalidCoupon(r.coupon)) {
      expect(r.coupon.reason).toBe("total_discount_cap");
      expect(r.coupon.reasonAr).toContain("الحد الأقصى");
    }
    // The buyer keeps the flash price; only the coupon is refused.
    expect(r.finalPrice).toBe(60);
  });

  it("coupon 60% alone > cap → rejected even with NO flash sale", async () => {
    await seedCoupon("C60", "60");
    const r = await computePricing({ listPrice: 100, couponCode: "C60" });
    expect(isInvalidCoupon(r.coupon)).toBe(true);
    expect(r.finalPrice).toBe(100);
  });

  it("flash 50% alone exhausts the cap → ANY coupon is rejected", async () => {
    await seedFlash(50);
    await seedCoupon("C10", "10");
    const r = await computePricing({ listPrice: 100, couponCode: "C10" });
    expect(isInvalidCoupon(r.coupon)).toBe(true);
    if (r.coupon && isInvalidCoupon(r.coupon)) {
      expect(r.coupon.reason).toBe("total_discount_cap");
    }
    expect(r.finalPrice).toBe(50);
  });

  it("the cap is operator-configurable: raising it to 70 admits the 58% stack", async () => {
    await savePricingConfig({ maxTotalDiscountPct: 70 });
    await seedFlash(40);
    await seedCoupon("C30B", "30");
    const r = await computePricing({ listPrice: 100, couponCode: "C30B" });
    expect(isAppliedCoupon(r.coupon)).toBe(true);
    expect(r.finalPrice).toBe(42);
  });

  it("out-of-bounds cap values are rejected at save time", async () => {
    await expect(savePricingConfig({ maxTotalDiscountPct: 5 })).rejects.toThrow(
      "INVALID_MAX_TOTAL_DISCOUNT_PCT",
    );
    await expect(savePricingConfig({ maxTotalDiscountPct: 99 })).rejects.toThrow(
      "INVALID_MAX_TOTAL_DISCOUNT_PCT",
    );
  });

  it("property: any ACCEPTED stack stays within the configured cap (fast-check)", async () => {
    const fc = await import("fast-check");
    await savePricingConfig({ maxTotalDiscountPct: 50 });
    // Deterministic coupon per run: create a percentage coupon with value v.
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 0, max: 95 }), async (couponPct, flashPct) => {
        await resetTestDb();
        __resetPricingConfigCache();
        await savePricingConfig({ maxTotalDiscountPct: 50 });
        if (flashPct > 0) await seedFlash(flashPct);
        await seedCoupon(`PC${couponPct}${flashPct}`, String(couponPct));
        const listPrice = 100;
        const r = await computePricing({ listPrice, couponCode: `PC${couponPct}${flashPct}` });
        if (isAppliedCoupon(r.coupon)) {
          const combined = flashPct + (r.discountAmount / listPrice) * 100;
          expect(combined).toBeLessThanOrEqual(50 + 1e-6);
        }
        // And the final price is never negative in ANY outcome.
        expect(r.finalPrice).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 25 },
    );
  });
});
