/**
 * R130 (A1-F1 / A1-F3) — the variant-drained line + the page-level
 * blocked-state gate (the R129-A1 recipe, completed).
 *
 * A1-F1: the B-11 snapshot is the product-WIDE stock total, but the
 * charge authority is variant-scoped. A line whose own variant drained
 * while OTHER variants (or the product total) still held stock used to
 * read "in stock" and reach the charge only to 409. quoteLineFromProduct
 * now quotes a drained variant with stockCount 0 — the existing B-11
 * machinery flags «نفد المخزون» and blocks the confirm CTA.
 *
 * A1-F3: no test ever rendered a BLOCKED line on the real page (the
 * R129 fix recipe was half-executed — the refresh-path test asserted
 * the CTA ENABLED). This file renders the real CheckoutPage with a
 * blocked line and pins the verdict + the disabled CTA end-to-end.
 *
 * Harness: checkout-pricing-reconcile.test.tsx (mocked
 * @workspace/api-client-react, real CartProvider seeded via
 * localStorage, global fetch stub for the balance probe).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPage from "@/pages/checkout";
import { CartProvider, type LocalCartItem } from "@/lib/cart";

const getProductMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  createOrder: vi.fn(),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  useGetMe: vi.fn(() => ({
    data: { id: 7, wallet_balance: 1_000_000 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  getMe: vi.fn(async () => ({ wallet_balance: 1_000_000 })),
  getProduct: (...args: unknown[]) => getProductMock(...(args as [])),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

/** The buyer holds ONE unit of the «Premium — سنة» variant (id 102,
 * 80.00). The product's OTHER variant (id 101, 25.00) is the drained
 * one; the product-wide total reads 5 — the old snapshot told the line
 * it was buyable. */
const DRAINED_VARIANT_LINE: LocalCartItem = {
  productId: 5,
  variantId: 102,
  variantLabel: "Premium — سنة",
  slug: "mixed-state",
  name: "Mixed State Product",
  imageUrl: null,
  priceLYD: 80,
  salePriceLYD: null,
  discountPercent: null,
  quantity: 1,
  stockCount: 5, // the product-WIDE snapshot the add site captured
};

function liveMixedProduct() {
  return {
    id: 5,
    slug: "mixed-state",
    name: "Mixed State Product",
    price: 25, // the OLD availability-blind display min (the drained variant)
    price_from: true,
    sale_price: null,
    discount_percent: null,
    is_active: true,
    is_available: true, // the PRODUCT holds stock — in other variants
    stock_count: 5,
    order_count: 0,
    variants: [
      {
        id: 101,
        plan_label: "Basic",
        duration_label: "شهر واحد",
        label: "Basic — شهر واحد",
        price: 25,
        sale_price: null,
        discount_percent: null,
        is_available: false, // DRAINED: scoped 0 + no generic units
      },
      {
        id: 102,
        plan_label: "Premium",
        duration_label: "سنة",
        label: "Premium — سنة",
        price: 80,
        sale_price: null,
        discount_percent: null,
        is_available: true,
      },
    ],
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <CartProvider>
          <CheckoutPage />
        </CartProvider>
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getProductMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("subnation_cart_v2", JSON.stringify([DRAINED_VARIANT_LINE]));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ wallet_balance: 1_000_000 }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CheckoutPage — a variant-drained line is blocked BEFORE the charge (A1-F1/A1-F3)", () => {
  it("the HOLDING variant's line stays buyable: verdict «متبقٍ 5 فقط» absent, CTA enabled", async () => {
    getProductMock.mockResolvedValue(liveMixedProduct());
    renderPage();

    // The line quotes from variant 102 (available): stock stays the
    // product total — no out-verdict, the CTA unlocks.
    await waitFor(() => expect(screen.queryByText("سلتك فارغة")).not.toBeInTheDocument());
    await waitFor(() => {
      const cta = screen.getByRole("button", { name: /إتمام الطلب/ });
      expect(cta).toBeEnabled();
    });
    expect(screen.queryByText("نفد المخزون")).not.toBeInTheDocument();
  });

  it("the DRAINED variant's line renders «نفد المخزون» and the confirm CTA is DISABLED (no 409 surprise)", async () => {
    // Same product, but the buyer's line holds the drained 25.00 variant.
    localStorage.setItem(
      "subnation_cart_v2",
      JSON.stringify([
        { ...DRAINED_VARIANT_LINE, variantId: 101, variantLabel: "Basic — شهر واحد", priceLYD: 25 },
      ]),
    );
    getProductMock.mockResolvedValue(liveMixedProduct());
    renderPage();

    // The re-quote sees variant 101 is_available:false → stockCount 0 →
    // the existing B-11 machinery blocks the CTA and the label SAYS WHY
    // (the checkout page's honest disabled state). The line is NOT
    // dropped (the buyer keeps the chance to switch options).
    const blockedCta = await screen.findByRole("button", { name: /نفد مخزونها/ });
    expect(blockedCta).toBeDisabled();
    // The blocked line survives the re-quote (no drop notice).
    expect(screen.queryByText(/أُزيل من الطلب/)).not.toBeInTheDocument();
    // The store carries the variant-honest snapshot (0), not the
    // product-wide 5 that blessed the line before.
    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem("subnation_cart_v2") ?? "[]",
      ) as LocalCartItem[];
      expect(stored[0]?.stockCount).toBe(0);
      expect(stored[0]?.variantId).toBe(101);
    });
  });
});
