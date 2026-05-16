import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  Flag,
  HeartPulse,
  Inbox,
  Layers,
  MemoryStick,
  Network,
  Server,
  Wifi,
  XCircle,
} from "lucide-react";
import type { ReactElement } from "react";
import { Link, useLocation } from "wouter";
import { AdminLayout } from "./layout";

// ── Backend response shapes (mirror exactly what the deployed API returns) ──

type CheckStatus = "ok" | "degraded" | "failing";

interface HealthCheck {
  status: CheckStatus;
  latencyMs?: number;
  error?: string;
  lastCheckedAt: string;
}

interface HealthzReadyResponse {
  status: CheckStatus;
  checks: Record<string, HealthCheck>;
  version: string;
  uptimeSec: number;
}

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

// ── Visual helpers (reuse existing design tokens) ───────────────────────────

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

function workerToneFromAgeSec(ageSec: number | null): CheckStatus {
  if (ageSec === null) return "failing";
  if (ageSec < 60) return "ok";
  if (ageSec < 180) return "degraded";
  return "failing";
}

// ── Sub-components ──────────────────────────────────────────────────────────

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
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Server;
  color?: string;
  bg?: string;
  border?: string;
}): ReactElement {
  return (
    <div className={`bg-card border ${border} rounded-2xl p-4`}>
      <div className="flex items-center gap-2 mb-2.5">
        <div className={`w-8 h-8 ${bg} border ${border} rounded-xl flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div className="font-black text-lg leading-none tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function AdminSystemPage(): ReactElement | null {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  const healthQ = useQuery<HealthzReadyResponse>({
    queryKey: ["healthz-ready"],
    queryFn: () => fetch("/api/healthz/ready").then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 15_000,
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

  if (!adminToken) {
    navigate("/admin/login");
    return null;
  }

  const handleRefresh = () => {
    healthQ.refetch();
    diagQ.refetch();
    summaryQ.refetch();
    recentAlertsQ.refetch();
  };

  const health = healthQ.data;
  const diag = diagQ.data;
  const summary = summaryQ.data;
  const recentAlerts = recentAlertsQ.data?.alerts ?? [];

  const aggregate = health?.status ?? "degraded";
  const aggregateMeta = STATUS_META[aggregate];

  const workerHeartbeat = summary?.worker?.heartbeat;
  const workerAgeSec = workerHeartbeat?.ageSec ?? null;
  const workerTone = workerToneFromAgeSec(workerAgeSec);
  const workerToneMeta = STATUS_META[workerTone];

  return (
    <AdminLayout onRefresh={handleRefresh}>
      <div className="space-y-6 page-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-black flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              حالة النظام
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              نظرة عامة على صحة الخدمات، الذاكرة، النبضة، والتنبيهات الحديثة
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
              {Array.from({ length: 4 }).map((_, i) => (
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
              {Object.entries(health.checks).map(([service, check]) => (
                <HealthPill key={service} service={service} check={check} />
              ))}
            </div>
          )}
        </section>

        {/* ── Panel 2: Worker heartbeat banner ── */}
        {summary && (
          <section
            className={`flex items-center justify-between gap-4 p-4 rounded-2xl border ${workerToneMeta.bg} ${workerToneMeta.border} float-in stagger-2`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-xl ${workerToneMeta.bg} flex items-center justify-center shrink-0`}
              >
                <HeartPulse className={`w-4 h-4 ${workerToneMeta.color}`} />
              </div>
              <div>
                <p className={`font-bold text-sm ${workerToneMeta.color}`}>
                  {workerAgeSec === null
                    ? "لم يتم تسجيل نبضة من الـ Worker"
                    : workerAgeSec < 60
                      ? `الـ Worker حيّ — آخر نبضة قبل ${workerAgeSec}ث`
                      : workerAgeSec < 180
                        ? `الـ Worker متأخر — آخر نبضة قبل ${workerAgeSec}ث`
                        : `الـ Worker متوقف — آخر نبضة قبل ${Math.floor(workerAgeSec / 60)}د`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {workerAgeSec === null
                    ? "تأكّد أن خدمة الـ Worker تعمل وأن Redis متاح"
                    : "النبضة تُحدَّث تلقائياً في Redis كل 30 ثانية"}
                </p>
              </div>
            </div>
          </section>
        )}

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

              {/* Feature flags (compact, secondary) */}
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

              {/* Dependency status (Redis / Socket from diag, complementing the health strip above) */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`bg-card border rounded-2xl p-3 flex items-center gap-3 ${diag.deps.redis.connected ? "border-emerald-400/20" : "border-red-400/20"}`}
                >
                  <Database
                    className={`w-4 h-4 ${diag.deps.redis.connected ? "text-emerald-400" : "text-red-400"}`}
                  />
                  <div className="flex-1">
                    <div className="text-xs font-bold">Redis</div>
                    <div className="text-[10px] text-muted-foreground">
                      {diag.deps.redis.connected ? "متصل" : "غير متصل"}
                    </div>
                  </div>
                </div>
                <div
                  className={`bg-card border rounded-2xl p-3 flex items-center gap-3 ${diag.deps.socket.initialized ? "border-emerald-400/20" : "border-red-400/20"}`}
                >
                  <Network
                    className={`w-4 h-4 ${diag.deps.socket.initialized ? "text-emerald-400" : "text-red-400"}`}
                  />
                  <div className="flex-1">
                    <div className="text-xs font-bold">Socket.IO</div>
                    <div className="text-[10px] text-muted-foreground">
                      {diag.deps.socket.initialized ? "مُهيّأ" : "غير مُهيّأ"}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ── Panel 4: Recent observability alerts ── */}
        <section className="space-y-3 float-in stagger-4">
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

        {/* ── Panel 5: External dashboards ── */}
        {summary &&
          (summary.dashboards.render ||
            summary.dashboards.sentry ||
            summary.dashboards.neon) && (
            <section className="space-y-3 float-in stagger-5">
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
