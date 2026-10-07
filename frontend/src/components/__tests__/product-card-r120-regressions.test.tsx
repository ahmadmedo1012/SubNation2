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
 *   • A1-F1: resting chrome (border-border/70 + shadow) reads as a
 *     container; A1-F4: a unified gradient pad sits behind every image.
 *   • A1-F10/A7-F13: h3 name with 2 clamp lines below sm; the 11px
 *     description row is hidden below sm.
 *
 * `@/lib/cart` and `@/hooks/use-toast` are mocked at the module
 * boundary (product-card-touch.test.tsx pattern).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "@/components/ProductCard";

const addItemMock = vi.fn();
vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: (...args: unknown[]) => addItemMock(...args) }),
  useCartCommands: () => ({ addItem: (...args: unknown[]) => addItemMock(...args) }),
}));

vi.mock("@/hooks/use-toast", () => ({
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
  it("resting chrome: border-border/70 + a resting shadow (A1-F1)", () => {
    const { container } = renderCard(AVAILABLE_PRODUCT);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border-border/70");
    expect(card.className).toContain("shadow-sm");
    expect(card.className).toContain("shadow-black/25");
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
