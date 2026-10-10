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
 *   3. (R127-L11, B2 §D.3) A non-finance admin's dashboard also NEVER
 *      requests /api/admin/stats — the R126 zombie-polling close
 *      (enabled: adminToken && canSeeMoney) had a direct pin only for
 *      the chart query and the layout's stats instance, never for the
 *      dashboard's own stats observer (a scoped session 403-polling
 *      every 5 min).
 *
 * Module-boundary mocks follow admin-layout-alerts.test.tsx — R127-L1
 * (B1 §3.1): the importActual spread keeps only the stats/orders hooks
 * stubbed, so the REAL useGetAdminChartData runs against the stubbed
 * global fetch (the gate is pinned at the fetch level: `enabled: false`
 * sends no bytes at all — exactly the R123 zero-bytes contract).
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminDashboardPage from "@/pages/admin/dashboard";
import { useGetAdminStats, useListAdminOrders } from "@workspace/api-client-react";

// B2 §D.3 (R127-L11): the REAL useGetAdminStats is captured here so the
// stats-gate test can restore it per-test — the file-level mockReturnValue
// bypasses `enabled` entirely (a mocked hook never reaches react-query, so
// it can fetch nothing), and the zombie-polling close can only be pinned
// with the real hook running against the stubbed global fetch. Holder is an
// OBJECT (not destructured) so the vi.mock factory can assign into it.
const apiReactReal = vi.hoisted(() => ({
  useGetAdminStats:
    undefined as unknown as (typeof import("@workspace/api-client-react"))["useGetAdminStats"],
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  // R127-L1 (B1 §3.1 importActual-spread idiom): only the stats +
  // orders hooks stay stubbed — the REAL useGetAdminChartData runs
  // against the stubbed global fetch so the scope gate keeps its
  // fetch-level assertion surface.
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  apiReactReal.useGetAdminStats = actual.useGetAdminStats;
  return { ...actual, useGetAdminStats: vi.fn(), useListAdminOrders: vi.fn() };
});

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
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body ?? null)),
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

/**
 * R128-IMP-4 (B5-4): deterministic negative-window settle — the
 * b0a9267 fake-timer idiom (referrals-search-race /
 * topups-queue-search), SCOPED to the window: fake the clock, drain
 * microtasks (any pending observer/effect chain runs until its
 * macrotask lands on the FAKE clock), advance the original real-sleep
 * margin (anything the window was meant to catch fires
 * deterministically — a loaded 2-CPU runner can no longer stretch the
 * window into a false green), drain again, restore real timers. The
 * waitFor/findBy phases before stay on real timers.
 */
async function settleWindow(ms: number) {
  vi.useFakeTimers();
  try {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  } finally {
    vi.useRealTimers();
  }
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
    // The chart query's answer is an empty series — the honest
    // no-data-yet block renders (no recharts), keeping the test scoped
    // to the gate (resLike carries the headers/text() the REAL
    // customFetch parses with — R127-L1).
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
    // R128-IMP-4 (B5-4): real 600ms sleep → deterministic settleWindow.
    await settleWindow(600);
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

  it("a non-finance admin's dashboard NEVER requests /api/admin/stats either (R126 zombie-polling close, B2 §D.3)", async () => {
    // The stats query's `enabled: !!adminToken && canSeeMoney` gate
    // (dashboard.tsx ~:434) mirrors the chart gate below it, but only
    // the chart side + the LAYOUT's stats instance were pinned. Here
    // the REAL stats hook is restored (mockImplementation over the
    // beforeEach mockReturnValue) so `enabled: false` is exercised by
    // react-query itself: a disabled observer sends no bytes — the
    // exact zero-bytes contract the chart test above pins for
    // chart-data, now for the 5-min stats poll a scoped support/admin
    // session used to fire into a guaranteed 403.
    (useGetAdminStats as ReturnType<typeof vi.fn>).mockImplementation(
      apiReactReal.useGetAdminStats,
    );
    authState.finance = false;
    renderPage();

    // Positive signal the dashboard is alive: the recent-orders stream's
    // section header renders off the (mocked) orders subscription — the
    // gate is the stats observer, not a dead page.
    await waitFor(() => {
      expect(screen.getByText("آخر الطلبات")).toBeInTheDocument();
    });
    // …then give both gated fetches a beat to (not) fire.
    // R128-IMP-4 (B5-4): real 600ms sleep → deterministic settleWindow.
    await settleWindow(600);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/stats"))).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/chart-data"))).toBe(
      false,
    );
  });
});
