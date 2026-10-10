/**
 * B-11 (R128-IMP-5 / B13 §3) — the cart stock snapshot.
 *
 * The cart used to hold NO stock state: a sold-out product sat in the
 * cart looking buyable and the buyer discovered it at CHARGE time (the
 * server's in-tx OUT_OF_STOCK 409). The line now carries a stockCount
 * snapshot (captured at add, refreshed on re-add and via the 98-F2
 * reconcileLine re-quote) and the exported verdict helpers turn it into
 * the honest per-line state («نفد المخزون» / «متبقٍ N فقط» — the
 * ProductCard idiom) plus the client-side checkout block.
 *
 * Pinned here:
 *   • snapshot captured at add + persisted; refreshed by a stock-carrying
 *     re-add; PRESERVED by a stock-less re-add (never clobbered to
 *     unknown);
 *   • load-time guards: corrupt snapshots (fractional/negative/string)
 *     read null = unknown — never a fake verdict;
 *   • reconcileLine key-present semantics: the patch refreshes stock
 *     alongside price (quantity untouched — the 98-F2 contract); the
 *     pre-B-11 price-only patch leaves the snapshot alone;
 *   • the verdict table (unknown/ok/low/insufficient/out) + the Arabic
 *     notice strings + cartHasBlockingStock;
 *   • the stock-aware quantity ceiling: raises cap at known stock, a
 *     reconciled-down line never silently shrinks (decreases always
 *     apply) — byte-identical to the old 99 clamp when stock is unknown.
 *
 * Harness: cart-sync-hardening.test.tsx — jsdom's REAL localStorage so
 * persistence + preload assertions work end-to-end.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CartProvider,
  cartHasBlockingStock,
  lineStockBlocksCheckout,
  lineStockNotice,
  lineStockStatus,
  useCart,
  type LocalCartItem,
} from "@/lib/cart";

const STORAGE_KEY = "subnation_cart_v2";

function item(over: Partial<LocalCartItem> = {}): LocalCartItem {
  return {
    productId: 1,
    variantId: null,
    variantLabel: null,
    slug: null,
    name: "A",
    imageUrl: null,
    priceLYD: 10,
    salePriceLYD: null,
    discountPercent: null,
    quantity: 1,
    ...over,
  };
}

/** Renders the lines' stock snapshot + status + quantity so tests can
 * see the store; exposes the commands the scenarios drive. */
function StockCartHarness() {
  const { items, addItem, updateQuantity, reconcileLine } = useCart();
  return (
    <div>
      {items.map((i) => (
        <span
          key={`${i.productId}:${i.variantId ?? 0}`}
          data-testid={`line-${i.productId}`}
        >{`${i.quantity}|${i.stockCount ?? "null"}|${lineStockStatus(i)}`}</span>
      ))}
      <span data-testid="blocks">{String(cartHasBlockingStock(items))}</span>
      <button
        data-testid="add"
        onClick={() =>
          addItem({
            productId: 1,
            variantId: null,
            variantLabel: null,
            slug: null,
            name: "A",
            imageUrl: null,
            priceLYD: 10,
            salePriceLYD: null,
            discountPercent: null,
            stockCount: 7,
          })
        }
      />
      <button
        data-testid="re-add-stock-3"
        onClick={() =>
          addItem({
            productId: 1,
            variantId: null,
            variantLabel: null,
            slug: null,
            name: "A",
            imageUrl: null,
            priceLYD: 10,
            salePriceLYD: null,
            discountPercent: null,
            stockCount: 3,
          })
        }
      />
      <button
        data-testid="re-add-stockless"
        onClick={() =>
          addItem({
            productId: 1,
            variantId: null,
            variantLabel: null,
            slug: null,
            name: "A",
            imageUrl: null,
            priceLYD: 10,
            salePriceLYD: null,
            discountPercent: null,
          })
        }
      />
      <button data-testid="qty-3" onClick={() => updateQuantity(1, 3)} />
      <button data-testid="qty-5" onClick={() => updateQuantity(1, 5)} />
      <button data-testid="qty-6" onClick={() => updateQuantity(1, 6)} />
      <button data-testid="qty-9" onClick={() => updateQuantity(1, 9)} />
      <button
        data-testid="reconcile-stock-2"
        onClick={() =>
          reconcileLine(1, {
            priceLYD: 10,
            salePriceLYD: null,
            discountPercent: null,
            stockCount: 2,
          })
        }
      />
      <button
        data-testid="reconcile-price-only"
        onClick={() =>
          reconcileLine(1, { priceLYD: 12, salePriceLYD: null, discountPercent: null })
        }
      />
    </div>
  );
}

function renderCart() {
  return render(
    <CartProvider>
      <StockCartHarness />
    </CartProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("B-11 — snapshot capture, re-add refresh + persistence", () => {
  it("captures stockCount at add, persists it, and re-add with stock refreshes it", async () => {
    renderCart();
    await act(async () => {
      screen.getByTestId("add").click();
    });
    // qty 1, snapshot 7, comfortable stock.
    expect(screen.getByTestId("line-1")).toHaveTextContent("1|7|ok");

    // Persisted under the v2 key with the snapshot.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as LocalCartItem[];
    expect(stored[0].stockCount).toBe(7);

    await act(async () => {
      screen.getByTestId("re-add-stock-3").click();
    });
    // Fresh catalog row on re-add: the snapshot follows it down (qty 2
    // ≤ 3 → low).
    expect(screen.getByTestId("line-1")).toHaveTextContent("2|3|low");
  });

  it("a stock-LESS re-add preserves the existing snapshot (never clobbers to unknown)", async () => {
    renderCart();
    await act(async () => {
      screen.getByTestId("add").click();
    });
    await act(async () => {
      screen.getByTestId("re-add-stockless").click();
    });
    // Pre-B-11 caller shape on a B-11 line: the add-time verdicts stay
    // armed (a null write here would silently disarm the block).
    expect(screen.getByTestId("line-1")).toHaveTextContent("2|7|ok");
  });
});

describe("B-11 — load-time guards (parseCartItems)", () => {
  it("a preloaded snapshot loads; corrupt stock values read null = unknown", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        item({ productId: 1, stockCount: 5 }),
        item({ productId: 2, stockCount: -3 }),
        item({ productId: 3, stockCount: 2.5 }),
        item({ productId: 4, stockCount: "7" as unknown as number }),
        item({ productId: 5 }),
      ]),
    );
    renderCart();

    await waitFor(() => expect(screen.getByTestId("line-1")).toBeInTheDocument());
    expect(screen.getByTestId("line-1")).toHaveTextContent("1|5|ok");
    expect(screen.getByTestId("line-2")).toHaveTextContent("1|null|unknown");
    expect(screen.getByTestId("line-3")).toHaveTextContent("1|null|unknown");
    expect(screen.getByTestId("line-4")).toHaveTextContent("1|null|unknown");
    expect(screen.getByTestId("line-5")).toHaveTextContent("1|null|unknown");
    // Nothing on this page blocks: unknown is advisory-only.
    expect(screen.getByTestId("blocks")).toHaveTextContent("false");
  });
});

describe("B-11 — reconcileLine refreshes stock with price (98-F2 pattern)", () => {
  it("a stock-carrying patch updates the snapshot, never the quantity", async () => {
    renderCart();
    await act(async () => {
      screen.getByTestId("add").click();
    });
    await act(async () => {
      screen.getByTestId("qty-5").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("5|7|ok");

    // The mount-time re-quote says only 2 remain: snapshot refreshed,
    // quantity deliberately untouched (the 98-F2 contract) → the line
    // flags insufficient and blocks.
    await act(async () => {
      screen.getByTestId("reconcile-stock-2").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("5|2|insufficient");
    expect(screen.getByTestId("blocks")).toHaveTextContent("true");
  });

  it("a price-only patch (the pre-B-11 caller shape) leaves the snapshot untouched", async () => {
    renderCart();
    await act(async () => {
      screen.getByTestId("add").click();
    });
    await act(async () => {
      screen.getByTestId("reconcile-price-only").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("1|7|ok");
  });
});

describe("B-11 — the verdict table + Arabic notices + the checkout block", () => {
  it("classifies every (quantity, stockCount) pair", () => {
    expect(lineStockStatus({ quantity: 1, stockCount: undefined })).toBe("unknown");
    expect(lineStockStatus({ quantity: 1, stockCount: null })).toBe("unknown");
    expect(lineStockStatus({ quantity: 1, stockCount: 0 })).toBe("out");
    expect(lineStockStatus({ quantity: 5, stockCount: 2 })).toBe("insufficient");
    expect(lineStockStatus({ quantity: 2, stockCount: 3 })).toBe("low");
    expect(lineStockStatus({ quantity: 3, stockCount: 3 })).toBe("low");
    expect(lineStockStatus({ quantity: 2, stockCount: 4 })).toBe("ok");
  });

  it("only out/insufficient block; unknown and low never do", () => {
    expect(lineStockBlocksCheckout({ quantity: 1, stockCount: 0 })).toBe(true);
    expect(lineStockBlocksCheckout({ quantity: 5, stockCount: 2 })).toBe(true);
    expect(lineStockBlocksCheckout({ quantity: 1, stockCount: null })).toBe(false);
    expect(lineStockBlocksCheckout({ quantity: 1, stockCount: undefined })).toBe(false);
    expect(lineStockBlocksCheckout({ quantity: 2, stockCount: 3 })).toBe(false);
    expect(
      cartHasBlockingStock([
        { quantity: 1, stockCount: null },
        { quantity: 2, stockCount: 50 },
        { quantity: 2, stockCount: 3 },
      ]),
    ).toBe(false);
    expect(
      cartHasBlockingStock([
        { quantity: 1, stockCount: 50 },
        { quantity: 1, stockCount: 0 },
      ]),
    ).toBe(true);
  });

  it("the notices reuse the ProductCard strings verbatim for the shared states", () => {
    // نفد المخزون — ProductCard's sold-out aria/badge idiom.
    expect(lineStockNotice({ quantity: 1, stockCount: 0 })).toBe("نفد المخزون");
    // متبقٍ N فقط — ProductCard's low-stock badge (93-C8 wording).
    expect(lineStockNotice({ quantity: 2, stockCount: 3 })).toBe("متبقٍ 3 فقط");
    // The cart-only stale-quantity state names the fix.
    expect(lineStockNotice({ quantity: 5, stockCount: 2 })).toBe("متبقٍ 2 فقط — عدّل الكمية");
    // Unknown/ok render nothing.
    expect(lineStockNotice({ quantity: 1, stockCount: null })).toBeNull();
    expect(lineStockNotice({ quantity: 2, stockCount: 9 })).toBeNull();
  });
});

describe("B-11 — the stock-aware quantity ceiling", () => {
  it("a raise caps at a known snapshot; a decrease always applies", async () => {
    renderCart();
    await act(async () => {
      screen.getByTestId("add").click();
    });
    // Snapshot 7 → ceiling 7: asking for 3 lands at 3…
    await act(async () => {
      screen.getByTestId("qty-3").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("3|7|ok");
    // …asking for 9 stops at the ceiling (the stepper cap B-11 adds —
    // the pre-fix cart held qty 99 against whatever stock actually
    // existed).
    await act(async () => {
      screen.getByTestId("qty-9").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("7|7|ok");
    // …and a decrease is always honored below it.
    await act(async () => {
      screen.getByTestId("qty-3").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("3|7|ok");
  });

  it("a reconciled-DOWN line never silently shrinks: raises no-op at the old quantity, decreases apply", async () => {
    renderCart();
    await act(async () => {
      screen.getByTestId("add").click();
    });
    await act(async () => {
      screen.getByTestId("qty-5").click();
    });
    await act(async () => {
      screen.getByTestId("reconcile-stock-2").click();
    });
    // qty 5 / stock 2 → insufficient (flagged, blocked) — the quantity
    // is NOT edited by the reconcile (98-F2)…
    expect(screen.getByTestId("line-1")).toHaveTextContent("5|2|insufficient");
    // …and the stepper's "+" (5→6) must not DROP it to 2: it stays 5,
    // flagged, until the user chooses a quantity.
    await act(async () => {
      screen.getByTestId("qty-6").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("5|2|insufficient");
    // A decrease is the user's explicit choice — always honored.
    await act(async () => {
      screen.getByTestId("qty-3").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("3|2|insufficient");
  });

  it("a re-add bump on a line above its refreshed snapshot is a no-op too (same raise rule)", async () => {
    renderCart();
    await act(async () => {
      screen.getByTestId("add").click();
    });
    await act(async () => {
      screen.getByTestId("qty-5").click();
    });
    // The re-add carries the fresher snapshot (stock 2) AND +1 qty —
    // the bump applies the cap: quantity stays 5, flagged insufficient.
    await act(async () => {
      screen.getByTestId("re-add-stock-3").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("5|3|insufficient");
  });

  it("unknown stock keeps the byte-identical 99 clamp (ceiling = MAX_LINE_QUANTITY)", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item({ quantity: 1 })]));
    renderCart();
    await waitFor(() => expect(screen.getByTestId("line-1")).toHaveTextContent(/^1\|null\|/));

    // No snapshot → the ceiling is the plain 99 mirror cap.
    await act(async () => {
      screen.getByTestId("qty-5").click();
    });
    expect(screen.getByTestId("line-1")).toHaveTextContent("5|null|unknown");
    // And nothing blocks on unknowns.
    expect(screen.getByTestId("blocks")).toHaveTextContent("false");
  });
});
