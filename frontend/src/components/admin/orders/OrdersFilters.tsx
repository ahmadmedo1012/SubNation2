import { Calendar } from "lucide-react";
import { DATE_RANGES, STATUS_FILTERS } from "@/components/admin/orders/orders-meta";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the filter
// row (the status tabs with counts + the date quick-filter + clear-all +
// the honest result count). The filter STATE and the R123 URL sync stay
// in the page: onSelectStatus / onSelectDays / onClearAll are page-owned
// handlers (each one also calls syncFilterParams — a raw setter must
// never reach an extract or the URL would desync from the chips). The
// move only changes the address; DOM, classes and aria-pressed
// semantics are byte-identical.

export function OrdersFilters({
  search,
  statusFilter,
  dateRange,
  statusCounts,
  allOrdersCount,
  filteredCount,
  onSelectStatus,
  onSelectDays,
  onClearAll,
}: {
  search: string;
  statusFilter: string;
  dateRange: number;
  statusCounts: Record<string, number>;
  allOrdersCount: number;
  filteredCount: number;
  onSelectStatus: (value: string) => void;
  onSelectDays: (days: number) => void;
  onClearAll: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Status filter tabs with counts */}
      <div className="flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1 overflow-x-auto scrollbar-none">
        {STATUS_FILTERS.map((s) => {
          const count = s.value ? (statusCounts[s.value] ?? 0) : allOrdersCount;
          const active = statusFilter === s.value;
          return (
            <button
              key={s.value}
              onClick={() => onSelectStatus(s.value)}
              /* R124-I5 (A6 F10): the active chip was purely visual —
                 aria-pressed exposes the toggle state to assistive
                 tech (the coupons.tsx chip-bar idiom). */
              aria-pressed={active}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                active
                  ? "bg-card shadow-sm text-foreground font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
              {count > 0 && (
                <span
                  className={`text-3xs font-bold px-1 rounded ${active ? "text-muted-foreground" : "text-muted-foreground"}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Date range quick-filter */}
      <div className="flex items-center gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1">
        <Calendar className="w-3 h-3 text-muted-foreground mx-1" />
        {DATE_RANGES.map((dr) => (
          <button
            key={dr.days}
            onClick={() => onSelectDays(dr.days)}
            /* R124-I5 (A6 F10): same toggle-state exposure as the
               status chips. */
            aria-pressed={dateRange === dr.days}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
              dateRange === dr.days
                ? "bg-card shadow-sm text-foreground font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {dr.label}
          </button>
        ))}
      </div>

      {(search || statusFilter || dateRange > 0) && (
        <button
          onClick={onClearAll}
          className="text-xs text-muted-foreground hover:text-primary-text transition-colors"
        >
          مسح الكل
        </button>
      )}

      <span className="text-xs text-muted-foreground mr-auto">{filteredCount} نتيجة</span>
    </div>
  );
}
