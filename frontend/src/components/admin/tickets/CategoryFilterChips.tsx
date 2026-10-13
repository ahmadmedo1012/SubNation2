import { CATEGORY_FILTERS } from "@/components/admin/tickets/tickets-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the queue's category chip bar (the client-side filter over the
// accumulated pages). The page owns the categoryFilter atom and the
// ?category= URL sync; the extract takes the value + the onSelect
// callback (the inline setCategoryFilter + syncFilterParams closure
// became the page-owned wrapper — same event, same writes).

export function CategoryFilterChips({
  categoryFilter,
  onSelect,
}: {
  categoryFilter: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORY_FILTERS.map((c) => (
        <button
          key={c.value}
          onClick={() => onSelect(c.value)}
          /* R124-C2 (A6 F10): same toggle-state exposure as the
             status tabs above. */
          aria-pressed={categoryFilter === c.value}
          /* R139 (precision): the tray-less chip bar joins the r138
             calm-pill dialect (the products category-bar twin shipped
             this round): active rises /10→/15 tint (the family fill),
             and the resting chip swaps its full-strength edge +
             secondary hover wash for the muted/30 box + /30 border +
             /70 border hover step — the values the pill family rides
             when no tray carries it. Both states were already boxed
             (the border stayed); aria-pressed + onSelect are
             byte-identical. */
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
            categoryFilter === c.value
              ? "bg-primary/15 border-primary/30 text-primary-text font-bold"
              : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
