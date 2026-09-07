/**
 * 93-C6 / F-07 (round-93 — A5 S-2 + O-1) — orders page false-empty +
 * silent-100-row-cap tests.
 *
 * Two P1s on the admin orders page:
 *
 *   1. (S-2) `isError`/`error` were never destructured from the list
 *      query — a failed load (401/500/network) left data=[] and the
 *      page rendered the "لا توجد طلبات" empty state: a support queue
 *      that LOOKED empty during an outage. Now: a distinct error card
 *      with retry (referrals.tsx idiom) when there is no data, an
 *      inline banner when stale rows exist.
 *
 *   2. (O-1) The backend supports `page`/`limit` (clamped [1,200],
 *      default 100) but the frontend never paginated — history past
 *      the newest 100 orders was unreachable while the header labeled
 *      the capped list "طلب إجمالاً" (a false total). Now: التالي/السابق
 *      controls drive the `page` param, and the header only claims
 *      "إجمالاً" when the whole result set provably fits one page.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminOrdersPage from "@/pages/admin/orders";
import { useListAdminOrders } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListAdminOrders: vi.fn(),
  getListAdminOrdersQueryKey: (params?: unknown) => ["/api/admin/orders", params ?? null],
  // 93-C6: useAdminHeaders registers the global 401 observer through
  // this export — the mock must carry the module surface the page
  // graph imports.
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

type OrdersResult = ReturnType<typeof useListAdminOrders>;

const ORDER = (i: number) => ({
  id: i + 1,
  order_code: `SN-${1000 + i}`,
  user_phone: `0910000${String(i).padStart(3, "0")}`,
  product_name: `Product ${i}`,
  amount: 10 + i,
  status: "completed",
  created_at: "2026-09-01T10:00:00.000Z",
});

function mockOrdersResult(data: unknown[], over: Partial<OrdersResult> = {}) {
  (useListAdminOrders as unknown as Mock).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as OrdersResult);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminOrdersPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminOrdersPage — false-empty on failed load (S-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrdersResult([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a failed load renders the error card, NEVER the 'لا توجد طلبات' empty state", () => {
    const refetch = vi.fn();
    mockOrdersResult([], { isError: true, error: new Error("HTTP 503"), refetch });

    renderPage();

    expect(screen.queryByText("لا توجد طلبات")).not.toBeInTheDocument();
    expect(screen.getByText("تعذّر تحميل الطلبات")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    expect(retry).toBeInTheDocument();

    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("stale rows + failed refresh keep the table and add an inline banner", () => {
    mockOrdersResult([ORDER(0), ORDER(1)], { isError: true, error: new Error("HTTP 500") });

    renderPage();

    // The stale table is still honest about what it shows…
    expect(screen.getAllByText("SN-1000").length).toBeGreaterThan(0);
    // …and the refresh failure is surfaced inline, not swallowed.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
    // Empty state must NOT appear while stale data is rendered.
    expect(screen.queryByText("لا توجد طلبات")).not.toBeInTheDocument();
  });
});

describe("AdminOrdersPage — pagination past the 100-row cap (O-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a full page shows التالي, sends page 2 to the query, and the header stops claiming إجمالياً", async () => {
    // Exactly ORDERS_PAGE_SIZE rows → a next page may exist.
    mockOrdersResult(Array.from({ length: 100 }, (_, i) => ORDER(i)));

    renderPage();

    // Page 1 with a full page: the total is NOT known — no "إجمالاً".
    expect(screen.queryByText("100 طلب إجمالاً")).not.toBeInTheDocument();

    const next = screen.getByRole("button", { name: "التالي" });
    const prev = screen.getByRole("button", { name: "السابق" });
    expect(prev).toBeDisabled(); // page 1
    expect(next).toBeEnabled();

    fireEvent.click(next);

    // The list query is re-invoked with the server-side page param.
    await waitFor(() => {
      const lastCall = (useListAdminOrders as unknown as Mock).mock.calls.at(-1);
      expect(lastCall?.[0]).toMatchObject({ page: 2, limit: 100 });
    });
    expect(screen.getByText("صفحة 2")).toBeInTheDocument();
  });

  it("a short first page: total IS known (إجمالاً) and no pagination controls render", () => {
    mockOrdersResult([ORDER(0), ORDER(1)]);

    renderPage();

    expect(screen.getByText("2 طلب إجمالاً")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "التالي" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "السابق" })).not.toBeInTheDocument();
    // No "stats describe only the loaded page" disclosure needed when
    // the whole store fits the page.
    expect(screen.queryByText(/الإحصاءات تعكس/)).not.toBeInTheDocument();
  });

  it("a capped list discloses that the stats describe the loaded page only", () => {
    mockOrdersResult(Array.from({ length: 100 }, (_, i) => ORDER(i)));

    renderPage();

    expect(screen.getByText(/الإحصاءات تعكس الطلبات المعروضة/)).toBeInTheDocument();
  });
});
