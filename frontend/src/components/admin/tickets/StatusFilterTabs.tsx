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
    <div className="flex gap-1 bg-secondary/50 border border-border/60 rounded-2xl p-1">
      {STATUS_FILTERS.map((s) => (
        <button
          key={s.value}
          onClick={() => onSelect(s.value)}
          /* R124-C2 (A6 F10): the active tab was purely visual —
             aria-pressed exposes the toggle state (the
             orders.tsx/topups.tsx chip-bar idiom). */
          aria-pressed={statusFilter === s.value}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${statusFilter === s.value ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
