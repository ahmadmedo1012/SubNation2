/**
 * R157-C — the shared native-select primitive's contract.
 *
 * The select is a thin styled wrapper around the NATIVE <select>
 * (mobile OS picker sheets + real option semantics for Arabic SRs —
 * the ponytail reason it is not Radix); these tests pin the parts a
 * regression would silently eat:
 *
 *   • the Input-recipe geometry the five retired hand-rolled recipes
 *     drifted from (h-10 + rounded-xl + bg-card/60 + the calibrated
 *     border + the focus ring + the A13-F7 zoom guard),
 *   • the RTL chevron (appearance-none retires the native arrow; the
 *     inline-end ChevronDown is the replacement affordance),
 *   • the native behavior a Radix rebuild would have to re-implement:
 *     options render, value/onChange round-trip, disabled blocks.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "@/components/ui/select";

function renderSelect(props: React.ComponentProps<"select"> = {}) {
  return render(
    <Select aria-label="ترتيب المنتجات" {...props}>
      <option value="newest">الأحدث</option>
      <option value="price_asc">الأرخص</option>
    </Select>,
  );
}

describe("Select — the shared native-select primitive (R157-C)", () => {
  it("renders a native select with its options (combobox role, real option semantics)", () => {
    renderSelect();
    const select = screen.getByRole("combobox", { name: "ترتيب المنتجات" });
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "الأحدث" })).toHaveValue("newest");
    expect(screen.getByRole("option", { name: "الأرخص" })).toHaveValue("price_asc");
  });

  it("carries the Input-recipe geometry so every form field shares it", () => {
    renderSelect();
    const select = screen.getByRole("combobox", { name: "ترتيب المنتجات" });
    for (const token of [
      "h-10",
      "rounded-xl",
      "bg-card/60",
      "border-muted-foreground/75",
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
      "focus-visible:ring-offset-background",
      "[@media(min-width:48rem)_and_(pointer:fine)]:text-sm",
    ]) {
      expect(select.className, `lost "${token}"`).toContain(token);
    }
  });

  it("the RTL chevron rides the inline-end (appearance-none retired the native arrow)", () => {
    const { container } = renderSelect();
    const select = screen.getByRole("combobox", { name: "ترتيب المنتجات" });
    // The native arrow is suppressed — the padding reserves its slot…
    expect(select.className).toContain("appearance-none");
    expect(select.className).toContain("pe-8");
    // …and the ChevronDown replacement sits at the logical inline-end.
    const chevron = container.querySelector("svg");
    expect(chevron).toBeTruthy();
    // toHaveClass (not .className — that's SVGAnimatedString on SVG).
    expect(chevron).toHaveClass("end-2.5");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
  });

  it("round-trips value changes through onChange (the native event path)", () => {
    const onChange = vi.fn();
    renderSelect({ onChange });
    const select = screen.getByRole("combobox", {
      name: "ترتيب المنتجات",
    }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "price_asc" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].target).toHaveValue("price_asc");
    expect(select).toHaveValue("price_asc");
  });

  it("disabled carries the disabled styles and blocks the control", () => {
    renderSelect({ disabled: true });
    const select = screen.getByRole("combobox", {
      name: "ترتيب المنتجات",
    }) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(select.className).toContain("disabled:cursor-not-allowed");
    expect(select.className).toContain("disabled:opacity-50");
  });
});
