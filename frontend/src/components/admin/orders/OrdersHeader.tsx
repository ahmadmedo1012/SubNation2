import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Search, X } from "lucide-react";
import { formatCount, formatCurrency } from "@/lib/utils";
import { ORDER_COUNT_FORMS } from "@/components/admin/orders/orders-meta";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the page
// header (the honest-count line + today chip + filtered-revenue chip +
// the search box + the export button). The search/export STATE and the
// handlers stay in the page: onSearchChange / onClearSearch / onExport
// are page-owned callbacks (exportSelected closes over the live
// selection; the export pick — selected vs all — is computed at the
// page's render, exactly where the old inline ternary lived). The move
// only changes the address; DOM, classes, aria (the orders-search id the
// page's "/" shortcut focuses) and event semantics are byte-identical.

export function OrdersHeader({
  knownTotal,
  allOrdersCount,
  todayCount,
  filteredCount,
  totalRevenue,
  search,
  onSearchChange,
  onClearSearch,
  selectedCount,
  onExport,
}: {
  knownTotal: boolean;
  allOrdersCount: number;
  todayCount: number;
  filteredCount: number;
  totalRevenue: number;
  search: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  selectedCount: number;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold mb-0.5">الطلبات</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {/* 94-C2 (A2 P1-1): honest count. «إجمالاً» is only true
              when the whole result set provably fits one page; an
              accumulating list is labeled with what it actually
              shows («عرض N»), never a grand total it can't know. */}
          <span>
            {knownTotal
              ? `${formatCount(allOrdersCount, ORDER_COUNT_FORMS)} إجمالاً`
              : `عرض ${formatCount(allOrdersCount, ORDER_COUNT_FORMS)} (الأحدث أولاً)`}
          </span>
          {todayCount > 0 && (
            <>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
              <span className="text-primary-text font-bold">{todayCount} اليوم</span>
            </>
          )}
          {filteredCount !== allOrdersCount && (
            <>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
              {/* R139 (precision): money emphasis by weight+size, not
                  color (the r138 receipt rule) — the filtered-revenue
                  chip drops its decorative success ink for plain
                  foreground; font-bold + tabular-nums carry it. This
                  is revenue, not a status — no semantic register to
                  keep (unlike the topups pending-total, which keeps
                  warning ink as semantic-pending money). */}
              <span className="text-foreground font-bold tabular-nums">
                {formatCurrency(totalRevenue)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
        {/* Search */}
        <div className="relative flex-1 sm:flex-none">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            id="orders-search"
            placeholder="بحث... ( / )"
            aria-label="البحث في الطلبات"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pr-9 h-9 w-full sm:w-56 text-sm"
          />
          {search && (
            <button
              onClick={onClearSearch}
              aria-label="مسح البحث"
              /* 93-C6 / F-07 (A5 S-6): bare w-3 icon ≈ 12px target —
                 p-2 lifts the tappable area to ~28px (the audit's
                 CopyButton recommendation). */
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Export */}
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={onExport}
          disabled={filteredCount === 0}
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {selectedCount > 0 ? `تصدير (${selectedCount})` : "تصدير CSV"}
          </span>
        </Button>
      </div>
    </div>
  );
}
