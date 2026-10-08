/**
 * R111-F1 G1 (P3) — checkout cart-hydration guard.
 *
 * The cart reads localStorage in a mount effect (`isLoaded` flips on the
 * first effect tick — lib/cart.tsx). cart.tsx has guarded this since
 * round-93 (`!isLoaded → CartSkeleton`); checkout did NOT: a shopper
 * deep-linking /checkout with a FULL cart saw the «سلتك فارغة» empty
 * branch for the first paint — a false "your cart is empty" flash on
 * the money screen.
 *
 * The guard mirrors cart.tsx:122 — `!isLoaded` renders the checkout-
 * shaped RouteSkeleton (same max-w-5xl two-column geometry) instead of
 * the empty state.
 *
 * useCart is mocked at the hook boundary (both hydration phases pinned
 * directly — the one-tick flash is not observable through the REAL
 * provider because RTL flushes the mount effect inside act()); the
 * genuine-empty path stays covered through the real provider in the
 * checkout-* suites.
 */

import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPage from "@/pages/checkout";
import { useCart } from "@/lib/cart";

vi.mock("@/lib/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cart")>();
  return { ...actual, useCart: vi.fn() };
});

vi.mock("@workspace/api-client-react", () => ({
  createOrder: vi.fn(),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  // R116-S2 (P3): the balance rides the seeded useGetMe cache now —
  // solvent by default so the confirm CTA stays enabled.
  useGetMe: vi.fn(() => ({
    data: { id: 7, wallet_balance: 1_000_000 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  getMe: vi.fn(),
  getProduct: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const FULL_CART = [
  {
    productId: 5,
    variantId: 101,
    variantLabel: "شهر واحد",
    slug: "netflix-1m",
    name: "Netflix شهر",
    imageUrl: null,
    priceLYD: 75,
    salePriceLYD: 49,
    discountPercent: 35,
    quantity: 1,
  },
];

function mockCartState({ isLoaded, items }: { isLoaded: boolean; items: typeof FULL_CART }) {
  vi.mocked(useCart).mockReturnValue({
    items,
    totalLYD: items.length ? 49 : 0,
    clear: vi.fn(),
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
    reconcileLine: vi.fn(),
    isLoaded,
  } as unknown as ReturnType<typeof useCart>);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <CheckoutPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("checkout cart-hydration guard (R111-F1 G1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a FULL cart that has not hydrated yet renders the skeleton — never the «سلتك فارغة» flash", () => {
    mockCartState({ isLoaded: false, items: FULL_CART });
    const { container } = renderPage();

    // The checkout-shaped RouteSkeleton (role=status, page-loading label —
    // R123-E4b P3-d: «جارٍ» tanwīn form).
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "جارٍ تحميل الصفحة");
    // The false-empty flash and the real page chrome are both absent.
    expect(screen.queryByText("سلتك فارغة")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "إتمام الطلب" })).not.toBeInTheDocument();
    // And it is the CHECKOUT shell (two-column grid), not a bare spinner.
    expect(container.querySelector(".md\\:grid-cols-\\[1fr_360px\\]")).not.toBeNull();
  });

  it("once hydrated, a genuinely empty cart still renders the honest empty state (guard is not sticky)", () => {
    mockCartState({ isLoaded: true, items: [] });
    renderPage();

    expect(screen.getByText("سلتك فارغة")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("once hydrated with items, the page renders (title + summary) — the guard is a pre-hydration state only", () => {
    mockCartState({ isLoaded: true, items: FULL_CART });
    renderPage();

    expect(screen.getByRole("heading", { name: "إتمام الطلب" })).toBeInTheDocument();
    expect(screen.getByText("ملخص الطلب")).toBeInTheDocument();
  });
});
