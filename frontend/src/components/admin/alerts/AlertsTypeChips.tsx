import { TYPE_META } from "@/components/admin/alerts/alerts-meta";
import type {
  AdminAlertItem,
  AlertType,
  FilterType,
} from "@/components/admin/alerts/alerts-inbox-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/alerts.tsx —
// the R125 (A3 #6) quick-filter chip strip: one chip per TYPE_META type
// with a live within-window count, zero-count chips hidden. The filter
// atom + setFilter stay in the page; this shell takes alerts + the
// active filter down and reports taps through onSetFilter. The move only
// changes its address; DOM, classes, aria-pressed and Arabic copy are
// byte-identical.

export function AlertsTypeChips({
  alerts,
  filter,
  onSetFilter,
}: {
  alerts: AdminAlertItem[];
  filter: FilterType;
  onSetFilter: (next: FilterType) => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {[
        { key: "no_stock", count: alerts.filter((a) => a.type === "no_stock").length },
        { key: "low_stock", count: alerts.filter((a) => a.type === "low_stock").length },
        {
          key: "forecast_stockout",
          count: alerts.filter((a) => a.type === "forecast_stockout").length,
        },
        {
          key: "coupon_maxed",
          count: alerts.filter((a) => a.type === "coupon_maxed").length,
        },
        {
          key: "coupon_expiring",
          count: alerts.filter((a) => a.type === "coupon_expiring").length,
        },
        { key: "system", count: alerts.filter((a) => a.type === "system").length },
      ]
        .filter((s) => s.count > 0)
        .map((s) => {
          const m = TYPE_META[s.key as AlertType];
          return (
            <button
              key={s.key}
              onClick={() => onSetFilter(filter === s.key ? "all" : (s.key as FilterType))}
              aria-pressed={filter === s.key}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-150 ${
                filter === s.key
                  ? `font-bold ${m.bg} ${m.border} ${m.color}`
                  : "bg-muted/20 border-border/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              <m.icon className="w-3 h-3" />
              {m.label}
              <span
                className={`text-3xs px-1 rounded-full font-bold ${filter === s.key ? "bg-white/10" : "bg-muted/60"}`}
              >
                {s.count}
              </span>
            </button>
          );
        })}
    </div>
  );
}
