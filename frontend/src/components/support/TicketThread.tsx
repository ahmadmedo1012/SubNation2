import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { CheckCircle, Clock, Loader2, MessageSquare, Send, Shield, User } from "lucide-react";
import type { RefObject } from "react";
import { STATUS_CONFIG, categoryIcon, categoryLabel, type TicketDetail } from "./support-meta";

// R137 (FE decomposition): extracted verbatim from pages/support.tsx —
// the ticket detail view (status bar + meta chips + the message thread
// + the reply composer). Presentational only: the thread fetch
// (openTicket), the 25 s poll (refreshOpenTicketSilently — B-10), the
// reply POST and its `if (sending) return` double-submit guard (R94-A1
// #3) all stay IN the page — the reply draft (replyText), the in-flight
// sending flag and the auto-scroll target flow DOWN as values + one
// callback each, so a poll tick or a re-render can never resurrect a
// stale closure over the money path. The move only changes its
// address; DOM, classes, Arabic copy and event semantics are
// byte-identical.

export function TicketThread({
  selectedTicket,
  ticketLoading,
  replyText,
  onReplyTextChange,
  sending,
  onReply,
  messagesEndRef,
}: {
  selectedTicket: TicketDetail;
  ticketLoading: boolean;
  replyText: string;
  onReplyTextChange: (value: string) => void;
  sending: boolean;
  onReply: (e: React.FormEvent) => void;
  /** The page-owned auto-scroll anchor (the openTicket + poll scroll
   * effects live beside the state they observe, in the page). */
  messagesEndRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)] float-in">
      {/* R139 (precision): the thread card is the page's prominent active
          surface — border/55 + shadow-lg shadow-black/12 retire for the
          family resting edge + the r138 two-layer calm elevation
          (CartSummaryAside/PaymentMethodCard register). */}
      {/* Status bar */}
      <div
        className={`h-[3px] ${
          selectedTicket.status === "open"
            ? "bg-gradient-to-l from-status-info/80 via-status-info/40 to-transparent"
            : selectedTicket.status === "in_progress"
              ? "bg-gradient-to-l from-status-warning/80 via-status-warning/40 to-transparent"
              : "bg-gradient-to-l from-border to-transparent"
        }`}
      />

      {/* Ticket meta */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border/60 bg-muted/30 flex-wrap">
        {/* R139 (precision): the meta band joins the quiet table-band
            register (bg-muted/30 on a /60 seam — the admin
            TicketDetailPane twin, 139-h); was bg-muted/8 on a /25 seam. */}
        <span
          className={`inline-flex items-center gap-1 text-2xs px-2 py-1 rounded-full border font-bold ${STATUS_CONFIG[selectedTicket.status]?.color} ${STATUS_CONFIG[selectedTicket.status]?.border}`}
        >
          {STATUS_CONFIG[selectedTicket.status]?.icon}
          {STATUS_CONFIG[selectedTicket.status]?.label}
        </span>
        {selectedTicket.category && (
          <span className="text-2xs text-muted-foreground bg-muted/30 border border-border/35 px-2 py-1 rounded-full flex items-center gap-1">
            {/* R139 (precision): /40+/40 → the TicketsList chip register
                (bg-muted/30 + /35) — ONE category-chip value across the
                page's two extracts. */}
            {categoryIcon(selectedTicket.category)} {categoryLabel(selectedTicket.category)}
          </span>
        )}
      </div>

      {/* Messages */}
      {ticketLoading ? (
        // Small message-bubble skeleton — matches the real reply
        // layout (alternating sender alignment + variable widths)
        // so the panel doesn't shift when ticketReplies arrive.
        <div
          className="p-5 space-y-4 overflow-hidden"
          style={{ maxHeight: "min(460px, calc(100dvh - 260px))" }}
          aria-busy="true"
        >
          <div className="flex justify-start">
            <Skeleton className="h-12 w-3/5 rounded-2xl" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-16 w-2/3 rounded-2xl" />
          </div>
          <div className="flex justify-start">
            <Skeleton className="h-10 w-1/2 rounded-2xl" />
          </div>
        </div>
      ) : (
        <div
          className="p-5 space-y-5 overflow-y-auto scrollbar-none"
          style={{ maxHeight: "min(460px, calc(100dvh - 260px))" }}
        >
          {selectedTicket.replies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 flex items-center justify-center mb-3">
                {/* R139 (precision): the no-messages tile joins the shared
                    icon-stage family (bg-muted/60 + /35 edge + ghost glyph
                    at opacity-35 — the EmptyState register; was
                    bg-muted/40 + /30 + opacity-20). */}
                <MessageSquare className="w-5 h-5 opacity-35" />
              </div>
              <p className="text-sm font-semibold">لا توجد رسائل بعد</p>
              <p className="text-xs text-muted-foreground mt-1">اكتب ردك أدناه لبدء المحادثة</p>
            </div>
          ) : (
            selectedTicket.replies.map((r, i) => {
              const isUser = r.author_type === "user";
              return (
                <div
                  key={r.id}
                  className={`flex gap-2.5 float-in stagger-${Math.min(i, 8)} ${isUser ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-1 border ${
                      isUser
                        ? "bg-primary border-primary/30 text-white"
                        : "bg-muted border-border/40 text-muted-foreground"
                    }`}
                  >
                    {isUser ? <User className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                  </div>

                  {/* Bubble */}
                  <div
                    className={`max-w-[78%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
                  >
                    {!isUser && (
                      /* R124-I4 (A5 #1): the raw surface token at /80
                         alpha is sub-AA at 11px — the text-safe twin. */
                      <span className="text-2xs font-bold text-primary-text px-1">فريق الدعم</span>
                    )}
                    <div
                      className={`
                      rounded-2xl px-4 py-2.5 text-sm leading-relaxed
                      ${
                        isUser
                          ? "bg-primary text-white rounded-tl-md"
                          : "bg-muted/60 border border-border/40 rounded-tr-md text-foreground/90"
                      }
                    `}
                    >
                      {/* R139 (precision): the thread pair rhymes with the
                          calm-pair treatment — the customer bubble is the
                          SOLID brand voice (shadow-md shadow-primary/22
                          dies: no elevation on a chat bubble, the admin
                          TicketDetailPane operator twin), the support
                          bubble is the paper well (bg-muted/55 + /35 →
                          the /60 + /40 well pair 139-h pinned). */}
                      {r.message}
                    </div>
                    <div
                      className={`flex items-center gap-1 text-3xs text-muted-foreground px-1 ${isUser ? "flex-row-reverse" : ""}`}
                    >
                      <Clock className="w-2.5 h-2.5" />
                      <span title={formatDate(r.created_at)}>
                        {formatRelativeTime(r.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Reply input */}
      <div className="border-t border-border/20 p-4">
        {/* R139 (precision): the reply seam is the thread's terminal
            receipt hairline (/20 — the admin pane's reply-seam value,
            139-h); was /25. */}
        {selectedTicket.status === "closed" ? (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/25 border border-border/30 rounded-xl px-4 py-3">
            <CheckCircle className="w-3.5 h-3.5 text-status-success shrink-0" />
            التذكرة مغلقة — أنشئ تذكرة جديدة إذا احتجت مساعدة إضافية
          </div>
        ) : (
          <form onSubmit={onReply} className="flex gap-2">
            <Input
              value={replyText}
              onChange={(e) => onReplyTextChange(e.target.value)}
              placeholder="اكتب ردك هنا…"
              aria-label="نص الرد على التذكرة"
              /* 96-F6 (R96 A2 P2-6 + P3-3): 44px row (matches the send
                 button) + mobile Enter key labelled “send” + the
                 backend's reply cap (TicketMessageBody, 4000 chars) as
                 a live client-side limit instead of a server
                 round-trip error. */
              maxLength={4000}
              enterKeyHint="send"
              /* R139 (precision): the field register returns to the shared
                 Input — the border-border/50 override sat under the
                 A4-F12 3:1 border floor and focus:border-primary/40
                 competed with the ONE focus system; the component owns
                 both now (only the 44px row geometry stays). */
              className="flex-1 h-11"
              dir="rtl"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onReply(e as React.FormEvent);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              disabled={sending || !replyText.trim()}
              aria-label="إرسال الرد"
              /* R139 (precision): canonical send — the raw <button>'s
                 hand-rolled chrome (flat bg-primary + hover:bg-primary/90
                 + text-white + shadow-md shadow-primary/25 +
                 active:scale-90) retires for Button size="icon"; w-11
                 h-11 preserves the 44px storefront floor + the h-11
                 reply-field pairing (the 96-F6 contract in the comment
                 above). type/disabled/aria-label + the Loader2↔Send
                 swap byte-identical. */
              className="w-11 h-11"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                /* 93-C5 / F-03 (A12 C-UX1): Send is a directional glyph —
                   mirror it in RTL like admin/tickets.tsx (B5-17), the
                   last 2 un-mirrored Send icons in the app. */
                <Send className="w-4 h-4 -scale-x-100" />
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
