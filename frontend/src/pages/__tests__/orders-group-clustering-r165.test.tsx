/**
 * R165 (the R162 ADR §6.2) — the /orders clustering:
 *
 *   1. the PURE computation (lib/order-groups.ts): runs of ≥2 consecutive
 *      rows sharing one non-null order_group_id; NULL never clusters;
 *      non-consecutive same-group rows break the run;
 *   2. the RENDERED affordance: a run gets exactly ONE «عملية شراء واحدة»
 *      divider with the honest count; historical NULL-group rows render
 *      with NO divider — byte-identical to today; every row keeps its own
 *      order code + link (grouping is presentational).
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrdersPage from "@/pages/orders";
import { useInfiniteQuery } from "@tanstack/react-query";
import { computeOrderGroupClusters } from "@/lib/order-groups";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

type InfiniteResult = ReturnType<typeof useInfiniteQuery>;

type TestOrder = {
  id: number;
  order_code: string;
  order_group_id?: string | null;
  product_name: string;
  status: string;
  amount: number;
  created_at: string;
};

function orderRow(id: number, group: string | null, over: Partial<TestOrder> = {}): TestOrder {
  return {
    id,
    order_code: `SN-G${String(id).padStart(4, "0")}`,
    order_group_id: group,
    product_name: `منتج ${id}`,
    status: "completed",
    amount: 10,
    created_at: "2026-10-18T10:00:00Z",
    ...over,
  };
}

function mockOrders(orders: TestOrder[]) {
  vi.mocked(useInfiniteQuery).mockReturnValue({
    data: { pages: [orders], pageParams: [1] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  } as unknown as InfiniteResult);
}

function renderPage() {
  return render(
    <Router>
      <OrdersPage />
    </Router>,
  );
}

beforeEach(() => {
  vi.mocked(useInfiniteQuery).mockReset();
});

describe("computeOrderGroupClusters (pure, lib/order-groups.ts)", () => {
  it("a consecutive run of ≥2 same-group rows is one cluster keyed at its start", () => {
    const orders = [orderRow(1, "g-1"), orderRow(2, "g-1"), orderRow(3, "g-1"), orderRow(4, null)];
    expect(computeOrderGroupClusters(orders)).toEqual(new Map([[0, 3]]));
  });

  it("a single-order group (run of 1) does NOT cluster — uniform contract, no affordance", () => {
    const orders = [orderRow(1, "g-1"), orderRow(2, null)];
    expect(computeOrderGroupClusters(orders)).toEqual(new Map());
  });

  it("NULL groups never cluster (historical rows)", () => {
    const orders = [orderRow(1, null), orderRow(2, null), orderRow(3, null)];
    expect(computeOrderGroupClusters(orders)).toEqual(new Map());
  });

  it("non-consecutive same-group rows break the run honestly (no reordering history)", () => {
    const orders = [
      orderRow(1, "g-1"),
      orderRow(2, "g-2"), // a purchase between this attempt's units
      orderRow(3, "g-1"),
    ];
    expect(computeOrderGroupClusters(orders)).toEqual(new Map());
  });

  it("multiple separate runs each get their own cluster", () => {
    const orders = [
      orderRow(1, "g-1"),
      orderRow(2, "g-1"),
      orderRow(3, null),
      orderRow(4, "g-3"),
      orderRow(5, "g-3"),
    ];
    expect(computeOrderGroupClusters(orders)).toEqual(
      new Map([
        [0, 2],
        [3, 2],
      ]),
    );
  });

  it("an empty list clusters nothing", () => {
    expect(computeOrderGroupClusters([])).toEqual(new Map());
  });
});

describe("OrdersPage — the cluster affordance (R165 render)", () => {
  it("a 3-row run gets exactly ONE divider with the honest count", () => {
    mockOrders([orderRow(1, "g-1"), orderRow(2, "g-1"), orderRow(3, "g-1"), orderRow(4, null)]);
    renderPage();

    const dividers = screen.queryAllByText("عملية شراء واحدة");
    expect(dividers).toHaveLength(1);
    // The honest count rides the divider chip.
    const chip = dividers[0].closest("span")!;
    expect(within(chip as HTMLElement).getByText(/3/)).toBeInTheDocument();
  });

  it("every clustered row keeps its own code + link (grouping is presentational)", () => {
    mockOrders([orderRow(1, "g-1"), orderRow(2, "g-1")]);
    renderPage();

    const link1 = screen.getByRole("link", { name: /SN-G0001/ });
    const link2 = screen.getByRole("link", { name: /SN-G0002/ });
    expect(link1).toHaveAttribute("href", "/orders/SN-G0001");
    expect(link2).toHaveAttribute("href", "/orders/SN-G0002");
  });

  it("historical NULL-group rows render with NO divider — today's DOM", () => {
    mockOrders([orderRow(1, null), orderRow(2, null)]);
    renderPage();

    expect(screen.queryByText("عملية شراء واحدة")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SN-G0001/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SN-G0002/ })).toBeInTheDocument();
  });

  it("R166 (F10b): same-group rows split across filter buckets → NO divider inside the filtered bucket", () => {
    // One attempt (g-1) whose two units landed in different buckets
    // (completed + pending): the cluster runs over the VISIBLE list
    // (orders.tsx computeOrderGroupClusters(visibleOrders)), so the
    // completed bucket sees a run of 1 — and a run of 1 never clusters.
    window.history.pushState(null, "", "/orders");
    mockOrders([
      orderRow(1, "g-1", { status: "completed" }),
      orderRow(2, "g-1", { status: "pending" }),
    ]);
    renderPage();

    // The «الكل» view: the 2-row run clusters, and the honest count
    // rides the nominative dual «2 طلبان» (R166-A F02).
    const dividers = screen.getAllByText("عملية شراء واحدة");
    expect(dividers).toHaveLength(1);
    const chip = dividers[0].closest("span")!;
    expect(within(chip as HTMLElement).getByText(/2 طلبان/)).toBeInTheDocument();

    // Switch to the completed bucket: only row 1 is visible — run of 1,
    // no divider inside the filtered bucket.
    fireEvent.click(screen.getByRole("button", { name: /^مكتمل/ }));

    expect(screen.queryByText("عملية شراء واحدة")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SN-G0001/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /SN-G0002/ })).not.toBeInTheDocument();

    // Reset the ?filter= mirror so any later test mounts on the
    // canonical bare /orders URL again.
    window.history.pushState(null, "", "/orders");
  });
});
