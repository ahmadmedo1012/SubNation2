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
import { ProductCardShell, RouteSkeleton } from "@/components/ui/route-skeleton";

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

/**
 * R123-E4b (P2 + CLS): the product shape must mirror pages/product.tsx —
 * the real page root is max-w-xl below lg and lg:max-w-6xl with the
 * R116-S2 two-column desktop split, a recommendations rail and (below
 * sm) the sticky buy bar. The old single-column max-w-xl shell made the
 * real container jump 576px→1152px wide at ≥1024px on the
 * skeleton→content swap (live-measured 0.176 layout-shift entry on
 * /product/netflix-premium; page CLS 0.21) and left the footer
 * in-viewport on mobile (a further ~0.12 shift when the taller content
 * pushed it out). product.tsx's in-page isLoading branch renders this
 * same shape, so these pins cover both skeleton phases.
 */
describe("RouteSkeleton product shape — desktop split + height reservation (R123-E4b)", () => {
  it("container is max-w-xl below lg and lg:max-w-6xl (mirrors the page root)", () => {
    const { container } = render(<RouteSkeleton shape="product" />);
    const root = container.querySelector('[class*="lg:max-w-6xl"]') as HTMLElement | null;
    expect(root).toBeInstanceOf(HTMLElement);
    expect(root!.className).toContain("max-w-xl");
  });

  it("the split wrapper is lg:grid lg:grid-cols-2 with a sticky buy-panel column", () => {
    const { container } = render(<RouteSkeleton shape="product" />);
    const wrapper = container.querySelector('[class*="lg:grid-cols-2"]') as HTMLElement | null;
    expect(wrapper).toBeInstanceOf(HTMLElement);
    // START column: media card; END column: the sticky buy panel — both
    // dissolve below lg (max-lg:contents) exactly like the real page.
    const sections = wrapper!.querySelectorAll("section");
    expect(sections.length).toBe(2);
    expect(sections[0].className).toContain("max-lg:contents");
    expect(sections[0].className).toContain("lg:rounded-2xl");
    expect(sections[1].className).toContain("lg:sticky");
    expect(sections[1].className).toContain("max-lg:contents");
    // The 16:9 media area lives in the START column.
    expect(sections[0].querySelector('[class*="aspect-[16/9]"]')).toBeInstanceOf(HTMLElement);
  });

  it("holds the recommendations rail + mobile sticky-bar slot (footer stays below the fold)", () => {
    const { container } = render(<RouteSkeleton shape="product" />);
    // Recommendations rail: header bar + 2 aspect-[4/3] cards (the same
    // geometry RecommendationsSection renders while its query loads).
    const rail = container.querySelector(".mt-8.space-y-4") as HTMLElement | null;
    expect(rail).toBeInstanceOf(HTMLElement);
    const railCards = rail!.querySelectorAll('[class*="aspect-[4/3]"]');
    expect(railCards.length).toBe(2);
    // Mobile sticky buy-bar slot — <sm only.
    const stickySlot = container.querySelector(".sm\\:hidden") as HTMLElement | null;
    expect(stickySlot).toBeInstanceOf(HTMLElement);
  });
});

/**
 * R123-E4b (P3-c): the new width/archetype shells. "list-wide"/"list-narrow"
 * are the list archetype at the wallet (max-w-5xl) and referrals/profile
 * (max-w-2xl) page roots; "grid" is the filter-less flash-sales shell —
 * the catalog shape's filter row must NOT appear there (the flash page
 * has no filters).
 */
describe("RouteSkeleton width/archetype shells (R123-E4b P3-c)", () => {
  it("list-wide is max-w-5xl (wallet) and list-narrow is max-w-2xl (referrals/profile)", () => {
    const wide = render(<RouteSkeleton shape="list-wide" />);
    const wideRoot = wide.container.querySelector(".max-w-5xl") as HTMLElement | null;
    expect(wideRoot).toBeInstanceOf(HTMLElement);
    expect(wideRoot!.className).not.toContain("max-w-3xl");
    wide.unmount();

    const narrow = render(<RouteSkeleton shape="list-narrow" />);
    const narrowRoot = narrow.container.querySelector(".max-w-2xl") as HTMLElement | null;
    expect(narrowRoot).toBeInstanceOf(HTMLElement);
  });

  it("grid (flash-sales) is a max-w-6xl card grid with NO filter row", () => {
    const { container } = render(<RouteSkeleton shape="grid" />);
    const root = container.querySelector(".max-w-6xl") as HTMLElement | null;
    expect(root).toBeInstanceOf(HTMLElement);
    const grid = root!.querySelector('[class*="lg:grid-cols-4"]');
    expect(grid).toBeInstanceOf(HTMLElement);
    // The catalog shell's filter row is a pair of h-10 bars above the
    // grid — the flash page has no filters, so none may render.
    expect(root!.querySelector(".h-10")).toBeNull();
  });
});
