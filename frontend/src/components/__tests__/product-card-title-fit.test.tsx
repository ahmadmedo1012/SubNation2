/**
 * R127-L6 — ProductCard title-fit / density / LCP-priority pins.
 *
 * B3-K1 (P2): at 390px the shrink-0 category badge (82–112px) starved
 * the title to 20–50px inside the ~143px mobile row, and 16/45 catalog
 * titles clipped mid-glyph (impeccable text-overflow census; the
 * evidence probe lives at /tmp/b3-impeccable/clipped-title-card.png).
 * jsdom cannot run flexbox geometry, so the unit pin is the CLASS
 * contract that implements the fix (the existing r120-regressions
 * pattern) + a real-browser 390px census rides the lane's playwright
 * verification:
 *   • the title row wraps below sm (flex-wrap) and reverts to the
 *     single row at ≥sm (sm:flex-nowrap — 0/45 desktop overflow),
 *   • the title's flex basis is its content width (flex-auto, was
 *     flex-1/basis-0) so the wrap decision sees the real title and the
 *     badge reflows UNDER the title only when the two collide — a
 *     fitting row keeps the exact pre-fix distribution,
 *   • the badge keeps shrink-0 + full label and caps at max-w-full +
 *     truncate (≤320px ellipsis instead of a hard clip),
 *   • A4-F7's min-w-0 survives on the title.
 *
 * B3-K2: the ≥sm description row moves 11px/400 → text-xs +
 * font-semibold (pixel-median 3.2–3.6:1 hairline-ink density on the
 * smallest text; the report's "font-medium" is not implementable —
 * the repo loads Readex Pro 400/600/700 only and the design-system
 * gate bans font-medium in .tsx, a missing 500 snaps back to 400).
 *
 * B4 fix-5 (FE half): fetchpriority="high" extends to index < 2 — the
 * observed mobile LCP element was the index-1 card at "auto" (live
 * trace, B4 §B/D5). The App.tsx boot-catalog image warming is the other
 * half (lane L10).
 *
 * `@/lib/cart` and `@/hooks/use-toast` are mocked at the module
 * boundary (product-card-touch test pattern).
 */

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "@/components/ProductCard";

const addItemMock = vi.fn();
vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: (...args: unknown[]) => addItemMock(...args) }),
  useCartCommands: () => ({ addItem: (...args: unknown[]) => addItemMock(...args) }),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (...args: unknown[]) => toastMock(...args) }),
}));

const GRAMMARLY = {
  id: 1,
  slug: "grammarly-pro",
  // The census's worst-case family: one long unbreakable Latin token
  // ("Grammarly" = 78px) next to the widest Arabic badge
  // («أدوات ذكاء اصطناعي» = 112px).
  name: "Grammarly Pro",
  description: "Grammarly Pro — تصحيح لغوي متقدم بالذكاء الاصطناعي",
  image_url: "/products/grammarly-pro.webp",
  price: 45,
  category: "ai-tools",
  is_available: true,
  stock_count: 12,
};

function renderCard(product: typeof GRAMMARLY, index = 0) {
  return render(
    <Router>
      <ProductCard product={product} index={index} />
    </Router>,
  );
}

describe("ProductCard — B3-K1: the badge reflows under the title instead of starving it", () => {
  beforeEach(() => {
    addItemMock.mockReset();
    toastMock.mockReset();
  });

  it("the title row wraps below sm and stays a single row from sm up", () => {
    renderCard(GRAMMARLY);
    const title = screen.getByText("Grammarly Pro");
    const row = title.parentElement as HTMLElement;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("sm:flex-nowrap");
    // 0/45 desktop overflow in the same census — the ≥sm layout is
    // exactly what it was.
    expect(row.className).not.toMatch(/(^|\s)flex-nowrap(\s|$)/);
  });

  it("the title's flex basis is its content width (flex-auto), keeping A4-F7's min-w-0", () => {
    renderCard(GRAMMARLY);
    const title = screen.getByText("Grammarly Pro");
    // basis-0 (flex-1) made the title's hypothetical size 0 — the row
    // never "overflowed", so the badge never wrapped and the title
    // absorbed the entire squeeze. flex-auto lets the wrap decision see
    // the real title width.
    expect(title.className).toContain("flex-auto");
    expect(title.className).not.toContain("flex-1");
    // A4-F7: a wrapped-alone title wider than the row shrinks under
    // min-w-0 — never pushes the badge out of the card.
    expect(title.className).toContain("min-w-0");
    // The 2-line/1-line clamp ladder is unchanged (A1-F10).
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).toContain("sm:line-clamp-1");
  });

  it("the badge keeps its full label + shrink-0 and caps at max-w-full truncate (≤320px guard)", () => {
    renderCard(GRAMMARLY);
    const badge = screen.getByText("أدوات ذكاء اصطناعي");
    expect(badge.className).toContain("shrink-0");
    expect(badge.className).toContain("max-w-full");
    expect(badge.className).toContain("truncate");
    // The pill polish is untouched (96-F4 #11).
    expect(badge.className).toContain("text-3xs");
    expect(badge.className).toContain("font-semibold");
  });
});

describe("ProductCard — B3-K2: description density (11px/400 → text-xs font-semibold)", () => {
  it("the ≥sm description row is text-xs + font-semibold on the muted token", () => {
    renderCard(GRAMMARLY);
    const desc = screen.getByText(/تصحيح لغوي متقدم/);
    expect(desc.className).toContain("text-xs");
    expect(desc.className).toContain("font-semibold");
    expect(desc.className).toContain("text-muted-foreground");
    // The guard keeps referencing the RAW pre-fix literals — the
    // hairline 11px/400 rendering never comes back.
    expect(desc.className).not.toContain("text-2xs");
    expect(desc.className).not.toMatch(/(^|\s)font-normal(\s|$)/);
    // Still ≥sm-only (A1-F15 fold budget).
    expect(desc.className).toContain("hidden");
    expect(desc.className).toContain("sm:block");
  });
});

describe("ProductCard — B4 fix-5 (FE half): fetchpriority spans the mobile first row", () => {
  it("index 0 AND 1 carry fetchpriority=high (index 1 was the live mobile LCP element)", () => {
    const { unmount } = renderCard(GRAMMARLY, 1);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("fetchpriority")).toBe("high");
    unmount();

    renderCard(GRAMMARLY, 0);
    expect((screen.getByRole("img") as HTMLImageElement).getAttribute("fetchpriority")).toBe(
      "high",
    );
  });

  it("index 2–3 stay eager/auto and index ≥4 drops to lazy/low (above-fold budget unchanged)", () => {
    const cases: Array<[number, string, string]> = [
      [2, "eager", "auto"],
      [3, "eager", "auto"],
      [4, "lazy", "low"],
      [9, "lazy", "low"],
    ];
    for (const [index, loading, priority] of cases) {
      const { unmount } = renderCard(GRAMMARLY, index);
      const img = screen.getByRole("img") as HTMLImageElement;
      expect(img.getAttribute("loading")).toBe(loading);
      expect(img.getAttribute("fetchpriority")).toBe(priority);
      unmount();
    }
  });
});
