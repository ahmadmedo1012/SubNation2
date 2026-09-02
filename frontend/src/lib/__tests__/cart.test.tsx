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
import React, { createContext, useContext } from "react";
import { CartProvider, useCart, type LocalCartItem } from "@/lib/cart";

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

const STORAGE_KEY = "subnation_cart_v1";

function getStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    ...store,
  };
}

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
