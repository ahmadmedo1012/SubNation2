// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the observability endpoints' response shapes (the six queries' T
// generics). The page and every admin/system extract import from here —
// one source for the backend contract; the move only changes its
// address, zero behavior change.

// ── Backend response shapes (mirror what the deployed API returns) ─────────
//
// 94-C2 (A2 P2-10): every «uppercase tracking-widest» on the Arabic
// metric/health labels below was removed (7 spots) — letter-spacing
// severs Arabic letter connections and uppercase is a no-op on Arabic
// anyway (rule A11 §8, documented in layout.tsx). Values keep their
// tabular-nums treatment; Latin/mono chips are untouched.

export interface DiagnosticsResponse {
  node: { version: string; platform: string; arch: string; pid: number };
  runtime: { uptimeSec: number; version: string; env: string; service: string };
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number };
  cpu: { userMs: number; systemMs: number };
  eventLoop: {
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  } | null;
  deps: { redis: { connected: boolean }; socket: { initialized: boolean } };
  flags: Record<string, string>;
}

export interface ObservabilitySummary {
  server: { version: string; uptimeSec: number; nodeVersion: string };
  redis: { available: boolean };
  worker: { heartbeat: { ageSec: number | null; ts: string | null } | null };
  alerts: { lastKnownGoodAt: string | null; stale: boolean; recentCount: number };
  dashboards: { render: string | null; sentry: string | null; neon: string | null };
}

export interface RecentAlert {
  id: number;
  type: string;
  title: string;
  message: string | null;
  createdAt: string;
}

export type SchedulerMode = "embedded" | "dedicated" | "single" | "disabled";

export interface SchedulerResponse {
  mode: SchedulerMode;
  active: boolean;
  isLeader: boolean;
  instanceId: string | null;
  reason: string;
  startedAt: string | null;
  heartbeat: {
    ageSec: number | null;
    ts: string | null;
    healthy: boolean;
    expected: boolean;
  };
  description: string;
}

export interface MetricsSnapshot {
  timestamp: string;
  uptimeSec: number;
  http: {
    totalRequests: number;
    requestsByStatusClass: Record<string, number>;
    errorRate: number;
    latency: {
      p50Ms: number | null;
      p95Ms: number | null;
      p99Ms: number | null;
      meanMs: number | null;
    };
    topRoutes: Array<{
      route: string;
      method: string;
      count: number;
      errorCount: number;
      p95Ms: number | null;
    }>;
  };
  auth: {
    outcomes: Record<string, number>;
    totalAttempts: number;
    failureRate: number;
  };
  redis: {
    available: boolean;
    opsTotal: Record<string, number>;
    errorsTotal: Record<string, number>;
    pingLatencyMs: { p50: number | null; p95: number | null; p99: number | null };
    degradedEvents: number;
  };
  socket: {
    connectedClients: number;
    eventsTotal: Record<string, number>;
  };
  worker: {
    jobsTotal: Record<string, number>;
  };
  cwv: { samples: Record<string, number>; p75: Record<string, number | null> };
  alerts: { dispatchedTotal: Record<string, number> };
  monitoringErrors: number;
}
