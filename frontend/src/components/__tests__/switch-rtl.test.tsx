/**
 * Switch RTL thumb direction (B6-P1-1).
 *
 * The thumb's checked transform is a PHYSICAL `translate-x-4`: in RTL the
 * thumb already rests at the (right) start edge, so +16px pushed it off
 * the end of the w-9 track — the checked state looked broken on the only
 * consumer (admin/pricing.tsx "simulate referred buyer" toggle).
 *
 * The fix keeps the LTR rule and adds a `rtl:` override that flips the
 * sign. Tailwind v4 compiles `data-[state=checked]:rtl:-translate-x-4`
 * AFTER the base rule at equal specificity (the rtl: variant's :where()
 * adds zero specificity), so the override deterministically wins in RTL
 * while LTR output is untouched.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Switch } from "@/components/ui/switch";

function getThumb(): HTMLElement {
  const root = screen.getByRole("switch");
  const thumb = root.firstElementChild;
  if (!(thumb instanceof HTMLElement)) throw new Error("thumb not rendered");
  return thumb;
}

describe("Switch — RTL thumb direction (B6-P1-1)", () => {
  it("checked thumb carries both the LTR transform and the rtl: override", () => {
    render(<Switch checked aria-label="محاكاة مشتري مُحال" />);

    const root = screen.getByRole("switch");
    expect(root).toHaveAttribute("data-state", "checked");

    const thumb = getThumb();
    // LTR base behavior unchanged: checked pushes the thumb +16px
    // (16px thumb inside a 32px inner track = exactly end-to-end).
    expect(thumb.className).toContain("data-[state=checked]:translate-x-4");
    // RTL: checked must move the thumb LEFT (inline-end), not off the
    // right edge of the track.
    expect(thumb.className).toContain("data-[state=checked]:rtl:-translate-x-4");
  });

  it("unchecked thumb stays at translate-x-0 in both directions", () => {
    render(<Switch aria-label="محاكاة مشتري مُحال" />);

    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "unchecked");
    expect(getThumb().className).toContain("data-[state=unchecked]:translate-x-0");
  });
});
