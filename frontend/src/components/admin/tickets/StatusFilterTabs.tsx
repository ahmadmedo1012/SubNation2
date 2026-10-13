import { STATUS_FILTERS } from "@/components/admin/tickets/tickets-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the queue's status tab bar. The page owns the statusFilter atom and
// the two-way ?status= URL sync; the extract takes the value + the
// onSelect callback (the inline setStatusFilter + syncFilterParams
// closure became the page-owned wrapper — same event, same writes, the
// R124-C2 aria-pressed toggle state rides down as a value).

export function StatusFilterTabs({
  statusFilter,
  onSelect,
}: {
  statusFilter: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div
      /* R139 (precision): the tray wash aligns to the family segment
         value (the orders/topups status trays ride the same secondary
         /40 + border /60 pair; /50 was this bar's lone outlier). */
      className="flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1"
    >
      {STATUS_FILTERS.map((s) => (
        <button
          key={s.value}
          onClick={() => onSelect(s.value)}
          /* R124-C2 (A6 F10): the active tab was purely visual —
             aria-pressed exposes the toggle state (the
             orders.tsx/topups.tsx chip-bar idiom). */
          aria-pressed={statusFilter === s.value}
          /* R139 (precision): the active tab joins the r138 calm-pill
             family — bg-primary/15 + text-primary-text +
             border-primary/30 + font-bold (the exact dialect the
             orders/topups status twins shipped this round). Both
             states carry a border box (inactive = transparent) so the
             1px text jitter dies on toggle; the old card-colored chip
             + its soft shadow read as a mini elevation lifting the
             active tab out of the tray. Inactive stays quiet muted
             ink with a muted/30 hover wash. aria-pressed + the
             onSelect wiring are byte-identical. */
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${statusFilter === s.value ? "bg-primary/15 text-primary-text border border-primary/30 font-bold" : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
