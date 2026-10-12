import { Clock } from "lucide-react";
import { EmptyState } from "@/components/admin/EmptyState";
import { LoadMoreButton } from "@/components/ui/load-more-button";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the money queue's two empty branches. The search/tab/query state and the
// fetchNextPage/setSearch callbacks stay centralized in the page; the
// extracts take values + callbacks only (which branch renders is still the
// page's `topups.length === 0` ternary). The move only changes the
// address; DOM, classes, aria and Arabic copy are byte-identical.

export function TopupsPartialEmptyState({
  debouncedSearch,
  isFetchingNextPage,
  isLoading,
  fetchNextPage,
  setSearch,
}: {
  debouncedSearch: string;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  fetchNextPage: () => void;
  setSearch: (value: string) => void;
}) {
  return (
    /* R126-L3 (A1-10): the search still filters CLIENT-side over
       the accumulated pages of the active tab, so a zero-match
       search over a partial window is NOT global emptiness — the
       orders.tsx:1471-1506 partial-empty block: honest wording +
       load-more as the remedy + the one-tap search clear. The
       status-tab empties no longer need this guard (the ?status=
       fetch makes page 1 the tab's head — a tab-empty is a
       server-verified claim now). */
    <div className="text-center py-14 text-muted-foreground bg-card border border-border/60 rounded-2xl space-y-3">
      <Clock className="w-10 h-10 mx-auto opacity-20" />
      <p className="text-sm font-bold text-foreground/80">
        لا طلبات مطابقة لـ &quot;{debouncedSearch.trim()}&quot; ضمن الصفحات المحمّلة
      </p>
      <p className="text-xs">قد تكون النتائج غير مكتملة — حمّل المزيد لتوسيع النطاق</p>
      <div className="flex justify-center gap-2 flex-wrap">
        <LoadMoreButton
          busy={isFetchingNextPage}
          disabled={isLoading}
          onClick={() => void fetchNextPage()}
        />
        <button
          type="button"
          onClick={() => setSearch("")}
          className="text-xs text-primary-text hover:underline mt-1.5"
        >
          مسح البحث
        </button>
      </div>
    </div>
  );
}

export function TopupsHardEmptyState({
  searchActive,
  debouncedSearch,
  statusFilter,
  setSearch,
}: {
  searchActive: boolean;
  debouncedSearch: string;
  statusFilter: string;
  setSearch: (value: string) => void;
}) {
  return (
    /* R126-L3 (A1-10): the hard empty is now only reached over a
       server-verified window — a status tab's page 1 was EMPTY
       (no such rows exist at all) or the search covered a
       complete tab window. The pending-tab wording stays the
       statusLabel vocabulary (R125-I2 A1-8). */
    <EmptyState
      icon={Clock}
      title={
        searchActive
          ? `لا نتائج لـ "${debouncedSearch.trim()}"`
          : statusFilter === "pending"
            ? /* R125-I2 (A1-8): the statusLabel vocabulary — the
               tab above reads «قيد الانتظار»; the empty claim
               said «معلق» for the same status (one status, one
               Arabic word — the status-badge invariant). */
              "لا توجد طلبات قيد الانتظار"
            : "لا توجد طلبات في هذه الفئة"
      }
      description={
        searchActive
          ? "جرّب رقم تحويل أو هاتفاً آخر — أو امسح البحث"
          : "ستظهر الطلبات هنا عند ورودها"
      }
      action={
        searchActive ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            /* R125-I2 (A6-B6): --primary-text — raw --primary on a
               dark card is 3.76:1, under the 4.5:1 text floor. */
            className="text-xs text-primary-text hover:underline mt-1"
          >
            مسح البحث
          </button>
        ) : undefined
      }
    />
  );
}
