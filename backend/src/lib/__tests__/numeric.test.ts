import { describe, expect, it } from "vitest";
import { toNumber } from "../numeric";

/**
 * R118-A5 TOP-20 #3 [P2] — lib/numeric.ts toNumber matrix.
 *
 * toNumber is the centralized money-parse policy ("a single Infinity
 * flowing into a wallet UPDATE corrupts the row" — the M1 class of
 * bugs), repeated 40+ times across the backend before round-3 collapsed
 * it into this helper. It had ZERO direct tests — the policy was
 * unpinned:
 *
 *   - null / undefined / "" / whitespace-only  → fallback (default 0)
 *   - unparsable garbage                        → fallback
 *   - non-finite ("Infinity", "NaN", 1/0, NaN)  → fallback — NEVER
 *     propagated (the corruption guard)
 *   - parsable numeric strings                  → the number
 *   - finite numbers                            → passthrough
 *   - custom fallback                           → honored
 *   - non-string non-number (object / bool)     → fallback
 */

describe("toNumber — money-parse single source (R118-A5 #3)", () => {
  it("null / undefined / empty / whitespace-only → fallback 0", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("")).toBe(0);
    expect(toNumber("   ")).toBe(0);
    expect(toNumber("\t\n")).toBe(0);
  });

  it("unparsable garbage → fallback", () => {
    expect(toNumber("abc")).toBe(0);
    expect(toNumber("12,34")).toBe(0);
    expect(toNumber("1.2.3")).toBe(0);
  });

  it("the corruption guard: non-finite STRING inputs → fallback (never propagated)", () => {
    // A single Infinity flowing into a wallet UPDATE corrupts the row for
    // every subsequent transaction — the exact class this helper exists
    // to make impossible.
    expect(toNumber("Infinity")).toBe(0);
    expect(toNumber("-Infinity")).toBe(0);
    expect(toNumber("NaN")).toBe(0);
  });

  it("the corruption guard: non-finite NUMBER inputs → fallback", () => {
    expect(toNumber(Infinity)).toBe(0);
    expect(toNumber(-Infinity)).toBe(0);
    expect(toNumber(Number.NaN)).toBe(0);
  });

  it("parsable numeric strings convert (drizzle numeric columns arrive as strings)", () => {
    expect(toNumber("12.34")).toBe(12.34);
    expect(toNumber("  10.5  ")).toBe(10.5); // surrounding whitespace trimmed
    expect(toNumber("-3.25")).toBe(-3.25);
    expect(toNumber("0")).toBe(0); // "0" is a VALUE, not a fallback
    expect(toNumber("100")).toBe(100);
  });

  it("finite numbers pass through unchanged (including 0 and negatives)", () => {
    expect(toNumber(12.34)).toBe(12.34);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-42)).toBe(-42);
    expect(toNumber(1e-9)).toBe(1e-9);
  });

  it("a custom fallback is honored for every reject class", () => {
    expect(toNumber(null, -1)).toBe(-1);
    expect(toNumber("garbage", -1)).toBe(-1);
    expect(toNumber("Infinity", -1)).toBe(-1);
    expect(toNumber(Infinity, -1)).toBe(-1);
    // …and never kicks in for valid values.
    expect(toNumber("12.34", -1)).toBe(12.34);
    expect(toNumber(7, -1)).toBe(7);
  });

  it("non-string non-number types → fallback (objects, booleans, arrays, functions)", () => {
    expect(toNumber({})).toBe(0);
    expect(toNumber({ value: 5 })).toBe(0);
    expect(toNumber(true)).toBe(0);
    expect(toNumber(false)).toBe(0);
    expect(toNumber([1, 2])).toBe(0);
    expect(toNumber(() => 5)).toBe(0);
  });
});
