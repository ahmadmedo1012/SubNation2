import { AlertCircle, Clock, Wifi, Zap } from "lucide-react";
import type { ChartColors } from "@/lib/chart-theme";
import { DetailsSection } from "@/components/admin/system/DetailsSection";
import { MetricCard } from "@/components/admin/system/MetricCard";
import { formatCount } from "@/lib/utils";
import { formatMs, formatNumber } from "@/components/admin/system/system-format";
import type { MetricsSnapshot } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the Redis performance panel of the advanced-diagnostics section
// (connection state / ops total / ping latency / errors). The metrics
// query stays in the page — the snapshot + the redis-ops sparkline series
// flow down as values; the move only changes its address, DOM/classes
// byte-identical.

/** Arabic plural forms for تخفيض — R187L-F1: the connection tile's
 *  degraded-events sub-count (the ALERT_COUNT_FORMS local-object idiom;
 *  was the frozen «N تخفيض»). */
const DEGRADE_COUNT_FORMS = {
  zero: "تخفيضات",
  one: "تخفيض",
  two: "تخفيضان",
  few: "تخفيضات",
  many: "تخفيضًا",
  other: "تخفيض",
};

export function RedisPerformanceSection({
  metrics,
  redisOpsRate,
  chart,
}: {
  metrics: MetricsSnapshot;
  redisOpsRate: number[];
  chart: ChartColors;
}) {
  return (
    <DetailsSection title="أداء Redis (الاتصال · العمليات · ping latency · الأخطاء)">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="حالة الاتصال"
          value={metrics.redis.available ? "متصل" : "غير متصل"}
          sub={
            metrics.redis.degradedEvents > 0
              ? formatCount(metrics.redis.degradedEvents, DEGRADE_COUNT_FORMS)
              : "بدون تخفيضات"
          }
          icon={Wifi}
          color={metrics.redis.available ? "text-status-success" : "text-status-error"}
          bg={metrics.redis.available ? "bg-status-success/10" : "bg-status-error/10"}
          border={metrics.redis.available ? "border-status-success/20" : "border-status-error/20"}
        />
        <MetricCard
          label="إجمالي العمليات"
          value={formatNumber(Object.values(metrics.redis.opsTotal).reduce((a, b) => a + b, 0))}
          sub="get/set/ping/etc"
          icon={Zap}
          color="text-primary"
          bg="bg-primary/10"
          border="border-primary/20"
          spark={redisOpsRate}
          sparkColor={chart.primary}
        />
        <MetricCard
          label="ping latency p95"
          value={formatMs(metrics.redis.pingLatencyMs.p95)}
          sub={`p50: ${formatMs(metrics.redis.pingLatencyMs.p50)} · p99: ${formatMs(metrics.redis.pingLatencyMs.p99)}`}
          icon={Clock}
          color={
            (metrics.redis.pingLatencyMs.p95 ?? 0) > 100 ? "text-status-error" : "text-status-info"
          }
          bg={
            (metrics.redis.pingLatencyMs.p95 ?? 0) > 100
              ? "bg-status-error/10"
              : "bg-status-info/10"
          }
          border={
            (metrics.redis.pingLatencyMs.p95 ?? 0) > 100
              ? "border-status-error/20"
              : "border-status-info/20"
          }
        />
        <MetricCard
          label="إجمالي الأخطاء"
          value={formatNumber(Object.values(metrics.redis.errorsTotal).reduce((a, b) => a + b, 0))}
          sub={
            Object.entries(metrics.redis.errorsTotal)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 1)
              .map(([k]) => k)[0] ?? "بدون"
          }
          icon={AlertCircle}
          color={
            Object.values(metrics.redis.errorsTotal).reduce((a, b) => a + b, 0) > 0
              ? "text-status-error"
              : "text-status-success"
          }
          bg={
            Object.values(metrics.redis.errorsTotal).reduce((a, b) => a + b, 0) > 0
              ? "bg-status-error/10"
              : "bg-status-success/10"
          }
          border={
            Object.values(metrics.redis.errorsTotal).reduce((a, b) => a + b, 0) > 0
              ? "border-status-error/20"
              : "border-status-success/20"
          }
        />
      </div>
    </DetailsSection>
  );
}
