import { describe, expect, it } from "vitest";
import { computeCouponDiscount, computeFlashSalePrice } from "../pricing";

describe("computeFlashSalePrice", () => {
  it("applies a percentage discount", () => {
    expect(computeFlashSalePrice(100, 25)).toBe(75);
    expect(computeFlashSalePrice(49.99, 10)).toBe(44.99);
  });

  it("returns the list price when discount is 0", () => {
    expect(computeFlashSalePrice(100, 0)).toBe(100);
  });

  it("rounds to 2 decimals", () => {
    expect(computeFlashSalePrice(33.33, 33)).toBe(22.33);
  });

  // R123 (E1, P3): the pure-math functions round through lib/money.roundLyd
  // (epsilon-corrected half-up — the money idiom, PRICING_ECONOMICS §1)
  // instead of +toFixed(2). These pins are the exact-half-cent cases where
  // the two idioms legitimately diverge: toFixed rounds the STORED DOUBLE
  // (44.994999…/1.024999…) DOWN, Postgres numeric semantics round the
  // INTENDED DECIMAL half-up. No pre-existing expectation shifted — the
  // fixtures above and the economic golden matrix are all whole-cent.
  it("rounds an intended exact half-cent UP (roundLyd idiom — toFixed rounded it down)", () => {
    // 89.99 × 50% = intended 44.995 → 45.00 (toFixed(2) answered 44.99)
    expect(computeFlashSalePrice(89.99, 50)).toBe(45);
    // 2.05 × 50% = intended 1.025 → 1.03 (toFixed(2) answered 1.02)
    expect(computeCouponDiscount("percentage", 50, 2.05)).toBe(1.03);
    // fixed branch: intended 2.675 → 2.68 (toFixed(2) answered 2.67)
    expect(computeCouponDiscount("fixed", 2.675, 10)).toBe(2.68);
    // …while a value just BELOW the half-cent stays DOWN (no over-rounding)
    expect(computeFlashSalePrice(89.988, 50)).toBe(44.99); // 44.994 → 44.99
  });

  it("clamps to >= 0 for absurd discounts", () => {
    expect(computeFlashSalePrice(100, 150)).toBe(0);
  });
});

describe("computeCouponDiscount", () => {
  it("percentage coupon discounts a fraction of base price", () => {
    expect(computeCouponDiscount("percentage", 20, 100)).toBe(20);
    expect(computeCouponDiscount("percentage", 15, 49.99)).toBe(7.5);
  });

  it("fixed coupon discounts the flat value", () => {
    expect(computeCouponDiscount("fixed", 10, 100)).toBe(10);
  });

  it("fixed coupon never discounts more than the base price", () => {
    expect(computeCouponDiscount("fixed", 200, 50)).toBe(50);
  });

  it("rounds to 2 decimals", () => {
    expect(computeCouponDiscount("percentage", 33, 33.33)).toBe(11);
  });
});

describe("discount stack (flash sale → coupon)", () => {
  it("coupon applies against the post-flash-sale price, not the list price", () => {
    const base = computeFlashSalePrice(100, 50); // 50
    const discount = computeCouponDiscount("percentage", 10, base); // 5, not 10
    expect(base).toBe(50);
    expect(discount).toBe(5);
    expect(+(base - discount).toFixed(2)).toBe(45);
  });
});
