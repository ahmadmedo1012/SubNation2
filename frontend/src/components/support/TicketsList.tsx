import { ChevronLeft } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { STATUS_CONFIG, categoryIcon, categoryLabel, type Ticket } from "./support-meta";

// R137 (FE decomposition): extracted verbatim from pages/support.tsx —
// the ticket list rows (status badge + category chip + the last-reply
// preview + the chevron). Presentational only: the rows resolve clicks
// through the page-owned onOpenTicket callback (openTicket — the
// guarded thread fetch with the 93-C5 res.ok/shape check); the list
// cascade around it (loading skeleton / error card / empty state)
// stays in the page, which owns the atoms. The move only changes its
// address; DOM, classes and Arabic copy are byte-identical.

export function TicketsList({
  tickets,
  onOpenTicket,
}: {
  tickets: Ticket[];
  onOpenTicket: (id: number) => void;
}) {
  return (
    <div className="space-y-2.5">
      {tickets.map((t, i) => {
        const s = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.open;
        const hasAdminReply = t.last_reply?.author_type === "admin";
        return (
          <button
            key={t.id}
            onClick={() => onOpenTicket(t.id)}
            className={`
              float-in stagger-${Math.min(i, 8)}
              w-full bg-card border border-border/60 border-r-[3px] rounded-2xl p-4
              hover:border-border hover:shadow-xl hover:-translate-y-0.5
              transition-all duration-200 text-right group active:scale-[0.995] active:translate-y-0
              ${t.status === "open" ? "border-r-status-info/55" : t.status === "in_progress" ? "border-r-status-warning/55" : "border-r-border/40"}
            `}
          >
            {/* R139 (precision): the row register rhymes with its
                DOCUMENTED twin — orders.tsx's statusAccentBorder comment
                names THIS ticket-card idiom as the shared one, and the
                orders rows ride border/60 + hover:border-border + the
                bare themed hover:shadow-xl (R157-C retired the raw-black
                hover color override on both twins); the /50 edge,
                /80 hover step and shadow-lg/black/12 were the drift.
                The 3px status edge stripe + status tints stay
                byte-identical (the shared idiom). */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  {t.status === "open" && (
                    <span className="w-2 h-2 rounded-full bg-status-info shrink-0 pulse-dot" />
                  )}
                  <span className="font-bold text-sm truncate flex-1 leading-snug group-hover:text-primary-text transition-colors duration-150">
                    {t.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span
                    className={`inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border font-bold ${s.color} ${s.border}`}
                  >
                    {s.icon}
                    {s.label}
                  </span>
                  {t.category && (
                    <span className="text-2xs text-muted-foreground bg-muted/30 border border-border/35 px-2 py-0.5 rounded-full">
                      {categoryIcon(t.category)} {categoryLabel(t.category)}
                    </span>
                  )}
                  <span className="text-2xs text-muted-foreground">
                    {formatRelativeTime(t.created_at)}
                  </span>
                </div>

                {t.last_reply && (
                  <div
                    dir="auto"
                    className={`text-xs px-3 py-1.5 rounded-xl leading-relaxed line-clamp-1 border ${
                      hasAdminReply
                        ? "bg-primary/7 text-primary-text border-primary/15"
                        : "bg-muted/35 text-muted-foreground border-border/35"
                    }`}
                  >
                    <span className="font-bold ml-1">{hasAdminReply ? "فريق الدعم:" : "أنت:"}</span>
                    {t.last_reply.message}
                  </div>
                )}
              </div>

              <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary group-hover:-translate-x-0.5 transition-all duration-150" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
