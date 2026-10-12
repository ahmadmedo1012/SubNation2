import { AlertTriangle, ShieldCheck, Zap } from "lucide-react";
import type { ChartColors } from "@/lib/chart-theme";
import { DetailsSection } from "@/components/admin/system/DetailsSection";
import { MetricCard } from "@/components/admin/system/MetricCard";
import { formatNumber } from "@/components/admin/system/system-format";
import type { MetricsSnapshot } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the auth & security panel of the advanced-diagnostics section (attempts /
// failure rate / firebase failures / lockouts). The metrics query stays in
// the page — the snapshot + the auth-failure sparkline series flow down as
// values; the move only changes its address, DOM/classes byte-identical.

export function AuthSecuritySection({
  metrics,
  authFailRate,
  chart,
}: {
  metrics: MetricsSnapshot;
  authFailRate: number[];
  chart: ChartColors;
}) {
  return (
    <DetailsSection title="المصادقة والأمان (المحاولات · معدل الفشل · حالات القفل)">
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
          color="text-status-success"
          bg="bg-status-success/10"
          border="border-status-success/20"
        />
        <MetricCard
          label="معدل الفشل"
          value={`${(metrics.auth.failureRate * 100).toFixed(1)}%`}
          sub="فشل + قفل / إجمالي"
          icon={AlertTriangle}
          /* R126-L5 (A3 item-10): the failure-rate MetricCard's
             healthy branch joins the warning sweep (yellow-400
             fails the light theme at ~1.5:1). */
          color={metrics.auth.failureRate > 0.1 ? "text-status-error" : "text-status-warning"}
          bg={metrics.auth.failureRate > 0.1 ? "bg-status-error/10" : "bg-status-warning/10"}
          border={
            metrics.auth.failureRate > 0.1 ? "border-status-error/20" : "border-status-warning/20"
          }
          spark={authFailRate}
          sparkColor={chart.warning}
        />
        <MetricCard
          label="فشل Firebase"
          value={formatNumber(metrics.auth.outcomes["firebase:failure"] ?? 0)}
          sub="جلسة Firebase / OTP"
          icon={Zap}
          color="text-status-low-stock"
          bg="bg-status-low-stock/10"
          border="border-status-low-stock/20"
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
          color="text-status-error"
          bg="bg-status-error/10"
          border="border-status-error/20"
        />
      </div>
    </DetailsSection>
  );
}
