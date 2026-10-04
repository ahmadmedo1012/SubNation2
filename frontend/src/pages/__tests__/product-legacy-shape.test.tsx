import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import ProductPage from "@/pages/product";
import { createElement } from "react";

/**
 * R116 regression (browser QA catch): the visual-QA browser run crashed the product page with
 * "Cannot read properties of undefined (reading 'slice')" on a product
 * that omits ALL enrichment fields (no description_long / faq / features
 * / seo_title / seo_description) — the legacy-product shape. Reproduce
 * and pin: this must render, not hit the ErrorBoundary.
 */

const PRODUCT = {
  id: 11,
  slug: null,
  name: "Spotify بريميوم",
  description: "موسيقى بلا إعلانات",
  category: "music",
  price: 25,
  price_from: true,
  sale_price: 20,
  image_url: null,
  is_active: true,
  is_available: true,
  stock_count: 8,
  discount_percent: 20,
  usage_terms: null,
  order_count: 25,
  variants: [
    {
      id: 1,
      plan_label: null,
      duration_label: "شهر واحد",
      label: "شهر واحد",
      price: 25,
      sale_price: 20,
      discount_percent: 20,
      is_available: true,
    },
  ],
};

vi.mock("@workspace/api-client-react", async (orig) => {
  const actual = await orig<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetProduct: () => ({
      data: PRODUCT,
      isLoading: false,
      isError: false,
      error: null,
    }),
    useListProducts: () => ({ data: [PRODUCT], isLoading: false, isError: false }),
    useGetFlashSale: () => ({ data: { flash_sale: null } }),
    useGetCatalogStats: () => ({
      data: { available_products: 3, total_units: 9, lowest_price: 15, total_products: 3 },
    }),
    useGetProductRecommendations: () => ({ data: [], isLoading: false, isError: false }),
    getProduct: vi.fn(async () => PRODUCT),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: null, user: null, loading: false }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  window.history.pushState({}, "", `/product/${PRODUCT.id}`);
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        Router,
        null,
        createElement(Route, { path: "/product/:slug", component: ProductPage }),
      ),
    ),
  );
}

describe("product page — legacy product (no enrichment fields)", () => {
  it("renders without hitting the ErrorBoundary", async () => {
    const rendered = renderPage();
    await waitFor(
      () => {
        expect(rendered.container.textContent).toContain("Spotify");
      },
      { timeout: 3000 },
    );
    expect(rendered.container.textContent).not.toContain("حدث خطأ غير متوقع");
  });
});
