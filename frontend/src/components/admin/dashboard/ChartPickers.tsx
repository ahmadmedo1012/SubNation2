import { Download } from "lucide-react";

// R137 (FE admin decomposition): the granularity/period chip pickers moved
// verbatim from pages/admin/dashboard.tsx — the chartDays/granularity atoms
// stay centralized in the page; the pickers take values + the page-owned
// range-change callbacks (and the export callback only where meaningful).

// Round-3 (8-e §2): period chips hardcoded Arabic-Indic digits ("٧
// أيام") while the same screen shows Latin percentages, Latin money
// tiles and Latin chart counts — three numeral regimes on one dashboard.
// Latin everywhere (the site-wide numeral policy); the Arabic words stay.
const PERIOD_OPTIONS = [
  { label: "7 أيام", days: 7 },
  { label: "14 يوماً", days: 14 },
  { label: "شهر", days: 30 },
  { label: "3 أشهر", days: 90 },
];

const GRANULARITY_OPTIONS = [
  { label: "يومي", value: "daily" },
  { label: "أسبوعي", value: "weekly" },
  { label: "شهري", value: "monthly" },
] as const;

/** R125 (A6-B10 / A1-6 + the chart-race pins): the granularity/period
 * chip pickers, extracted so BOTH chart states render them — the
 * empty-state block previously offered no way to switch period, yet
 * “7d empty” does not mean “90d empty” (a store with last-month
 * orders showed the no-data-yet copy with no honest way to look
 * further back). Each cluster is a named role="group" whose chips
 * expose aria-pressed (the coupons.tsx/orders.tsx chip-bar idiom). */
export function ChartPickers({
  granularity,
  onGranularityChange,
  chartDays,
  onDaysChange,
  onExport,
}: {
  granularity: "daily" | "weekly" | "monthly";
  onGranularityChange: (g: "daily" | "weekly" | "monthly") => void;
  chartDays: number;
  onDaysChange: (d: number) => void;
  onExport?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Granularity picker */}
      <div
        role="group"
        aria-label="دقة المخطط الزمني"
        className="flex items-center gap-0.5 bg-muted/40 border border-border/60 rounded-lg p-0.5"
      >
        {GRANULARITY_OPTIONS.map((g) => (
          <button
            key={g.value}
            onClick={() => onGranularityChange(g.value)}
            aria-pressed={granularity === g.value}
            /* R139 (precision): the selected chip migrates to the calm
               active pill — bg-primary/15 + text-primary-text +
               border-primary/30 + font-bold, BOTH states carrying the
               border box (the login-tab geometry: chips sit on a recessed
               bg-muted/40 track exactly as those tabs sat on bg-muted/30).
               The old bg-card + shadow-sm "raised segment" was a second
               selected-state vocabulary; one family now covers nav items,
               login tabs, risk chips and these pickers. aria-pressed and
               the px/py text scale are byte-identical (admin density). */
            className={`px-2 py-1 rounded text-3xs border transition-all duration-150 ${
              granularity === g.value
                ? "bg-primary/15 text-primary-text border-primary/30 font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Period picker */}
      <div
        role="group"
        aria-label="الفترة الزمنية للمخطط"
        className="flex items-center gap-0.5 bg-muted/40 border border-border/60 rounded-lg p-0.5"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.days}
            onClick={() => onDaysChange(opt.days)}
            aria-pressed={chartDays === opt.days}
            /* R139 (precision): same calm-active migration as the
               granularity cluster above — one selected-state vocabulary
               for both picker tracks (period at text-2xs keeps its own
               scale). */
            className={`px-2.5 py-1 rounded text-2xs border transition-all duration-150 ${
              chartDays === opt.days
                ? "bg-primary/15 text-primary-text border-primary/30 font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Export chart data (meaningful only with data on screen) */}
      {onExport && (
        <button
          onClick={onExport}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="تصدير بيانات المخطط CSV"
          aria-label="تصدير بيانات المخطط CSV"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
