/**
 * 96-F4 (R96 A1 M12): the product-card skeleton mirrors the real card's
 * always-visible mobile CTA.
 *
 * Every real ProductCard renders a `md:hidden min-h-11` buy button (or
 * the «نفد المخزون» bar) below the details block; ProductCardShell
 * mirrored only the image + text rows, so every card grew ~58px on the
 * skeleton → content swap of the 8-card mobile grid — a visible CLS jump
 * on the highest-traffic page (exactly the class the route-skeleton
 * system exists to eliminate).
 *
 * Pins the placeholder's presence, its geometry classes (matching the
 * real CTA's `mx-3.5 mb-3.5 min-h-11` rhythm) and its position as the
 * LAST child of the card shell — same slot the real CTA occupies.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductCardShell } from "@/components/ui/route-skeleton";

describe("ProductCardShell — mobile CTA placeholder (96-F4 / R96 A1 M12)", () => {
  it("renders a md:hidden min-h-11 CTA placeholder block", () => {
    const { container } = render(<ProductCardShell />);

    const cta = container.querySelector(".md\\:hidden");
    expect(cta).toBeInstanceOf(HTMLElement);
    expect(cta!.className).toContain("min-h-11");
    expect(cta!.className).toContain("mx-3.5");
    expect(cta!.className).toContain("mb-3.5");
    expect(cta!.className).toContain("skeleton-shimmer");
  });

  it("places the placeholder AFTER the details block (the real CTA's slot)", () => {
    const { container } = render(<ProductCardShell />);

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("rounded-2xl");

    // The details block (p-3.5) is followed by the CTA placeholder —
    // mirroring ProductCard's DOM order (Link details → sibling button).
    const details = card.querySelector(".p-3\\.5");
    expect(details).toBeInstanceOf(HTMLElement);
    const cta = card.querySelector(".md\\:hidden") as HTMLElement;
    expect(cta.previousElementSibling).toBe(details);
  });

  it("the image area stays an aspect-square shimmer (existing geometry unchanged)", () => {
    const { container } = render(<ProductCardShell />);
    const card = container.firstElementChild as HTMLElement;
    const media = card.firstElementChild as HTMLElement;
    expect(media.className).toContain("aspect-square");
    expect(media.className).toContain("skeleton-shimmer");
  });
});
