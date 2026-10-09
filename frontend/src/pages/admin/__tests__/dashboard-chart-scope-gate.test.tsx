/**
 * R123 (E3 item 5) — dashboard chart payload scope gate.
 *
 * fetchChart ran UNCONDITIONALLY: canSeeMoney gated only the
 * rendering/export, so a non-finance operator's network tab received
 * the full daily revenue/discount series on every dashboard visit (the
 * endpoint is requireAdmin-only — the UI is the only honest gate, the
 * same premise as the R122 KPI gating).
 *
 * These tests pin the minimal fix at the FETCH level:
 *
 *   1. A finance admin's dashboard requests /api/admin/chart-data.
 *   2. A non-finance admin's dashboard NEVER requests it — no
 *      revenue/discount bytes leave the server for them at all — and
 *      the charts column hides entirely instead of rendering the
 *      misleading «لا توجد بيانات بعد» empty block for a scope gate.
 *
 * Module-boundary mocks follow admin-layout-alerts.test.tsx (the stats
 * + recent-orders generated hooks are stubbed; only fetchChart's raw
 * fetch rides the stubbed global — it answers `[]` so no recharts
 * surface mounts, keeping the test scoped to the gate).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminDashboardPage from "@/pages/admin/dashboard";
import { useGetAdminStats, useListAdminOrders } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useGetAdminStats: vi.fn(),
  useListAdminOrders: vi.fn(),
  getGetAdminStatsQueryKey: () => ["/api/admin/stats"],
  getListAdminOrdersQueryKey: (params?: unknown) => ["/api/admin/orders", params ?? null],
  setUnauthorizedHandler: vi.fn(),
}));

// R122 (A2-P2): the finance scope flips per test — the auth mock reads
// from hoisted mutable state (the admin-layout-alerts idiom).
const { authState } = vi.hoisted(() => ({
  authState: { finance: true } as Record<string, boolean>,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: (scope: string) => authState[scope] !== false,
  }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/components/admin/copilot/CopilotPanel", () => ({
  CopilotPanel: () => null,
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const STATS = {
  total_users: 17,
  total_orders: 5,
  total_revenue: 241.49,
  pending_topups: 0,
  today_orders: 0,
  today_revenue: 0,
  available_stock: 120,
  total_wallet_balance: 826,
};

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminDashboardPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminDashboardPage — the chart payload is finance-scoped at the FETCH level (R123 E3 item 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useGetAdminStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: STATS,
      isLoading: false,
      refetch: vi.fn(),
    });
    (useListAdminOrders as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // fetchChart's answer is an empty series — the honest no-data-yet
    // block renders (no recharts), keeping the test scoped to the gate.
    fetchMock.mockResolvedValue(resLike({ body: [] }));
    authState.finance = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a finance admin's dashboard requests the chart payload", async () => {
    renderPage();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/chart-data?days=7")),
      ).toBe(true);
    });
  });

  it("a non-finance admin's dashboard NEVER requests the chart payload (no revenue/discount bytes)", async () => {
    authState.finance = false;
    renderPage();

    // Positive signal the dashboard is alive: a non-money KPI tile
    // renders off the (mocked) stats subscription — «المخزون المتاح»
    // stays visible for every scope (R122 gating)…
    await waitFor(() => {
      expect(screen.getByText("المخزون المتاح")).toBeInTheDocument();
    });
    // …then give the gated fetch a beat to (not) fire.
    await new Promise((r) => setTimeout(r, 600));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/chart-data"))).toBe(
      false,
    );
    // The charts column hides entirely — the «لا توجد بيانات بعد»
    // empty block would present a scope gate as "no data".
    expect(screen.queryByText("لا توجد بيانات بعد")).not.toBeInTheDocument();
    expect(screen.queryByText("الإيرادات والطلبات")).not.toBeInTheDocument();
  });

  it("a finance admin's empty chart renders the honest no-data block (the gate is scope, not silence)", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("لا توجد بيانات بعد")).toBeInTheDocument();
    });
  });
});
