import { FILTERS } from "@/components/admin/alerts/alerts-inbox-meta";
import type { AdminAlertItem, FilterType } from "@/components/admin/alerts/alerts-inbox-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/alerts.tsx —
// the R125 (A3 #6) filter tab bar (الكل / غير مقروء / one tab per alert
// type, each with its within-window count). The filter atom + setFilter
// stay in the page; this shell takes alerts + unreadCount + the active
// filter down and reports taps through onSetFilter — both bars (chips +
// tabs) read the SAME page atom, so aria-pressed stays one-source. The
// move only changes its address; DOM, classes and Arabic copy are
// byte-identical.

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
    <div className="flex items-center gap-1 bg-muted/30 border border-border/40 p-1 rounded-2xl overflow-x-auto scrollbar-none w-fit max-w-full">
      {FILTERS.map((tab) => {
        const cnt =
          tab.value === "all"
            ? alerts.length
            : tab.value === "unread"
              ? unreadCount
              : alerts.filter((a) => a.type === tab.value).length;
        return (
          <button
            key={tab.value}
            onClick={() => onSetFilter(tab.value)}
            aria-pressed={filter === tab.value}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap shrink-0 ${
              filter === tab.value
                ? "bg-card text-foreground shadow-sm font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {cnt > 0 && (
              <span
                className={`text-3xs font-bold px-1.5 py-px rounded-full ${
                  filter === tab.value
                    ? "bg-primary/15 text-primary-text"
                    : "bg-muted/60 text-muted-foreground"
                }`}
              >
                {cnt}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
