import { STATUS_FILTERS } from "@/components/admin/tickets/tickets-meta";
import { FilterTabs } from "@/components/ui/filter-tabs";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the queue's status tab bar. The page owns the statusFilter atom and
// the two-way ?status= URL sync; the extract takes the value + the
// onSelect callback (the inline setStatusFilter + syncFilterParams
// closure became the page-owned wrapper — same event, same writes, the
// R124-C2 aria-pressed toggle state rides down as a value).
//
// R159 (IMPL-A): the hand-rolled tray retired for the shared ui/FilterTabs
// primitive (R158-D) — same export + props contract, so the page is
// unchanged. aria-pressed, the calm-pill classes and the segment tray now
// come from the primitive (its min-h-11 bakes the 44px touch floor — the
// admin dialect inherits it, R158-D); the page's onSelect wrapper keeps
// the ?status= sync.

export function StatusFilterTabs({
  statusFilter,
  onSelect,
}: {
  statusFilter: string;
  onSelect: (value: string) => void;
}) {
  return (
    <FilterTabs
      variant="tray"
      ariaLabel="تصفية التذاكر حسب الحالة"
      items={STATUS_FILTERS}
      value={statusFilter}
      onSelect={onSelect}
    />
  );
}
