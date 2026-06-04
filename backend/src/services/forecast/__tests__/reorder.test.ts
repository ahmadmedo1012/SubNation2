import { describe, expect, it } from "vitest";
import { recommendReorderQty } from "../reorder";

/**
 * Reorder-formula tests (011-inventory-demand-forecast, T020).
 * Algorithm reference: research §R-2.
 */

describe("recommendReorderQty", () => {
  it("returns 0 when current stock already exceeds the safety target", () => {
    // 30-day demand 10 × 1.2 = 12 — well below stock of 50.
    expect(recommendReorderQty(10, 50)).toBe(0);
  });

  it("returns the safety-target gap rounded up", () => {
    // 30-day demand 100 × 1.2 = 120; current stock 80 → gap 40.
    expect(recommendReorderQty(100, 80)).toBe(40);
  });

  it("returns 0 for non-finite inputs (defensive)", () => {
    expect(recommendReorderQty(Number.NaN, 5)).toBe(0);
    expect(recommendReorderQty(Number.POSITIVE_INFINITY, 5)).toBe(0);
  });

  it("rounds ceiling so we never under-order by half a unit", () => {
    // 30-day demand 1 × 1.2 = 1.2; stock 0 → gap 1.2 → 2 units.
    expect(recommendReorderQty(1, 0)).toBe(2);
  });
});
