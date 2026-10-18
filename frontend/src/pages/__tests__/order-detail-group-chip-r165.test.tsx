/**
 * R165 (the R162 ADR §6.3) — the order-detail sibling-awareness chip:
 * an order carrying order_group_id shows «جزء من عملية شراء متعددة»
 * linking to /orders (the v1 shape); an order WITHOUT one (single,
 * historical) renders exactly as before — no chip.
 */

import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderDetailPage from "@/pages/order-detail";
import { useGetOrder, type Order } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useGetOrder: vi.fn(),
  getGetOrderQueryKey: (code: string) => [`/api/orders/${code}`],
  useGetMe: () => ({ data: { id: 7, wallet_balance: 51 }, isLoading: false }),
  getGetMeQueryKey: () => ["/api/auth/me"],
  createOrder: vi.fn(),
  getProduct: vi.fn(),
  getMe: vi.fn(async () => ({ id: 7, wallet_balance: 51 })),
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  getGetProductQueryKey: (id: number) => [`/api/products/${id}`],
  getGetProductRecommendationsQueryKey: (id: number) => [`/api/products/${id}/recommendations`],
  useGetProduct: () => ({
    data: null,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGetProductRecommendations: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  // use-socket (imported by order-detail) imports the bare `toast`.
  toast: toastSpy,
}));

const GROUPED_ORDER: Order = {
  id: 95,
  order_code: "SNR165A",
  product_id: 3,
  product_name: "Netflix شهر",
  product_image_url: null,
  variant_id: null,
  status: "completed",
  amount: 49,
  created_at: "2026-10-18T12:00:00.000Z",
  delivered_email: "buyer@example.com",
  delivered_password: "hunter2",
  delivered_extra_details: null,
  delivered_usage_terms: null,
  discount_amount: 0,
  coupon_code: null,
  order_group_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};

const SINGLE_ORDER: Order = {
  ...GROUPED_ORDER,
  id: 96,
  order_code: "SNR165B",
  order_group_id: null,
};

beforeEach(() => {
  vi.mocked(useGetOrder).mockReset();
  toastSpy.mockReset();
  localStorage.clear();
});

function renderDetail(order: Order) {
  vi.mocked(useGetOrder).mockReturnValue({
    data: order,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGetOrder>);
  window.history.pushState({}, "", `/orders/${order.order_code}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <OrderDetailPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("OrderDetailPage — the multi-purchase chip (R165, ADR §6.3)", () => {
  it("an order with a group shows «جزء من عملية شراء متعددة» linking to /orders", () => {
    renderDetail(GROUPED_ORDER);

    const chip = screen.getByRole("link", { name: /جزء من عملية شراء متعددة/ });
    expect(chip).toHaveAttribute("href", "/orders");
  });

  it("an order WITHOUT a group (single / historical) renders no chip — today's DOM", () => {
    renderDetail(SINGLE_ORDER);

    expect(screen.queryByText(/جزء من عملية شراء متعددة/)).not.toBeInTheDocument();
    expect(screen.getByText("SNR165B")).toBeInTheDocument();
  });
});
