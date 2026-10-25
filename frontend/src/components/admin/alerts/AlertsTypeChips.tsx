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
//
// R159 (coordinator verdict — closes IMPL-A's stop-clause): NO-GO on
// the ui/filter-tabs conversion, and not only for the tone-enum gap
// IMPL-A stopped on. This bar is a SEVERITY-CHIP dialect, not a
// filter-pill one: actives ride TYPE_META's /10 fill + /20 edge
// row-badge tuples (vs the primitive's /15 + /30 pill actives), the
// count badge rides the R143 L2-7 theme-aware bg-foreground/10 with
// inherited ink (vs the primitive's hardcoded primary pair) plus
// px-1/no-py padding (vs px-1.5 py-px). A faithful conversion needs
// THREE escape hatches (per-item active classes, badge ink override,
// badge padding) — a wrapper for its own sake. The twin keeps its
// dialect; revisit only if a second severity-chip bar appears (the
// escape hatches then earn a real second consumer).

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
      {/* R187E-F2: the key list derives from TYPE_META's own keys — the
          hardcoded six-entry array is gone, so a future AlertType can
          never again render rows its chip bar silently omits (the order
          is TYPE_META's key order, system last as before). */}
      {(Object.keys(TYPE_META) as AlertType[])
        .map((key) => ({
          key,
          count: alerts.filter((a) => a.type === key).length,
        }))
        .filter((s) => s.count > 0)
        .map((s) => {
          const m = TYPE_META[s.key];
          return (
            <button
              key={s.key}
              onClick={() => onSetFilter(filter === s.key ? "all" : s.key)}
              aria-pressed={filter === s.key}
              /* R139 (precision): the ACTIVE chip's severity tuple is
                 verified, not changed — TYPE_META already drives it
                 with --status-* token tints (a /10 fill + /20 edge +
                 full ink per severity), the §6 status-via-tokens
                 dialect, and the row's reason text (label + live
                 count) rides along. Only the RESTING chip joins the
                 pill family's tray-less values: the muted/20 wash +
                 /40 edge + text-only hover swaps for the /30 box +
                 /30 edge + /70 border hover step (the products
                 category-bar dialect). aria-pressed untouched. */
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-150 ${
                filter === s.key
                  ? `font-bold ${m.bg} ${m.border} ${m.color}`
                  : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
              }`}
            >
              <m.icon className="w-3 h-3" />
              {m.label}
              {/* R143 (L2-7): the ACTIVE count badge's bg-white/10 was a
                  dark-default hand-roll — under .light, white/10 over the
                  severity /10 tint ≈ an invisible pill. bg-foreground/10
                  is theme-aware (white-ish on dark, black-ish on light)
                  and stays distinct from the INACTIVE twin's bg-muted/60
                  — the chip body carries the state either way. */}
              <span
                className={`text-3xs px-1 rounded-full font-bold ${filter === s.key ? "bg-foreground/10" : "bg-muted/60"}`}
              >
                {s.count}
              </span>
            </button>
          );
        })}
    </div>
  );
}
