/**
 * R108 (final-hardening FH-A1 §9.8.5) — System page scheduler banner,
 * SINGLE_INSTANCE_MODE shape.
 *
 * The admin System page (system.tsx) derives its scheduler banner from
 * GET /api/admin/observability/scheduler. R108 adds the "single" mode
 * (SINGLE_INSTANCE_MODE=true — the Oracle/Coolify single-container
 * target) and fixes the backend's no-Redis heartbeat expectation
 * (FH-A1 P2 F4): with REDIS_URL unset the backend now answers
 * `heartbeat.expected === false` + a note, so the banner must read
 * healthy instead of a permanent "stale heartbeat" degradation.
 *
 * Pins:
 *   1. single + active + expected:false → ok tone: title
 *      «الجدولة أحادية الخادم نشطة», NO stale-heartbeat warning;
 *   2. embedded + active + expected:false (the F4-fixed no-Redis
 *      production shape) → «الجدولة المضمّنة نشطة», no stale warning;
 *   3. single + Redis present + genuinely stale heartbeat
 *      (expected:true, healthy:false) → the degraded branch DOES fire —
 *      the "ok by definition" reading must not swallow a real finding.
 *
 * The page's fetch surface is mocked at the module boundary
 * (customFetch) + global fetch per the users-wallet-confirm pattern;
 * the admin shell, auth and header hook are stubbed.
 */

import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminSystemPage from "@/pages/admin/system";
import { customFetch } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/hooks/use-admin-headers", () => ({
  useAdminHeaders: () => ({ Authorization: "Bearer test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

/** The R108 single-mode scheduler payload (no-Redis production shape). */
function singleModeScheduler(heartbeat: Record<string, unknown>) {
  return {
    mode: "single",
    active: true,
    isLeader: true,
    instanceId: "single-instance-1",
    reason: "active",
    startedAt: "2026-09-22T00:00:00.000Z",
    heartbeat: {
      ageSec: null,
      ts: null,
      healthy: false,
      expected: false,
      note: "no Redis — heartbeat inert by design",
      ...heartbeat,
    },
    description:
      "الجدولة أحادية الخادم نشطة (SINGLE_INSTANCE_MODE — بلا انتخاب قائد أو نبضة إيجاز؛ مهام الجدولة تعمل داخل هذه العملية وحدها).",
  };
}

/** Minimal Response-like object — the resLike pattern. */
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

const fetchMock = vi.fn();

function installFetchSchedulerPayload(schedulerBody: unknown) {
  fetchMock.mockImplementation((url: string) => {
    if (url === "/api/healthz/ready") {
      return Promise.resolve(resLike({ body: { status: "ok", checks: {} } }));
    }
    if (url === "/api/admin/observability/scheduler") {
      return Promise.resolve(resLike({ body: schedulerBody }));
    }
    if (url === "/api/admin/observability/alerts/recent") {
      return Promise.resolve(resLike({ body: { alerts: [], stale: false } }));
    }
    // metrics: fail → the charts/metrics panels render their honest
    // fallbacks; only the scheduler banner is under test here.
    return Promise.resolve(resLike({ ok: false, status: 500, body: {} }));
  });
}

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
});

describe("AdminSystemPage — scheduler banner, R108 single mode (FH-A1 §9.8.5)", () => {
  it("single + active + expected:false → ok tone, أحادية title, NO stale-heartbeat warning", async () => {
    installFetchSchedulerPayload(singleModeScheduler({}));
    renderPage();

    // The ok-branch title (renders in the scheduler details section).
    expect(await screen.findByText("الجدولة أحادية الخادم نشطة")).toBeInTheDocument();

    // NO stale-heartbeat degradation in any variant: the single-mode
    // stale title, the shared "متأخرة" wording and the embedded-mode
    // never-registered message must all stay absent — with the R108
    // backend contract (expected:false + note) the banner is ok.
    expect(
      screen.queryByText("الجدولة أحادية الخادم تعمل لكن النبضة متأخرة"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/متأخرة/)).not.toBeInTheDocument();
    expect(screen.queryByText(/النبضة لم تُسجَّل/)).not.toBeInTheDocument();

    // The description (with the SINGLE_INSTANCE_MODE marker) renders.
    expect(screen.getByText(/SINGLE_INSTANCE_MODE/)).toBeInTheDocument();
  });

  it("F4 chain pin: embedded + active + expected:false (no-Redis shape) → embedded-active title, no stale warning", async () => {
    // The exact payload the R108 backend emits for an embedded elected
    // leader without REDIS_URL (heartbeatExpected now requires a Redis
    // client). Pre-R108 the backend sent expected:true here and this
    // page was permanently degraded.
    installFetchSchedulerPayload({
      mode: "embedded",
      active: true,
      isLeader: true,
      instanceId: "web-1",
      reason: "active",
      startedAt: "2026-09-22T00:00:00.000Z",
      heartbeat: {
        ageSec: null,
        ts: null,
        healthy: false,
        expected: false,
        note: "no Redis — heartbeat inert by design",
      },
      description: "الجدولة المضمّنة تعمل في عملية الخادم (لا توجد خدمة worker مستقلة).",
    });
    renderPage();

    expect(await screen.findByText("الجدولة المضمّنة نشطة")).toBeInTheDocument();
    expect(screen.queryByText("الجدولة المضمّنة تعمل لكن النبضة متأخرة")).not.toBeInTheDocument();
    expect(screen.queryByText(/النبضة لم تُسجَّل/)).not.toBeInTheDocument();
  });

  it("single + Redis present + genuinely stale heartbeat → the degraded branch still fires", async () => {
    // With Redis, single mode DOES run the heartbeat — expected:true +
    // healthy:false is a real finding that must surface (guard against
    // an over-broad "single mode is always ok" reading).
    installFetchSchedulerPayload(
      singleModeScheduler({ expected: true, healthy: false, ageSec: 120 }),
    );
    renderPage();

    // Degraded tone renders the title in BOTH the critical banner and
    // the scheduler details section — at least the banner must carry it.
    const titled = await screen.findAllByText("الجدولة أحادية الخادم تعمل لكن النبضة متأخرة");
    expect(titled.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/آخر نبضة قبل 120ث/).length).toBeGreaterThanOrEqual(1);
  });
});
