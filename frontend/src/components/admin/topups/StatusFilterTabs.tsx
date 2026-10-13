import { STATUS_FILTERS } from "@/components/admin/topups/topups-queue-meta";
import type { AdminTopupRow } from "@/components/admin/topups/topups-queue-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the queue's status tab bar. The statusFilter atom and its deep-link
// initializer stay centralized in the page; the extract takes the selected
// value, the setter callback and the loaded window (an inactive tab's
// count is unknown — the R126-L3 honesty rule) and renders inside
// TopupsToolbar at its original DOM position. The URL write-back rode
// along with the tab's verbatim onClick. Byte-identical markup and copy.

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
    <div className="flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1">
      {STATUS_FILTERS.map((s) => {
        const active = statusFilter === s.value;
        // R126-L3 (A1-10): the per-tab server-side fetch means
        // the loaded window only speaks for the ACTIVE tab's
        // status — an inactive tab's count is UNKNOWN (its rows
        // are not in this window), and rendering the accidental
        // 0 was exactly the false-count the audit flagged. The
        // active tab keeps its live count; the sidebar badge
        // carries the global pending truth.
        const count = active ? allTopups.length : null;
        return (
          <button
            key={s.value}
            onClick={() => {
              setStatusFilter(s.value);
              // R123 (E3 P3a): write-back — the deep-link param
              // the initializer reads stays truthful after the
              // operator flips the tab (replaceState: flips
              // don't spam the history stack).
              const url = new URL(window.location.href);
              if (s.value) url.searchParams.set("status", s.value);
              else url.searchParams.delete("status");
              window.history.replaceState(null, "", url.toString());
            }}
            /* R124-I5 (A6 F10): the active chip was purely visual —
               a screen reader announced four identical buttons.
               aria-pressed exposes the toggle state (the
               coupons.tsx chip-bar idiom). */
            aria-pressed={active}
            /* R139 (precision): the active tab joins the r138 calm-pill
               family — bg-primary/15 + text-primary-text +
               border-primary/30 + font-bold (the CatalogFiltersBar /
               VariantSelector dialect; the orders twin in
               components/admin/orders/OrdersFilters.tsx rides the same
               recipe). Both states carry a border box (inactive =
               transparent) so the 1px text jitter dies on toggle; the
               old bg-card + shadow-sm lifted the active chip as a mini
               elevation. Inactive stays quiet muted ink with a muted/30
               hover wash. aria-pressed + the URL write-back onClick are
               byte-identical. */
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
              active
                ? "bg-primary/15 text-primary-text border border-primary/30 font-bold"
                : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            {s.label}
            {count !== null && count > 0 && (
              /* R139 (precision): the count chip's dead active/inactive
                 ternary (both branches were identical) collapses to one
                 muted ink — quiet metadata on both pill states. */
              <span className="text-3xs font-bold text-muted-foreground">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
