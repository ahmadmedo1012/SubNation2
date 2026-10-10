/**
 * R130 (A1-F2) — the add-sites' honesty contract.
 *
 * The B-11 raise cap refuses a quantity RAISE at the stock-aware
 * ceiling — and before R130 it did so SILENTLY while both add sites
 * toasted «أُضيف إلى السلة» unconditionally: the second quick-add of any
 * low-stock product (the exact products the «متبقٍ N فقط» badge calls
 * out) promised a badge change that never happened.
 *
 * Pinned here (the lib half of the close; the page toasts are visual):
 *   • addItem returns TRUE when the quantity actually grew (first add,
 *     genuine raise, decreases);
 *   • addItem returns FALSE when the raise cap refused the bump at the
 *     known-stock ceiling — the caller's cue for the honest
 *     «بلغت الحد الأقصى المتاح» toast;
 *   • a stock-LESS re-add of a line whose snapshot refreshed DOWN below
 *     its quantity is NOT a refusal (the line keeps its reconciled
 *     quantity per the B-11 no-silent-shrink rule) — returns false but
 *     never shrinks.
 *
 * Harness: the REAL CartProvider + jsdom localStorage (cart-stock-
 * snapshot idiom).
 */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CartProvider, stockAwareCeiling, useCart, type LocalCartItem } from "@/lib/cart";

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

function AddHarness({
  stockCount,
  onAdd,
}: {
  stockCount: number | null;
  onAdd: (applied: boolean) => void;
}) {
  const { addItem } = useCart();
  return (
    <button
      data-testid="add"
      onClick={() =>
        onAdd(
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
            stockCount,
          }),
        )
      }
    />
  );
}

function renderHarness(stockCount: number | null, onAdd: (applied: boolean) => void) {
  render(
    <CartProvider>
      <AddHarness stockCount={stockCount} onAdd={onAdd} />
    </CartProvider>,
  );
  return screen.getByTestId("add");
}

describe("addItem return — the raise-refusal honesty contract (R130 A1-F2)", () => {
  // The provider's load effect re-reads the storage key — a prior case's
  // line (same productId/variantId key) would silently put the next
  // case's first add ON its ceiling.
  beforeEach(() => {
    localStorage.clear();
  });

  it("first add of a NEW line returns true (the badge must move)", () => {
    let applied: boolean | null = null;
    const button = renderHarness(3, (a) => (applied = a));
    act(() => button.click());
    expect(applied).toBe(true);
  });

  it("a genuine raise inside the stock ceiling returns true", () => {
    let applied: boolean | null = null;
    const button = renderHarness(3, (a) => (applied = a));
    act(() => button.click()); // qty 1
    act(() => button.click()); // qty 2 — inside the ceiling
    expect(applied).toBe(true);
  });

  it("a raise refused at the stock-aware ceiling returns FALSE (the toast cue)", () => {
    let applied: boolean | null = null;
    const button = renderHarness(2, (a) => (applied = a));
    act(() => button.click()); // qty 1
    act(() => button.click()); // qty 2 — AT the ceiling
    expect(applied).toBe(true);
    act(() => button.click()); // requested 3 > ceiling 2 — REFUSED
    expect(applied).toBe(false);
    // The line kept its ceiling quantity (never silently crossed).
    const stored = JSON.parse(localStorage.getItem("subnation_cart_v2") ?? "[]") as LocalCartItem[];
    expect(stored[0]?.quantity).toBe(2);
  });

  it("unknown snapshots keep the legacy 99 ceiling (byte-identical clamp)", () => {
    expect(stockAwareCeiling(null)).toBe(99);
    expect(stockAwareCeiling(undefined as unknown as null)).toBe(99);
    expect(stockAwareCeiling(0)).toBe(1); // floored: the out-flag owns 0-stock honesty
  });

  it("a re-add that carries NO stock preserves a reconciled-down line's quantity (no silent shrink)", () => {
    // Seed a line already above its (refreshed-down) snapshot: qty 5 / stock 2.
    const seeded: LocalCartItem[] = [item({ quantity: 5, stockCount: 2 })];
    localStorage.setItem("subnation_cart_v2", JSON.stringify(seeded));

    let applied: boolean | null = null;
    function NoStockAddHarness({ onAdd }: { onAdd: (a: boolean) => void }) {
      const { addItem } = useCart();
      return (
        <button
          data-testid="add-nostock"
          onClick={() =>
            onAdd(
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
                // NO stockCount — preserves the line's snapshot.
              }),
            )
          }
        />
      );
    }
    render(
      <CartProvider>
        <NoStockAddHarness onAdd={(a) => (applied = a)} />
      </CartProvider>,
    );
    act(() => screen.getByTestId("add-nostock").click());
    // The raise cap refused (5 requested stays 5 — max(ceiling, current)),
    // so the caller must NOT toast a success.
    expect(applied).toBe(false);
    const stored = JSON.parse(localStorage.getItem("subnation_cart_v2") ?? "[]") as LocalCartItem[];
    expect(stored[0]?.quantity).toBe(5); // the B-11 no-silent-shrink rule
    expect(stored[0]?.stockCount).toBe(2); // snapshot preserved
  });
});
