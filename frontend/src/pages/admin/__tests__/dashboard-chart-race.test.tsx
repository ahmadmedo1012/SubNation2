/**
 * R125-I2 (A5-F1 / A1-3 / A1-4 / A6-B10) — the dashboard chart race,
 * the refresh double-fire, and the picker chip semantics.
 *
 * fetchChart was a plain un-ordered `fetch`: two rapid period flips
 * (7d → 90d) left two requests in flight, and a slow OLD response
 * landing after the new one silently fed the KPI Sparklines /
 * TrendBadge / new-users-today tile the wrong period's series (A1
 * finding 3's deepened blast radius) while its `.finally` cleared
 * chartLoading early (fake-idle skeleton gap — A5-F8). Every call now
 * aborts the previous controller and every state write (incl. the
 * finally) is guarded — last call wins (the GlobalSearch recipe,
 * layout.tsx's 94-C2 A2 P2-3 abort idiom).
 *
 * These tests pin (A10 §C rows 9, 13, and the dashboard half of 17):
 *
 *   1. A late 7d response landing AFTER the 90d one is DROPPED — the
 *      rendered series + the new-users-today tile keep the 90d data,
 *      and the period chips agree (aria-pressed follows the selection).
 *   2. The aborted fetch's rejection is not a chart error (no banner)
 *      and its finally does NOT fake-idle the loading state while the
 *      newer request is still in flight.
 *   3. handleRefresh fires exactly ONE /admin/stats request per click
 *      (the manual `refetch()` is gone — the R124-A6 F11 orders class,
 *      now pinned where orders never was).
 *   4. Both chip pickers are named groups whose chips expose
 *      aria-pressed (A6-B10 / A1-6).
 *
 * recharts is MOCKED (the lazy boundary resolves to the mock without
 * loading the 400 KB vendor): the chart components surface their
 * `data` bucket count as a data attribute so "which period's series is
 * rendered" is assertable without SVG internals.
 *
 * R127-L1 (B1 §3.1): the chart series rides the REAL useGetAdminChartData
 * now (importActual spread — only the stats/orders hooks stay stubbed),
 * so customFetch parses the deferred d7/d90 stubs (resLike carries the
 * headers/text() it needs) and the race pins the RQ-structural
 * last-wins: days sits in the queryKey, a chip flip swaps queries, and
 * the stale response can only land in the OLD key's cache.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminDashboardPage from "@/pages/admin/dashboard";
import { useGetAdminStats, useListAdminOrders } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  // R127-L1 (B1 §3.1 importActual-spread idiom): ONLY the stats + orders
  // hooks stay stubbed — the REAL useGetAdminChartData /
  // getGetAdminChartDataQueryKey / customFetch run against the stubbed
  // global fetch so the chart race + single-fire pins stay fetch-level.
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return { ...actual, useGetAdminStats: vi.fn(), useListAdminOrders: vi.fn() };
});

// R125-I2: the recharts mock — the dashboard's ONLY runtime reference
// is the lazy ChartsLoader's dynamic import(); vi.mock intercepts it,
// so the Suspense boundary resolves to these trivially-renderable
// stand-ins (no 400 KB vendor, no jsdom measurement). Each chart
// surfaces its bucket count for the last-wins assertions.
vi.mock("recharts", () => {
  const chartStub = (testId: string) =>
    function ChartStub({ data }: { data?: unknown[] }) {
      return <div data-testid={testId} data-points={data?.length ?? 0} />;
    };
  return {
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    LineChart: chartStub("spark-chart"),
    Line: () => null,
    AreaChart: chartStub("area-chart"),
    Area: () => null,
    BarChart: chartStub("bar-chart"),
    Bar: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
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

// R125-I2 (A1-4): the refresh button lives in AdminLayout — the stub
// EXPOSES the page-passed onRefresh as a real button so the
// single-fire test can click it.
vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children, onRefresh }: { children?: ReactNode; onRefresh?: () => void }) => (
    <div>
      {onRefresh && (
        <button type="button" onClick={onRefresh}>
          refresh-trigger
        </button>
      )}
      {children}
    </div>
  ),
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

/** A days-long series ending `lastUsers` new users TODAY (the tile's
 * newUsersToday reads the LAST bucket — the 90d/7d discriminators are
 * distinct so a stale landing is visible in text, not just pixels).
 * R125 fix (parent): dates are minted by REAL date arithmetic — the
 * original `2026-07-${i+1}` template emitted 2026-07-32…90 (invalid),
 * and aggregateData's weekly bucketing collapsed all 59 invalid dates
 * into a single "Invalid Date" bucket (5 valid weeks + 1 = 6 points,
 * not the ~13 the >7 assertions expect). */
function series(days: number, lastUsers: number) {
  const start = new Date("2026-07-01T00:00:00.000Z");
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      orders: 1,
      revenue: 10,
      users: i === days - 1 ? lastUsers : 0,
      discounts: 0,
      coupon_orders: 0,
    };
  });
}

const fetchMock = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

describe("AdminDashboardPage — chart fetch race (A5-F1 / A1-3)", () => {
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
    authState.finance = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a late 7d response landing after the 90d one is dropped — the series, the tile and the chips all agree (last call wins)", async () => {
    const d7 = deferred<Response>();
    const d90 = deferred<Response>();
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("days=7")) return d7.promise;
      if (url.includes("days=90")) return d90.promise;
      return Promise.resolve(resLike({ body: [] }));
    });

    renderPage();

    // The initial 7d request is in flight (NOT resolved).
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/chart-data?days=7")),
      ).toBe(true),
    );

    // Flip to 90 days — the key swap makes the 7d query inactive and a
    // 90d fetch starts (R127-L1: days sits in the queryKey).
    fireEvent.click(screen.getByRole("button", { name: "3 أشهر" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/chart-data?days=90")),
      ).toBe(true),
    );

    // The NEW period lands first: 90 buckets of daily data (weekly
    // granularity auto-activates for 90d → ~13 buckets, rendered on
    // every chart surface) + the users tile reads the 90d last bucket
    // (1 → «مستخدم جديد اليوم»).
    d90.resolve(resLike({ body: series(90, 1) }));
    // formatCount prefixes the digit ("1 مستخدم جديد") — the tile's
    // full sub-line is "1 مستخدم جديد اليوم".
    const usersTile = await screen.findByText("1 مستخدم جديد اليوم");
    expect(usersTile).toBeInTheDocument();
    await waitFor(() => {
      const charts = screen.getAllByTestId("bar-chart");
      // data-points is a string attribute — coerce before comparing.
      for (const c of charts) expect(Number(c.dataset.points)).toBeGreaterThan(7);
    });

    // The SLOW 7d response resolves LAST — it must be dropped: the
    // R127-L1 flip makes this structural — the response lands in the
    // OLD key's cache; the rendered 90d series + the 7d last-bucket
    // (5 → «مستخدمين جدد اليوم») never reach the display.
    d7.resolve(resLike({ body: series(7, 5) }));
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByText("5 مستخدمين جدد اليوم")).not.toBeInTheDocument();
    for (const c of screen.getAllByTestId("bar-chart")) {
      expect(Number(c.dataset.points)).toBeGreaterThan(7);
    }

    // The chips agree with the rendered series (A6-B10 / A1-6).
    expect(screen.getByRole("button", { name: "3 أشهر" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "7 أيام" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("the aborted fetch's rejection is not a chart error and its finally does not fake-idle the loading state", async () => {
    const d7 = deferred<Response>();
    const d90 = deferred<Response>();
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("days=7")) return d7.promise;
      if (url.includes("days=90")) return d90.promise;
      return Promise.resolve(resLike({ body: [] }));
    });

    const { container } = renderPage();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/chart-data?days=7")),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "3 أشهر" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/chart-data?days=90")),
      ).toBe(true),
    );

    // The in-flight 7d request REJECTS (under the flip, RQ's key swap
    // abandons the 7d query — the manual reject below stands in for the
    // runtime's abort rejection and settles the in-flight promise
    // either way). Guarded: no error banner on the ACTIVE display, and
    // the loading skeleton STAYS (isFetching belongs to the ACTIVE
    // 90d key only — the honest «لا توجد بيانات بعد» empty block
    // cannot render while the 90d request is still in flight).
    d7.reject(new DOMException("The user aborted a request.", "AbortError"));
    await new Promise((r) => setTimeout(r, 150));
    expect(
      screen.queryByText("تعذّر تحميل بيانات الرسوم البيانية — تحقّق من الشبكة ثم أعد المحاولة"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("لا توجد بيانات بعد")).not.toBeInTheDocument();
    expect(container.querySelector(".skeleton-shimmer")).not.toBeNull();

    // The 90d data lands and the section completes normally.
    d90.resolve(resLike({ body: series(90, 1) }));
    await waitFor(() => expect(screen.getByText("1 مستخدم جديد اليوم")).toBeInTheDocument());
    expect(
      screen.queryByText("تعذّر تحميل بيانات الرسوم البيانية — تحقّق من الشبكة ثم أعد المحاولة"),
    ).not.toBeInTheDocument();
  });
});

describe("AdminDashboardPage — handleRefresh single-fire (A1-4 / A10 pin 13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.finance = true;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("one refresh click sends exactly ONE /admin/stats request (invalidateQueries is the single source of truth)", async () => {
    // The stats hook runs a REAL query on the stubbed global fetch so
    // the request COUNT is observable (the module-boundary mock only
    // shapes the hook surface; invalidateQueries refetches this query).
    let statsFetches = 0;
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/stats")) {
        statsFetches += 1;
        return Promise.resolve(resLike({ body: STATS }));
      }
      // chart-data answers an empty series — no chart surfaces mount.
      return Promise.resolve(resLike({ body: [] }));
    });
    (useGetAdminStats as unknown as Mock).mockImplementation(() =>
      useQuery({
        queryKey: ["/api/admin/stats"],
        queryFn: () => fetch("/api/admin/stats").then((r) => r.json()),
        retry: false,
      }),
    );
    (useListAdminOrders as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // The mount fetch.
    await waitFor(() => expect(statsFetches).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "refresh-trigger" }));

    // The refresh adds EXACTLY one request — the old `refetch()` +
    // `invalidateQueries` pair fired two identical /admin/stats
    // requests per click (the R124-A6 F11 orders class).
    await waitFor(() => expect(statsFetches).toBe(2));
    await new Promise((r) => setTimeout(r, 200));
    expect(statsFetches).toBe(2);

    // R127-L1 (B1 §3.1): the chart single-fire pin — handleRefresh
    // invalidates the chart base key (one mount fetch + one refresh
    // refetch, never two per click).
    const chartFetches = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/admin/chart-data"),
    ).length;
    expect(chartFetches).toBe(2);
  });
});

describe("AdminDashboardPage — chart picker chip semantics (A6-B10 / A1-6)", () => {
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
    fetchMock.mockResolvedValue(resLike({ body: [] }));
    authState.finance = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("both pickers are named groups and every chip exposes aria-pressed matching its visual state", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("لا توجد بيانات بعد")).toBeInTheDocument());

    // Unlabeled button groups are silent to screen readers — both
    // pickers now carry role="group" + aria-label (A6-B10).
    expect(screen.getByRole("group", { name: "دقة المخطط الزمني" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "الفترة الزمنية للمخطط" })).toBeInTheDocument();

    const daily = screen.getByRole("button", { name: "يومي" });
    const weekly = screen.getByRole("button", { name: "أسبوعي" });
    expect(daily.getAttribute("aria-pressed")).toBe("true");
    expect(weekly.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(weekly);
    expect(weekly.getAttribute("aria-pressed")).toBe("true");
    expect(daily.getAttribute("aria-pressed")).toBe("false");
  });
});
