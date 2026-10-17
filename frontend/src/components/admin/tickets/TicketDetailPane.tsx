import type { FormEvent, RefObject } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  Clock,
  Loader2,
  MessageSquare,
  Send,
  Shield,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  STATUS_TONE,
  StatusBadge,
  UNKNOWN_STATUS_TONE,
  type SemanticStatus,
} from "@/components/ui/status-badge";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { formatDate, statusLabel } from "@/lib/utils";
import { CATEGORIES, type TicketDetail } from "@/components/admin/tickets/tickets-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the detail pane: the thread header (user identity + canonical status
// pill + the close/re-open actions), the messages thread (admin/user
// bubbles with the B5-17 RTL mirroring), and the reply form (the
// useDirtyGuard-guarded draft + the closed-ticket gate). The page owns
// selected/replyText/sending/statusBusy, the openTicket refetch, the
// handleReply/handleStatus money handlers and messagesEndRef; the
// extract takes values + callbacks only (setSelected/handleStatus/
// handleReply/setReplyText became the onClose/onStatus/onSubmit/
// setReplyText props — same events, same calls; the messagesEndRef
// rides down as a prop, the orders.tsx BulkActionBar triggerRef
// precedent).

export function TicketDetailPane({
  selected,
  statusBusy,
  replyText,
  setReplyText,
  sending,
  onSubmit,
  onClose,
  onStatus,
  messagesEndRef,
}: {
  selected: TicketDetail;
  statusBusy: number | null;
  replyText: string;
  setReplyText: (value: string) => void;
  sending: boolean;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
  onStatus: (id: number, status: string) => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      /* R139 (precision): the pane shell joins the resting /60 border
         family (the queue cards + both empty branches already ride
         /60; the full-strength edge was this pane's outlier — it is a
         content column, not a floating layer, so NO two-layer calm
         elevation: the orders-table family keeps grid columns flat). */
      className="lg:col-span-3 bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div
        /* R139 (precision): the header band joins the quiet table-band
           register — bg-muted/30 (the OrdersTable/VariantRows header
           value; /15 was a one-off band wash) on a /60 seam (one
           chrome weight with the shell). */
        className="flex items-start justify-between px-5 py-4 border-b border-border/60 bg-muted/30"
      >
        <div className="flex-1 min-w-0">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1.5 lg:hidden transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5 rotate-180" /> العودة
          </button>
          <h2 className="font-bold text-sm truncate mb-1">{selected.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="w-3 h-3" />
              <span className="font-mono">{displayUserName(userFromRow(selected))}</span>
            </div>
            <StatusBadge
              variant={STATUS_TONE[selected.status as SemanticStatus] ?? UNKNOWN_STATUS_TONE}
              size="sm"
            >
              {statusLabel(selected.status)}
            </StatusBadge>
            {selected.category && (
              <span className="text-xs text-muted-foreground">
                {CATEGORIES[selected.category] ?? selected.category}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ms-3">
          {selected.status !== "closed" ? (
            <button
              onClick={() => onStatus(selected.id, "closed")}
              disabled={statusBusy === selected.id}
              /* R139 (precision): verified, not changed — the close /
                 re-open actions already ride quiet --status-* token
                 tints (a /10 fill + /20 edge + full ink), the §6
                 status-via-tokens dialect; severity never lives in
                 these resting action buttons. */
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-status-success/10 text-status-success border border-status-success/20 hover:bg-status-success/15 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {statusBusy === selected.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}{" "}
              إغلاق
            </button>
          ) : (
            <button
              onClick={() => onStatus(selected.id, "open")}
              disabled={statusBusy === selected.id}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-status-info/10 text-status-info border border-status-info/20 hover:bg-status-info/15 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {statusBusy === selected.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}{" "}
              إعادة فتح
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="إغلاق تفاصيل التذكرة"
            /* R139 (precision): the icon button's hover wash joins the
               muted/60 register (the alerts row actions + the shell's
               kbd family; the old secondary wash was the pre-r138
               idiom). Target stays ≥24px (p-1.5 + w-4 icon = 26px). */
            className="hidden lg:flex p-1.5 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0"
        style={{ maxHeight: "clamp(280px, 45vh, 480px)" }}
      >
        {selected.replies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
            <MessageSquare className="w-8 h-8 mb-2 opacity-25" />
            <p className="text-sm">لا توجد رسائل بعد</p>
          </div>
        ) : (
          selected.replies.map((r) => {
            const isAdmin = r.author_type === "admin";
            return (
              <div
                key={r.id}
                className={`flex gap-2.5 ${isAdmin ? "flex-row-reverse" : "flex-row"}`}
              >
                <div
                  className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${isAdmin ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {isAdmin ? <Shield className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                </div>
                <div
                  className={`max-w-[78%] ${isAdmin ? "items-end" : "items-start"} flex flex-col gap-1`}
                >
                  <div
                    /* R139 (precision): the thread pair, verified coherent
                       — operator = brand voice (solid primary bubble,
                       no edge, mirrored by the primary avatar),
                       customer = paper (muted/60 well, mirrored by the
                       muted avatar); the mirrored corner notches keep
                       the sides distinct in RTL. The customer edge
                       joins the muted-well family value /40 (the
                       CartSummaryAside thumbnail wells + ProductCard
                       shelf ride the same bg-muted/60 + /40 pair; the
                       old /50 was a between-value nowhere else in the
                       family). */
                    className={`rounded-2xl px-4 py-2.5 ${isAdmin ? "bg-primary text-primary-foreground rounded-tl-sm" : "bg-muted/60 border border-border/40 rounded-tr-sm"}`}
                  >
                    <p className="text-sm leading-relaxed">{r.message}</p>
                  </div>
                  <div
                    className={`flex items-center gap-1 text-3xs text-muted-foreground ${isAdmin ? "flex-row-reverse" : ""}`}
                  >
                    <Clock className="w-2.5 h-2.5" />
                    <span>{formatDate(r.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box */}
      <form
        onSubmit={onSubmit}
        /* R139 (precision): the reply seam softens to the /20 receipt
           hairline — the terminal rule under the thread's "slip"
           (the OrdersTable footer + CartSummaryAside terminal line
           ride the same value at their writing/summary boundary);
           the band seam above stays /60, so the pane reads
           band → paper → terminal rule. The form rides the shared
           Input/Button components (verified) — the send button's
           flat primary fill + press scale is the wave-2 admin-CTA
           register (ProductsHeader keeps the same pair). */
        className="border-t border-border/20 p-4"
      >
        {selected.status === "closed" && (
          <div
            /* R139 (precision): the closed hint's edge joins the well
               family value /40 (the customer bubble's pair — one
               container-edge weight inside the pane). */
            className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-lg px-3 py-2 mb-3"
          >
            <CheckCircle className="w-3.5 h-3.5 text-status-success" />
            هذه التذكرة مغلقة — أعد فتحها للرد
          </div>
        )}
        <div className="flex gap-2.5">
          <Input
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={selected.status === "closed" ? "التذكرة مغلقة…" : "اكتب ردك هنا…"}
            className="flex-1 h-10"
            disabled={selected.status === "closed"}
            dir="rtl"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="إرسال الرد"
            /* R158 (A6 tail): the flat-fill override retires —
             * buttonVariants owns the canonical fill + press-spring
             * (the send affordance keeps its h-10 w-10 square). */
            className="h-10 w-10 shrink-0"
            disabled={sending || !replyText.trim() || selected.status === "closed"}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              /* B5-17: Send points right-to-left — un-mirrored in
                 RTL it looks like "go back". */
              <Send className="w-4 h-4 -scale-x-100" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
