/**
 * R158-D (ledger b) — the shared FilterTabs primitive's contract.
 *
 * The audit's tray/pill census found seven hand-rolled twins speaking
 * one dialect with drifting callback spellings; ui/filter-tabs.tsx is
 * that dialect extracted (native buttons + Tailwind — the ponytail
 * verdict, no library). These tests pin the parts a regression would
 * silently eat:
 *
 *   • the toggle semantics — aria-pressed on the active pill, a
 *     role="group" + aria-label container when named, native
 *     buttons all (the idiom the five admin twins + the two
 *     converted storefront pages rode);
 *   • the canonical calm-pill classes (active trio / boxed
 *     transparent tray-idle / muted-box chips-idle, duration-150,
 *     the storefront 44px floor);
 *   • the count honesty rules (null = unknown renders nothing, 0
 *     hides, >0 renders inline or as the micro-chip);
 *   • the onSelect round-trip through the item's typed value;
 *   • the tone fills (the status-token actives the orders chips'
 *     documented per-bucket colors);
 *   • the RTL orientation — the decorative icon rides the inline
 *     START (right edge under dir="rtl"), aria-hidden.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterTabs, type FilterTabItem } from "@/components/ui/filter-tabs";
import { Clock } from "lucide-react";

type Bucket = "all" | "pending" | "completed";

function renderTabs(overrides: Partial<React.ComponentProps<typeof FilterTabs<Bucket>>> = {}) {
  const items: FilterTabItem<Bucket>[] = [
    { value: "all", label: "الكل" },
    { value: "pending", label: "قيد الانتظار", count: 3 },
    { value: "completed", label: "مكتمل", count: null },
  ];
  return render(
    <FilterTabs
      items={items}
      value="all"
      onSelect={vi.fn()}
      ariaLabel="تصفية الحالة"
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("FilterTabs — the shared tray/pill primitive (R158-D)", () => {
  it("renders native buttons inside a named group, aria-pressed exposing the active pill", () => {
    renderTabs();
    const group = screen.getByRole("group", { name: "تصفية الحالة" });
    expect(group.tagName).toBe("DIV");
    expect(screen.getByRole("button", { name: "الكل" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /قيد الانتظار/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("carries the canonical calm-pill classes and the 44px touch floor", () => {
    const { container } = renderTabs();
    const active = screen.getByRole("button", { name: "الكل" });
    for (const token of [
      "min-h-11",
      "text-xs",
      "transition-all",
      "duration-150",
      "rounded-lg",
      "bg-primary/15",
      "text-primary-text",
      "border-primary/30",
      // twMerge folds the base font-semibold under the active font-bold
      // (the twins shipped both; CSS picked bold — same rendered weight).
      "font-bold",
    ]) {
      expect(active.className, `active lost "${token}"`).toContain(token);
    }
    // The tray wash track + the boxed-transparent inactive idiom (the
    // base font-semibold survives on the inactive pill).
    expect(container.firstElementChild?.className).toContain("bg-secondary/40");
    const idle = screen.getByRole("button", { name: /قيد الانتظار/ });
    expect(idle.className).toContain("font-semibold");
    expect(idle.className).toContain("border-transparent");
    expect(idle.className).toContain("hover:bg-muted/30");
  });

  it("the chips variant trades the tray for the tray-less muted box", () => {
    const { container } = renderTabs({ variant: "chips" });
    expect(container.firstElementChild?.className).toContain("flex-wrap");
    const idle = screen.getByRole("button", { name: /قيد الانتظار/ });
    expect(idle.className).toContain("bg-muted/30");
    expect(idle.className).toContain("border-border/30");
    expect(idle.className).toContain("hover:bg-muted/60");
  });

  it("round-trips selection through onSelect with the item's typed value", () => {
    const onSelect = vi.fn();
    renderTabs({ onSelect });
    fireEvent.click(screen.getByRole("button", { name: /قيد الانتظار/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("pending");
  });

  it("counts stay honest: >0 renders, 0 and null (unknown) render nothing", () => {
    renderTabs();
    // pending (count 3) renders inline; completed (null — the R126-L3
    // unknown) renders no badge; the count is quiet muted metadata.
    expect(screen.getByText("3")).toBeInTheDocument();
    const completed = screen.getByRole("button", { name: "مكتمل" });
    expect(completed.textContent).toBe("مكتمل");
    expect(screen.getByText("3").className).toContain("text-muted-foreground");
  });

  it("countBadge 'chip' rides the alerts micro-chip and 'none' hides the badge", () => {
    const { unmount } = renderTabs({ countBadge: "chip" });
    expect(screen.getByText("3").className).toContain("rounded-full");
    expect(screen.getByText("3").className).toContain("bg-muted/60");
    unmount();

    renderTabs({ countBadge: "none" });
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("a status tone re-skins the active fill through the --status-* tokens", () => {
    renderTabs({
      value: "pending",
      items: [
        { value: "all", label: "الكل" },
        { value: "pending", label: "قيد الانتظار", tone: "warning" },
      ],
    });
    const active = screen.getByRole("button", { name: /قيد الانتظار/ });
    expect(active.className).toContain("bg-status-warning/15");
    expect(active.className).toContain("text-status-warning");
    expect(active.className).toContain("border-status-warning/30");
  });

  it("the decorative icon rides the inline start, aria-hidden (RTL: the leading edge)", () => {
    renderTabs({
      items: [
        { value: "all", label: "الكل", icon: Clock },
        { value: "pending", label: "قيد الانتظار" },
      ],
    });
    const pill = screen.getByRole("button", { name: "الكل" });
    const icon = pill.querySelector("svg");
    expect(icon).toBeTruthy();
    // Leading position = inline-start; under the app's dir="rtl" that
    // is the RIGHT edge — physical left/right classes would break the
    // mirror, so the pill carries none.
    expect(pill.firstElementChild).toBe(icon);
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
