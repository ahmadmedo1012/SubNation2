import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import ProductPage from "@/pages/product";
import { customFetch } from "@workspace/api-client-react";
import { createElement } from "react";

/**
 * R146 (audit-frontend-pages F1) — the legacy numeric PDP URL rewrite.
 *
 * /product/:id deep links (bookmarks, pre-migration sitemap entries, old
 * WhatsApp shares) fetch by id, render the full PDP, then rewrite the URL
 * to the slug form via history.replaceState. wouter 3.9 patches
 * replaceState into a LOCATION change: isLegacyNumeric flips false and the
 * page switches to bySlugQuery — whose key ["product-by-slug", slug] held
 * NO data, so line ~590's `if (isLoading) return <RouteSkeleton/>`
 * replaced the PDP the visitor was already reading with a full-page
 * skeleton until a SECOND fetch of the same product landed.
 *
 * The fix seeds the slug key with the by-id response before the rewrite
 * (same DTO shape — the page's own comment at the bySlugQuery). This pins:
 *   1. the slug key is seeded with the by-id DTO;
 *   2. the by-slug fetch NEVER fires (the app query client's 60 s
 *      staleTime makes the seeded entry fresh — mirrored below);
 *   3. the rendered PDP is never swapped for the route skeleton.
 *
 * Harness: product-legacy-shape.test.tsx's idiom (module-boundary mock of
 * the generated client; the QueryClient mirrors app/query-client.ts's
 * staleTime so the freshness verdict matches production).
 */

const PRODUCT = {
  id: 11,
  slug: "spotify-premium",
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
  variants: [],
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
    // Path 2 (by-slug) rides customFetch — the double-fetch probe: if the
    // seeding regresses, the by-slug query fires and this spy records it.
    customFetch: vi.fn(async () => PRODUCT),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: null, user: null, loading: false }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

function renderPage() {
  // staleTime mirrors app/query-client.ts (60 s) — the production config
  // under which the seeded entry is fresh and no background refetch fires.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  window.history.pushState({}, "", `/product/${PRODUCT.id}`);
  return {
    queryClient,
    rendered: render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          Router,
          null,
          createElement(Route, { path: "/product/:slug", component: ProductPage }),
        ),
      ),
    ),
  };
}

describe("product page — legacy numeric URL rewrite seeds the slug key (R146-F1)", () => {
  it("rewrite lands, slug key seeded, no second fetch, no skeleton flip", async () => {
    const { queryClient, rendered } = renderPage();

    // The by-id PDP rendered…
    await waitFor(
      () => {
        expect(rendered.container.textContent).toContain("Spotify");
      },
      { timeout: 3000 },
    );
    // …and the URL was rewritten to the canonical slug form.
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/product/${PRODUCT.slug}`);
    });

    // The slug key carries the by-id DTO (same shape — the page's own
    // bySlugQuery comment): the post-rewrite bySlugQuery reads THIS.
    expect(queryClient.getQueryData(["product-by-slug", PRODUCT.slug])).toEqual(PRODUCT);

    // The by-slug fetch never fired — the seeded entry is fresh.
    expect(vi.mocked(customFetch)).not.toHaveBeenCalled();

    // And the rendered PDP was never swapped back for the route skeleton
    // (RouteSkeleton's own aria-label — the flash the visitor saw).
    expect(rendered.container.querySelector('[aria-label="جارٍ تحميل الصفحة"]')).toBeNull();
    expect(rendered.container.textContent).toContain("Spotify");
  });
});
