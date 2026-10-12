import { BarChart2 } from "lucide-react";
import { ChartPickers } from "./ChartPickers";

// R137 (FE admin decomposition): the charts column's honest no-data-yet
// block moved verbatim from pages/admin/dashboard.tsx — the chartEmpty /
// showChartsColumn gates stay in the page; the pickers take the range
// atoms + the page-owned range-change callbacks.

export function ChartsEmptyState({
  granularity,
  onGranularityChange,
  chartDays,
  onDaysChange,
}: {
  granularity: "daily" | "weekly" | "monthly";
  onGranularityChange: (g: "daily" | "weekly" | "monthly") => void;
  chartDays: number;
  onDaysChange: (d: number) => void;
}) {
  return (
    /* R115 (A9 P2): the honest no-data-yet block — a brand-new
       store's dashboard no longer loses its whole charts
       column in silence. */
    <div className="xl:col-span-3 bg-card border border-border/60 rounded-2xl p-5 float-in stagger-7">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-sm">الرسوم البيانية</h2>
          <p className="text-3xs text-muted-foreground mt-1">
            بيانات الفترة الحالية فارغة — جرّب فترة أطول
          </p>
        </div>
        {/* R125: the pickers render in the EMPTY state too —
            “no data this week” must not strand the operator
            with no way to look further back (ChartPickers). */}
        <ChartPickers
          granularity={granularity}
          onGranularityChange={onGranularityChange}
          chartDays={chartDays}
          onDaysChange={onDaysChange}
        />
      </div>
      <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-8">
        <BarChart2 className="w-9 h-9 mb-3 opacity-20" />
        <p className="text-sm font-bold text-foreground/80">لا توجد بيانات بعد</p>
        <p className="text-xs mt-1 leading-relaxed">
          ستظهر الرسوم البيانية مع أول طلب أو تسجيل مستخدم جديد
        </p>
      </div>
    </div>
  );
}
