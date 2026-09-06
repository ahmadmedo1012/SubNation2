/**
 * Pure-function tests for `lib/utils.ts`.
 *
 * Locks in the shape and edge-case handling of the small set of
 * formatters every admin page and customer page depends on:
 *
 *   - formatCurrency   — Libyan dinar formatting (د.ل) with null guards
 *   - statusLabel      — Arabic labels for every order/topup status
 *   - statusColor      — token-based class tuples (no theme branching)
 *   - tierLabel/Color  — loyalty tier labels (4-tier scale)
 *   - cn               — clsx + tailwind-merge composition
 *
 * These functions are dependency-free and called from dozens of pages,
 * so a regression here cascades broadly. Tests focus on:
 *
 *   1. Happy path returns the expected string for the documented inputs
 *   2. Null / undefined / NaN inputs do not throw and return safe
 *      defaults (formatCurrency in particular — a NaN amount on a
 *      product card was the historical breakage)
 *   3. Unknown keys (status / tier / category) fall through to the
 *      input value rather than rendering "undefined" in the UI
 */

import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  cn,
  formatCurrency,
  statusColor,
  statusLabel,
  tierColor,
  tierLabel,
  formatCount,
} from "../utils";

describe("formatCurrency", () => {
  it("formats positive numbers with two decimals + Libyan dinar suffix", () => {
    expect(formatCurrency(12.5)).toBe("12.50 د.ل");
    expect(formatCurrency(0)).toBe("0.00 د.ل");
    expect(formatCurrency(1234.567)).toBe("1,234.57 د.ل");
  });

  it("groups thousands (round-3 fix: wallet/revenue tiles exceeded 4 digits with unreadable ungrouped runs)", () => {
    expect(formatCurrency(12345.5)).toBe("12,345.50 د.ل");
    expect(formatCurrency(1000000)).toBe("1,000,000.00 د.ل");
  });

  it("returns the zero-Libyan-dinar fallback for null / undefined / NaN", () => {
    // The historical bug this guards: `${NaN.toFixed(2)} د.ل` rendered
    // "NaN د.ل" on product cards when an inventory record arrived
    // without a price. Defensive default is the contract.
    expect(formatCurrency(null)).toBe("0.00 د.ل");
    expect(formatCurrency(undefined)).toBe("0.00 د.ل");
    expect(formatCurrency(Number.NaN)).toBe("0.00 د.ل");
  });

  it("handles negative numbers (e.g. wallet adjustment reversals)", () => {
    expect(formatCurrency(-30.5)).toBe("-30.50 د.ل");
  });
});

describe("statusLabel", () => {
  it("returns the Arabic label for every documented order status", () => {
    expect(statusLabel("pending")).toBe("قيد الانتظار");
    expect(statusLabel("processing")).toBe("جارٍ التنفيذ");
    expect(statusLabel("completed")).toBe("مكتمل");
    expect(statusLabel("delivered")).toBe("مكتمل");
    expect(statusLabel("failed")).toBe("فشل");
    expect(statusLabel("refunded")).toBe("مسترجع");
  });

  it("returns the Arabic label for topup statuses", () => {
    expect(statusLabel("approved")).toBe("موافق عليه");
    expect(statusLabel("rejected")).toBe("مرفوض");
  });

  it("falls through to the raw value for unknown statuses", () => {
    // Better than rendering "undefined" — keeps a future status string
    // visible until the labels map is updated.
    expect(statusLabel("custom-status")).toBe("custom-status");
    expect(statusLabel("")).toBe("");
  });
});

describe("statusColor", () => {
  it("returns class tuples that include token-based status classes", () => {
    expect(statusColor("completed")).toContain("status-success");
    expect(statusColor("approved")).toContain("status-success");
    expect(statusColor("delivered")).toContain("status-success");

    expect(statusColor("failed")).toContain("status-error");
    expect(statusColor("rejected")).toContain("status-error");

    expect(statusColor("pending")).toContain("status-warning");
    expect(statusColor("processing")).toContain("status-info");
    expect(statusColor("refunded")).toContain("status-info");
  });

  it("falls through to a muted-foreground class for unknown statuses", () => {
    expect(statusColor("unknown")).toBe("text-muted-foreground");
    expect(statusColor("")).toBe("text-muted-foreground");
  });
});

describe("tierLabel + tierColor", () => {
  it("returns Arabic labels for the 4 loyalty tiers", () => {
    expect(tierLabel("bronze")).toBe("برونزي");
    expect(tierLabel("silver")).toBe("فضي");
    expect(tierLabel("gold")).toBe("ذهبي");
    expect(tierLabel("platinum")).toBe("بلاتيني");
  });

  it("returns tone-correct color classes per tier", () => {
    expect(tierColor("bronze")).toBe("text-amber-600");
    expect(tierColor("silver")).toBe("text-slate-400");
    expect(tierColor("gold")).toBe("text-yellow-400");
    expect(tierColor("platinum")).toBe("text-cyan-400");
  });

  it("falls through to raw / muted-foreground for unknown tiers", () => {
    expect(tierLabel("custom")).toBe("custom");
    expect(tierColor("custom")).toBe("text-muted-foreground");
  });
});

describe("categoryLabel", () => {
  it("returns Arabic labels for the documented product categories", () => {
    expect(categoryLabel("streaming")).toBe("بث مباشر");
    expect(categoryLabel("music")).toBe("موسيقى");
    expect(categoryLabel("gaming")).toBe("ألعاب");
    expect(categoryLabel("productivity")).toBe("إنتاجية");
  });

  it("returns the 'general' fallback for null / undefined", () => {
    expect(categoryLabel(null)).toBe("عام");
    expect(categoryLabel(undefined)).toBe("عام");
  });

  it("falls through to the raw value for unknown categories", () => {
    expect(categoryLabel("ai")).toBe("ai");
  });
});

describe("cn", () => {
  it("composes class strings via clsx + tailwind-merge dedup", () => {
    // Plain composition.
    expect(cn("a", "b")).toBe("a b");
    // Conditional truthy / falsy — model how callers use it: a runtime
    // boolean drives whether a class is included. ESLint's
    // no-constant-binary-expression flags `false && "x"` literals, so
    // the condition rides a variable here.
    const enabled = false;
    expect(cn("a", enabled && "b", "c")).toBe("a c");
    // Object syntax (clsx).
    expect(cn("a", { b: true, c: false })).toBe("a b");
  });

  it("dedupes conflicting Tailwind classes (twMerge layer)", () => {
    // Last value wins when two classes target the same Tailwind property.
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("returns an empty string for empty / falsy inputs", () => {
    expect(cn()).toBe("");
    expect(cn(false, null, undefined, "")).toBe("");
  });
});

describe("formatCount (Arabic pluralization, round-3)", () => {
  it("selects the correct Arabic plural form per CLDR category", () => {
    expect(
      formatCount(1, { one: "منتج", two: "منتجان", few: "منتجات", many: "منتجاً", other: "منتج" }),
    ).toBe("1 منتج");
    expect(
      formatCount(2, { one: "منتج", two: "منتجان", few: "منتجات", many: "منتجاً", other: "منتج" }),
    ).toBe("2 منتجان");
    expect(
      formatCount(3, { one: "منتج", two: "منتجان", few: "منتجات", many: "منتجاً", other: "منتج" }),
    ).toBe("3 منتجات");
    expect(
      formatCount(11, { one: "منتج", two: "منتجان", few: "منتجات", many: "منتجاً", other: "منتج" }),
    ).toBe("11 منتجاً");
    expect(
      formatCount(100, { one: "منتج", two: "منتجان", few: "منتجات", many: "منتجاً", other: "منتج" }),
    ).toBe("100 منتج");
  });

  it("falls back to `other` when a category has no provided form", () => {
    expect(formatCount(3, { other: "عنصر" })).toBe("3 عنصر");
    expect(formatCount(0, { other: "عنصر" })).toBe("0 عنصر");
  });

  it("groups large counts like money values do", () => {
    expect(formatCount(1234567, { other: "طلب" })).toBe("1,234,567 طلب");
  });
});
