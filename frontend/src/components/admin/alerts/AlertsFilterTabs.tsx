import { FILTERS } from "@/components/admin/alerts/alerts-inbox-meta";
import type { AdminAlertItem, FilterType } from "@/components/admin/alerts/alerts-inbox-meta";
import { FilterTabs } from "@/components/ui/filter-tabs";

// R137 (FE decomposition): extracted verbatim from pages/admin/alerts.tsx —
// the R125 (A3 #6) filter tab bar (الكل / غير مقروء / one tab per alert
// type, each with its within-window count). The filter atom + setFilter
// stay in the page; this shell takes alerts + unreadCount + the active
// filter down and reports taps through onSetFilter — both bars (chips +
// tabs) read the SAME page atom, so aria-pressed stays one-source.
//
// R159 (IMPL-A): the hand-rolled tray retired for the shared ui/FilterTabs
// primitive (R158-D) — same export + props contract, so the page is
// unchanged. aria-pressed, the calm-pill classes, the scroll rail and the
// micro-chip count badge come from the primitive (countBadge="chip" is
// the exact active bg-primary/15 / inactive bg-muted/60 pair this bar
// shipped in R139; its min-h-11 bakes the 44px touch floor — the admin
// dialect inherits it, R158-D). The twin's tray-level items-center was a
// no-op (every pill rides the same min-h-11 floor), so the primitive's
// canonical tray drops it.

export function AlertsFilterTabs({
  alerts,
  unreadCount,
  filter,
  onSetFilter,
}: {
  alerts: AdminAlertItem[];
  unreadCount: number;
  filter: FilterType;
  onSetFilter: (next: FilterType) => void;
}) {
  return (
    <FilterTabs
      variant="tray"
      scrollable
      countBadge="chip"
      ariaLabel="تصفية التنبيهات"
      items={FILTERS.map((tab) => ({
        value: tab.value,
        label: tab.label,
        count:
          tab.value === "all"
            ? alerts.length
            : tab.value === "unread"
              ? unreadCount
              : alerts.filter((a) => a.type === tab.value).length,
      }))}
      value={filter}
      onSelect={onSetFilter}
    />
  );
}
