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
    <div className="lg:col-span-3 bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-muted/15">
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
        <div className="flex items-center gap-2 shrink-0 mr-3">
          {selected.status !== "closed" ? (
            <button
              onClick={() => onStatus(selected.id, "closed")}
              disabled={statusBusy === selected.id}
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
            className="hidden lg:flex p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
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
                  className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${isAdmin ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
                >
                  {isAdmin ? <Shield className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                </div>
                <div
                  className={`max-w-[78%] ${isAdmin ? "items-end" : "items-start"} flex flex-col gap-1`}
                >
                  <div
                    className={`rounded-2xl px-4 py-2.5 ${isAdmin ? "bg-primary text-white rounded-tl-sm" : "bg-muted/60 border border-border/50 rounded-tr-sm"}`}
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
      <form onSubmit={onSubmit} className="border-t border-border p-4">
        {selected.status === "closed" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/50 rounded-lg px-3 py-2 mb-3">
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
            className="bg-primary hover:bg-primary/90 h-10 w-10 shrink-0 active:scale-90 transition-transform"
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
