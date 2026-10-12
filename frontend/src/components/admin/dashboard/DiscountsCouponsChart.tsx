import { Suspense } from "react";
import type { ChartColors } from "@/lib/chart-theme";
import { ChartTooltip } from "./ChartTooltip";
import { fmtChartTick, type ChartDay } from "./chart-data";
import { ChartPanelFallback, ChartsLoader } from "./ChartsLoader";

// R137 (FE admin decomposition): the Discounts & Coupon Orders chart panel
// moved verbatim from pages/admin/dashboard.tsx — the finance scope gate
// stays in the page; the panel renders the page-computed series + palette
// as values (recharts JSX byte-identical, riding the shared ChartsLoader
// lazy bridge).

export function DiscountsCouponsChart({
  chart,
  chartLoading,
  chartData,
  displayData,
}: {
  chart: ChartColors;
  chartLoading: boolean;
  chartData: ChartDay[];
  displayData: ChartDay[];
}) {
  return (
    /* Discounts & Coupon Orders chart */
    <div className="bg-card border border-border/60 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-bold text-sm">الخصومات والكوبونات</h2>
          <p className="text-3xs text-muted-foreground mt-0.5">
            قيمة الخصم اليومي وعدد الطلبات باستخدام كوبون
          </p>
        </div>
        <div className="flex items-center gap-3 text-3xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-status-warning rounded inline-block" />
            الخصومات
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-status-success inline-block" />
            طلبات بكوبون
          </span>
        </div>
      </div>
      {/* R125-I2 (A5-F8 + F3): same keep-mounted rule as
          the revenue panel (skeleton only on first load,
          dimmed otherwise) + the lazy recharts bridge. */}
      {chartLoading && chartData.length === 0 ? (
        <ChartPanelFallback heightClass="h-28" />
      ) : !chartLoading &&
        displayData.every((d) => (d.discounts || 0) === 0 && (d.coupon_orders || 0) === 0) ? (
        <div className="h-28 flex items-center justify-center text-muted-foreground text-xs">
          لا يوجد استخدام كوبونات في هذه الفترة
        </div>
      ) : (
        <div className={chartLoading ? "opacity-60 transition-opacity" : undefined}>
          <Suspense fallback={<ChartPanelFallback heightClass="h-28" />}>
            <ChartsLoader>
              {(rc) => (
                <rc.ResponsiveContainer width="100%" height={120}>
                  <rc.BarChart
                    data={displayData}
                    margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                  >
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
                    <rc.Bar
                      dataKey="discounts"
                      name="الخصومات"
                      fill={chart.warning}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={24}
                      fillOpacity={0.8}
                    />
                    <rc.Bar
                      dataKey="coupon_orders"
                      name="طلبات بكوبون"
                      fill={chart.success}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={24}
                      fillOpacity={0.8}
                    />
                  </rc.BarChart>
                </rc.ResponsiveContainer>
              )}
            </ChartsLoader>
          </Suspense>
        </div>
      )}
    </div>
  );
}
