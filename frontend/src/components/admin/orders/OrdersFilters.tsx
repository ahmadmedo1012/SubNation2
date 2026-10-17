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
              /* R139 (precision): the active status chip joins the r138
                 calm-pill family — bg-primary/15 + text-primary-text +
                 border-primary/30 + font-bold (the VariantSelector /
                 CatalogFiltersBar dialect). Both states now carry a
                 border box (inactive = transparent), killing the 1px
                 text jitter the borderless inactive state caused on
                 toggle; the old bg-card + shadow-sm read as a mini
                 elevation lifting the active chip. Inactive stays
                 quiet muted ink over the trough with a muted/30 hover
                 wash. aria-pressed byte-identical. */
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                active
                  ? "bg-primary/15 text-primary-text border border-primary/30 font-bold"
                  : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
              }`}
            >
              {s.label}
              {count > 0 && (
                /* R139 (precision): the count chip's dead active/
                   inactive ternary (both branches were identical)
                   collapses to one muted ink — quiet metadata on both
                   pill states. */
                <span className="text-3xs font-bold px-1 rounded text-muted-foreground">
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
            /* R139 (precision): the date quick-filter joins the status
               chips' calm-pill dialect (one row, one language):
               active = bg-primary/15 + primary-text + /30 border +
               bold; inactive = transparent border box + muted ink +
               muted/30 hover wash. */
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
              dateRange === dr.days
                ? "bg-primary/15 text-primary-text border border-primary/30 font-bold"
                : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
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

      <span className="text-xs text-muted-foreground ms-auto">{filteredCount} نتيجة</span>
    </div>
  );
}
