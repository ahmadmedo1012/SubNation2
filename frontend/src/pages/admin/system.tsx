import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  Flag,
  HeartPulse,
  Inbox,
  KeyRound,
  Layers,
  MemoryStick,
  Network,
  Radio,
  Server,
  ShieldCheck,
  TimerReset,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Link, useLocation } from "wouter";
import { AdminLayout } from "./layout";

// ── Backend response shapes (mirror what the deployed API returns) ─────────

import {
  fetchHealthzReady,
  type CheckStatus,
  type HealthCheck,
  type HealthzReadyResponse,
} from "@/lib/healthz";

// Re-export the shared types under their existing local names so the rest
// of this large file's prop signatures remain unchanged.
export type { CheckStatus, HealthCheck, HealthzReadyResponse };

interface DiagnosticsResponse {
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

interface ObservabilitySummary {
  server: { version: string; uptimeSec: number; nodeVersion: string };
  redis: { available: boolean };
  worker: { heartbeat: { ageSec: number | null; ts: string | null } | null };
  alerts: { lastKnownGoodAt: string | null; stale: boolean; recentCount: number };
  dashboards: { render: string | null; sentry: string | null; neon: string | null };
}

interface RecentAlert {
  id: number;
  type: string;
  title: string;
  message: string | null;
  createdAt: string;
}

type SchedulerMode = "embedded" | "dedicated" | "disabled";

interface SchedulerResponse {
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

interface MetricsSnapshot {
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

// ── Visual helpers (reuse existing design tokens) ──────────────────────────

const STATUS_META: Record<
  CheckStatus,
  { color: string; bg: string; border: string; label: string; icon: typeof CheckCircle2 }
> = {
  ok: {
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
    label: "متاح",
    icon: CheckCircle2,
  },
  degraded: {
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/20",
    label: "متدنٍ",
    icon: AlertTriangle,
  },
  failing: {
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/20",
    label: "خلل",
    icon: XCircle,
  },
};

const SERVICE_LABELS: Record<string, { label: string; icon: typeof Database }> = {
  redis: { label: "Redis", icon: Database },
  neon: { label: "قاعدة البيانات", icon: Database },
  worker: { label: "Worker", icon: HeartPulse },
  socket: { label: "Socket.IO", icon: Wifi },
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  if (m > 0) return `${m}د ${s}ث`;
  return `${s}ث`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v < 1) return "<1ms";
  if (v < 1000) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(2)}s`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function HealthPill({
  service,
  check,
}: {
  service: string;
  check: HealthCheck;
}): ReactElement {
  const meta = STATUS_META[check.status];
  const svc = SERVICE_LABELS[service] ?? { label: service, icon: Server };
  const Icon = svc.icon;
  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${meta.bg} ${meta.border}`}
      title={check.error ?? `مدة الاستجابة: ${check.latencyMs ?? "?"}ms`}
    >
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.bg}`}>
        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold leading-none">{svc.label}</div>
        <div className={`text-[10px] mt-0.5 ${meta.color}`}>
          {meta.label}
          {check.latencyMs != null && (
            <span className="text-muted-foreground"> · {check.latencyMs}ms</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "text-foreground",
  bg = "bg-muted/30",
  border = "border-border/60",
  spark,
  sparkColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Server;
  color?: string;
  bg?: string;
  border?: string;
  spark?: number[];
  sparkColor?: string;
}): ReactElement {
  return (
    <div className={`bg-card border ${border} rounded-2xl p-4 flex flex-col`}>
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className={`w-8 h-8 ${bg} border ${border} rounded-xl flex items-center justify-center shrink-0`}
        >
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div className="font-black text-lg leading-none tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
      {spark && spark.length >= 2 && (
        <div className="mt-2 -mx-1 opacity-70">
          <ResponsiveContainer width="100%" height={28}>
            <LineChart
              data={spark.map((v, i) => ({ i, v }))}
              margin={{ top: 1, right: 1, left: 1, bottom: 1 }}
            >
              <Line
                type="monotone"
                dataKey="v"
                stroke={sparkColor ?? "currentColor"}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Client-side rolling buffer ─────────────────────────────────────────────
//
// Keep the last 30 minutes of poll snapshots in memory so we can render
// sparklines + trend deltas without standing up a TSDB. 15 s polling × 120
// samples = 30 min window. Browsers' V8 holds this cheaply (~12 KB).

interface MetricsSample {
  ts: number;
  totalRequests: number;
  errors5xx: number;
  p95Ms: number | null;
  authFailures: number;
  redisOps: number;
  redisErrors: number;
  socketClients: number;
  eventLoopP99Ms: number | null;
  memoryRssMb: number | null;
}

const MAX_SAMPLES = 120; // 30 min @ 15 s polling

function deriveDelta(samples: MetricsSample[], pick: (s: MetricsSample) => number): number[] {
  if (samples.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].ts - samples[i - 1].ts) / 1000;
    if (dt <= 0) {
      out.push(0);
      continue;
    }
    const dv = pick(samples[i]) - pick(samples[i - 1]);
    out.push(Math.max(0, dv / dt)); // counters never decrease in normal flow
  }
  return out;
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminSystemPage(): ReactElement | null {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  // Existing queries (unchanged) ───────────────────────────────────────────

  const healthQ = useQuery<HealthzReadyResponse>({
    queryKey: ["healthz-ready"],
    queryFn: fetchHealthzReady,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  });

  const diagQ = useQuery<DiagnosticsResponse>({
    queryKey: ["admin-diagnostics"],
    queryFn: () => fetch("/api/admin/diagnostics", { headers }).then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!adminToken,
  });

  const summaryQ = useQuery<ObservabilitySummary>({
    queryKey: ["admin-observability-summary"],
    queryFn: () =>
      fetch("/api/admin/observability/summary", { headers }).then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!adminToken,
  });

  const recentAlertsQ = useQuery<{ alerts: RecentAlert[]; stale: boolean }>({
    queryKey: ["admin-observability-alerts-recent"],
    queryFn: () =>
      fetch("/api/admin/observability/alerts/recent", { headers }).then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!adminToken,
  });

  // New queries ────────────────────────────────────────────────────────────

  const metricsQ = useQuery<MetricsSnapshot>({
    queryKey: ["admin-observability-metrics"],
    queryFn: () =>
      fetch("/api/admin/observability/metrics", { headers }).then((r) => r.json()),
    refetchInterval: 15_000,
    staleTime: 7_000,
    enabled: !!adminToken,
  });

  const schedulerQ = useQuery<SchedulerResponse>({
    queryKey: ["admin-observability-scheduler"],
    queryFn: () =>
      fetch("/api/admin/observability/scheduler", { headers }).then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: !!adminToken,
  });

  // Rolling buffer ─────────────────────────────────────────────────────────

  const samplesRef = useRef<MetricsSample[]>([]);
  useEffect(() => {
    if (!metricsQ.data || !diagQ.data) return;
    const m = metricsQ.data;
    const d = diagQ.data;
    const sample: MetricsSample = {
      ts: Date.now(),
      totalRequests: m.http.totalRequests,
      errors5xx: m.http.requestsByStatusClass["5xx"] ?? 0,
      p95Ms: m.http.latency.p95Ms,
      authFailures: Object.entries(m.auth.outcomes)
        .filter(([k]) => k.endsWith(":failure") || k.endsWith(":lockout"))
        .reduce((a, [, v]) => a + v, 0),
      redisOps: Object.values(m.redis.opsTotal).reduce((a, b) => a + b, 0),
      redisErrors: Object.values(m.redis.errorsTotal).reduce((a, b) => a + b, 0),
      socketClients: m.socket.connectedClients,
      eventLoopP99Ms: d.eventLoop?.p99Ms ?? null,
      memoryRssMb: d.memory?.rssMb ?? null,
    };
    const buf = samplesRef.current;
    // Skip exact-duplicate samples (re-renders without new poll)
    const last = buf[buf.length - 1];
    if (last && last.ts === sample.ts) return;
    buf.push(sample);
    if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
  }, [metricsQ.data, diagQ.data]);

  if (!adminToken) {
    navigate("/admin/login");
    return null;
  }

  const handleRefresh = () => {
    healthQ.refetch();
    diagQ.refetch();
    summaryQ.refetch();
    recentAlertsQ.refetch();
    metricsQ.refetch();
    schedulerQ.refetch();
  };

  const health = healthQ.data;
  const diag = diagQ.data;
  const summary = summaryQ.data;
  const recentAlerts = recentAlertsQ.data?.alerts ?? [];
  const metrics = metricsQ.data;
  const scheduler = schedulerQ.data;

  const aggregate = health?.status ?? "degraded";
  const aggregateMeta = STATUS_META[aggregate];

  // Derived series for sparklines (last 60 samples = 15 min @ 15 s)
  const samples = samplesRef.current.slice(-60);
  const reqRate = deriveDelta(samples, (s) => s.totalRequests);
  const errRate = deriveDelta(samples, (s) => s.errors5xx);
  const authFailRate = deriveDelta(samples, (s) => s.authFailures);
  const redisOpsRate = deriveDelta(samples, (s) => s.redisOps);
  const p95Series = samples.map((s) => s.p95Ms ?? 0);
  const eventLoopSeries = samples.map((s) => s.eventLoopP99Ms ?? 0);
  const memorySeries = samples.map((s) => s.memoryRssMb ?? 0);

  // Filter health checks to skip the misleading "worker" tile when in
  // embedded mode — the new Scheduler panel below is the authoritative
  // surface for that. We still render redis/neon/socket from /healthz/ready.
  const filteredChecks = health
    ? Object.fromEntries(
        Object.entries(health.checks).filter(
          ([k]) =>
            // Drop "worker" — replaced by the embedded-scheduler panel below.
            // Keep all other checks (redis, neon, socket, future ones).
            k !== "worker",
        ),
      )
    : {};

  // ── Scheduler banner state ───────────────────────────────────────────────

  let schedTone: CheckStatus = "ok";
  let schedTitle = "حالة الجدولة";
  let schedMessage = "";

  if (!scheduler) {
    schedTone = "degraded";
    schedTitle = "حالة الجدولة";
    schedMessage = "جارٍ التحميل...";
  } else if (scheduler.mode === "embedded" && scheduler.active) {
    if (scheduler.heartbeat.expected && !scheduler.heartbeat.healthy) {
      schedTone = "degraded";
      schedTitle = "الجدولة المضمّنة تعمل لكن النبضة متأخرة";
      schedMessage =
        scheduler.heartbeat.ageSec === null
          ? "النبضة لم تُسجَّل بعد منذ الإقلاع — قد تستغرق ~30ث."
          : `آخر نبضة قبل ${scheduler.heartbeat.ageSec}ث (المتوقع <60ث).`;
    } else {
      schedTone = "ok";
      schedTitle = "الجدولة المضمّنة نشطة";
      schedMessage = scheduler.description;
    }
  } else if (scheduler.mode === "embedded" && !scheduler.active) {
    schedTone = "degraded";
    schedTitle = "الجدولة المضمّنة في وضع الانتظار";
    schedMessage = scheduler.description;
  } else if (scheduler.mode === "dedicated") {
    if (scheduler.heartbeat.healthy) {
      schedTone = "ok";
      schedTitle = "خدمة worker مستقلة نشطة";
      schedMessage = `آخر نبضة قبل ${scheduler.heartbeat.ageSec}ث.`;
    } else {
      schedTone = "failing";
      schedTitle = "خدمة worker المستقلة لا تستجيب";
      schedMessage =
        scheduler.heartbeat.ageSec === null
          ? "لا توجد نبضة من خدمة worker — تحقق من تشغيلها."
          : `آخر نبضة قبل ${scheduler.heartbeat.ageSec}ث (المتوقع <60ث).`;
    }
  } else {
    schedTone = "degraded";
    schedTitle = "الجدولة معطّلة";
    schedMessage = scheduler.description;
  }
  const schedMeta = STATUS_META[schedTone];

  return (
    <AdminLayout onRefresh={handleRefresh}>
      <div className="space-y-6 page-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-black flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              مركز المراقبة
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              مقاييس الأداء، الطلبات، المصادقة، Redis، الجدولة، والتنبيهات — تحديث تلقائي كل 15ث
            </p>
          </div>
          {health && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${aggregateMeta.bg} ${aggregateMeta.border}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  aggregate === "ok"
                    ? "bg-emerald-400 animate-pulse"
                    : aggregate === "degraded"
                      ? "bg-yellow-400"
                      : "bg-red-400 animate-pulse"
                }`}
              />
              <span className={`text-xs font-bold ${aggregateMeta.color}`}>
                {aggregate === "ok"
                  ? "النظام يعمل"
                  : aggregate === "degraded"
                    ? "أداء متدنٍ"
                    : "يوجد خلل"}
              </span>
            </div>
          )}
        </div>

        {/* ── Panel 1: Service health strip ── */}
        <section className="space-y-3 float-in stagger-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold">صحة الخدمات</h2>
            <span className="text-[10px] text-muted-foreground">آخر فحص: تلقائي كل 30ث</span>
          </div>

          {healthQ.isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[52px] rounded-xl skeleton-shimmer" />
              ))}
            </div>
          ) : healthQ.isError || !health ? (
            <div className="bg-card border border-red-400/20 rounded-2xl p-4 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-xs text-muted-foreground">
                تعذّر جلب حالة الخدمات. تحقق من الاتصال بالخادم.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              {Object.entries(filteredChecks).map(([service, check]) => (
                <HealthPill key={service} service={service} check={check} />
              ))}
            </div>
          )}
        </section>

        {/* ── Panel 2: Scheduler banner (replaces misleading worker pill) ── */}
        <section
          className={`flex items-center justify-between gap-4 p-4 rounded-2xl border ${schedMeta.bg} ${schedMeta.border} float-in stagger-2`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl ${schedMeta.bg} flex items-center justify-center shrink-0`}
            >
              <TimerReset className={`w-4 h-4 ${schedMeta.color}`} />
            </div>
            <div className="min-w-0">
              <p className={`font-bold text-sm ${schedMeta.color}`}>{schedTitle}</p>
              <p className="text-xs text-muted-foreground">{schedMessage}</p>
              {scheduler && (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/40 border border-border/40 text-muted-foreground">
                    mode: {scheduler.mode}
                  </span>
                  {scheduler.isLeader && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary">
                      leader
                    </span>
                  )}
                  {scheduler.startedAt && (
                    <span
                      className="text-[10px] text-muted-foreground"
                      title={scheduler.startedAt}
                    >
                      منذ {formatRelativeTime(scheduler.startedAt)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Panel 3: Runtime diagnostics grid ── */}
        <section className="space-y-3 float-in stagger-3">
          <h2 className="text-sm font-bold">تشخيص وقت التشغيل</h2>

          {diagQ.isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-[88px] rounded-2xl skeleton-shimmer" />
              ))}
            </div>
          ) : diagQ.isError || !diag ? (
            <div className="bg-card border border-yellow-400/20 rounded-2xl p-4 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0" />
              <span className="text-xs text-muted-foreground">
                تعذّر جلب تشخيص وقت التشغيل (يتطلب صلاحيات إدارية).
              </span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard
                  label="مدة التشغيل"
                  value={formatUptime(diag.runtime.uptimeSec)}
                  sub={`بيئة: ${diag.runtime.env}`}
                  icon={Clock}
                  color="text-emerald-400"
                  bg="bg-emerald-400/10"
                  border="border-emerald-400/20"
                />
                <MetricCard
                  label="الذاكرة (RSS)"
                  value={`${diag.memory.rssMb}MB`}
                  sub={`heap: ${diag.memory.heapUsedMb}/${diag.memory.heapTotalMb}MB`}
                  icon={MemoryStick}
                  color="text-blue-400"
                  bg="bg-blue-400/10"
                  border="border-blue-400/20"
                  spark={memorySeries}
                  sparkColor="#3b82f6"
                />
                <MetricCard
                  label="event-loop p99"
                  value={diag.eventLoop ? `${diag.eventLoop.p99Ms.toFixed(1)}ms` : "—"}
                  sub={
                    diag.eventLoop
                      ? `p50: ${diag.eventLoop.p50Ms.toFixed(1)}ms · p95: ${diag.eventLoop.p95Ms.toFixed(1)}ms`
                      : "غير متاح"
                  }
                  icon={Cpu}
                  color={
                    diag.eventLoop && diag.eventLoop.p99Ms > 100 ? "text-red-400" : "text-cyan-400"
                  }
                  bg={
                    diag.eventLoop && diag.eventLoop.p99Ms > 100
                      ? "bg-red-400/10"
                      : "bg-cyan-400/10"
                  }
                  border={
                    diag.eventLoop && diag.eventLoop.p99Ms > 100
                      ? "border-red-400/20"
                      : "border-cyan-400/20"
                  }
                  spark={eventLoopSeries}
                  sparkColor="#22d3ee"
                />
                <MetricCard
                  label="الإصدار"
                  value={diag.runtime.version}
                  sub={`Node ${diag.node.version} · ${diag.runtime.service}`}
                  icon={Layers}
                  color="text-orange-400"
                  bg="bg-orange-400/10"
                  border="border-orange-400/20"
                />
              </div>

              <div className="bg-card border border-border/60 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Flag className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                    الأعلام التشغيلية
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(diag.flags).map(([key, val]) => {
                    const enabled = val === "true";
                    return (
                      <span
                        key={key}
                        className={`text-[10px] px-2 py-1 rounded-lg border font-mono ${
                          enabled
                            ? "bg-emerald-400/8 border-emerald-400/20 text-emerald-400"
                            : "bg-muted/30 border-border/50 text-muted-foreground"
                        }`}
                      >
                        {key}: {val}
                      </span>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>

        {/* ── Panel 4: HTTP Request Analytics ── */}
        {metrics && (
          <section className="space-y-3 float-in stagger-4">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" />
              تحليلات الطلبات HTTP
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="إجمالي الطلبات"
                value={formatNumber(metrics.http.totalRequests)}
                sub={`منذ آخر إقلاع · ${metrics.http.topRoutes.length} مسار نشط`}
                icon={Radio}
                color="text-primary"
                bg="bg-primary/10"
                border="border-primary/20"
                spark={reqRate}
                sparkColor="#e11d48"
              />
              <MetricCard
                label="معدل الأخطاء (5xx)"
                value={`${(metrics.http.errorRate * 100).toFixed(2)}%`}
                sub={`${formatNumber(metrics.http.requestsByStatusClass["5xx"] ?? 0)} خطأ`}
                icon={AlertCircle}
                color={metrics.http.errorRate > 0.01 ? "text-red-400" : "text-emerald-400"}
                bg={metrics.http.errorRate > 0.01 ? "bg-red-400/10" : "bg-emerald-400/10"}
                border={
                  metrics.http.errorRate > 0.01 ? "border-red-400/20" : "border-emerald-400/20"
                }
                spark={errRate}
                sparkColor="#f87171"
              />
              <MetricCard
                label="زمن الاستجابة p95"
                value={formatMs(metrics.http.latency.p95Ms)}
                sub={`p50: ${formatMs(metrics.http.latency.p50Ms)} · p99: ${formatMs(metrics.http.latency.p99Ms)}`}
                icon={Clock}
                color={
                  (metrics.http.latency.p95Ms ?? 0) > 1000 ? "text-red-400" : "text-cyan-400"
                }
                bg={(metrics.http.latency.p95Ms ?? 0) > 1000 ? "bg-red-400/10" : "bg-cyan-400/10"}
                border={
                  (metrics.http.latency.p95Ms ?? 0) > 1000
                    ? "border-red-400/20"
                    : "border-cyan-400/20"
                }
                spark={p95Series}
                sparkColor="#22d3ee"
              />
              <MetricCard
                label="حالات الاستجابة"
                value={`${formatNumber(metrics.http.requestsByStatusClass["2xx"] ?? 0)} / ${formatNumber(metrics.http.requestsByStatusClass["4xx"] ?? 0)}`}
                sub={`2xx ناجح · 4xx خطأ من العميل`}
                icon={ShieldCheck}
                color="text-emerald-400"
                bg="bg-emerald-400/10"
                border="border-emerald-400/20"
              />
            </div>

            {/* Top routes table */}
            {metrics.http.topRoutes.length > 0 && (
              <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <Box className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                    أكثر المسارات نشاطاً
                  </span>
                </div>
                <div className="divide-y divide-border/40">
                  {metrics.http.topRoutes.slice(0, 6).map((r) => {
                    const errPct = r.count === 0 ? 0 : (r.errorCount / r.count) * 100;
                    return (
                      <div
                        key={`${r.method}-${r.route}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
                      >
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/40 border border-border/40 text-muted-foreground shrink-0">
                          {r.method}
                        </span>
                        <span className="font-mono text-xs flex-1 min-w-0 truncate" dir="ltr">
                          {r.route}
                        </span>
                        <span className="text-xs font-bold tabular-nums shrink-0">
                          {formatNumber(r.count)}
                        </span>
                        {errPct > 0 && (
                          <span
                            className={`text-[10px] font-bold tabular-nums shrink-0 ${errPct > 1 ? "text-red-400" : "text-yellow-400"}`}
                          >
                            {errPct.toFixed(1)}% أخطاء
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Panel 5: Auth & Security ── */}
        {metrics && (
          <section className="space-y-3 float-in stagger-5">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              المصادقة والأمان
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="إجمالي المحاولات"
                value={formatNumber(metrics.auth.totalAttempts)}
                sub={`${formatNumber(
                  Object.entries(metrics.auth.outcomes)
                    .filter(([k]) => k.endsWith(":success"))
                    .reduce((a, [, v]) => a + v, 0),
                )} نجاح`}
                icon={ShieldCheck}
                color="text-emerald-400"
                bg="bg-emerald-400/10"
                border="border-emerald-400/20"
              />
              <MetricCard
                label="معدل الفشل"
                value={`${(metrics.auth.failureRate * 100).toFixed(1)}%`}
                sub="فشل + قفل / إجمالي"
                icon={AlertTriangle}
                color={metrics.auth.failureRate > 0.1 ? "text-red-400" : "text-yellow-400"}
                bg={metrics.auth.failureRate > 0.1 ? "bg-red-400/10" : "bg-yellow-400/10"}
                border={
                  metrics.auth.failureRate > 0.1
                    ? "border-red-400/20"
                    : "border-yellow-400/20"
                }
                spark={authFailRate}
                sparkColor="#f59e0b"
              />
              <MetricCard
                label="فشل Firebase"
                value={formatNumber(metrics.auth.outcomes["firebase:failure"] ?? 0)}
                sub="جلسة Firebase / OTP"
                icon={Zap}
                color="text-orange-400"
                bg="bg-orange-400/10"
                border="border-orange-400/20"
              />
              <MetricCard
                label="حالات قفل الحساب"
                value={formatNumber(
                  Object.entries(metrics.auth.outcomes)
                    .filter(([k]) => k.endsWith(":lockout"))
                    .reduce((a, [, v]) => a + v, 0),
                )}
                sub="بسبب محاولات متكررة"
                icon={ShieldCheck}
                color="text-red-400"
                bg="bg-red-400/10"
                border="border-red-400/20"
              />
            </div>
          </section>
        )}

        {/* ── Panel 6: Redis Performance ── */}
        {metrics && (
          <section className="space-y-3 float-in stagger-6">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              أداء Redis
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="حالة الاتصال"
                value={metrics.redis.available ? "متصل" : "غير متصل"}
                sub={
                  metrics.redis.degradedEvents > 0
                    ? `${metrics.redis.degradedEvents} تخفيض`
                    : "بدون تخفيضات"
                }
                icon={Wifi}
                color={metrics.redis.available ? "text-emerald-400" : "text-red-400"}
                bg={metrics.redis.available ? "bg-emerald-400/10" : "bg-red-400/10"}
                border={metrics.redis.available ? "border-emerald-400/20" : "border-red-400/20"}
              />
              <MetricCard
                label="إجمالي العمليات"
                value={formatNumber(
                  Object.values(metrics.redis.opsTotal).reduce((a, b) => a + b, 0),
                )}
                sub="get/set/ping/etc"
                icon={Zap}
                color="text-primary"
                bg="bg-primary/10"
                border="border-primary/20"
                spark={redisOpsRate}
                sparkColor="#e11d48"
              />
              <MetricCard
                label="ping latency p95"
                value={formatMs(metrics.redis.pingLatencyMs.p95)}
                sub={`p50: ${formatMs(metrics.redis.pingLatencyMs.p50)} · p99: ${formatMs(metrics.redis.pingLatencyMs.p99)}`}
                icon={Clock}
                color={
                  (metrics.redis.pingLatencyMs.p95 ?? 0) > 100
                    ? "text-red-400"
                    : "text-cyan-400"
                }
                bg={
                  (metrics.redis.pingLatencyMs.p95 ?? 0) > 100
                    ? "bg-red-400/10"
                    : "bg-cyan-400/10"
                }
                border={
                  (metrics.redis.pingLatencyMs.p95 ?? 0) > 100
                    ? "border-red-400/20"
                    : "border-cyan-400/20"
                }
              />
              <MetricCard
                label="إجمالي الأخطاء"
                value={formatNumber(
                  Object.values(metrics.redis.errorsTotal).reduce((a, b) => a + b, 0),
                )}
                sub={
                  Object.entries(metrics.redis.errorsTotal)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 1)
                    .map(([k]) => k)[0] ?? "بدون"
                }
                icon={AlertCircle}
                color={
                  Object.values(metrics.redis.errorsTotal).reduce((a, b) => a + b, 0) > 0
                    ? "text-red-400"
                    : "text-emerald-400"
                }
                bg={
                  Object.values(metrics.redis.errorsTotal).reduce((a, b) => a + b, 0) > 0
                    ? "bg-red-400/10"
                    : "bg-emerald-400/10"
                }
                border={
                  Object.values(metrics.redis.errorsTotal).reduce((a, b) => a + b, 0) > 0
                    ? "border-red-400/20"
                    : "border-emerald-400/20"
                }
              />
            </div>
          </section>
        )}

        {/* ── Panel 7: Socket.IO + Job Activity ── */}
        {metrics && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-3 float-in stagger-7">
            {/* Socket.IO */}
            <div className="bg-card border border-border/60 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold">Socket.IO</h3>
                <span className="text-[10px] text-muted-foreground mr-auto">واجهات لحظية</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
                    عملاء متّصلون
                  </div>
                  <div className="font-black text-2xl text-cyan-400 tabular-nums">
                    {metrics.socket.connectedClients}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
                    إجمالي الأحداث
                  </div>
                  <div className="font-black text-2xl tabular-nums">
                    {formatNumber(
                      Object.values(metrics.socket.eventsTotal).reduce((a, b) => a + b, 0),
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Background jobs */}
            <div className="bg-card border border-border/60 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <TimerReset className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold">المهام الخلفية</h3>
                <span className="text-[10px] text-muted-foreground mr-auto">
                  cron · watchers · heartbeat
                </span>
              </div>
              {Object.keys(metrics.worker.jobsTotal).length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center">
                  لم تُسجَّل أي مهمة بعد
                </div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {Object.entries(metrics.worker.jobsTotal)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 8)
                    .map(([key, count]) => {
                      const [job, status] = key.split(":");
                      const isFailed = status === "failed";
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-2 text-xs py-1 border-b border-border/30 last:border-0"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              isFailed ? "bg-red-400" : "bg-emerald-400"
                            }`}
                          />
                          <span className="font-mono text-muted-foreground truncate" dir="ltr">
                            {job}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {status}
                          </span>
                          <span className="font-bold tabular-nums shrink-0 mr-auto">{count}</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Panel 7.5: Core Web Vitals p75 ── */}
        {metrics && Object.keys(metrics.cwv.p75).length > 0 && (
          <section className="space-y-3 float-in stagger-7">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Cpu className="w-4 h-4 text-primary" />
              Core Web Vitals (p75)
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {(
                [
                  { key: "lcp", label: "LCP", good: 2500, poor: 4000, unit: "ms" as const },
                  { key: "fcp", label: "FCP", good: 1800, poor: 3000, unit: "ms" as const },
                  { key: "inp", label: "INP", good: 200, poor: 500, unit: "ms" as const },
                  { key: "cls", label: "CLS", good: 0.1, poor: 0.25, unit: "" as const },
                  { key: "ttfb", label: "TTFB", good: 800, poor: 1800, unit: "ms" as const },
                ] as const
              ).map(({ key, label, good, poor, unit }) => {
                const p75 = metrics.cwv.p75[key];
                const samples = metrics.cwv.samples[key] ?? 0;
                let tone: "ok" | "degraded" | "failing" = "ok";
                let display = "—";
                if (p75 !== null && p75 !== undefined) {
                  if (p75 > poor) tone = "failing";
                  else if (p75 > good) tone = "degraded";
                  display =
                    unit === "ms"
                      ? p75 < 1000
                        ? `${Math.round(p75)}ms`
                        : `${(p75 / 1000).toFixed(2)}s`
                      : p75.toFixed(3);
                } else if (samples === 0) {
                  display = "بدون عيّنات";
                }
                const meta = STATUS_META[tone];
                return (
                  <div
                    key={key}
                    className={`bg-card border ${meta.border} rounded-2xl p-4`}
                    title={`${samples} عيّنة · حد الجيد: ${good}${unit} · حد الضعيف: ${poor}${unit}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                        {label}
                      </span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          tone === "ok"
                            ? "bg-emerald-400"
                            : tone === "degraded"
                              ? "bg-yellow-400"
                              : "bg-red-400"
                        }`}
                      />
                    </div>
                    <div className={`font-black text-base leading-none tabular-nums ${meta.color}`}>
                      {display}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">{samples} عيّنة</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Panel 8: Request rate trend chart (visual centerpiece) ── */}
        {samples.length >= 4 && (
          <section className="float-in stagger-8">
            <div className="bg-card border border-border/60 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold">معدل الطلبات (طلب/ث)</h3>
                <span className="text-[10px] text-muted-foreground mr-auto">
                  آخر {Math.min(samples.length, 60)} عيّنة · ~{Math.min(samples.length, 60) * 15}ث
                </span>
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart
                  data={reqRate.map((v, i) => ({ i, rps: v, errs: errRate[i] ?? 0 }))}
                  margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="rpsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e11d48" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.04)"
                    vertical={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgb(20 20 20 / 0.95)",
                      border: "1px solid rgb(80 80 80 / 0.4)",
                      borderRadius: 12,
                      fontSize: 11,
                    }}
                    labelStyle={{ display: "none" }}
                    formatter={(v: number) => [v.toFixed(2), "طلب/ث"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="rps"
                    stroke="#e11d48"
                    fill="url(#rpsGrad)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* ── Panel 9: Recent observability alerts ── */}
        <section className="space-y-3 float-in stagger-9">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">آخر التنبيهات</h2>
            <Link href="/admin/alerts">
              <span className="text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer">
                عرض الكل ←
              </span>
            </Link>
          </div>
          {recentAlertsQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[56px] rounded-xl skeleton-shimmer" />
              ))}
            </div>
          ) : recentAlerts.length === 0 ? (
            <div className="bg-card border border-border/60 rounded-2xl p-6 flex flex-col items-center gap-2 text-muted-foreground">
              <Inbox className="w-6 h-6 opacity-30" />
              <span className="text-xs">لا توجد تنبيهات حديثة</span>
            </div>
          ) : (
            <div className="bg-card border border-border/60 rounded-2xl divide-y divide-border/40 overflow-hidden">
              {recentAlerts.slice(0, 5).map((alert) => (
                <Link key={alert.id} href="/admin/alerts">
                  <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors cursor-pointer">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate">{alert.title}</div>
                      {alert.message && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {alert.message}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatRelativeTime(alert.createdAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── Panel 10: External dashboards ── */}
        {summary &&
          (summary.dashboards.render ||
            summary.dashboards.sentry ||
            summary.dashboards.neon) && (
            <section className="space-y-3 float-in stagger-10">
              <h2 className="text-sm font-bold">لوحات خارجية</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {summary.dashboards.render && (
                  <a
                    href={summary.dashboards.render}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-card border border-border/60 hover:border-border rounded-2xl p-4 flex items-center gap-3 transition-all card-spring"
                  >
                    <div className="w-9 h-9 rounded-xl bg-violet-400/10 border border-violet-400/20 flex items-center justify-center">
                      <Server className="w-4 h-4 text-violet-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold">Render</div>
                      <div className="text-[10px] text-muted-foreground">
                        النشرات والسجلات
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                  </a>
                )}
                {summary.dashboards.sentry && (
                  <a
                    href={summary.dashboards.sentry}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-card border border-border/60 hover:border-border rounded-2xl p-4 flex items-center gap-3 transition-all card-spring"
                  >
                    <div className="w-9 h-9 rounded-xl bg-purple-400/10 border border-purple-400/20 flex items-center justify-center">
                      <AlertCircle className="w-4 h-4 text-purple-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold">Sentry</div>
                      <div className="text-[10px] text-muted-foreground">
                        الأخطاء والتتبع
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                  </a>
                )}
                {summary.dashboards.neon && (
                  <a
                    href={summary.dashboards.neon}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-card border border-border/60 hover:border-border rounded-2xl p-4 flex items-center gap-3 transition-all card-spring"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                      <Database className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold">Neon</div>
                      <div className="text-[10px] text-muted-foreground">قاعدة البيانات</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                  </a>
                )}
              </div>
            </section>
          )}
      </div>
    </AdminLayout>
  );
}
