import { MessageSquare } from "lucide-react";
import { LoadMoreButton } from "@/components/ui/load-more-button";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the queue's two empty branches (the TopupsEmptyStates shape). The
// page owns the categoryPartialEmpty gate + the categoryLabel/category
// atoms; the extracts take values + the onFetchNext / onClearCategory
// callbacks (the inline setCategoryFilter + syncFilterParams closures
// became the page-owned wrapper — same event, same writes, the load-more
// stays reachable exactly as before).

export function TicketsPartialEmptyState({
  categoryLabel,
  loadingMoreTickets,
  loading,
  onFetchNext,
  onClearCategory,
}: {
  categoryLabel: string;
  loadingMoreTickets: boolean;
  loading: boolean;
  onFetchNext: () => void;
  onClearCategory: () => void;
}) {
  return (
    /* R126-L3 (A2-4): zero matches over PARTIAL data — the
       users.tsx:1309-1330 partial-empty idiom (R125-I4
       A1-7): honest incompleteness wording + the load-more
       STAYS VISIBLE (it was previously trapped inside the
       non-empty branch) + a one-tap filter escape. The
       ?category= URL filter makes this dead-end shareable,
       so the block must be the honest default. */
    <div className="flex-1 flex flex-col items-center justify-center py-14 text-muted-foreground bg-card border border-border/60 rounded-2xl space-y-3">
      <MessageSquare className="w-10 h-10 mb-1 opacity-20" />
      <p className="text-sm font-bold text-foreground/80">
        لا تذاكر بفئة {categoryLabel} ضمن الصفحات المحمّلة
      </p>
      <p className="text-xs">قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل</p>
      <div className="flex justify-center gap-2 flex-wrap">
        <LoadMoreButton busy={loadingMoreTickets} disabled={loading} onClick={onFetchNext} />
        <button
          onClick={onClearCategory}
          className="text-xs text-primary-text hover:underline mt-1.5"
        >
          إلغاء فلتر الفئة
        </button>
      </div>
    </div>
  );
}

export function TicketsHardEmptyState({
  categoryFilter,
  categoryLabel,
  onClearCategory,
}: {
  categoryFilter: string;
  categoryLabel: string;
  onClearCategory: () => void;
}) {
  return (
    /* R126-L3 (A2-4): the hard empty is now only reached over
       a PROVABLY complete window (no more pages) or with no
       category filter — and its copy names the filter when
       one is active (the users tier-empty wording) instead
       of claiming the whole queue is empty. */
    <div className="flex-1 flex flex-col items-center justify-center py-16 text-muted-foreground bg-card border border-border/60 rounded-2xl">
      <MessageSquare className="w-10 h-10 mb-3 opacity-25" />
      <p className="font-bold">
        {categoryFilter ? `لا توجد تذاكر بفئة ${categoryLabel}` : "لا توجد تذاكر"}
      </p>
      <p className="text-sm mt-1">
        {categoryFilter ? "جرّب فئة أخرى أو أزل الفلتر" : "ستظهر تذاكر الدعم هنا"}
      </p>
      {categoryFilter && (
        <button
          onClick={onClearCategory}
          className="text-xs text-primary-text hover:underline mt-3"
        >
          إلغاء فلتر الفئة
        </button>
      )}
    </div>
  );
}
