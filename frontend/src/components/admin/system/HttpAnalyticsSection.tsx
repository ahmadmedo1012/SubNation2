import { AlertCircle, Box, Clock, Radio, ShieldCheck } from "lucide-react";
import type { ChartColors } from "@/lib/chart-theme";
import { DetailsSection } from "@/components/admin/system/DetailsSection";
import { MetricCard } from "@/components/admin/system/MetricCard";
import { formatMs, formatNumber } from "@/components/admin/system/system-format";
import type { MetricsSnapshot } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the HTTP request-analytics panel (the honest metrics-failure banner +
// the four request tiles + the top-routes table). The metrics query stays
// in the page — data/error + the retry callback + the req/err/p95 series
// flow down as values; the move only changes its address, DOM/classes
// byte-identical.

export function HttpAnalyticsSection({
  metrics,
  metricsError,
  onRetryMetrics,
  reqRate,
  errRate,
  p95Series,
  chart,
}: {
  metrics: MetricsSnapshot | undefined;
  metricsError: boolean;
  /** metricsQ.refetch — the page owns the query. */
  onRetryMetrics: () => void;
  reqRate: number[];
  errRate: number[];
  p95Series: number[];
  chart: ChartColors;
}) {
  return (
    <>
      {/* 93-C6 / SY-1: the metrics queryFn used to swallow !ok
          bodies as data; on failure the section simply vanished.
          Now the failure is explicit (with a retry) instead of
          silently missing panels or fake zeros. */}
      {!metrics && metricsError && (
        <div
          role="alert"
          className="bg-card border border-status-warning/20 rounded-2xl p-4 flex items-center gap-3 flex-wrap"
        >
          <AlertCircle className="w-4 h-4 text-status-warning shrink-0" />
          <span className="text-xs text-muted-foreground flex-1 min-w-40">
            تعذّر جلب مقاييس المراقبة — قد تكون الجلسة منتهية أو الخدمة غير متاحة.
          </span>
          <button
            type="button"
            onClick={onRetryMetrics}
            /* R125-I2 (A6-B6): --primary-text (raw --primary is
               3.76:1 on dark — under the 4.5:1 text floor). */
            className="text-xs font-bold text-primary-text underline underline-offset-2 hover:opacity-80"
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      {metrics && (
        <DetailsSection title="تحليلات الطلبات HTTP (المسارات · حالات الاستجابة · زمن p50/p99)">
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
              sparkColor={chart.primary}
            />
            <MetricCard
              label="معدل الأخطاء (5xx)"
              value={`${(metrics.http.errorRate * 100).toFixed(2)}%`}
              sub={`${formatNumber(metrics.http.requestsByStatusClass["5xx"] ?? 0)} خطأ`}
              icon={AlertCircle}
              color={metrics.http.errorRate > 0.01 ? "text-status-error" : "text-status-success"}
              bg={metrics.http.errorRate > 0.01 ? "bg-status-error/10" : "bg-status-success/10"}
              border={
                metrics.http.errorRate > 0.01
                  ? "border-status-error/20"
                  : "border-status-success/20"
              }
              spark={errRate}
              sparkColor={chart.error}
            />
            <MetricCard
              label="زمن الاستجابة p95"
              value={formatMs(metrics.http.latency.p95Ms)}
              sub={`p50: ${formatMs(metrics.http.latency.p50Ms)} · p99: ${formatMs(metrics.http.latency.p99Ms)}`}
              icon={Clock}
              color={
                (metrics.http.latency.p95Ms ?? 0) > 1000 ? "text-status-error" : "text-status-info"
              }
              bg={
                (metrics.http.latency.p95Ms ?? 0) > 1000
                  ? "bg-status-error/10"
                  : "bg-status-info/10"
              }
              border={
                (metrics.http.latency.p95Ms ?? 0) > 1000
                  ? "border-status-error/20"
                  : "border-status-info/20"
              }
              spark={p95Series}
              sparkColor={chart.info}
            />
            <MetricCard
              label="حالات الاستجابة"
              value={`${formatNumber(metrics.http.requestsByStatusClass["2xx"] ?? 0)} / ${formatNumber(metrics.http.requestsByStatusClass["4xx"] ?? 0)}`}
              sub={`2xx ناجح · 4xx خطأ من العميل`}
              icon={ShieldCheck}
              color="text-status-success"
              bg="bg-status-success/10"
              border="border-status-success/20"
            />
          </div>

          {/* Top routes table */}
          {metrics.http.topRoutes.length > 0 && (
            <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
              {/* R139 (precision): the table's header seam joins the /60
                  value (139-e's orders-table header seam — one seam weight
                  across the admin lanes; was the full-strength
                  border-border, this lane's lone outlier). */}
              <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
                <Box className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-3xs text-muted-foreground font-bold">
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
                      <span className="text-3xs font-mono px-1.5 py-0.5 rounded bg-muted/40 border border-border/40 text-muted-foreground shrink-0">
                        {r.method}
                      </span>
                      <span className="font-mono text-xs flex-1 min-w-0 truncate" dir="ltr">
                        {r.route}
                      </span>
                      <span className="text-xs font-bold tabular-nums shrink-0">
                        {formatNumber(r.count)}
                      </span>
                      {errPct > 0 && (
                        /* R126-L5 (A3 item-10): the sub-1% error
                           text joins the warning sweep
                           (yellow-400 fails the light theme at
                           ~1.5:1). */
                        <span
                          className={`text-3xs font-bold tabular-nums shrink-0 ${errPct > 1 ? "text-status-error" : "text-status-warning"}`}
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
        </DetailsSection>
      )}
    </>
  );
}
