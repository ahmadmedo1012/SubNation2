import {
  AlertCircle,
  Clock,
  Database,
  HeartPulse,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  Wifi,
} from "lucide-react";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { SkeletonText } from "@/components/ui/Skeleton";
import { formatRelativeTime } from "@/lib/utils";
import { type CheckStatus, type HealthCheck, type HealthzReadyResponse } from "@/lib/healthz";
import { formatMs, formatNumber } from "@/components/admin/system/system-format";
import { STATUS_META, type StatusMetaEntry } from "@/components/admin/system/system-meta";
import { HealthTile } from "@/components/admin/system/HealthTile";
import type {
  MetricsSnapshot,
  ObservabilitySummary,
  SchedulerResponse,
} from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// SECTION 1, the health-overview strip (honest healthz error / announcing
// skeleton / the seven KPI tiles + the critical scheduler banner). The
// healthz query, its retry and the filtered-checks derivation stay in the
// page — loading/error/retry flow down as values + one callback; the
// extracts render the byte-identical DOM they rendered inline yesterday
// (the sentry tile's alertsStale local became a prop of the same name).

export function HealthOverviewSection({
  health,
  healthLoading,
  healthError,
  onRetryHealth,
  filteredChecks,
  metrics,
  scheduler,
  schedTone,
  schedMeta,
  schedTitle,
  schedMessage,
  summary,
  alertsStale,
}: {
  health: HealthzReadyResponse | undefined;
  healthLoading: boolean;
  healthError: boolean;
  /** healthQ.refetch — the page owns the query. */
  onRetryHealth: () => void;
  /** /healthz/ready checks minus "worker" (the scheduler panel owns it). */
  filteredChecks: Record<string, HealthCheck>;
  metrics: MetricsSnapshot | undefined;
  scheduler: SchedulerResponse | undefined;
  schedTone: CheckStatus;
  schedMeta: StatusMetaEntry;
  schedTitle: string;
  schedMessage: string;
  summary: ObservabilitySummary | undefined;
  /** recentAlertsQ.data?.stale === true — computed in the page. */
  alertsStale: boolean;
}) {
  return (
    <section className="space-y-2.5 float-in stagger-1">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <HeartPulse className="w-3.5 h-3.5 text-primary" />
          نظرة سريعة على الصحة
        </h2>
        <span className="text-3xs text-muted-foreground">تحديث تلقائي</span>
      </div>

      {healthError ? (
        // R133 (A3-F4): an unreachable /healthz/ready is an ERROR —
        // the old silent "degraded" fallback fabricated an
        // infrastructure verdict out of an authorization outcome or
        // an outage (the amber pill + amber tiles looked like real
        // readings). The FetchErrorCard is the family's honest
        // shape; the 60 s poll keeps retrying behind it.
        <FetchErrorCard
          size="section"
          retryIcon={RefreshCw}
          title="تعذّر تحميل حالة الصحة"
          description="تعذّر الوصول إلى فحوص الجهوزية — تحقّق من الاتصال بالخادم ثم أعد المحاولة"
          onRetry={onRetryHealth}
        />
      ) : healthLoading || !health ? (
        /* R136 (UX-1): SkeletonText — the 7-tile health grid becomes
           one announcing wrapper (role=status + sr-only, net-new)
           with the grid classes + tile geometry verbatim. */
        <SkeletonText
          count={7}
          wrapperClassName="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2"
          className="h-[56px] rounded-xl"
          lastShorter={false}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
          {/* DB / Neon */}
          {(() => {
            const c = filteredChecks.neon;
            return (
              <HealthTile
                label="قاعدة البيانات"
                value={c ? STATUS_META[c.status].label : "—"}
                status={c?.status ?? "degraded"}
                icon={Database}
                hint={c?.latencyMs != null ? `${c.latencyMs}ms` : (c?.error ?? undefined)}
              />
            );
          })()}

          {/* Redis */}
          {(() => {
            const c = filteredChecks.redis;
            return (
              <HealthTile
                label="Redis"
                value={c ? STATUS_META[c.status].label : "—"}
                status={c?.status ?? "degraded"}
                icon={Database}
                hint={c?.latencyMs != null ? `${c.latencyMs}ms` : (c?.error ?? undefined)}
              />
            );
          })()}

          {/* Socket.IO */}
          {(() => {
            const c = filteredChecks.socket;
            const clients = metrics?.socket.connectedClients;
            return (
              <HealthTile
                label="Socket.IO"
                value={
                  clients != null
                    ? `${formatNumber(clients)} اتصال`
                    : c
                      ? STATUS_META[c.status].label
                      : "—"
                }
                status={c?.status ?? "degraded"}
                icon={Wifi}
                hint={c?.latencyMs != null ? `${c.latencyMs}ms` : undefined}
              />
            );
          })()}

          {/* API latency (p95) */}
          {(() => {
            const p95 = metrics?.http.latency.p95Ms ?? null;
            const tone: CheckStatus | "neutral" =
              p95 == null ? "neutral" : p95 > 1000 ? "failing" : p95 > 500 ? "degraded" : "ok";
            return (
              <HealthTile
                label="زمن الاستجابة p95"
                value={formatMs(p95)}
                status={tone}
                icon={Clock}
                hint={
                  metrics?.http.latency.p99Ms != null
                    ? `p99 ${formatMs(metrics.http.latency.p99Ms)}`
                    : undefined
                }
              />
            );
          })()}

          {/* Error rate (5xx) */}
          {(() => {
            const er = metrics?.http.errorRate ?? null;
            const tone: CheckStatus | "neutral" =
              er == null ? "neutral" : er > 0.05 ? "failing" : er > 0.01 ? "degraded" : "ok";
            const errCount = metrics?.http.requestsByStatusClass["5xx"] ?? 0;
            return (
              <HealthTile
                label="معدل الأخطاء"
                value={er == null ? "—" : `${(er * 100).toFixed(2)}%`}
                status={tone}
                icon={AlertCircle}
                hint={errCount > 0 ? `${formatNumber(errCount)} خطأ 5xx` : "بدون أخطاء"}
              />
            );
          })()}

          {/* Background jobs / scheduler */}
          <HealthTile
            label="المهام الخلفية"
            value={
              scheduler == null
                ? "—"
                : scheduler.mode === "disabled"
                  ? "معطّلة"
                  : scheduler.heartbeat.healthy
                    ? "نشطة"
                    : scheduler.heartbeat.expected
                      ? "نبضة متأخرة"
                      : "قيد البدء"
            }
            status={schedTone}
            icon={TimerReset}
            hint={
              scheduler?.heartbeat.ageSec != null
                ? `نبضة قبل ${scheduler.heartbeat.ageSec}ث`
                : scheduler?.mode
                  ? `mode: ${scheduler.mode}`
                  : undefined
            }
          />

          {/* Sentry / monitoring */}
          {(() => {
            const sentryUrl = summary?.dashboards.sentry;
            const tone: CheckStatus | "neutral" = !summary
              ? "neutral"
              : sentryUrl && !alertsStale
                ? "ok"
                : "degraded";
            const value = !summary
              ? "—"
              : sentryUrl
                ? alertsStale
                  ? "تنبيهات قديمة"
                  : "متصل"
                : "غير مهيأ";
            return (
              <HealthTile
                label="المراقبة"
                value={value}
                status={tone}
                icon={ShieldCheck}
                hint={
                  summary?.alerts.lastKnownGoodAt
                    ? `آخر إشارة: ${formatRelativeTime(summary.alerts.lastKnownGoodAt)}`
                    : undefined
                }
              />
            );
          })()}
        </div>
      )}

      {/* Critical scheduler banner — only when NOT healthy.
          When healthy the tile above already conveys it; we suppress
          the banner to keep the overview calm. */}
      {scheduler && schedTone !== "ok" && (
        <div
          className={`flex items-center gap-3 p-3 rounded-2xl border ${schedMeta.bg} ${schedMeta.border}`}
        >
          <div
            className={`w-8 h-8 rounded-xl ${schedMeta.bg} flex items-center justify-center shrink-0`}
          >
            <TimerReset className={`w-4 h-4 ${schedMeta.color}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`font-bold text-xs ${schedMeta.color} truncate`}>{schedTitle}</p>
            <p className="text-2xs text-muted-foreground truncate">{schedMessage}</p>
          </div>
        </div>
      )}
    </section>
  );
}
