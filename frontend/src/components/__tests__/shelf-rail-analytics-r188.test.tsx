/**
 * R188-4 (R188-A seed) — ShelfRail's list→PDP hop is GA4-visible.
 *
 * The guest hero's lit shelf is the FIRST-fold product imagery on
 * mobile (the leading two tiles load eager, index 0 fetchPriority
 * "high"), and its product Links were the one product-click surface
 * with ZERO select_item coverage — every sibling fires it
 * (ProductCard :339, flash-sales :104, RecommendationsSection :94 =
 * R187's A-F3 fix for the identical blindness class). This pin holds
 * the A-F3 shape verbatim: the shelf click fires select_item with the
 * rail's own "home-shelf" item_list_id and the productToItem item
 * shape (single-price list DTO — no variant arg, the flash-card
 * shape).
 *
 * ShelfRail's only client import is `import type ProductListItem`
 * (erased at runtime), so no @workspace/api-client-react mock is
 * needed — the component renders from plain props.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShelfRail } from "@/components/home/ShelfRail";
import type { ProductListItem } from "@workspace/api-client-react";

/** Minimal list-DTO rows (image-less — the box well renders; the
 * analytics contract under test is link-address independent). */
function shelfProduct(over: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 21,
    slug: "shelf-item",
    name: "Shelf Item",
    price: 30,
    price_from: false,
    is_active: true,
    stock_count: 5,
    is_available: true,
    order_count: 0,
    variant_count: 0,
    ...over,
  };
}

const products: ProductListItem[] = [
  shelfProduct(),
  shelfProduct({
    id: 22,
    slug: "shelf-sale",
    name: "Shelf Sale Item",
    price: 40,
    sale_price: 32.5,
  }),
];

function renderShelf() {
  return render(
    <Router>
      <ShelfRail products={products} isLoading={false} />
    </Router>,
  );
}

describe("ShelfRail — tile click fires select_item (R188-4 / R188-A)", () => {
  /** Arm the R164 loader's own gtag shape (the analytics-events idiom):
   * pushes land on window.dataLayer. */
  beforeEach(() => {
    window.dataLayer = [];
    window.gtag = (...args: unknown[]) => {
      window.dataLayer!.push(args);
    };
  });

  afterEach(() => {
    delete window.gtag;
    window.dataLayer = [];
  });

  it("renders silently — the shelf carries no impression event of its own (the home grid owns view_item_list)", () => {
    renderShelf();

    expect(layerEntries("select_item")).toHaveLength(0);
    expect(layerEntries("view_item_list")).toHaveLength(0);
  });

  it("one select_item with item_list_id home-shelf + items[0] = the tile's productToItem shape", () => {
    renderShelf();

    fireEvent.click(screen.getByRole("link", { name: "Shelf Item" }));

    const selectPushes = layerEntries("select_item");
    expect(selectPushes).toHaveLength(1);
    const payload = selectPushes[0]![2] as Record<string, unknown>;
    expect(payload.item_list_id).toBe("home-shelf");
    expect(payload.items).toEqual([
      { item_id: "21", item_name: "Shelf Item", price: 30, quantity: 1 },
    ]);
  });

  it("a sale-price tile reports the effective price (sale_price ?? price — productToItem)", () => {
    renderShelf();

    fireEvent.click(screen.getByRole("link", { name: "Shelf Sale Item" }));

    const payload = layerEntries("select_item")[0]![2] as Record<string, unknown>;
    expect(payload.item_list_id).toBe("home-shelf");
    expect((payload.items as Array<{ price: number }>)[0]!.price).toBe(32.5);
  });
});

/** The payloads of every pushed occurrence of `eventName` (the
 * analytics-events suite's `fired` idiom, inlined for this file). */
function layerEntries(eventName: string): [string, string, Record<string, unknown>][] {
  return ((window.dataLayer ?? []) as unknown as unknown[][])
    .filter((e) => e[0] === "event" && e[1] === eventName)
    .map((e) => e as [string, string, Record<string, unknown>]);
}
