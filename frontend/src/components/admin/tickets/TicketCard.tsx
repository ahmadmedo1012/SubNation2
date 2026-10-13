import { ChevronLeft } from "lucide-react";
import {
  STATUS_TONE,
  StatusBadge,
  UNKNOWN_STATUS_TONE,
  type SemanticStatus,
} from "@/components/ui/status-badge";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { formatRelativeTime, statusLabel } from "@/lib/utils";
import { CATEGORIES, type TicketSummary } from "@/components/admin/tickets/tickets-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the queue row: the staggered float-in card with the open-status pulse
// dot, the relative last-reply time, the user identity line, the
// category chip, the canonical status pill (93-C7 / C-UX2) and the
// R125-I4 awaiting-reply cue. The page owns the query + the selected
// atom + openTicket; the extract takes values + the onOpen callback
// (the inline openTicket closure became the prop — same event, same
// call; isActive rides down as a value).

export function TicketCard({
  t,
  idx,
  isActive,
  onOpen,
}: {
  t: TicketSummary;
  idx: number;
  isActive: boolean;
  onOpen: (id: number) => void;
}) {
  return (
    <button
      key={t.id}
      onClick={() => onOpen(t.id)}
      /* R139 (precision): the queue row joins the r138 calm register —
         the selected tint drops its brand-tinted micro shadow + the
         nonstandard /4 wash for the family's bg-primary/8 selection
         fill (the mobile order-card's exact pair: primary/40 edge +
         /8 tint, edge does the signaling); the resting edge was
         already the /60 family. The hover retires its shadow-md —
         a calm border step only (/60 → full), the topups-card
         decision this round; no row elevation in the queue. The
         staggered float-in, the open-status pulse dot and the
         awaiting-reply cue are sanctioned motion, byte-identical. */
      className={`float-in stagger-${Math.min(idx + 1, 8)} w-full bg-card border rounded-2xl p-4 text-right transition-all duration-150 group ${isActive ? "border-primary/40 bg-primary/8" : "border-border/60 hover:border-border"}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {t.status === "open" && (
              <span className="w-2 h-2 rounded-full bg-status-info shrink-0 animate-pulse" />
            )}
            <span className="font-bold text-sm truncate leading-snug flex-1">{t.title}</span>
            {(t.last_reply_at || t.created_at) && (
              <span className="text-3xs text-muted-foreground shrink-0 tabular-nums">
                {formatRelativeTime(t.last_reply_at ?? t.created_at)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">
              {displayUserName(userFromRow(t))}
            </span>
            {t.category && (
              <span className="text-2xs text-muted-foreground bg-muted/40 border border-border/40 px-1.5 py-0.5 rounded-md">
                {CATEGORIES[t.category] ?? t.category}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            {/* 93-C7 / C-UX2 (A12 B1): canonical tone + label
                from the shared maps — same pill the detail
                pane and the storefront use. */}
            <StatusBadge
              variant={STATUS_TONE[t.status as SemanticStatus] ?? UNKNOWN_STATUS_TONE}
              size="sm"
            >
              {statusLabel(t.status)}
            </StatusBadge>
            {/* R125-I4 (A3-3): the awaiting-reply cue — the
                customer's reply is the last word on this
                ticket. Text + tone (never a color-only
                dot) so the signal survives grayscale +
                screen readers. */}
            {t.has_unread_admin && t.status !== "closed" && (
              <StatusBadge variant="warning" size="sm">
                بانتظار ردك
              </StatusBadge>
            )}
            <span className="text-xs text-muted-foreground">{t.reply_count} ردود</span>
          </div>
        </div>
        <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-muted-foreground transition-colors" />
      </div>
    </button>
  );
}
