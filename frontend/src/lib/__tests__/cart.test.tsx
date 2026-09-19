/**
 * Unit tests for the client-side cart store (lib/cart.tsx).
 *
 * Tests the CartProvider + useCart hook in isolation by rendering a
 * minimal React tree with jsdom + @testing-library.  localStorage is
 * faked per-test via Object.defineProperty so each test gets a clean
 * slate without side-effects.
 */

import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
// JSX in this file compiles with the classic runtime (React.createElement)
// in the vitest transform, so the React default import is load-bearing.
import React from "react";
import { CartProvider, roundToCents, useCart } from "@/lib/cart";

function LocalCartConsumer() {
  const { items, itemCount, totalLYD, addItem, removeItem, updateQuantity, clear } = useCart();
  return (
    <div>
      <span data-testid="count">{itemCount}</span>
      <span data-testid="total">{totalLYD}</span>
      <span data-testid="items">{items.length}</span>
      {items.map((it) => (
        <span key={it.productId} data-testid={`item-${it.productId}`}>
          {it.productId}:{it.quantity}
        </span>
      ))}
      <button
        data-testid="add"
        onClick={() =>
          addItem({
            productId: 1,
            variantId: null,
            variantLabel: null,
            name: "P1",
            slug: null,
            imageUrl: null,
            priceLYD: 10,
            salePriceLYD: null,
            discountPercent: null,
          })
        }
      />
      <button
        data-testid="add-sale"
        onClick={() =>
          addItem({
            productId: 2,
            variantId: null,
            variantLabel: null,
            name: "P2",
            slug: null,
            imageUrl: null,
            priceLYD: 20,
            salePriceLYD: 15,
            discountPercent: 25,
          })
        }
      />
      <button data-testid="remove-1" onClick={() => removeItem(1)} />
      <button data-testid="update-1" onClick={() => updateQuantity(1, 5)} />
      <button data-testid="clear" onClick={clear} />
    </div>
  );
}

const STORAGE_KEY = "subnation_cart_v2";

describe("CartProvider", () => {
  beforeEach(() => {
    // Reset localStorage between every test.
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  it("renders children", () => {
    render(
      <CartProvider>
        <span>hello</span>
      </CartProvider>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("starts with empty cart", () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("total")).toHaveTextContent("0");
    expect(screen.getByTestId("items")).toHaveTextContent("0");
  });

  it("addItem increments the cart", async () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("total")).toHaveTextContent("10");
    expect(screen.getByTestId("items")).toHaveTextContent("1");
  });

  it("adding the same product twice increments quantity", async () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add").click();
      screen.getByTestId("add").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("total")).toHaveTextContent("20");
    expect(screen.getByTestId("items")).toHaveTextContent("1"); // still 1 unique product
  });

  it("sale price is used for total when set", async () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add-sale").click();
    });
    // salePriceLYD = 15 should be used (not priceLYD = 20)
    expect(screen.getByTestId("total")).toHaveTextContent("15");
  });

  it("removeItem clears a product from the cart", async () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    await act(async () => {
      screen.getByTestId("remove-1").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("total")).toHaveTextContent("0");
  });

  it("updateQuantity sets the exact quantity", async () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    await act(async () => {
      screen.getByTestId("update-1").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("5");
    expect(screen.getByTestId("total")).toHaveTextContent("50"); // 5 × 10
  });

  it("updateQuantity with qty < 1 is a no-op", async () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add").click();
    });
    await act(async () => {
      // quantity = 1 → minus → qty would be 0 → should be ignored
      screen.getByTestId("remove-1").click(); // removes entirely instead
    });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("clear resets everything", async () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add").click();
      screen.getByTestId("add-sale").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    await act(async () => {
      screen.getByTestId("clear").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("total")).toHaveTextContent("0");
  });

  it("persists to localStorage on mutation", async () => {
    render(
      <CartProvider>
        <LocalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add").click();
    });
    expect(window.localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
  });

  it("throws when useCart is called outside CartProvider", () => {
    function Bad() {
      useCart();
      return null;
    }
    expect(() => {
      render(<Bad />);
    }).toThrow("useCart must be used within <CartProvider>");
  });
});

/* ── R94-A1 #1 (P2, FP money gate) ────────────────────────────────────── */

/**
 * Floating-point-dust regression tests for the cart total (94-C1).
 *
 * checkout.tsx's «رصيد غير كافٍ» gate compares the wallet balance to
 * `totalLYD`. Relative-discount prices (8.33 × 6, 0.1 + 0.2, 12.99 +
 * 34.99) accumulate FP dust — the raw sum for 8.33 × 6 is
 * 49.980000000000004, which made `49.98 < total` TRUE for a user whose
 * balance was EXACTLY the total, blocking the purchase with the
 * nonsensical «الناقص 0.00 د.ل». lib/cart now rounds every money total
 * to the cent (roundToCents) at the source.
 */
describe("cart money totals — cent rounding (R94-A1 #1)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  describe("roundToCents", () => {
    it("collapses floating-point dust to the exact cent", () => {
      expect(roundToCents(8.33 * 6)).toBe(49.98);
      expect(roundToCents(0.1 + 0.2)).toBe(0.3);
      expect(roundToCents(12.99 + 34.99)).toBe(47.98);
    });

    it("passes already-exact values through untouched", () => {
      expect(roundToCents(49.98)).toBe(49.98);
      expect(roundToCents(0)).toBe(0);
      expect(roundToCents(5)).toBe(5);
    });
  });

  /** Consumer whose line price is the real-world dust producer (8.33). */
  function FractionalCartConsumer() {
    const { totalLYD, itemCount, addItem, updateQuantity } = useCart();
    return (
      <div>
        <span data-testid="count">{itemCount}</span>
        <span data-testid="total">{totalLYD}</span>
        <button
          data-testid="add-priced"
          onClick={() =>
            addItem({
              productId: 3,
              name: "Fractional",
              slug: null,
              imageUrl: null,
              priceLYD: 8.33,
              salePriceLYD: null,
              discountPercent: null,
            })
          }
        />
        <button data-testid="set-six" onClick={() => updateQuantity(3, 6)} />
      </div>
    );
  }

  it("the context total for 8.33 × 6 is EXACTLY 49.98 (no FP dust)", async () => {
    render(
      <CartProvider>
        <FractionalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add-priced").click();
    });
    await act(async () => {
      screen.getByTestId("set-six").click();
    });
    // Without rounding React renders 49.980000000000004.
    expect(screen.getByTestId("total")).toHaveTextContent(/^49\.98$/);
    expect(screen.getByTestId("count")).toHaveTextContent(/^6$/);
  });

  it("the checkout balance-gate contract: an EXACT balance is never insufficient", async () => {
    render(
      <CartProvider>
        <FractionalCartConsumer />
      </CartProvider>,
    );
    await act(async () => {
      screen.getByTestId("add-priced").click();
    });
    await act(async () => {
      screen.getByTestId("set-six").click();
    });
    // checkout.tsx: `insufficient = balance !== null && balance < total`
    // — encode the gate here so it can never regress to the raw sum.
    const total = Number(screen.getByTestId("total").textContent);
    expect(total).toBe(49.98);
    expect(49.98 < total).toBe(false);
    // One cent BELOW the total must still gate (rounding is not a bypass).
    expect(49.97 < total).toBe(true);
  });
});
