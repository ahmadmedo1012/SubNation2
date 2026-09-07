/**
 * Error-state test for the orders page (B4 P1-4).
 *
 * useListOrders previously had no `isError` branch: an API outage or an
 * expired session fell through to `orders = []` and rendered the
 * "no orders yet" empty state — an incident disguised as "you never
 * bought anything" on the last purchase-journey page without an error
 * branch. This test pins the contract: a failed query renders the
 * distinct error card, never the empty state.
 *
 * `@workspace/api-client-react` and `@/lib/auth` are mocked at the
 * module boundary (the vitest config's documented pattern for
 * page-level component tests).
 */

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import OrdersPage from "@/pages/orders";
import { useListOrders } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListOrders: vi.fn(),
  getListOrdersQueryKey: () => ["/api/orders"],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

type OrdersResult = ReturnType<typeof useListOrders>;

function mockOrdersResult(over: Partial<OrdersResult>) {
  vi.mocked(useListOrders).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as OrdersResult);
}

function renderPage() {
  return render(
    <Router>
      <OrdersPage />
    </Router>,
  );
}

describe("OrdersPage — a failed query is an error, not an empty list (B4 P1-4)", () => {
  it("renders the error card with a retry action when the orders query fails", () => {
    mockOrdersResult({ isError: true });

    renderPage();

    expect(screen.getByText("تعذّر تحميل الطلبات")).toBeInTheDocument();
    // Crucially NOT the "no orders yet" empty state — the outage used
    // to masquerade as an empty purchase history.
    expect(screen.queryByText("لا توجد طلبات بعد")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("still renders the empty state when the query succeeds with zero orders", () => {
    mockOrdersResult({ data: [] });

    renderPage();

    expect(screen.getByText("لا توجد طلبات بعد")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل الطلبات")).not.toBeInTheDocument();
  });
});
