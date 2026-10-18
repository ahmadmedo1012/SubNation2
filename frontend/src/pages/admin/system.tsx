import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { Skeleton } from "@/components/ui/Skeleton";
import { AdminSessionExpiredError, adminFetch, isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { useChartColors } from "@/lib/chart-theme";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Activity, Cpu } from "lucide-react";
import { type ReactElement, Suspense, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";
// R137 (FE decomposition): the page's self-contained subcomponents and
// pure helpers moved to @/components/admin/system/* (verbatim moves —
// the six observability queries, the guarded fetchers, the rolling
// metrics buffer, handleRefresh, the settings-scope gate and the rps
// trend chart (the rolling buffer's own surface) stay HERE; the
// extracts render the byte-identical DOM they rendered inline
// yesterday). Import surface:
//   • system-types / system-samples / system-scheduler / system-meta —
//     the page's pure modules (backend response shapes, the rolling-
//     buffer math + MAX_SAMPLES, the scheduler-banner tone/title
//     derivation, the STATUS_META tone map)
//   • system-charts — the lazy recharts bridge (Panel 8 below rides it
//     inline; the diagnostics MetricCard sparklines import their own)
//   • DetailsSection — the native-<details> collapsible (Panel 8 rides
//     it inline; the extracted panels import their own)
//   • HealthOverviewSection / SchedulerDetailsSection /
//     RuntimeDiagnosticsSection / HttpAnalyticsSection /
//     AuthSecuritySection / RedisPerformanceSection / SocketJobsSection /
//     CoreWebVitalsSection / RecentAlertsSection /
//     ExternalDashboardsSection — the page's ten panels (values +
//     retry callbacks flow down; MetricCard / HealthTile ride inside
//     their consumers)
import { ChartsLoader } from "@/components/admin/system/system-charts";
import { STATUS_META } from "@/components/admin/system/system-meta";
import { deriveSchedulerBanner } from "@/components/admin/system/system-scheduler";
import {
  MAX_SAMPLES,
  deriveDelta,
  type MetricsSample,
} from "@/components/admin/system/system-samples";
import type {
  DiagnosticsResponse,
  MetricsSnapshot,
  ObservabilitySummary,
  RecentAlert,
  SchedulerResponse,
} from "@/components/admin/system/system-types";
import { DetailsSection } from "@/components/admin/system/DetailsSection";
import { HealthOverviewSection } from "@/components/admin/system/HealthOverviewSection";
import { SchedulerDetailsSection } from "@/components/admin/system/SchedulerDetailsSection";
import { RuntimeDiagnosticsSection } from "@/components/admin/system/RuntimeDiagnosticsSection";
import { HttpAnalyticsSection } from "@/components/admin/system/HttpAnalyticsSection";
import { AuthSecuritySection } from "@/components/admin/system/AuthSecuritySection";
import { RedisPerformanceSection } from "@/components/admin/system/RedisPerformanceSection";
import { SocketJobsSection } from "@/components/admin/system/SocketJobsSection";
import { CoreWebVitalsSection } from "@/components/admin/system/CoreWebVitalsSection";
import { RecentAlertsSection } from "@/components/admin/system/RecentAlertsSection";
import { ExternalDashboardsSection } from "@/components/admin/system/ExternalDashboardsSection";
import { type CheckStatus, type HealthCheck, type HealthzReadyResponse } from "@/lib/healthz";

// Re-export the shared types under their existing local names so the rest
// of this large file's prop signatures remain unchanged.
export type { CheckStatus, HealthCheck, HealthzReadyResponse };

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminSystemPage(): ReactElement | null {
  const { adminToken, hasAdminPermission } = useAuth();
  // R133 (A3-F4, the system half): the six queries below hit
  // settings-scoped endpoints (/healthz/ready + the /admin/diagnostics
  // + /admin/observability family — health.ts:820 + the admin mounts),
  // but mounted for ANY authenticated admin: a scope-less deep-linker
  // ate a synchronized 403 burst every poll cycle. The risk.tsx:107
  // idiom — gate the queries AND render the honest reason.
  const canViewSystem = hasAdminPermission("settings");
  const [, navigate] = useLocation();
  const headers = useAdminHeaders();
  // R115-A6 #7: sparklines / rps chart / tooltip ride the theme tokens
  // (see lib/chart-theme.ts) — no more theme-blind hexes.
  const chart = useChartColors();

  // 93-C6 / SY-1 (A5, round-93): guarded JSON fetcher for the three
  // observability queryFns that previously did bare
  // `fetch(url).then(r => r.json())` — a 401/500 error body became
  // `data` and panels rendered the envelope as fake readings (401 →
  // zeroed metrics that looked real). Now: !ok → throw (query error
  // state, panels fall back honestly), 401 → global session handler.
  function fetchAdminJson<T>(url: string): () => Promise<T> {
    return async () => {
      // L13-1 (R143): adminFetch threads the shared 20 s timeout — the
      // observability polls (15–90 s cadence) used to freeze a panel's
      // slot silently on a stalled link (the quietest failure class in
      // the console); the abort now lands in the query error state
      // where the FetchErrorCard discloses it.
      const res = await adminFetch(url, { headers });
      if (isAdminUnauthorized(res, url)) {
        // Handled globally (toast + redirect); the query error state
        // below just keeps the panel out of "live" rendering.
        throw new Error("SESSION_EXPIRED");
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} — تعذّر جلب بيانات المراقبة`);
      }
      return (await res.json()) as T;
    };
  }

  // /api/healthz/ready is now admin-gated. Build an admin-aware fetcher
  // wrapping the shared robust pattern from lib/healthz.
  // R133 (A3-F4): the old catch-all mapped EVERY failure — 401/403
  // included — onto `{status:"degraded"}`, so an authorization outcome
  // rendered as an infrastructure verdict (an amber «أداء متدنٍ» pill
  // during a pure scope rejection). Failures now land in the query
  // error state and the section renders its FetchErrorCard; 503 stays
  // parsed — it IS the health verdict (a degraded aggregate with a
  // real JSON body).
  async function fetchAdminHealthReady(): Promise<HealthzReadyResponse> {
    let res: Response;
    try {
      // L13-1 (R143): adminFetch threads the shared 20 s timeout — the
      // 60 s health poll used to freeze the tile without an error
      // surface on a stalled link.
      res = await adminFetch("/api/healthz/ready", { headers });
    } catch (err) {
      // The expired-session sentinel is NOT a network failure — let it
      // propagate (the query error state renders either way).
      if (err instanceof AdminSessionExpiredError) throw err;
      throw new Error("HEALTHZ_READY_NETWORK", { cause: err });
    }
    if (isAdminUnauthorized(res, "/api/healthz/ready")) {
      // Handled globally (toast + redirect); the query error state
      // below just keeps the panel out of "live" rendering.
      throw new Error("SESSION_EXPIRED");
    }
    if (!res.ok && res.status !== 503) {
      // 403 (scope loss mid-session) / 404 / 5xx — an honest error, not
      // a fabricated degraded verdict.
      throw new Error(`HEALTHZ_READY_HTTP_${res.status}`);
    }
    return (await res.json()) as HealthzReadyResponse;
  }

  // Existing queries (unchanged) ───────────────────────────────────────────

  const healthQ = useQuery<HealthzReadyResponse>({
    queryKey: ["healthz-ready"],
    queryFn: fetchAdminHealthReady,
    // Reduced 30 s → 60 s. Backend cache is 15 s; admin doesn't need
    // sub-30 s granularity on health.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: false,
    // R133 (A3-F4): settings scope gates this query too.
    enabled: !!adminToken && canViewSystem,
  });

  const diagQ = useQuery<DiagnosticsResponse>({
    queryKey: ["admin-diagnostics"],
    queryFn: () => customFetch<DiagnosticsResponse>("/api/admin/diagnostics", { headers }),
    // 30 s → 60 s. Memory + CPU + event-loop p99 don't need 30 s precision.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    // R133 (A3-F4): settings scope gates this query too.
    enabled: !!adminToken && canViewSystem,
  });

  const summaryQ = useQuery<ObservabilitySummary>({
    queryKey: ["admin-observability-summary"],
    queryFn: () =>
      customFetch<ObservabilitySummary>("/api/admin/observability/summary", { headers }),
    // 30 s → 60 s. Aggregate counters update slowly.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    // R133 (A3-F4): settings scope gates this query too.
    enabled: !!adminToken && canViewSystem,
  });

  const recentAlertsQ = useQuery<{ alerts: RecentAlert[]; stale: boolean }>({
    queryKey: ["admin-observability-alerts-recent"],
    // 93-C6 / SY-1 (A5, round-93): plain `r.json()` turned a 401/500
    // error body into `data` — panels then rendered the envelope's
    // fields as if they were real readings. Guarded parse now: !ok →
    // throw → useQuery error state (data stays undefined, the section's
    // fallback renders); 401 → the global session-expiry handler.
    queryFn: fetchAdminJson<{ alerts: RecentAlert[]; stale: boolean }>(
      "/api/admin/observability/alerts/recent",
    ),
    // 60 s → 90 s. Alerts already trigger Discord pushes; this panel is
    // a historical view, not real-time.
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    staleTime: 45_000,
    // R133 (A3-F4): settings scope gates this query too.
    enabled: !!adminToken && canViewSystem,
  });

  // New queries ────────────────────────────────────────────────────────────

  const metricsQ = useQuery<MetricsSnapshot>({
    queryKey: ["admin-observability-metrics"],
    // The metrics endpoint wraps its snapshot in a last-known-good
    // envelope (`{ value, lastKnownGoodAt, stale }` — see the backend's
    // CachedWithLKG). Unwrap here; `value: null` (backend has never
    // built a snapshot, e.g. right after boot) is an honest "no data"
    // state → throw so the panel renders its error fallback instead of
    // crashing on a missing `http`/`socket` subtree.
    queryFn: async () => {
      const env = await fetchAdminJson<{
        value: MetricsSnapshot | null;
        lastKnownGoodAt: string | null;
        stale: boolean;
      }>("/api/admin/observability/metrics")();
      if (!env?.value) throw new Error("NO_METRICS_SNAPSHOT");
      return env.value;
    },
    // Kept at 15 s — realtime CWV + event-loop is the highest-value
    // panel for live operator triage.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 7_000,
    // R133 (A3-F4): settings scope gates this query too.
    enabled: !!adminToken && canViewSystem,
  });

  const schedulerQ = useQuery<SchedulerResponse>({
    queryKey: ["admin-observability-scheduler"],
    queryFn: fetchAdminJson<SchedulerResponse>("/api/admin/observability/scheduler"),
    // 30 s → 90 s. Scheduler state changes slowly (leader rotation,
    // worker heartbeat). Sub-minute precision is unnecessary.
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    staleTime: 45_000,
    // R133 (A3-F4): settings scope gates this query too.
    enabled: !!adminToken && canViewSystem,
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

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  if (!adminToken) return null;

  // R133 (A3-F4): the deep-link honest-reason card (the risk.tsx
  // canViewRisk idiom) — the nav already hides «حالة النظام» for
  // scope-less admins (layout.tsx NAV_SECTIONS), but a URL used to
  // mount the page and fire the 403 burst. Sits AFTER every hook
  // (the queries' enabled gates keep a scope-less mount fetch-free).
  if (!canViewSystem) {
    return (
      <AdminLayout>
        <p className="text-sm text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2">
          مركز المراقبة يتطلب صلاحية الإعدادات — تواصل مع مسؤول النظام
        </p>
      </AdminLayout>
    );
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
  const alertsStale = recentAlertsQ.data?.stale === true;

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

  const { schedTone, schedTitle, schedMessage } = deriveSchedulerBanner(scheduler);
  const schedMeta = STATUS_META[schedTone];

  return (
    <AdminLayout onRefresh={handleRefresh}>
      <div className="space-y-5 page-in">
        {/* Header — compact, single-purpose copy */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              مركز المراقبة
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              حالة الخدمات والأداء — تحديث تلقائي
            </p>
          </div>
          {health && (
            /* R139 (precision): VERIFIED, no change — the aggregate health
               pill already rides the quiet token-tint register: the
               STATUS_META bg/border tints + the status ink on the label,
               the state dot on the token fill — never a full-status wall
               (the R128 A1-D1/F1 token migration). */
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${aggregateMeta.bg} ${aggregateMeta.border}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  aggregate === "ok"
                    ? "bg-status-success animate-pulse"
                    : aggregate === "degraded"
                      ? "bg-status-warning"
                      : "bg-status-error animate-pulse"
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

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 1 — HEALTH OVERVIEW
            Seven critical KPIs the operator should be able to read in <5s.
            All other detail moves below into Advanced Diagnostics.
        ═══════════════════════════════════════════════════════════════ */}
        <HealthOverviewSection
          health={health}
          healthLoading={healthQ.isLoading}
          healthError={healthQ.isError}
          onRetryHealth={() => void healthQ.refetch()}
          filteredChecks={filteredChecks}
          metrics={metrics}
          scheduler={scheduler}
          schedTone={schedTone}
          schedMeta={schedMeta}
          schedTitle={schedTitle}
          schedMessage={schedMessage}
          summary={summary}
          alertsStale={alertsStale}
        />

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 2 — ADVANCED DIAGNOSTICS
            All low-priority technical metrics live here, collapsed by
            default. Operators expand only what they need.
        ═══════════════════════════════════════════════════════════════ */}
        <section className="space-y-2.5 float-in stagger-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
              التشخيص المتقدّم
            </h2>
            <span className="text-3xs text-muted-foreground">انقر لتوسيع أي قسم</span>
          </div>

          <div className="space-y-2">
            {/* ── Scheduler details (was Panel 2) ── */}
            <SchedulerDetailsSection
              scheduler={scheduler}
              schedMeta={schedMeta}
              schedTitle={schedTitle}
              schedMessage={schedMessage}
            />

            {/* ── Panel 3: Runtime diagnostics grid ── */}
            <RuntimeDiagnosticsSection
              diag={diag}
              diagLoading={diagQ.isLoading}
              diagError={diagQ.isError}
              memorySeries={memorySeries}
              eventLoopSeries={eventLoopSeries}
              chart={chart}
            />

            {/* ── Panel 4: HTTP Request Analytics ── */}
            <HttpAnalyticsSection
              metrics={metrics}
              metricsError={metricsQ.isError}
              onRetryMetrics={() => void metricsQ.refetch()}
              reqRate={reqRate}
              errRate={errRate}
              p95Series={p95Series}
              chart={chart}
            />

            {/* ── Panel 5: Auth & Security ── */}
            {metrics && (
              <AuthSecuritySection metrics={metrics} authFailRate={authFailRate} chart={chart} />
            )}

            {/* ── Panel 6: Redis Performance ── */}
            {metrics && (
              <RedisPerformanceSection
                metrics={metrics}
                redisOpsRate={redisOpsRate}
                chart={chart}
              />
            )}

            {/* ── Panel 7: Socket.IO + Job Activity ── */}
            {metrics && <SocketJobsSection metrics={metrics} />}

            {/* ── Panel 7.5: Core Web Vitals p75 ── */}
            {metrics && Object.keys(metrics.cwv.p75).length > 0 && (
              <CoreWebVitalsSection metrics={metrics} />
            )}

            {/* ── Panel 8: Request rate trend chart (visual centerpiece) ── */}
            {samples.length >= 4 && (
              <DetailsSection title="مخطط معدل الطلبات (rps · آخر 60 عيّنة)">
                <div className="bg-card border border-border/60 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold">معدل الطلبات (طلب/ث)</h3>
                    <span className="text-3xs text-muted-foreground ms-auto">
                      آخر {Math.min(samples.length, 60)} عيّنة · ~
                      {Math.min(samples.length, 60) * 15}ث
                    </span>
                  </div>
                  {/* R125-I2 (A5-F3): the rps trend rides the lazy
                      recharts bridge (see the ChartsLoader module) with a
                      height-reserved fallback. R136 (UX-1): the fallback
                      is a Skeleton block now — geometry verbatim, the pair
                      net-new. (The sparkline slot's fallback above stays
                      a bare aria-hidden div: a decorative slot inside an
                      already-live card must not become its own live
                      region.) */}
                  <Suspense fallback={<Skeleton className="h-[120px] rounded-lg" />}>
                    <ChartsLoader>
                      {(rc) => (
                        <rc.ResponsiveContainer width="100%" height={120}>
                          <rc.AreaChart
                            data={reqRate.map((v, i) => ({ i, rps: v, errs: errRate[i] ?? 0 }))}
                            margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient id="rpsGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={chart.primary} stopOpacity={0.25} />
                                <stop offset="95%" stopColor={chart.primary} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <rc.CartesianGrid
                              strokeDasharray="3 3"
                              stroke={chart.grid}
                              vertical={false}
                            />
                            <rc.Tooltip
                              contentStyle={{
                                background: chart.tooltipBg,
                                border: `1px solid ${chart.tooltipBorder}`,
                                borderRadius: 12,
                                fontSize: 11,
                              }}
                              labelStyle={{ display: "none" }}
                              formatter={(v: number) => [v.toFixed(2), "طلب/ث"]}
                            />
                            <rc.Area
                              type="monotone"
                              dataKey="rps"
                              stroke={chart.primary}
                              fill="url(#rpsGrad)"
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </rc.AreaChart>
                        </rc.ResponsiveContainer>
                      )}
                    </ChartsLoader>
                  </Suspense>
                </div>
              </DetailsSection>
            )}
          </div>
        </section>
        {/* End of SECTION 2 — ADVANCED DIAGNOSTICS */}

        {/* ── Panel 9: Recent observability alerts ── */}
        <RecentAlertsSection alertsLoading={recentAlertsQ.isLoading} recentAlerts={recentAlerts} />

        {/* ── Panel 10: External dashboards ── */}
        {summary &&
          (summary.dashboards.render || summary.dashboards.sentry || summary.dashboards.neon) && (
            <ExternalDashboardsSection summary={summary} />
          )}
      </div>
    </AdminLayout>
  );
}
