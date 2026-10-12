import { Suspense } from "react";
import { Download } from "lucide-react";
import type { ChartColors } from "@/lib/chart-theme";
import { ChartTooltip } from "./ChartTooltip";
import { fmtChartTick, type ChartDay } from "./chart-data";
import { ChartPanelFallback, ChartsLoader } from "./ChartsLoader";

// R137 (FE admin decomposition): the New Users chart panel moved verbatim
// from pages/admin/dashboard.tsx — the users CSV export ACTION stays in the
// page (handleExportUsersChart owns the blob/download); the panel takes it
// as a callback, and the series/palette flow down as values.

export function NewUsersChart({
  chart,
  chartLoading,
  chartData,
  displayData,
  granularity,
  chartDays,
  onExportUsers,
}: {
  chart: ChartColors;
  chartLoading: boolean;
  chartData: ChartDay[];
  displayData: ChartDay[];
  granularity: "daily" | "weekly" | "monthly";
  chartDays: number;
  onExportUsers: () => void;
}) {
  return (
    /* New users chart */
    <div className="bg-card border border-border/60 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-sm">المستخدمون الجدد</h2>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted-foreground bg-muted/40 border border-border/60 px-2 py-0.5 rounded-full">
            {granularity === "daily" ? "يومي" : granularity === "weekly" ? "أسبوعي" : "شهري"} · آخر{" "}
            {chartDays} يوم
          </span>
          <button
            onClick={onExportUsers}
            className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-muted-foreground"
            title="تصدير CSV"
          >
            <Download className="w-3 h-3" />
          </button>
        </div>
      </div>
      {/* R125-I2 (A5-F8 + F3): keep-mounted across period
          switches + the lazy recharts bridge (see the
          revenue panel comment). */}
      {chartLoading && chartData.length === 0 ? (
        <ChartPanelFallback heightClass="h-28" />
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
                      allowDecimals={false}
                    />
                    <rc.Tooltip content={<ChartTooltip />} />
                    <rc.Bar
                      dataKey="users"
                      name="مستخدمون جدد"
                      fill={chart.info}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
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
