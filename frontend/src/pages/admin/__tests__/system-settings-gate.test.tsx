/**
 * R133 (A3-F4) — System page settings-scope gate + honest healthz failure.
 *
 * The page's six queries hit settings-scoped endpoints but mounted for ANY
 * authenticated admin: a scope-less deep-linker ate a synchronized 403
 * burst every poll cycle, and healthQ's catch-all mapped every failure —
 * 401/403 included — onto `{status:"degraded"}`, so an authorization
 * outcome rendered as an infrastructure verdict (the amber «أداء متدنٍ»
 * pill + amber tiles that looked like real readings).
 *
 * Pins:
 *   1. A settings-scope-less admin sees the honest-reason banner and
 *      fires NOTHING (no fetch, no customFetch).
 *   2. /healthz/ready answering 403 renders the FetchErrorCard — the
 *      fabricated «أداء متدنٍ» verdict is gone.
 *   3. The error card's retry refetches (recovery is one click away).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminSystemPage from "@/pages/admin/system";
import { customFetch } from "@workspace/api-client-react";

const authState: Record<string, boolean> = {};
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: (scope: string) => authState[scope] !== false,
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

vi.mock("@/hooks/useAdminHeaders", () => ({
  useAdminHeaders: () => ({ Authorization: "Bearer test-admin-token" }),
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

const DIAG_PAYLOAD = {
  node: { version: "v22", platform: "linux", arch: "arm64", pid: 1 },
  runtime: { uptimeSec: 10, version: "testsha", env: "test", service: "web" },
  memory: { rssMb: 1, heapUsedMb: 1, heapTotalMb: 2, externalMb: 0 },
  cpu: { userMs: 1, systemMs: 1 },
  eventLoop: null,
  deps: { redis: { connected: false }, socket: { initialized: false } },
  flags: {},
};

const SUMMARY_PAYLOAD = {
  server: { version: "testsha", uptimeSec: 10, nodeVersion: "v22" },
  redis: { available: false },
  worker: { heartbeat: null },
  alerts: { lastKnownGoodAt: null, stale: false, recentCount: 0 },
  dashboards: { render: null, sentry: null, neon: null },
};

const SCHEDULER_OK = {
  mode: "single",
  active: true,
  isLeader: true,
  instanceId: "single-instance-1",
  reason: "active",
  startedAt: "2026-09-22T00:00:00.000Z",
  heartbeat: { ageSec: null, ts: null, healthy: false, expected: false },
  description: "الجدولة أحادية الخادم نشطة.",
};

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminSystemPage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  (customFetch as unknown as Mock).mockImplementation((url: string) => {
    if (url === "/api/admin/diagnostics") return Promise.resolve(DIAG_PAYLOAD);
    if (url === "/api/admin/observability/summary") return Promise.resolve(SUMMARY_PAYLOAD);
    return Promise.resolve({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(authState)) delete authState[k];
});

describe("AdminSystemPage — settings-scope gate + honest healthz failure (A3-F4, R133)", () => {
  it("a settings-scope-less admin sees the honest-reason banner and fires NOTHING", async () => {
    authState.settings = false;

    renderPage();

    expect(
      await screen.findByText("مركز المراقبة يتطلب صلاحية الإعدادات — تواصل مع مسؤول النظام"),
    ).toBeInTheDocument();
    // The 403 burst is dead by construction — no query even started.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(customFetch).not.toHaveBeenCalled();
  });

  it("a 403 from /healthz/ready renders the honest error card — the fabricated «أداء متدنٍ» verdict is gone", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/healthz/ready") {
        return Promise.resolve(resLike({ ok: false, status: 403, body: { error: "forbidden" } }));
      }
      if (url === "/api/admin/observability/scheduler") {
        return Promise.resolve(resLike({ body: SCHEDULER_OK }));
      }
      if (url === "/api/admin/observability/alerts/recent") {
        return Promise.resolve(resLike({ body: { alerts: [], stale: false } }));
      }
      return Promise.resolve(resLike({ ok: false, status: 500, body: {} }));
    });

    renderPage();

    // The honest error card (NOT the silent degraded fallback). Scoped
    // to the health section — the system page renders OTHER error
    // fallbacks with their own retry buttons when their endpoints fail
    // (the metrics 500 here); the assertion is about THIS section.
    const section = (await screen.findByText("نظرة سريعة على الصحة")).closest("section");
    expect(section).not.toBeNull();
    // findBy — the query's rejection lands asynchronously after the
    // section header paints.
    expect(
      await within(section as HTMLElement).findByText("تعذّر تحميل حالة الصحة"),
    ).toBeInTheDocument();
    expect(
      within(section as HTMLElement).getByRole("button", { name: "إعادة المحاولة" }),
    ).toBeInTheDocument();
    // The old fabricated infrastructure verdict must NOT render — an
    // authorization outcome is not a health reading.
    expect(screen.queryByText("أداء متدنٍ")).not.toBeInTheDocument();
  });

  it("the error card's retry refetches /healthz/ready and recovers when the API answers", async () => {
    let readyCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/healthz/ready") {
        readyCalls += 1;
        // 500 — a server error (NOT 503, which is the real degraded
        // health verdict and stays parsed by design).
        if (readyCalls === 1) {
          return Promise.resolve(resLike({ ok: false, status: 500, body: { error: "boom" } }));
        }
        return Promise.resolve(
          resLike({ body: { status: "ok", checks: {}, version: "testsha", uptimeSec: 5 } }),
        );
      }
      if (url === "/api/admin/observability/scheduler") {
        return Promise.resolve(resLike({ body: SCHEDULER_OK }));
      }
      if (url === "/api/admin/observability/alerts/recent") {
        return Promise.resolve(resLike({ body: { alerts: [], stale: false } }));
      }
      return Promise.resolve(resLike({ ok: false, status: 500, body: {} }));
    });

    renderPage();

    // Scoped to the health section — the metrics 500 renders its own
    // retry elsewhere on the page; this test is the health card's.
    const section = (await screen.findByText("نظرة سريعة على الصحة")).closest("section");
    expect(section).not.toBeNull();
    const retry = await within(section as HTMLElement).findByRole("button", {
      name: "إعادة المحاولة",
    });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(readyCalls).toBeGreaterThanOrEqual(2);
    });
    // Recovered: the error card is gone and the health section renders
    // the real tiles (the aggregate pill with the ok verdict).
    await waitFor(() => {
      expect(screen.queryByText("تعذّر تحميل حالة الصحة")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("النظام يعمل")).toBeInTheDocument();
    });
  });
});

// ── R186 (fix-squad 2) ──────────────────────────────────────────────────────

/** A full /admin/observability/metrics snapshot value (the page's
 *  MetricsSnapshot contract) — carries the R186 telegram record so the
 *  F-F1 tile renders. */
const METRICS_PAYLOAD = {
  timestamp: "2026-09-22T00:00:00.000Z",
  uptimeSec: 60,
  http: {
    totalRequests: 100,
    requestsByStatusClass: { "2xx": 90, "3xx": 0, "4xx": 9, "5xx": 1, other: 0 },
    errorRate: 0.01,
    latency: { p50Ms: 10, p95Ms: 50, p99Ms: 90, meanMs: 20 },
    topRoutes: [],
  },
  auth: { outcomes: { "password:success": 5 }, totalAttempts: 5, failureRate: 0 },
  redis: {
    available: false,
    opsTotal: {},
    errorsTotal: {},
    pingLatencyMs: { p50: null, p95: null, p99: null },
    degradedEvents: 0,
  },
  socket: { connectedClients: 2, eventsTotal: {} },
  worker: { jobsTotal: { "session_prune:success": 4 } },
  cwv: { samples: {}, p75: {} },
  alerts: { dispatchedTotal: {} },
  telegram: { sendsTotal: { "order_new:failure": 3, "user_new:ok": 7 } },
  monitoringErrors: 0,
};

describe("AdminSystemPage — D-F4 (R186): a failed alerts load is an error, not a false empty state", () => {
  it("a 500 from /api/admin/observability/alerts/recent renders «تعذّر تحميل التنبيهات» — «لا توجد تنبيهات حديثة» must NOT render", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/healthz/ready") {
        return Promise.resolve(
          resLike({ body: { status: "ok", checks: {}, version: "testsha", uptimeSec: 5 } }),
        );
      }
      if (url === "/api/admin/observability/alerts/recent") {
        return Promise.resolve(resLike({ ok: false, status: 500, body: { error: "boom" } }));
      }
      if (url === "/api/admin/observability/scheduler") {
        return Promise.resolve(resLike({ body: SCHEDULER_OK }));
      }
      return Promise.resolve(resLike({ ok: false, status: 500, body: {} }));
    });

    renderPage();

    // Scoped to the alerts section — the metrics 500 renders its own
    // error surface elsewhere on the page (same scoping as the health
    // tests above).
    const section = (await screen.findByText("آخر التنبيهات")).closest("section");
    expect(section).not.toBeNull();
    expect(
      await within(section as HTMLElement).findByText("تعذّر تحميل التنبيهات"),
    ).toBeInTheDocument();
    // The false-empty verdict is gone — an outage is not "no alerts".
    expect(
      within(section as HTMLElement).queryByText("لا توجد تنبيهات حديثة"),
    ).not.toBeInTheDocument();
    // The retry is wired (recentAlertsQ.refetch flows down).
    expect(
      within(section as HTMLElement).getByRole("button", { name: "إعادة المحاولة" }),
    ).toBeInTheDocument();
  });

  it("the alerts error card's retry refetches the endpoint and recovers when it answers", async () => {
    let alertsCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/healthz/ready") {
        return Promise.resolve(
          resLike({ body: { status: "ok", checks: {}, version: "testsha", uptimeSec: 5 } }),
        );
      }
      if (url === "/api/admin/observability/alerts/recent") {
        alertsCalls += 1;
        if (alertsCalls === 1) {
          return Promise.resolve(resLike({ ok: false, status: 500, body: { error: "boom" } }));
        }
        return Promise.resolve(resLike({ body: { alerts: [], stale: false } }));
      }
      if (url === "/api/admin/observability/scheduler") {
        return Promise.resolve(resLike({ body: SCHEDULER_OK }));
      }
      return Promise.resolve(resLike({ ok: false, status: 500, body: {} }));
    });

    renderPage();

    const section = (await screen.findByText("آخر التنبيهات")).closest("section");
    expect(section).not.toBeNull();
    const retry = await within(section as HTMLElement).findByRole("button", {
      name: "إعادة المحاولة",
    });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(alertsCalls).toBeGreaterThanOrEqual(2);
    });
    // Recovered: the error card is gone; the (honest, now-real) empty
    // state renders instead.
    await waitFor(() => {
      expect(screen.queryByText("تعذّر تحميل التنبيهات")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("لا توجد تنبيهات حديثة")).toBeInTheDocument();
  });
});

describe("AdminSystemPage — F-F1 (R186): the Telegram delivery-outcome tile", () => {
  it("a snapshot carrying telegram.sendsTotal renders «إشعارات تيليجرام (آخر التسليمات)» with event:outcome → count rows", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/healthz/ready") {
        return Promise.resolve(
          resLike({ body: { status: "ok", checks: {}, version: "testsha", uptimeSec: 5 } }),
        );
      }
      if (url === "/api/admin/observability/metrics") {
        return Promise.resolve(
          resLike({
            body: { value: METRICS_PAYLOAD, lastKnownGoodAt: null, stale: false },
          }),
        );
      }
      if (url === "/api/admin/observability/alerts/recent") {
        return Promise.resolve(resLike({ body: { alerts: [], stale: false } }));
      }
      if (url === "/api/admin/observability/scheduler") {
        return Promise.resolve(resLike({ body: SCHEDULER_OK }));
      }
      return Promise.resolve(resLike({ ok: false, status: 500, body: {} }));
    });

    renderPage();

    // The tile (a native <details> in the advanced-diagnostics stack).
    const tile = (await screen.findByText("إشعارات تيليجرام (آخر التسليمات)")).closest("details");
    expect(tile).not.toBeNull();
    // The record rows: event (mono) + outcome + count — the
    // "deliveries stopped" cell is readable without the Prometheus
    // scrape (sorted desc → user_new:ok 7 first, order_new:failure 3).
    expect(within(tile as HTMLElement).getByText("order_new")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("failure")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("3")).toBeInTheDocument();
    expect(within(tile as HTMLElement).getByText("user_new")).toBeInTheDocument();
  });
});
