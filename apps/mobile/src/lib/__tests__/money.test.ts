import { describe, expect, it } from "vitest";

import { formatCurrency, formatNumber } from "@/lib/money";

/**
 * M17 pins — the ONE LYD formatting idiom, ported verbatim from the web:
 * en-US grouping + two decimals + «د.ل» suffix, Latin digits, NaN/null →
 * «— د.ل», sign-blind zero. A regression here surfaces on every money
 * surface in the app.
 */
describe("formatCurrency (M17 LYD idiom)", () => {
  it("formats with en-US grouping and two decimals", () => {
    expect(formatCurrency(1234.5)).toBe("1,234.50 د.ل");
    expect(formatCurrency(1234567.891)).toBe("1,234,567.89 د.ل");
  });

  it("keeps exactly two decimals on whole numbers", () => {
    expect(formatCurrency(20)).toBe("20.00 د.ل");
    expect(formatCurrency(0.5)).toBe("0.50 د.ل");
  });

  it("is sign-blind on zero", () => {
    expect(formatCurrency(0)).toBe("0.00 د.ل");
    expect(formatCurrency(-0)).toBe("0.00 د.ل");
  });

  it("degrades non-finite and missing to the dash form", () => {
    expect(formatCurrency(null)).toBe("— د.ل");
    expect(formatCurrency(undefined)).toBe("— د.ل");
    expect(formatCurrency(Number.NaN)).toBe("— د.ل");
  });

  it("preserves negative sign for real debits", () => {
    expect(formatCurrency(-12.5)).toBe("-12.50 د.ل");
  });
});

describe("formatNumber", () => {
  it("groups counts en-US style", () => {
    expect(formatNumber(1250)).toBe("1,250");
    expect(formatNumber(42)).toBe("42");
  });

  it("degrades missing to the dash", () => {
    expect(formatNumber(null)).toBe("—");
  });
});
