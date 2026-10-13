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
    <div
      /* R139 (precision): the tray joins the family segment geometry —
         the secondary/40 wash + /60 edge the orders/topups/tickets
         status trays ride (the muted/30 + /40 trough was this bar's
         outlier); scroll behavior untouched. */
      className="flex items-center gap-1 bg-secondary/40 border border-border/60 p-1 rounded-2xl overflow-x-auto scrollbar-none w-fit max-w-full"
    >
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
            /* R139 (precision): the active tab joins the r138 calm-pill
               family — bg-primary/15 + text-primary-text +
               border-primary/30 + font-bold (the dialect the
               orders/topups/tickets status twins ride this round).
               Both states carry a border box (inactive = transparent)
               so the 1px text jitter dies on toggle; the old
               card-colored chip + its soft shadow read as a mini
               elevation lifting the active tab. Inactive stays quiet
               muted ink with a muted/30 hover wash. aria-pressed +
               onSetFilter are byte-identical. */
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap shrink-0 ${
              filter === tab.value
                ? "bg-primary/15 text-primary-text border border-primary/30 font-bold"
                : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            {tab.label}
            {cnt > 0 && (
              <span
                /* R139 (precision): the count chip is untouched quiet
                   metadata — on the new active pill its /15 primary
                   chip fill blends into the pill itself (reads as
                   primary-text ink), on the inactive box it stays a
                   muted/60 micro chip; the ternary renders meaningfully
                   in both states, so no collapse. */
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
