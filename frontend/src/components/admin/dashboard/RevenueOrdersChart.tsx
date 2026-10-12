import { Suspense } from "react";
import type { ChartColors } from "@/lib/chart-theme";
import { ChartPickers } from "./ChartPickers";
import { ChartTooltip } from "./ChartTooltip";
import { fmtChartTick, type ChartDay } from "./chart-data";
import { ChartPanelFallback, ChartsLoader } from "./ChartsLoader";

// R137 (FE admin decomposition): the Revenue + Orders chart panel moved
// verbatim from pages/admin/dashboard.tsx — the query, the displayData
// aggregation, the range atoms and the CSV export handler stay in the
// page; the panel renders the page-computed series + palette as values
// (the recharts JSX is byte-identical, riding the shared ChartsLoader
// lazy bridge).

export function RevenueOrdersChart({
  chart,
  chartLoading,
  chartData,
  displayData,
  granularity,
  onGranularityChange,
  chartDays,
  onDaysChange,
  onExport,
}: {
  chart: ChartColors;
  chartLoading: boolean;
  chartData: ChartDay[];
  displayData: ChartDay[];
  granularity: "daily" | "weekly" | "monthly";
  onGranularityChange: (g: "daily" | "weekly" | "monthly") => void;
  chartDays: number;
  onDaysChange: (d: number) => void;
  onExport: () => void;
}) {
  return (
    /* Revenue + Orders chart */
    <div className="bg-card border border-border/60 rounded-2xl p-5">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-sm">الإيرادات والطلبات</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center gap-1 text-3xs text-muted-foreground">
              <span className="w-3 h-0.5 bg-primary rounded inline-block" />
              الإيرادات
            </span>
            <span className="flex items-center gap-1 text-3xs text-muted-foreground">
              <span className="w-3 h-0.5 bg-status-success rounded inline-block" />
              الطلبات
            </span>
            <span className="flex items-center gap-1 text-3xs text-muted-foreground">
              <span className="w-3 h-px border-t-2 border-status-warning border-dashed inline-block" />
              الخصومات
            </span>
          </div>
        </div>
        <ChartPickers
          granularity={granularity}
          onGranularityChange={onGranularityChange}
          chartDays={chartDays}
          onDaysChange={onDaysChange}
          onExport={onExport}
        />
      </div>
      {/* R125-I2 (A5-F8): period switches keep the charts
          MOUNTED — the old unmount-to-skeleton on every
          chip flip forced a full recharts re-init
          (~100-300 ms low-end) + a visual flash. The
          skeleton now shows only on the FIRST load (no
          data yet); afterwards the previous series stays
          visible, dimmed, until the new one lands
          (recharts updates in place cheaply on
          identity-stable data). The charts ride the lazy
          recharts bridge (A5-F3) — the Suspense fallback
          reserves the exact panel height. */}
      {chartLoading && chartData.length === 0 ? (
        <ChartPanelFallback heightClass="h-40" />
      ) : (
        <div className={chartLoading ? "opacity-60 transition-opacity" : undefined}>
          <Suspense fallback={<ChartPanelFallback heightClass="h-40" />}>
            <ChartsLoader>
              {(rc) => (
                <rc.ResponsiveContainer width="100%" height={160}>
                  <rc.AreaChart
                    data={displayData}
                    margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chart.primary} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={chart.primary} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chart.success} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={chart.success} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="discGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chart.warning} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={chart.warning} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <rc.CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                    <rc.XAxis
                      dataKey="date"
                      tickFormatter={fmtChartTick}
                      tick={{ fontSize: 10, fill: chart.muted }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <rc.YAxis
                      tick={{ fontSize: 10, fill: chart.muted }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <rc.Tooltip content={<ChartTooltip />} />
                    <rc.Area
                      type="monotone"
                      dataKey="revenue"
                      name="الإيرادات"
                      stroke={chart.primary}
                      fill="url(#revGrad)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                    <rc.Area
                      type="monotone"
                      dataKey="orders"
                      name="الطلبات"
                      stroke={chart.success}
                      fill="url(#ordGrad)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                    <rc.Area
                      type="monotone"
                      dataKey="discounts"
                      name="الخصومات"
                      stroke={chart.warning}
                      fill="url(#discGrad)"
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3 }}
                      strokeDasharray="4 2"
                    />
                  </rc.AreaChart>
                </rc.ResponsiveContainer>
              )}
            </ChartsLoader>
          </Suspense>
        </div>
      )}
    </div>
  );
}
