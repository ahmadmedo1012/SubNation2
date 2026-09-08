/**
 * 93-C6 / F-07 (round-93 — A5 S-2 + O-1) + 94-C2 (A2 P1-1 + P2-2) —
 * orders page false-empty + load-more + server-side search tests.
 *
 * Three behaviors pinned:
 *
 *   1. (S-2, carried from r93) `isError`/`error` are destructured — a
 *      failed load (401/500/network) renders the error card, NEVER the
 *      "لا توجد طلبات" empty state; a failed REFRESH of stale rows
 *      keeps the table and adds the inline banner.
 *
 *   2. (P1-1, 94-C2) The list is an accumulating useInfiniteQuery over
 *      the frozen `?page=&limit=` contract — the round-93 page-swapping
 *      controls are replaced by «تحميل المزيد»: page 2 is requested
 *      with `{page: 2, limit: 100}`, rows append in place, and the
 *      button hides once a short page arrives. The header only claims
 *      «إجمالاً» when the whole result set provably fits one page —
 *      otherwise «عرض N (الأحدث أولاً)».
 *
 *   3. (P2-2, 94-C2) Search is SERVER-side: the debounced input value
 *      enters the query params as `search` (the backend LIKEs across
 *      order code / phone / email / name / product) — and a
 *      `/admin/orders?search=` deep-link prefills it so the
 *      GlobalSearch palette's query survives the navigation.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (vitest-config pattern).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminOrdersPage from "@/pages/admin/orders";
import { listAdminOrders } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  // 94-C2 (A2 P1-1): the list moved from the generated useListAdminOrders
  // hook to useInfiniteQuery + listAdminOrders over the frozen
  // `?page=&limit=` contract — the mock follows the new module surface.
  listAdminOrders: vi.fn(),
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

const ORDER = (i: number) => ({
  id: i + 1,
  order_code: `SN-${1000 + i}`,
  user_phone: `0910000${String(i).padStart(3, "0")}`,
  product_name: `Product ${i}`,
  amount: 10 + i,
  status: "completed",
  created_at: "2026-09-01T10:00:00.000Z",
});

/** Exactly ORDERS_PAGE_SIZE rows — "a next page MIGHT exist". */
const FULL_PAGE = Array.from({ length: 100 }, (_, i) => ORDER(i));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminOrdersPage />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

describe("AdminOrdersPage — false-empty on failed load (S-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a failed load renders the error card, NEVER the 'لا توجد طلبات' empty state", async () => {
    (listAdminOrders as unknown as Mock).mockRejectedValue(new Error("HTTP 503"));

    renderPage();

    expect(await screen.findByText("تعذّر تحميل الطلبات")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد طلبات")).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    expect(retry).toBeInTheDocument();

    fireEvent.click(retry);
    // The refetch fired (still failing — the card is the honest state).
    await waitFor(() => expect((listAdminOrders as Mock).mock.calls.length).toBeGreaterThan(1));
  });

  it("stale rows + failed refresh keep the table and add an inline banner", async () => {
    (listAdminOrders as unknown as Mock)
      .mockResolvedValueOnce([ORDER(0), ORDER(1)])
      .mockRejectedValue(new Error("HTTP 500"));

    const { client } = renderPage();

    // The stale table is still honest about what it shows…
    await screen.findAllByText("SN-1000");
    // …and a failed refresh of the SAME query (invalidation path)
    // surfaces inline instead of swapping to the empty state.
    await act(async () => {
      await client.invalidateQueries();
    });

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
    expect(screen.queryByText("لا توجد طلبات")).not.toBeInTheDocument();
  });
});

describe("AdminOrdersPage — accumulating load-more past the 100-row cap (O-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a full page offers تحميل المزيد, requests page 2, appends in place, and hides on a short page", async () => {
    (listAdminOrders as unknown as Mock)
      .mockResolvedValueOnce(FULL_PAGE)
      .mockResolvedValueOnce([ORDER(100), ORDER(101)]);

    renderPage();
    await screen.findAllByText("SN-1000");

    // Page 1 full: the total is NOT known — «عرض N», never «إجمالاً».
    expect(screen.getByText(/عرض 100/)).toBeInTheDocument();
    expect(screen.getByText(/الأحدث أولاً/)).toBeInTheDocument();
    expect(screen.queryByText(/إجمالاً/)).not.toBeInTheDocument();

    const more = screen.getByRole("button", { name: "تحميل المزيد" });
    fireEvent.click(more);

    // The frozen contract: page 2 of the same limit, body stays a
    // plain array (the mock resolves one).
    await screen.findAllByText("SN-1100");
    expect((listAdminOrders as unknown as Mock).mock.calls[1][0]).toMatchObject({
      page: 2,
      limit: 100,
    });
    // Appended in place — page-1 rows survive the load-more.
    expect(screen.getAllByText("SN-1000").length).toBeGreaterThan(0);

    // The second page was SHORT (2 < 100) — the definite end.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "تحميل المزيد" })).not.toBeInTheDocument(),
    );
  });

  it("a short first page: total IS known (إجمالاً) and no load-more control renders", async () => {
    (listAdminOrders as unknown as Mock).mockResolvedValue([ORDER(0), ORDER(1)]);

    renderPage();
    await screen.findAllByText("SN-1000");

    expect(screen.getByText(/إجمالاً/).textContent).toContain("2");
    expect(screen.queryByRole("button", { name: "تحميل المزيد" })).not.toBeInTheDocument();
    // No "stats describe only the loaded page" disclosure needed when
    // the whole result set fits the page.
    expect(screen.queryByText(/الإحصاءات تعكس/)).not.toBeInTheDocument();
  });

  it("a capped list discloses that the stats describe the loaded page only", async () => {
    (listAdminOrders as unknown as Mock).mockResolvedValue(FULL_PAGE);

    renderPage();
    await screen.findAllByText("SN-1000");

    expect(screen.getByText(/الإحصاءات تعكس الطلبات المعروضة/)).toBeInTheDocument();
  });
});

describe("AdminOrdersPage — server-side search (A2 P2-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminOrders as unknown as Mock).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("the debounced input value reaches the query params as `search`", async () => {
    renderPage();

    const input = screen.getByPlaceholderText("بحث... ( / )");
    fireEvent.change(input, { target: { value: "SN-10" } });

    // 300ms debounce — one request per typing pause.
    await waitFor(
      () => {
        const lastCall = (listAdminOrders as unknown as Mock).mock.calls.at(-1);
        expect(lastCall?.[0]).toMatchObject({ search: "SN-10", page: 1, limit: 100 });
      },
      { timeout: 2000 },
    );
  });

  it("a GlobalSearch deep-link (?search=…) prefills the first request", async () => {
    window.history.replaceState({}, "", "/admin/orders?search=abc");

    renderPage();

    await waitFor(() => {
      const firstCall = (listAdminOrders as unknown as Mock).mock.calls[0];
      expect(firstCall?.[0]).toMatchObject({ search: "abc", page: 1 });
    });
  });
});
