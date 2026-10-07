/**
 * Error-state test for the orders page (B4 P1-4).
 *
 * The orders query previously had no `isError` branch: an API outage or
 * an expired session fell through to an empty list and rendered the
 * "no orders yet" empty state — an incident disguised as "you never
 * bought anything" on the last purchase-journey page without an error
 * branch. This test pins the contract: a failed query renders the
 * distinct error card, never the empty state.
 *
 * R120-B7 (reviewer finding — A6-F1): the page rides the accumulating
 * useInfiniteQuery idiom (admin/orders.tsx 94-C2 A2 P1-1) instead of the
 * generated useListOrders hook — the mock follows the new module
 * surface. `useInfiniteQuery` is mocked at the module boundary (partial
 * mock — the rest of @tanstack/react-query stays real); the raw-fetch
 * pagination itself is covered by orders-load-more.test.tsx.
 */

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import OrdersPage from "@/pages/orders";
import { useInfiniteQuery } from "@tanstack/react-query";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

type InfiniteResult = ReturnType<typeof useInfiniteQuery>;

function mockInfiniteResult(over: Partial<InfiniteResult>) {
  vi.mocked(useInfiniteQuery).mockReturnValue({
    data: { pages: [[]], pageParams: [1] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...over,
  } as unknown as InfiniteResult);
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
    mockInfiniteResult({ isError: true });

    renderPage();

    expect(screen.getByText("تعذّر تحميل الطلبات")).toBeInTheDocument();
    // Crucially NOT the "no orders yet" empty state — the outage used
    // to masquerade as an empty purchase history.
    expect(screen.queryByText("لا توجد طلبات بعد")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("still renders the empty state when the query succeeds with zero orders", () => {
    mockInfiniteResult({ data: { pages: [[]], pageParams: [1] } });

    renderPage();

    expect(screen.getByText("لا توجد طلبات بعد")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل الطلبات")).not.toBeInTheDocument();
  });

  // R120-B7 (A4-F1 completion): the empty-state CTA is ONE anchor
  // wearing the button styling (asChild composition) — no nested
  // button, no doubled tab stop (cart.tsx ghost-CTA idiom).
  it("the empty-state CTA is a single anchor with no nested button", () => {
    mockInfiniteResult({ data: { pages: [[]], pageParams: [1] } });

    renderPage();

    const cta = screen.getByRole("link", { name: "تصفح الكتالوج" });
    expect(cta).toHaveAttribute("href", "/");
    expect(cta.querySelector("button")).toBeNull();
  });
});
