/**
 * R168-L3 (fix 6) — multi-variant stock-count honesty.
 *
 * «متوفر (N)» showed the PRODUCT-level pool even when a specific
 * variant was selected — the number could over-claim what that variant
 * can deliver (the verified drift case: uneven scoped pools → a
 * mid-charge 409). Multi-variant products now render «متوفر» WITHOUT
 * the count; single-variant products KEEP it (accurate there, and the
 * low-stock urgency signal stays). SR aria-label mirrors the visible
 * badge either way.
 *
 * Harness: PriceStockPanel is props-only — rendered directly with the
 * two DTO shapes the PDP actually serves.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PriceStockPanel } from "@/components/product/PriceStockPanel";
import type { Product } from "@workspace/api-client-react";

afterEach(cleanup);

function product(variants: Product["variants"], over: Partial<Product> = {}): Product {
  return {
    id: 5,
    slug: null,
    name: "Netflix شهر",
    category: "streaming",
    price: 25,
    price_from: variants.length > 1,
    is_active: true,
    is_available: true,
    stock_count: 5,
    order_count: 0,
    variants,
    ...over,
  };
}

describe("R168-L3 fix 6 — the stock badge's numeric honesty", () => {
  it("single-variant products KEEP the count («متوفر (5)» + the SR twin)", () => {
    render(
      <PriceStockPanel
        product={product([{ id: 1, label: "شهر واحد", price: 25, is_available: true }])}
        selectedVariant={null}
        displayPrice={25}
      />,
    );

    const badge = screen.getByRole("status");
    expect(badge.textContent).toContain("متوفر (5)");
    expect(badge).toHaveAttribute("aria-label", "المنتج متوفر، الكمية 5");
  });

  it("multi-variant products DROP the count (the product pool can over-claim the variant)", () => {
    render(
      <PriceStockPanel
        product={product([
          { id: 1, label: "شهر واحد", price: 25, is_available: true },
          { id: 2, label: "سنة كاملة", price: 300, is_available: true },
        ])}
        // A variant IS selected — the exact drift scenario.
        selectedVariant={{ id: 2, label: "سنة كاملة", price: 300, is_available: true }}
        displayPrice={300}
      />,
    );

    const badge = screen.getByRole("status");
    expect(badge.textContent).toContain("متوفر");
    expect(badge.textContent).not.toContain("(");
    expect(badge).toHaveAttribute("aria-label", "المنتج متوفر");
  });

  it("the sold-out verdict is untouched (regression guard)", () => {
    render(
      <PriceStockPanel
        product={product([], { is_available: false, stock_count: 0 })}
        selectedVariant={null}
        displayPrice={25}
      />,
    );

    const badge = screen.getByRole("status");
    expect(badge.textContent).toContain("نفد المخزون");
    expect(badge).toHaveAttribute("aria-label", "نفد المخزون");
  });

  it("the R115-I1 variant-aware strike still renders (the panel's other contract)", () => {
    render(
      <PriceStockPanel
        product={product([
          { id: 1, label: "شهر واحد", price: 100, sale_price: 80, is_available: true },
        ])}
        selectedVariant={{
          id: 1,
          label: "شهر واحد",
          price: 100,
          sale_price: 80,
          is_available: true,
        }}
        displayPrice={80}
      />,
    );

    const strike = screen.getByText("100.00 د.ل");
    expect(strike.className).toContain("line-through");
  });
});
