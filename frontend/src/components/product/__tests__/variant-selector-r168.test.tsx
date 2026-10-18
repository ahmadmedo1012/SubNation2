/**
 * R168-L3 (fix 5) — the duration pills' monthly-equivalent sub-line.
 *
 * The selector's own docblock named the mental model (Libyan shoppers
 * compare monthly-equivalent value per option) but never rendered the
 * comparison — the shopper did long division mid-purchase. Multi-month
 * pills now carry «≈ N د.ل شهريًا» under the price, derived ONLY from
 * labels the catalog actually uses (parseDurationMonths' fail-safe:
 * unparsable / «بدون مدة» / month-count < 1 → no line, never a
 * fabricated duration).
 *
 * Two contracts pinned here:
 *   1. the pure parser's table (the unit suite the round asked for);
 *   2. the rendering: sub-line present iff months > 1 (a 1-month
 *      pill's per-month IS the displayed price), cents-rounded via the
 *      repo idiom, and the pill's single-button a11y contract intact
 *      (the aria-label keeps naming label + price, nothing else).
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VariantSelector,
  parseDurationMonths,
  type SelectableVariant,
} from "@/components/product/VariantSelector";

afterEach(cleanup);

function variant(over: Partial<SelectableVariant> & { id: number }): SelectableVariant {
  return { label: "باقة", price: 25, is_available: true, ...over };
}

function renderSelector(variants: SelectableVariant[], selectedId: number | null = null) {
  return render(<VariantSelector variants={variants} selectedId={selectedId} onSelect={vi.fn()} />);
}

// ── 1. the pure parser — the parse table + the fail-safes ────────────────

describe("R168-L3 fix 5 — parseDurationMonths (pure)", () => {
  // The labels the catalog actually uses (live set behind the selector).
  it.each([
    ["شهر واحد", 1],
    ["1 شهر", 1],
    ["3 أشهر", 3],
    ["6 أشهر", 6],
    ["12 شهر", 12],
    ["سنة", 12],
    ["سنة كاملة", 12],
  ])("%s → %d month(s)", (label, months) => {
    expect(parseDurationMonths(label)).toBe(months);
  });

  it("surrounding whitespace is tolerated", () => {
    expect(parseDurationMonths(" 3 أشهر ")).toBe(3);
  });

  // The fail-safes — every non-well-formed label renders NO line.
  it.each([
    ["مدى الحياة"],
    ["بدون مدة"],
    ["شهري"], // recurring descriptor, not a duration count
    ["سنوي"],
    ["أسبوع"],
    ["شهر"], // bare unit, no count
    ["سنة كاملة مع هدية"], // anchored — trailing junk must not parse
    ["شهر سنه اسبوع يوم برو بلس"], // a real catalog name string, not a label
    ["3 اشهر"], // bare alef (أشهر is the catalog spelling)
    ["٣ أشهر"], // Arabic-Indic digits — the app numeral language is Latin
    [""],
  ])("%s → null (never fabricate)", (label) => {
    expect(parseDurationMonths(label)).toBeNull();
  });

  it("null/undefined labels → null", () => {
    expect(parseDurationMonths(null)).toBeNull();
    expect(parseDurationMonths(undefined)).toBeNull();
  });

  it("month-count < 1 → null (the task's floor)", () => {
    expect(parseDurationMonths("0 شهر")).toBeNull();
    expect(parseDurationMonths("-3 أشهر")).toBeNull();
  });
});

// ── 2. the rendering — the sub-line inside the pill ──────────────────────

describe("R168-L3 fix 5 — the monthly-equivalent sub-line renders (months > 1 only)", () => {
  it("a 3-month pill carries «≈ 26.67 د.ل شهريًا» off the SALE price (cents-rounded)", async () => {
    renderSelector([
      variant({ id: 1, duration_label: "شهر واحد", label: "شهر واحد", price: 25 }),
      variant({
        id: 2,
        duration_label: "3 أشهر",
        label: "3 أشهر",
        price: 100,
        sale_price: 80, // 80/3 = 26.666… → 26.67 via the repo cents idiom
      }),
    ]);

    // The pill's aria-label contract is UNCHANGED — label + price, the
    // sub-line is visible-only comparison context (no second button).
    const threeMonths = screen.getByRole("button", { name: "3 أشهر — 80.00 د.ل" });
    expect(threeMonths.textContent).toContain("≈ 26.67 د.ل شهريًا");
    // One button per option — the pill was never split.
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("a year pill carries the equivalent («سنة كاملة» = 12 months)", () => {
    renderSelector([
      variant({ id: 1, duration_label: "سنة كاملة", label: "سنة كاملة", price: 300 }),
    ]);

    expect(screen.getByRole("button", { name: "سنة كاملة — 300.00 د.ل" }).textContent).toContain(
      "≈ 25.00 د.ل شهريًا",
    );
  });

  it("a 1-month pill renders NO sub-line (the per-month IS the displayed price)", () => {
    renderSelector([variant({ id: 1, duration_label: "شهر واحد", label: "شهر واحد", price: 25 })]);

    const pill = screen.getByRole("button", { name: "شهر واحد — 25.00 د.ل" });
    expect(pill.textContent).not.toContain("شهريًا");
  });

  it("unparsable durations («مدى الحياة») render NO sub-line — never fabricate", () => {
    renderSelector([
      variant({ id: 1, duration_label: "مدى الحياة", label: "مدى الحياة", price: 400 }),
    ]);

    const pill = screen.getByRole("button", { name: "مدى الحياة — 400.00 د.ل" });
    expect(pill.textContent).not.toContain("شهريًا");
  });
});
