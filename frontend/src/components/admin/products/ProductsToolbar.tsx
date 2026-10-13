import { Input } from "@/components/ui/input";
import { CATEGORY_FILTERS } from "@/components/admin/products/products-meta";
import { CheckSquare, Search, Square, X } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the toolbar (select-all toggle, the server-side search box with its
// clear button, the category chip bar and the clear-filters link).
// Presentational by contract: the page owns search/debouncedSearch/
// categoryFilter/selectedIds (the R120-B4 server-side ?search= debounce
// and the R127-B2 membership-honest select-all flag) — every keystroke and
// chip tap dispatches through the page-owned callbacks. The move only
// changes its address; DOM, classes, aria and event semantics are
// byte-identical.

export function ProductsToolbar({
  isLoading,
  filteredCount,
  allFilteredSelected,
  onToggleSelectAll,
  search,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  onClearFilters,
}: {
  isLoading: boolean;
  filteredCount: number;
  /** R127-B2 (§A): the membership-honest select-all flag. */
  allFilteredSelected: boolean;
  onToggleSelectAll: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  categoryFilter: string;
  onCategoryChange: (value: string) => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Select all toggle */}
      {!isLoading && filteredCount > 0 && (
        <button
          onClick={onToggleSelectAll}
          /* R127-B2 (§A.1 rider): aria-pressed mirrors orders.tsx:1560 —
             the visible text swap already announces the state; this
             exposes it to AT + makes test assertions uniform. */
          aria-pressed={allFilteredSelected}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-secondary"
          title={allFilteredSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
        >
          {allFilteredSelected ? (
            <CheckSquare className="w-3.5 h-3.5 text-primary" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">
            {allFilteredSelected ? "إلغاء الكل" : "تحديد الكل"}
          </span>
        </button>
      )}

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="بحث في المنتجات…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pr-9 h-9 w-52 text-sm"
        />
        {search && (
          <button
            onClick={() => onSearchChange("")}
            aria-label="مسح البحث"
            /* R120-B4 (A2-F12): the orders.tsx fixed version — bare
               w-3 icon ≈ 12px target; p-2 lifts the tappable area to
               ~28px. */
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {/* R139 (precision): the category bar leaves the segmented-control
          shell (a secondary-tinted tray + borderless resting chips + a
          card-colored active tile with its soft shadow) for the r138
          calm pill dialect — active bg-primary/15 + text-primary-text +
          border-primary/30 + font-bold, resting a bg-muted/30 box with
          the /30 border BOTH states carry (kills the 1px toggle jitter
          the borderless active caused). The CatalogFiltersBar /
          RiskFilterChips row shape: each pill owns its border box, so
          the tray wash is gone. aria-pressed untouched. */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
        {CATEGORY_FILTERS.map((c) => (
          <button
            key={c.value}
            onClick={() => onCategoryChange(c.value)}
            /* R124-C2 (A6 F10): the active chip was purely visual —
               aria-pressed exposes the toggle state (the
               orders.tsx/topups.tsx chip-bar idiom). */
            aria-pressed={categoryFilter === c.value}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap ${
              categoryFilter === c.value
                ? "bg-primary/15 text-primary-text border-primary/30 font-bold"
                : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {(search || categoryFilter) && (
        <button
          onClick={onClearFilters}
          className="text-xs text-muted-foreground hover:text-primary-text transition-colors"
        >
          مسح
        </button>
      )}
      <span className="text-xs text-muted-foreground mr-auto">{filteredCount} منتج</span>
    </div>
  );
}
