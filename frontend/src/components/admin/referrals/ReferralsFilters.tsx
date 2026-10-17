import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { STATUS_FILTERS } from "@/components/admin/referrals/referrals-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/referrals.tsx —
// the filter row (the search box + the three status chips). The search
// and statusFilter atoms stay in the page (the 300ms debounce →
// debouncedSearch → params-in-queryKey race guard keys off them);
// keystrokes and chip taps report up through the page-owned
// onSearchChange/onStatusFilterChange callbacks. The move only changes
// its address; DOM, classes, aria and Arabic copy are byte-identical.

export function ReferralsFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
}) {
  return (
    <>
      {/* Filters + search */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="بحث برقم المُحيل أو المُحال..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="ps-9 h-9 text-sm"
          />
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => onStatusFilterChange(f.value)}
              /* R139 (precision): the status chips join the r138 calm-pill
                 family (the no-trough row shape — RiskFilterChips /
                 ProductsToolbar's dialect): active = bg-primary/15 +
                 text-primary-text + border-primary/30 + font-bold; the old
                 solid bg-primary + white ink + brand shadow was the
                 pre-r138 raised segment. Both states carry a border box
                 (inactive = muted/30 + border/30) so the 1px toggle jitter
                 dies; base weight steps 700→600 with bold reserved for the
                 active state (the OrdersFilters ladder). onClick + DOM
                 byte-identical. */
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all press-spring ${
                statusFilter === f.value
                  ? "bg-primary/15 text-primary-text border border-primary/30 font-bold"
                  : "bg-muted/30 border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
