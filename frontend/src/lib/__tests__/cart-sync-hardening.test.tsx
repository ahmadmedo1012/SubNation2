/**
 * 98-F2 completion (98-F2b) — hardening tests for the three
 * lib/cart.tsx behaviors that landed WITHOUT coverage:
 *
 *   1. cross-tab `storage` re-sync (r97 F-09 / 98-F2): another tab
 *      writing `subnation_cart_v2` fires a `storage` event here and
 *      THIS tab's view follows; a null newValue (key cleared in the
 *      other tab) or a foreign/corrupt payload must NOT wipe the local
 *      cart (the listener re-parses with the load-time guards);
 *   2. context value stable identity (R98-03, r98 frontend-deep §2):
 *      the memoized context object keeps its identity across provider
 *      re-renders that do NOT change cart data, and mints a new one
 *      exactly when the data changes;
 *   3. legacy `subnation_cart_v1` removal (R98-10a): the key is wiped
 *      once at load after migration, and a v2 entry wins over a stale
 *      v1 copy (v1-only browsers are migrated with the default
 *      variantId:null reshape).
 *
 * Unlike cart.test.tsx (which fakes localStorage with vi.fn() mocks),
 * these ride jsdom's REAL localStorage so key removal and StorageEvent
 * dispatch work end-to-end.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { CartProvider, useCart, type LocalCartItem } from "@/lib/cart";

const STORAGE_KEY = "subnation_cart_v2";
const LEGACY_KEY = "subnation_cart_v1";

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

/** Pre-v2 shape: no variantId/variantLabel (the fields the migration adds). */
function legacyItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productId: 1,
    name: "legacy",
    slug: null,
    imageUrl: null,
    priceLYD: 10,
    salePriceLYD: null,
    discountPercent: null,
    quantity: 1,
    ...over,
  };
}

/** Renders the cart's names/count/variant ids so tests can see the store. */
function CartSummary() {
  const { items, itemCount } = useCart();
  return (
    <div>
      <span data-testid="names">{items.map((i) => i.name).join("|")}</span>
      <span data-testid="count">{itemCount}</span>
      <span data-testid="variants">{items.map((i) => String(i.variantId)).join("|")}</span>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("cart cross-tab storage re-sync (r97 F-09 / 98-F2)", () => {
  it("a storage event from another tab re-syncs this tab's cart", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item()]));
    render(
      <CartProvider>
        <CartSummary />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("A"));

    // Another tab replaced the whole cart (different line, quantity 3).
    const otherTab = [item({ productId: 2, variantId: 7, name: "B", quantity: 3 })];
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify(otherTab),
        }),
      );
    });

    expect(screen.getByTestId("names")).toHaveTextContent("B");
    expect(screen.getByTestId("count")).toHaveTextContent("3");
    expect(screen.getByTestId("variants")).toHaveTextContent("7");
  });

  it("a null newValue (key cleared in the other tab) does NOT wipe this tab's cart", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item()]));
    render(
      <CartProvider>
        <CartSummary />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("A"));

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: null }));
    });

    // Per the fix contract: a clear elsewhere is ignored here.
    expect(screen.getByTestId("names")).toHaveTextContent("A");
  });

  it("a corrupt/foreign storage payload does not blank the cart", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item()]));
    render(
      <CartProvider>
        <CartSummary />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("A"));

    await act(async () => {
      // Corrupt JSON for the cart key…
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEY, newValue: "not json at all" }),
      );
      // …and a well-formed write to an UNRELATED key.
      window.dispatchEvent(
        new StorageEvent("storage", { key: "subnation_whatever", newValue: "[]" }),
      );
    });

    expect(screen.getByTestId("names")).toHaveTextContent("A");
  });
});

describe("cart context value identity (R98-03 memo)", () => {
  /** Records every useCart() identity it ever rendered with. */
  function IdentityConsumer({ identities }: { identities: ReturnType<typeof useCart>[] }) {
    const ctx = useCart();
    identities.push(ctx);
    return (
      <div>
        <span data-testid="count">{ctx.itemCount}</span>
        <button
          data-testid="add"
          onClick={() =>
            ctx.addItem({
              productId: 9,
              variantId: null,
              variantLabel: null,
              slug: null,
              name: "X",
              imageUrl: null,
              priceLYD: 5,
              salePriceLYD: null,
              discountPercent: null,
            })
          }
        />
      </div>
    );
  }

  /** Parent whose re-render re-renders the provider WITHOUT touching cart data. */
  function Harness({ identities }: { identities: ReturnType<typeof useCart>[] }) {
    const [, setBump] = useState(0);
    return (
      <CartProvider>
        <IdentityConsumer identities={identities} />
        <button data-testid="bump" onClick={() => setBump((n) => n + 1)} />
      </CartProvider>
    );
  }

  it("stable across data-less provider re-renders, new identity on data change", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item()]));
    const identities: ReturnType<typeof useCart>[] = [];
    render(<Harness identities={identities} />);
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));

    // Two unrelated parent re-renders: the provider re-renders, the cart
    // data does not — the context object must keep its identity (the
    // pre-memo inline object allocated a fresh one every render).
    const before = identities[identities.length - 1];
    await act(async () => {
      screen.getByTestId("bump").click();
    });
    await act(async () => {
      screen.getByTestId("bump").click();
    });
    const after = identities[identities.length - 1];
    expect(after).toBe(before);
    // The stable identity was handed to the consumer on every one of
    // those renders (mount, load, bump, bump — ≥3 post-load pushes).
    expect(identities.filter((v) => v === before).length).toBeGreaterThanOrEqual(3);

    // A real data change (addItem) must mint a NEW identity.
    await act(async () => {
      screen.getByTestId("add").click();
    });
    expect(identities[identities.length - 1]).not.toBe(before);
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });
});

describe("legacy v1 key removal after migration (R98-10a)", () => {
  it("v2 wins when both keys exist, and the v1 key is wiped at load", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([legacyItem({ name: "stale" })]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item({ productId: 2, name: "v2" })]));
    render(
      <CartProvider>
        <CartSummary />
      </CartProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("v2"));
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("a v1-only browser is migrated (variantId reshaped to null) and the key is wiped", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([legacyItem()]));
    render(
      <CartProvider>
        <CartSummary />
      </CartProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("legacy"));
    // The migration adds the variant fields the rest of the app assumes.
    expect(screen.getByTestId("variants")).toHaveTextContent("null");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    // The migrated content is NOT re-persisted under the v2 key until a
    // mutation happens — the read path only mirrors, it never writes.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
