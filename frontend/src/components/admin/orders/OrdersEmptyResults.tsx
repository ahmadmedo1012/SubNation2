import { ShoppingBag, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/admin/EmptyState";
import { LoadMoreButton } from "@/components/ui/load-more-button";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the two
// honest zero-result states (R115 A9 P2): matches-zero-over-PARTIAL-data
// (keep the load-more + the incompleteness hint) vs the definite
// EmptyState with its clear-filters action. hasNextPage / the busy flags
// / fetchNextPage and the filter resets stay page-owned — they flow down
// as values + callbacks. The move only changes the address; DOM, classes
// and aria are byte-identical.

export function OrdersEmptyResults({
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  onLoadMore,
  search,
  statusFilter,
  dateRange,
  onClearFilters,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  search: string;
  statusFilter: string;
  dateRange: number;
  onClearFilters: () => void;
}) {
  return hasNextPage ? (
    /* R115 (A9 P2): zero matches over PARTIAL data — the status
       and date tabs filter CLIENT-SIDE over the accumulated
       pages, so a tab can read «لا توجد طلبات» while matching
       rows sit on unloaded pages (hasNextPage=true). The hard
       empty state was a false claim; keep the load-more visible
       + the honest incompleteness hint instead. */
    <div className="text-center py-14 text-muted-foreground bg-card border border-border/60 rounded-2xl space-y-3">
      <ShoppingBag className="w-10 h-10 mx-auto opacity-20" />
      <p className="text-sm font-bold text-foreground/80">لا طلبات مطابقة ضمن الصفحات المحمّلة</p>
      <p className="text-xs">قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل</p>
      <div className="flex justify-center gap-2 flex-wrap">
        <LoadMoreButton
          spinner={RefreshCw}
          busy={isFetchingNextPage}
          disabled={isLoading}
          onClick={onLoadMore}
        />
        {(search || statusFilter || dateRange > 0) && (
          <button
            onClick={onClearFilters}
            className="text-xs text-primary-text hover:underline mt-1.5"
          >
            مسح الفلاتر
          </button>
        )}
      </div>
    </div>
  ) : (
    <EmptyState
      icon={ShoppingBag}
      title="لا توجد طلبات"
      action={
        search || statusFilter || dateRange > 0 ? (
          <button
            onClick={onClearFilters}
            className="text-xs text-primary-text hover:underline mt-1"
          >
            مسح الفلاتر
          </button>
        ) : undefined
      }
    />
  );
}
