import { CATEGORY_FILTERS } from "@/components/admin/tickets/tickets-meta";
import { FilterTabs } from "@/components/ui/filter-tabs";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the queue's category chip bar (the client-side filter over the
// accumulated pages). The page owns the categoryFilter atom and the
// ?category= URL sync; the extract takes the value + the onSelect
// callback (the inline setCategoryFilter + syncFilterParams closure
// became the page-owned wrapper — same event, same writes).
//
// R159 (IMPL-A): the hand-rolled chips retired for the shared
// ui/FilterTabs primitive (R158-D) — same export + props contract, so the
// page is unchanged. aria-pressed, the tray-less muted-box idle and the
// calm active trio now come from the primitive via variant="chips" (its
// min-h-11 bakes the 44px touch floor — the admin dialect inherits it,
// R158-D); the page's onSelect wrapper keeps the ?category= sync.

export function CategoryFilterChips({
  categoryFilter,
  onSelect,
}: {
  categoryFilter: string;
  onSelect: (value: string) => void;
}) {
  return (
    <FilterTabs
      variant="chips"
      ariaLabel="تصفية التذاكر حسب الفئة"
      items={CATEGORY_FILTERS}
      value={categoryFilter}
      onSelect={onSelect}
    />
  );
}
