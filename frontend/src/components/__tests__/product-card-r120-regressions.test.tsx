/**
 * R120-B1 regressions — ProductCard storefront-shell fixes.
 *
 *   • A3-F10/A4-F4: sold-out cards are no longer dead taps. They kept
 *     pointer-events-none + aria-disabled (focusable-looking but dead),
 *     so 6+ leading نفد cards neither navigated nor announced why. The
 *     card now navigates to the product page (which handles نفد
 *     honestly) while the dimmed opacity/saturate treatment stays and
 *     every add-to-cart affordance remains gated off.
 *   • A1-F2: a persistent desktop quick-add icon button lives in the
 *     price row (the old desktop CTA was hover-reveal only); sold-out
 *     keeps a dimmed DISABLED affordance.
 *   • A1-F1: resting chrome reads as a container; A1-F4: a unified
 *     gradient pad sits behind every image. (R138 re-tuned the resting
 *     values — border 70→60, shadow-sm → the two-layer calm elevation,
 *     the well bg-card → bg-muted/60 — see the R138-pinned tests below;
 *     the A1-F1 mechanism itself, chrome carrying the container read,
 *     is unchanged.)
 *   • A1-F10/A7-F13: h3 name with 2 clamp lines below sm; the 11px
 *     description row is hidden below sm.
 *
 * `@/lib/cart` and `@/hooks/useToast` are mocked at the module
 * boundary (product-card-touch.test.tsx pattern).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "@/components/ProductCard";
import { formatCurrency } from "@/lib/utils";

const addItemMock = vi.fn();
vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: (...args: unknown[]) => addItemMock(...args) }),
  useCartCommands: () => ({ addItem: (...args: unknown[]) => addItemMock(...args) }),
  // C-2 (R142): the card imports the real threshold constant now — the
  // module mock must carry it (the value mirrors cart.tsx's definition).
  LOW_STOCK_THRESHOLD: 3,
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: (...args: unknown[]) => toastMock(...args) }),
}));
const toastMock = vi.fn();

beforeEach(() => {
  addItemMock.mockReset();
  toastMock.mockReset();
});

const AVAILABLE_PRODUCT = {
  id: 5,
  slug: "chatgpt-plus",
  name: "ChatGPT Plus شهر",
  description: "اشتراك ChatGPT Plus لمدة شهر",
  image_url: null,
  price: 120,
  category: "ai-tools",
  is_available: true,
  stock_count: 9,
};

const SOLD_OUT_PRODUCT = {
  ...AVAILABLE_PRODUCT,
  id: 6,
  slug: "netflix-1m",
  name: "Netflix شهر",
  category: "streaming",
  is_available: false,
  stock_count: 0,
};

function renderCard(product: typeof AVAILABLE_PRODUCT) {
  return render(
    <Router>
      <ProductCard product={product} index={0} />
    </Router>,
  );
}

describe("ProductCard — sold-out cards navigate, not dead (R120-B1 / A3-F10 + A4-F4)", () => {
  it("keeps the dimmed treatment but drops pointer-events-none", () => {
    const { container } = renderCard(SOLD_OUT_PRODUCT);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("opacity-45");
    expect(card.className).toContain("saturate-[0.3]");
    expect(card.className).not.toContain("pointer-events-none");
  });

  it("the details Link navigates and no longer carries aria-disabled", () => {
    renderCard(SOLD_OUT_PRODUCT);
    const link = screen.getByRole("link", { name: /Netflix شهر/ });
    expect(link).toHaveAttribute("href", "/product/netflix-1m");
    expect(link).not.toHaveAttribute("aria-disabled");
    // The composed label still announces the honest state…
    expect(link).toHaveAccessibleName(/نفد المخزون/);
  });

  it("no add-to-cart affordance is live for sold-out (quick-add disabled, no mobile CTA)", () => {
    renderCard(SOLD_OUT_PRODUCT);
    expect(screen.queryByRole("button", { name: "أضف للسلة" })).not.toBeInTheDocument();
    const quickAdd = screen.getByRole("button", { name: "نفد المخزون" });
    expect(quickAdd).toBeDisabled();
  });
});

describe("ProductCard — persistent desktop quick-add (R120-B1 / A1-F2)", () => {
  it("renders a keyboard-focusable icon button that shares the cart handler", () => {
    renderCard(AVAILABLE_PRODUCT);
    const quickAdd = screen.getByRole("button", { name: /أضف ChatGPT Plus شهر إلى السلة/ });
    expect(quickAdd.className).toContain("md:flex");
    fireEvent.click(quickAdd);
    expect(addItemMock).toHaveBeenCalledTimes(1);
    expect(addItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 5, name: "ChatGPT Plus شهر" }),
    );
  });

  it("shares the 500ms double-tap lock with the mobile CTA", () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    try {
      renderCard(AVAILABLE_PRODUCT);
      const quickAdd = screen.getByRole("button", { name: /أضف ChatGPT Plus شهر إلى السلة/ });
      dateNowSpy.mockReturnValue(10_000);
      fireEvent.click(quickAdd);
      dateNowSpy.mockReturnValue(10_200);
      fireEvent.click(quickAdd);
      expect(addItemMock).toHaveBeenCalledTimes(1);
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});

describe("ProductCard — chrome + imagery + type regressions (R120-B1)", () => {
  it("resting chrome: border-border/60 + the R138 two-layer calm elevation (A1-F1)", () => {
    const { container } = renderCard(AVAILABLE_PRODUCT);
    const card = container.firstElementChild as HTMLElement;
    // R138 (visual): resting border 70→60 + shadow-sm shadow-black/25 →
    // a two-layer calm elevation — the live audit read resting cards as
    // raw HTML containers; widening the resting→hover gap (border 60→
    // 100%, sm→xl shadow) makes the affordance legible without adding
    // motion. Rationale block: ProductCard.tsx R138 comment above the
    // card root.
    // R143 (L2-1): the calm recipe is now the theme-aware `shadow-calm`
    // token (index.css) — dark rendering byte-identical to the r138
    // literal, .light re-tuned inside DESIGN.md's 6–14% ceiling. The
    // literal itself must not come back.
    expect(card.className).toContain("border-border/60");
    expect(card.className).toContain("shadow-calm");
    expect(card.className).not.toContain("0_10px_28px");
    // The old flat resting (one 1-3px layer) never comes back.
    expect(card.className).not.toContain("shadow-sm");
    // A BASE shadow-black/25 would re-color BOTH arbitrary layers to a
    // flat 25% (v4 color utilities ride --tw-shadow-color) — the color
    // must only exist at hover scope. The hover: prefix must not match
    // this guard, hence the leading boundary.
    expect(card.className).not.toMatch(/(^|\s)shadow-black\/25(\s|$)/);
    // Hover progression preserved verbatim (R120-B1): full-strength
    // border + the bare themed xl geometry. R157-C: the black/25
    // shadow-color override retired — a bare shadow utility resolves
    // through the theme's own ladder (index.css), so .light renders
    // the ladder's xl (≈13%, inside DESIGN.md's 6–14% ceiling) instead
    // of the literal 25% black; dark is byte-identical (the 55% step).
    expect(card.className).toContain("hover:border-border");
    expect(card.className).toContain("hover:shadow-xl");
    expect(card.className).not.toContain("shadow-black");
  });

  it("R138: the image well is a muted/60 shelf plane, not a bare bg-card tile", () => {
    const { container } = renderCard(AVAILABLE_PRODUCT);
    const well = container.querySelector(".aspect-square") as HTMLElement;
    // R138 (visual): bg-card → bg-muted/60 — the well was the same tone
    // as the card body (sub-perceptual on dark), so catalog imagery
    // read as raw file previews on a bare background; the /60 muted
    // wash (empty-state icon-tile vocabulary) gives the media plane its
    // own shelf surface.
    expect(well.className).toContain("bg-muted/60");
    expect(well.className).not.toContain("bg-card");
  });

  it("unified image pad tile sits behind the image area (A1-F4)", () => {
    const { container } = renderCard(AVAILABLE_PRODUCT);
    const tile = container.querySelector(
      ".aspect-square > .bg-gradient-to-b.from-white\\/\\[0\\.06\\]",
    );
    expect(tile).toBeInstanceOf(HTMLElement);
    expect(tile!.getAttribute("aria-hidden")).toBe("true");
  });

  it("name is an h3, 2 clamp lines below sm, 1 from sm; description hidden below sm (A1-F10/A7-F13)", () => {
    renderCard(AVAILABLE_PRODUCT);
    const name = screen.getByText("ChatGPT Plus شهر");
    expect(name.tagName).toBe("H3");
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).toContain("sm:line-clamp-1");
    const desc = screen.getByText("اشتراك ChatGPT Plus لمدة شهر");
    expect(desc.className).toContain("hidden");
    expect(desc.className).toContain("sm:block");
  });
});

describe("ProductCard — RTL anchor on Latin names (R128-A2 F-1)", () => {
  it('the h3 keeps dir="auto" isolation AND pins text-right — Latin titles don\'t float off the RTL reading edge', () => {
    renderCard(AVAILABLE_PRODUCT);
    const name = screen.getByText("ChatGPT Plus شهر");
    // dir=auto (R116-S2) stays: Latin names resolve their own base
    // direction instead of scrambling in the RTL block.
    expect(name).toHaveAttribute("dir", "auto");
    // text-right (R128-A2 F-1): with dir=auto resolving a pure-Latin
    // name to ltr, text-align:start computed LEFT — measured 21–97px
    // dead zones on the RTL reading edge (cPanel/Windows 8 cards).
    // The physical class pins the visual anchor; measured live.
    expect(name.className).toContain("text-right");
  });
});

describe("ProductCard — storefront badge copy (R123-E4b P3-a)", () => {
  it("the 5–19 order tier reads «رائج», not «شائع»", () => {
    renderCard({ ...AVAILABLE_PRODUCT, order_count: 7 } as typeof AVAILABLE_PRODUCT);
    expect(screen.getByText("رائج")).toBeInTheDocument();
    expect(screen.queryByText("شائع")).not.toBeInTheDocument();
  });

  it("low stock reads the full phrase «متبقٍ N فقط», matching its own aria-label", () => {
    renderCard({ ...AVAILABLE_PRODUCT, stock_count: 2 } as typeof AVAILABLE_PRODUCT);
    // R134 (A2-F5): the badge joins its family («متبقٍ N فقط» — its own
    // aria-label, the quick-add ceiling toast, the cart's lineStockNotice).
    const badge = screen.getByText("متبقٍ 2 فقط");
    expect(badge.closest("[aria-label]")).toHaveAttribute("aria-label", "مخزون منخفض، متبقٍ 2 فقط");
    // The old noun-less fragment «آخر 2» is gone.
    expect(screen.queryByText(/^آخر 2$/)).not.toBeInTheDocument();
  });

  it("the mid-range stock pill is self-describing «كمية N» and spoken in the card name (R134 A2-F4)", () => {
    // AVAILABLE_PRODUCT carries stock_count: 9 — the 4–99 single-variant
    // branch that used to render a bare numeral beside the price.
    renderCard(AVAILABLE_PRODUCT as typeof AVAILABLE_PRODUCT);
    expect(screen.getByText("كمية 9")).toBeInTheDocument();
    // The card's composed aria-label now speaks the count too (it was
    // silent on the mid-range branch — stock only entered the name on
    // the نفد/low-stock branches).
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("aria-label", expect.stringContaining("الكمية 9"));
  });

  it("stock caps at «كمية 99+» — the RTL-safe source order (digits, then plus)", () => {
    renderCard({ ...AVAILABLE_PRODUCT, stock_count: 250 } as typeof AVAILABLE_PRODUCT);
    // In the RTL base direction a logical "99+" renders with the plus on
    // the LEFT of the digits (digits first in Arabic reading order) —
    // the Navbar/MobileNav/NotificationBell badge convention. The old
    // source "+99" rendered plus-on-the-right (English visual order).
    // R134 (A2-F4): the pill carries the «كمية» noun now.
    expect(screen.getByText("كمية 99+")).toBeInTheDocument();
    expect(screen.queryByText("+99")).not.toBeInTheDocument();
  });
});

describe("ProductCard — R138 resting-state premium (deep visual round)", () => {
  it("the discount badge rides the unified primary-chip elevation (shadow-md shadow-primary/30)", () => {
    renderCard({ ...AVAILABLE_PRODUCT, discount_percent: 35 } as typeof AVAILABLE_PRODUCT);
    const badge = screen.getByText("35%");
    // R138 (visual): shadow-primary/40 → /30 — one primary-chip elevation
    // value shared with the desktop quick-add (shadow-md
    // shadow-primary/30); a same-family 10% alpha spread is vocabulary
    // drift. AA re-verified this round: white on bg-primary ≈4.9:1 dark
    // / ≈5.3:1 light at 11px bold — the ink pair needs no change.
    expect(badge.className).toContain("bg-primary");
    expect(badge.className).toContain("text-primary-foreground");
    expect(badge.className).toContain("shadow-md");
    expect(badge.className).toContain("shadow-primary/30");
    expect(badge.className).not.toContain("shadow-primary/40");
  });

  it("the price block keeps the money typography contract (verified, no drift)", () => {
    renderCard(AVAILABLE_PRODUCT);
    // R138 (visual audit): text-lg font-bold + tabular-nums led the
    // title's text-sm by a full step. R145 (D4) stepped the price to
    // text-base + the title to full-ink foreground: the NAME now leads
    // the hierarchy (the live-site critique read the old ratio as
    // inverted), the price follows as the value datum one step under
    // it. The strike-through family is pinned by the touch suite's
    // sale-price fixture; the money idiom (font-bold + tabular-nums +
    // neutral foreground ink) is the contract.
    const price = screen.getByText(formatCurrency(120));
    expect(price.className).toContain("text-base");
    expect(price.className).toContain("font-bold");
    expect(price.className).toContain("tabular-nums");
    expect(price.className).toContain("text-foreground");
    // D4's other half: the title rides full ink (was /85).
    const title = screen.getByRole("heading", { name: /ChatGPT Plus/ });
    expect(title.className).toContain("text-foreground");
    expect(title.className).not.toContain("text-foreground/85");
  });
});
