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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
 * R139 (precision): the r138 register parity — the flagged drifts this
 * round closed (r138-b/r138-f/r138-e left the skeleton family one round
 * behind the real surfaces it mirrors).
 */
describe("RouteSkeleton — r138 register parity (R139)", () => {
  it("ProductCardShell rests at the real card's border-border/60 with the bg-muted/60 shelf marker", () => {
    const { container } = render(<ProductCardShell />);
    const card = container.firstElementChild as HTMLElement;
    // r138-b: the real ProductCard's resting edge went 70→60; the
    // skeleton kept /50 — a 10% alpha step on every card container at
    // each shimmer→content swap of the 8-card catalog grid.
    expect(card.className).toContain("border-border/60");
    expect(card.className).not.toContain("border-border/50");
    // The well carries the real card's shelf class — a REGISTER marker
    // riding along render-neutral (.skeleton-shimmer owns the base fill
    // and wins the @layer utilities source order; the R136 riding-tint
    // idiom — the /60 wash's pixel parity is capped by the utility).
    const media = card.firstElementChild as HTMLElement;
    expect(media.className).toContain("bg-muted/60");
    expect(media.className).toContain("skeleton-shimmer");
    // NO two-layer calm elevation — the r138-B shadow is the
    // PROMINENT-card register; placeholders rest at the skeleton
    // family's flatter, quieter step.
    expect(card.className).not.toContain("shadow-[");
  });

  it("ProductCardShell's internal divider rides the /20 hairline family value", () => {
    const { container } = render(<ProductCardShell />);
    const divider = container.querySelector(".border-t") as HTMLElement | null;
    expect(divider).toBeInstanceOf(HTMLElement);
    // R139 (precision, border-rhythm consistency): the real ProductCard
    // divider (and, since r138-e, the checkout receipt's section rules)
    // ride /20 — the skeleton's /25 was the lone outlier between the two
    // /20 surfaces it previews.
    expect(divider!.className).toContain("border-border/20");
    expect(divider!.className).not.toContain("border-border/25");
  });

  it("the product shell's title bar tracks the PDP h1's fluid-3xl (h-7 → h-9)", () => {
    const { container } = render(<RouteSkeleton shape="product" />);
    const sections = container.querySelectorAll("section");
    // r138-f: the real h1 went text-fluid-2xl → text-fluid-3xl — ≈29.5px
    // mobile, 46.4px desktop cap, clamp midpoint ≈38px. h-9=36px is the
    // closest step in the shell vocabulary (h-7=28px was the
    // fluid-2xl-era midpoint pick for that clamp's 22→32px range).
    const titleBar = sections[0].querySelector(".space-y-4 > .h-9");
    expect(titleBar).toBeInstanceOf(HTMLElement);
    expect(titleBar!.className).toContain("w-3/4");
    expect(sections[0].querySelector(".space-y-4 > .h-7")).toBeNull();
    // The 16:9 media plane carries the real page's bg-muted/60 shelf
    // marker (render-neutral riding tint — see ProductCardShell above);
    // the section chrome (lg:border-border/60 + lg:shadow-xl) is
    // verified parity with ProductMediaSection (R143 L2-2: /55 → /60 on
    // both sides of the mirror — the r139 resting card-frame value).
    const media = sections[0].querySelector('[class*="aspect-[16/9]"]');
    expect(media).toBeInstanceOf(HTMLElement);
    expect((media as HTMLElement).className).toContain("bg-muted/60");
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

  it("the admin shell's table frame rests at the admin family's border-border/60 (R139)", () => {
    const { container } = render(<RouteSkeleton shape="admin" />);
    // Every real admin table container (OrdersTable / RiskEventsTable /
    // ReferralsTable) and the canonical admin TableSkeleton ride the
    // resting /60 frame — the route-level fallback was the lone /50
    // outlier, flashing a softer frame on every admin cold load.
    const frame = container.querySelector(".bg-card.rounded-2xl") as HTMLElement | null;
    expect(frame).toBeInstanceOf(HTMLElement);
    expect(frame!.className).toContain("border-border/60");
    expect(frame!.className).not.toContain("border-border/50");
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

/**
 * B13 F-3 (R127-L6): skeleton hero radius parity. The real heroes the
 * catalog/detail shells mirror went rounded-3xl → rounded-2xl in
 * R125-I7 (home guest+authed hero, category, loyalty cards); the two
 * RouteSkeleton hero bands kept 24px corners, so every cold route-load
 * of `/` and `/category/*` popped its radius on the skeleton → content
 * swap. Cosmetic-only (aspect/height reserved — zero CLS), but the
 * skeleton-parity contract (product.tsx: "mirrors the real card so the
 * grid doesn't jump on load") covers corner radius too.
 */
describe("RouteSkeleton hero bands — rounded-2xl parity (B13 F-3 / R127-L6)", () => {
  it("catalog hero band is rounded-2xl (mirrors home/category heroes post-R125-I7)", () => {
    const { container } = render(<RouteSkeleton shape="catalog" />);
    const hero = container.querySelector(".max-w-6xl")!.firstElementChild as HTMLElement;
    expect(hero.className).toContain("rounded-2xl");
    expect(hero.className).toContain("h-[160px]");
    expect(hero.className).not.toContain("rounded-3xl");
  });

  it("detail hero band is rounded-2xl (mirrors loyalty's 16px cards)", () => {
    const { container } = render(<RouteSkeleton shape="detail" />);
    const hero = container.querySelector(".max-w-4xl")!.firstElementChild as HTMLElement;
    expect(hero.className).toContain("rounded-2xl");
    expect(hero.className).not.toContain("rounded-3xl");
  });

  it("form shell KEEPS rounded-3xl — onboarding.tsx:119 is still 24px (B-12 tail)", () => {
    const { container } = render(<RouteSkeleton shape="form" />);
    // The faithful mirror is the one that matches the real page: the
    // auth-card REFUSE tail is a separate batch (B-12) — flipping this
    // skeleton before its real page would CREATE the drift F-3 fixes.
    expect(container.querySelector(".max-w-md .rounded-3xl")).toBeInstanceOf(HTMLElement);
  });
});

/**
 * R143 (L2-2): the route-skeleton joins the /55 → /60 resting-edge ban.
 * The r139 sweep landed border-border/60 everywhere except auth + the
 * PDP trio + this shared loading primitive (which had mirrored the PDP's
 * /55 as "verified parity"). The existing r139 visual suites already
 * assert `not.toContain("border-border/55")` for FAQ/PROFILE/SESSIONS/
 * admin-catalog/access-ops — this extends the ban to the skeleton family
 * so the shared primitive can never re-inherit the drift.
 */
describe("RouteSkeleton — the /55 resting edge is banned (R143 L2-2)", () => {
  // Comments stripped (the r139 suite idiom) — rationale prose may NAME
  // the retired /55 value without tripping the ban.
  const strip = (s: string): string =>
    s
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\*.*$/gm, "");
  const src = strip(
    readFileSync(resolve(process.cwd(), "src/components/ui/route-skeleton.tsx"), "utf8"),
  );

  it("no border-border/55 anywhere in the skeleton family source", () => {
    // Source-scan (the r139 suite idiom): the three former sites were
    // the PDP section pair (lg:border-border/55 ×2) + FormShell's auth
    // card (border-border/55) — all now the family /60.
    expect(src).not.toContain("border-border/55");
    expect(src.match(/border-border\/60/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("the PDP section pair still mirrors ProductMediaSection/BuyPanelColumn exactly", () => {
    // Verified parity cuts both ways: the mirror must ride the SAME
    // classes the real sections ride post-R143.
    expect(src).toContain("lg:bg-card lg:border lg:border-border/60 lg:rounded-2xl");
    expect(src).toContain(
      "lg:self-start lg:sticky lg:top-24 lg:bg-card lg:border lg:border-border/60",
    );
  });
});

// ── R186 (H-F7): comment-pointer truth ───────────────────────────────────────

describe("RouteSkeleton — the ROUTE_SHAPES pointer names route-shapes.ts (R186 H-F7)", () => {
  it("no stale pre-R137 App.tsx ROUTE_SHAPES / App.tsx:1xx pointer survives in the docblock", () => {
    // ROUTE_SHAPES has lived at app/route-shapes.ts (checkout entry
    // :54) since the R137 route-registry decomposition; App.tsx:114 is
    // unrelated code. Raw source, comments INCLUDED (the `strip` helper
    // above would erase the docblock this pin guards).
    const raw = readFileSync(
      resolve(process.cwd(), "src/components/ui/route-skeleton.tsx"),
      "utf8",
    );
    expect(raw).not.toContain("App.tsx ROUTE_SHAPES");
    expect(raw).not.toContain("App.tsx:114");
    expect(raw).toContain("route-shapes.ts:54");
  });
});
