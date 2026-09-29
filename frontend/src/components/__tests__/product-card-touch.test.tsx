/**
 * 96-F4 (R96 A2 P1-7): add-to-cart double-tap lock on ProductCard.
 *
 * The card CTA had no re-entry guard: a double-tap on a laggy phone
 * added qty 2 in one gesture (and the funnel charged twice at checkout).
 * handleAddToCart now carries a 500ms re-entry lock via a ref timestamp
 * — the toast already confirms the first add, so the second tap inside
 * the lock window is swallowed.
 *
 * Also pins the 96-F4 (R96 A6 #11 / #12) polish: the category badge is
 * 10px semibold (was 9px — microscopic on the 2-up mobile grid) and the
 * «نفد» status text uses the full-opacity muted token (was /80 ≈ 4.14:1
 * on the light card — AA failure for a 10px text).
 *
 * `@/lib/cart` and `@/hooks/use-toast` are mocked at the module
 * boundary; Date.now is spied for deterministic lock-window math.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "@/components/ProductCard";

const addItemMock = vi.fn();
vi.mock("@/lib/cart", () => ({
  // R111-F4-F1: ProductCard subscribes to the commands context only —
  // the mock provides both hooks so either wiring passes, but the
  // card's add-to-cart path is exercised through useCartCommands.
  useCart: () => ({ addItem: (...args: unknown[]) => addItemMock(...args) }),
  useCartCommands: () => ({ addItem: (...args: unknown[]) => addItemMock(...args) }),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (...args: unknown[]) => toastMock(...args) }),
}));

const AVAILABLE_PRODUCT = {
  id: 5,
  slug: "netflix-1m",
  name: "Netflix شهر",
  description: "اشتراك Netflix لمدة شهر",
  image_url: null,
  price: 75,
  sale_price: 49,
  discount_percent: 35,
  category: "streaming",
  is_available: true,
  stock_count: 12,
};

const UNAVAILABLE_PRODUCT = {
  ...AVAILABLE_PRODUCT,
  id: 6,
  name: "Spotify شهر",
  category: "music",
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

describe("ProductCard — add-to-cart double-tap lock (96-F4 / R96 A2 P1-7)", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addItemMock.mockReset();
    toastMock.mockReset();
    dateNowSpy = vi.spyOn(Date, "now");
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it("swallows the second tap inside the 500ms window, lets a later tap through", () => {
    renderCard(AVAILABLE_PRODUCT);
    // The card renders TWO CTAs (mobile md:hidden + desktop hover-reveal)
    // sharing the label — the lock lives in the shared handler, so driving
    // the mobile one (first in DOM) exercises it.
    const cta = screen.getAllByRole("button", { name: "أضف للسلة" })[0];

    dateNowSpy.mockReturnValue(10_000);
    fireEvent.click(cta);
    expect(addItemMock).toHaveBeenCalledTimes(1);

    // Double-tap 200ms later — swallowed (qty must stay 1).
    dateNowSpy.mockReturnValue(10_200);
    fireEvent.click(cta);
    expect(addItemMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledTimes(1);

    // A tap after the window expires goes through normally.
    dateNowSpy.mockReturnValue(11_000);
    fireEvent.click(cta);
    expect(addItemMock).toHaveBeenCalledTimes(2);
  });

  it("the first (successful) add still fires the cart toast", () => {
    renderCard(AVAILABLE_PRODUCT);
    dateNowSpy.mockReturnValue(0);
    fireEvent.click(screen.getAllByRole("button", { name: "أضف للسلة" })[0]);

    // The card passes the line WITHOUT an explicit quantity — the provider
    // defaults it to 1 (the double-charge risk was the LOCK, not the arg).
    expect(addItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 5, name: "Netflix شهر" }),
    );
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "أُضيف إلى السلة" }));
  });
});

describe("ProductCard — badge/نفد polish (96-F4 / R96 A6 #11 + #12)", () => {
  it("category badge is text-3xs font-semibold (was 9px bold)", () => {
    const { container } = renderCard(AVAILABLE_PRODUCT);
    // The badge is the pill next to the card title — «بث مباشر» is the
    // streaming category label.
    const badge = screen.getByText("بث مباشر");
    expect(badge.className).toContain("text-3xs");
    expect(badge.className).toContain("font-semibold");
    // Guards keep referencing the RAW pre-token literals — the point is
    // that the sub-10px / heavier-weight regressions never come back.
    expect(badge.className).not.toContain("text-[9px]");
    expect(badge.className).not.toContain("font-bold");
  });

  it("«نفد» status text uses the full-opacity muted token (AA on light card)", () => {
    renderCard(UNAVAILABLE_PRODUCT);
    // Two «نفد» texts exist: the image-corner badge (aria-hidden) and the
    // price-row status span — the AA fix targets the latter.
    const soldOut = screen
      .getAllByText("نفد")
      .find((el) => el.className.includes("text-muted-foreground"));
    expect(soldOut).toBeDefined();
    expect(soldOut!.className).toContain("text-muted-foreground");
    expect(soldOut!.className).not.toContain("text-muted-foreground/80");
  });

  it("unavailable cards render no add-to-cart CTA (unreachable funnel stays off)", () => {
    renderCard(UNAVAILABLE_PRODUCT);
    expect(screen.queryByRole("button", { name: "أضف للسلة" })).not.toBeInTheDocument();
  });
});
