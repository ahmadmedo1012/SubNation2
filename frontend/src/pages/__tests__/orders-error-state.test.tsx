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

/** A GET /api/orders row (the orders-load-more.test.tsx fixture shape). */
const ORDER = (i: number) => ({
  id: i,
  order_code: `SNDB${String(i).padStart(4, "0")}`,
  status: "completed",
  amount: 25,
  product_name: `منتج رقم ${i}`,
  product_image_url: null,
  variant_label: null,
  created_at: "2026-09-08T10:00:00.000Z",
});

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
    // R187 (B-F7): a failed FIRST load leaves `data` undefined (the real
    // react-query shape — the old mock's pre-seeded empty page made the
    // same state unreachable). loadError keys on exactly this shape.
    mockInfiniteResult({ data: undefined, isError: true });

    renderPage();

    expect(screen.getByText("تعذّر تحميل الطلبات")).toBeInTheDocument();
    // Crucially NOT the "no orders yet" empty state — the outage used
    // to masquerade as an empty purchase history.
    expect(screen.queryByText("لا توجد طلبات بعد")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("R187 (B-F7): a background-refetch failure keeps the rendered rows (stale-keep, the referrals idiom)", () => {
    // Page 1 SUCCEEDED and is cached; a later refetch (socket/resync
    // lane) failed. Bare isError used to blank the fully-rendered list
    // with the outage card — a transient failure must not destroy
    // on-screen data (referrals.tsx's loadError derivation).
    mockInfiniteResult({
      data: { pages: [[ORDER(1), ORDER(2)]], pageParams: [1] },
      isError: true,
    });

    renderPage();

    expect(screen.getByText(/منتج رقم 1$/)).toBeInTheDocument();
    expect(screen.getByText(/منتج رقم 2$/)).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل الطلبات")).not.toBeInTheDocument();
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
