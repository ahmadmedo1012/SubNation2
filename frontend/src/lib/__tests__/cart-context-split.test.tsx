/**
 * R111-F4-F1 (P2): render-scope regression tests for the cart context
 * split (commands vs state).
 *
 * The pre-split single context changed identity on EVERY cart mutation,
 * so ALL subscribers re-rendered on every add-to-cart tap — on the home
 * grid that meant all 45 ProductCards + the Navbar re-rendered for a
 * tap whose only state read lives in the Navbar badge (80-200ms INP on
 * low-end Android, the money-critical tap).
 *
 * The split contract pinned here:
 *   1. a COMMANDS-ONLY consumer (ProductCard's wiring) does not
 *      re-render when cart state changes — neither from a sibling's
 *      addItem nor from a cross-tab storage re-sync;
 *   2. the commands value keeps ONE identity across mutations (the
 *      provider-lifetime stability that makes (1) hold);
 *   3. the split is render-scope ONLY: a commands-only consumer's
 *      addItem still lands in the shared state AND localStorage —
 *      user-visible semantics are byte-identical to the wide context.
 *
 * Rides jsdom's REAL localStorage (same choice as
 * cart-sync-hardening.test.tsx) so the storage-event path works
 * end-to-end.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CartProvider, useCart, useCartCommands, type LocalCartItem } from "@/lib/cart";

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

/** Mutable box so probes can report render counts without re-rendering
 * the tree root (a stateful root would re-create the children elements
 * and defeat the provider bailout this suite exists to pin). */
function box<T>(initial: T): { value: T } {
  return { value: initial };
}

/** ProductCard's wiring: subscribes to commands ONLY. */
function CommandsProbe({
  renders,
  identities,
}: {
  renders: { value: number };
  identities?: ReturnType<typeof useCartCommands>[];
}) {
  const commands = useCartCommands();
  renders.value += 1;
  identities?.push(commands);
  return (
    <button
      data-testid="card-add"
      onClick={() =>
        commands.addItem({
          productId: 2,
          variantId: null,
          variantLabel: null,
          slug: null,
          name: "B",
          imageUrl: null,
          priceLYD: 5,
          salePriceLYD: null,
          discountPercent: null,
        })
      }
    />
  );
}

/** Navbar's wiring: the combined hook — re-renders on cart data changes
 * (the badge count is a live state read). */
function StateProbe({ renders }: { renders: { value: number } }) {
  const { itemCount } = useCart();
  renders.value += 1;
  return <span data-testid="count">{itemCount}</span>;
}

beforeEach(() => {
  localStorage.clear();
});

describe("R111-F4-F1: cart context split — render scope", () => {
  it("an add-to-cart tap re-renders the state subscriber but NOT the commands-only consumer", async () => {
    // Seed one line so the load effect's setItems creates a real state
    // change after mount — the exact conditions of a catalog page.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item()]));
    const cardRenders = box(0);
    const navbarRenders = box(0);

    render(
      <CartProvider>
        <CommandsProbe renders={cardRenders} />
        <StateProbe renders={navbarRenders} />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));

    // Post-load baselines: the card rendered on mount ONLY (the load
    // state change was invisible to it), the state subscriber rendered
    // on mount + load.
    const cardRendersAfterLoad = cardRenders.value;
    const navbarRendersAfterLoad = navbarRenders.value;
    expect(cardRendersAfterLoad).toBe(1);
    expect(navbarRendersAfterLoad).toBe(2);

    // THE MONEY TAP: a card's addItem mutates the cart…
    await act(async () => {
      screen.getByTestId("card-add").click();
    });

    // …the state subscriber re-renders (badge count is live)…
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(navbarRenders.value).toBe(navbarRendersAfterLoad + 1);
    // …and the commands-only card did NOT re-render — the 45-card grid
    // stays untouched by an add-to-cart tap (the F4-F1 fix).
    expect(cardRenders.value).toBe(cardRendersAfterLoad);

    // And the mutation landed (render scope changed, semantics did not).
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as LocalCartItem[];
    expect(stored.map((i) => i.productId)).toEqual([1, 2]);
  });

  it("a cross-tab storage re-sync also skips the commands-only consumer", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item()]));
    const cardRenders = box(0);
    const navbarRenders = box(0);

    render(
      <CartProvider>
        <CommandsProbe renders={cardRenders} />
        <StateProbe renders={navbarRenders} />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    const cardRendersAfterLoad = cardRenders.value;
    const navbarRendersAfterLoad = navbarRenders.value;

    // Another tab replaces the cart (98-F2 cross-tab re-sync path).
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify([item({ productId: 3, name: "C", quantity: 4 })]),
        }),
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("4");
    expect(navbarRenders.value).toBe(navbarRendersAfterLoad + 1);
    expect(cardRenders.value).toBe(cardRendersAfterLoad);
  });

  it("the commands value keeps ONE identity across cart mutations (provider-lifetime stable)", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item()]));
    const cardRenders = box(0);
    const navbarRenders = box(0);
    const identities: ReturnType<typeof useCartCommands>[] = [];

    render(
      <CartProvider>
        <CommandsProbe renders={cardRenders} identities={identities} />
        <StateProbe renders={navbarRenders} />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    const before = identities[identities.length - 1];

    await act(async () => {
      screen.getByTestId("card-add").click();
    });
    expect(screen.getByTestId("count")).toHaveTextContent("2");

    // The card did not re-render (no new identity push), and the one
    // identity it holds is still what a fresh read would return: the
    // commands context value never changed.
    expect(identities.every((v) => v === before)).toBe(true);
    expect(identities.length).toBe(1);
  });
});
