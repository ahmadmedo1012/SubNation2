import { STATUS_FILTERS } from "@/components/admin/topups/topups-queue-meta";
import type { AdminTopupRow } from "@/components/admin/topups/topups-queue-meta";
import { FilterTabs } from "@/components/ui/filter-tabs";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the queue's status tab bar. The statusFilter atom and its deep-link
// initializer stay centralized in the page; the extract takes the selected
// value, the setter callback and the loaded window (an inactive tab's
// count is unknown — the R126-L3 honesty rule) and renders inside
// TopupsToolbar at its original DOM position. The URL write-back rode
// along with the tab's verbatim onClick.
//
// R159 (IMPL-A): the hand-rolled tray retired for the shared ui/FilterTabs
// primitive (R158-D) — same export + props contract, so TopupsToolbar is
// unchanged. aria-pressed, the calm-pill classes, the segment tray and the
// inline count badge now come from the primitive (its min-h-11 bakes the
// 44px touch floor — the admin dialect inherits it, R158-D); the ?status=
// write-back stays HERE verbatim inside the onSelect wrapper
// (topups-status-tab-query pins the replaceState behavior).

export function StatusFilterTabs({
  statusFilter,
  setStatusFilter,
  allTopups,
}: {
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  allTopups: AdminTopupRow[];
}) {
  return (
    <FilterTabs
      variant="tray"
      ariaLabel="تصفية طلبات الشحن حسب الحالة"
      items={STATUS_FILTERS.map((s) => ({
        value: s.value,
        label: s.label,
        // R126-L3 (A1-10): the per-tab server-side fetch means the
        // loaded window only speaks for the ACTIVE tab's status — an
        // inactive tab's count is UNKNOWN (its rows are not in this
        // window), and rendering the accidental 0 was exactly the
        // false-count the audit flagged. null renders nothing in the
        // primitive; the sidebar badge carries the global pending
        // truth.
        count: statusFilter === s.value ? allTopups.length : null,
      }))}
      value={statusFilter}
      onSelect={(value) => {
        setStatusFilter(value);
        // R123 (E3 P3a): write-back — the deep-link param the
        // initializer reads stays truthful after the operator flips
        // the tab (replaceState: flips don't spam the history stack).
        const url = new URL(window.location.href);
        if (value) url.searchParams.set("status", value);
        else url.searchParams.delete("status");
        window.history.replaceState(null, "", url.toString());
      }}
    />
  );
}
