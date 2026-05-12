import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MessageSquare,
  Plus,
  ChevronLeft,
  Clock,
  CheckCircle,
  AlertCircle,
  Send,
  X,
  Loader2,
  Shield,
  User,
  Tag,
  ArrowRight,
  Headphones,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  { value: "billing", label: "الدفع والفواتير", icon: "💳" },
  { value: "order", label: "الطلبات", icon: "📦" },
  { value: "technical", label: "مشكلة تقنية", icon: "⚙️" },
  { value: "account", label: "الحساب", icon: "👤" },
  { value: "other", label: "أخرى", icon: "💬" },
];

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode; border: string }
> = {
  open: {
    label: "مفتوحة",
    color: "text-blue-400 bg-blue-400/10",
    icon: <Clock className="w-3 h-3" />,
    border: "border-blue-400/25",
  },
  in_progress: {
    label: "قيد المعالجة",
    color: "text-yellow-400 bg-yellow-400/10",
    icon: <AlertCircle className="w-3 h-3" />,
    border: "border-yellow-400/25",
  },
  closed: {
    label: "مغلقة",
    color: "text-muted-foreground bg-muted/30",
    icon: <CheckCircle className="w-3 h-3" />,
    border: "border-border",
  },
};

interface Ticket {
  id: number;
  title: string;
  category: string | null;
  status: string;
  created_at: string;
  last_reply: { author_type: string; message: string; created_at: string } | null;
}
interface TicketDetail extends Ticket {
  replies: { id: number; author_type: string; message: string; created_at: string }[];
}

function categoryLabel(cat: string | null) {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? "أخرى";
}
function categoryIcon(cat: string | null) {
  return CATEGORIES.find((c) => c.value === cat)?.icon ?? "💬";
}

export default function SupportPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ title: "", message: "", category: "other" });
  const [submitting, setSubmitting] = useState(false);

  const headers = { Authorization: token ? `Bearer ${token}` : "" };

  const fetchTickets = () => {
    if (!token) return;
    fetch("/api/support/tickets", { headers })
      .then((r) => r.json())
      .then((d) => setTickets(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const openTicket = async (id: number) => {
    setTicketLoading(true);
    try {
      const res = await fetch(`/api/support/tickets/${id}`, { headers });
      const d = await res.json();
      setSelectedTicket(d);
      setReplyText("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch {
    } finally {
      setTicketLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    fetchTickets();
  }, [token]);

  useEffect(() => {
    if (selectedTicket) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedTicket?.replies?.length]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) {
      toast({ title: "أدخل العنوان والرسالة", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast({ title: "تم إنشاء التذكرة", description: "سيرد فريق الدعم قريباً" });
      setForm({ title: "", message: "", category: "other" });
      setShowCreate(false);
      fetchTickets();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${selectedTicket.id}/reply`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyText }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setReplyText("");
      await openTicket(selectedTicket.id);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const openCount = tickets.filter((t) => t.status === "open").length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-7 page-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {selectedTicket ? (
            <button
              onClick={() => setSelectedTicket(null)}
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-secondary/60 hover:bg-secondary border border-border/50 transition-all press-spring"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Headphones className="w-5 h-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black leading-tight break-words">
                {selectedTicket ? selectedTicket.title : "الدعم الفني"}
              </h1>
              {!selectedTicket && openCount > 0 && (
                <span className="text-[11px] font-black bg-blue-400/12 text-blue-400 border border-blue-400/25 px-2 py-0.5 rounded-full">
                  {openCount} مفتوحة
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedTicket
                ? `#${selectedTicket.id} · ${formatRelativeTime(selectedTicket.created_at)}`
                : "نحن هنا للمساعدة على مدار الساعة"}
            </p>
          </div>
        </div>

        {!selectedTicket && !showCreate && (
          <Button
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 active:scale-[0.97] transition-all gap-1.5 rounded-xl shrink-0"
          >
            <Plus className="w-4 h-4" />
            تذكرة جديدة
          </Button>
        )}
        {showCreate && !selectedTicket && (
          <button
            onClick={() => {
              setShowCreate(false);
              setForm({ title: "", message: "", category: "other" });
            }}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all press-spring"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Ticket Detail View ──────────────────────────────────── */}
      {selectedTicket && (
        <div className="bg-card border border-border/55 rounded-2xl overflow-hidden shadow-lg shadow-black/12 float-in">
          {/* Status bar */}
          <div
            className={`h-[3px] ${
              selectedTicket.status === "open"
                ? "bg-gradient-to-l from-blue-400/80 via-blue-400/40 to-transparent"
                : selectedTicket.status === "in_progress"
                  ? "bg-gradient-to-l from-yellow-400/80 via-yellow-400/40 to-transparent"
                  : "bg-gradient-to-l from-border to-transparent"
            }`}
          />

          {/* Ticket meta */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border/25 bg-muted/8 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border font-bold ${STATUS_CONFIG[selectedTicket.status]?.color} ${STATUS_CONFIG[selectedTicket.status]?.border}`}
            >
              {STATUS_CONFIG[selectedTicket.status]?.icon}
              {STATUS_CONFIG[selectedTicket.status]?.label}
            </span>
            {selectedTicket.category && (
              <span className="text-[11px] text-muted-foreground bg-muted/40 border border-border/40 px-2 py-1 rounded-full flex items-center gap-1">
                {categoryIcon(selectedTicket.category)} {categoryLabel(selectedTicket.category)}
              </span>
            )}
          </div>

          {/* Messages */}
          {ticketLoading ? (
            <div className="p-10 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div
              className="p-5 space-y-5 overflow-y-auto scrollbar-none"
              style={{ maxHeight: "min(460px, calc(100vh - 260px))" }}
            >
              {selectedTicket.replies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <div className="w-12 h-12 rounded-2xl bg-muted/40 border border-border/30 flex items-center justify-center mb-3">
                    <MessageSquare className="w-5 h-5 opacity-20" />
                  </div>
                  <p className="text-sm font-medium">لا توجد رسائل بعد</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    اكتب ردك أدناه لبدء المحادثة
                  </p>
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
                        {isUser ? (
                          <User className="w-3.5 h-3.5" />
                        ) : (
                          <Shield className="w-3.5 h-3.5" />
                        )}
                      </div>

                      {/* Bubble */}
                      <div
                        className={`max-w-[78%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
                      >
                        {!isUser && (
                          <span className="text-[11px] font-bold text-primary/80 px-1">
                            فريق الدعم
                          </span>
                        )}
                        <div
                          className={`
                          rounded-2xl px-4 py-2.5 text-sm leading-relaxed
                          ${
                            isUser
                              ? "bg-primary text-white rounded-tl-md shadow-md shadow-primary/22"
                              : "bg-muted/55 border border-border/35 rounded-tr-md text-foreground/90"
                          }
                        `}
                        >
                          {r.message}
                        </div>
                        <div
                          className={`flex items-center gap-1 text-[10px] text-muted-foreground px-1 ${isUser ? "flex-row-reverse" : ""}`}
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
          <div className="border-t border-border/25 p-4">
            {selectedTicket.status === "closed" ? (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/25 border border-border/30 rounded-xl px-4 py-3">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                التذكرة مغلقة — أنشئ تذكرة جديدة إذا احتجت مساعدة إضافية
              </div>
            ) : (
              <form onSubmit={handleReply} className="flex gap-2">
                <Input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="اكتب ردك هنا..."
                  className="flex-1 h-10 rounded-xl bg-muted/30 border-border/50 focus:border-primary/40 focus:ring-2 focus:ring-primary/12 transition-all"
                  dir="rtl"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleReply(e as any);
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className="w-10 h-10 rounded-xl bg-primary hover:bg-primary/90 text-white flex items-center justify-center shrink-0 transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-primary/25 press-spring"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Create Form ──────────────────────────────────────────── */}
      {!selectedTicket && showCreate && (
        <div className="bg-card border border-primary/22 rounded-2xl overflow-hidden shadow-xl shadow-primary/6 mb-5 float-in">
          <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/25 bg-primary/4">
            <div className="w-7 h-7 rounded-lg bg-primary/12 border border-primary/20 flex items-center justify-center">
              <Plus className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="font-black text-sm">تذكرة دعم جديدة</h2>
          </div>

          <form onSubmit={handleCreate} className="p-5 space-y-4">
            {/* Category pills */}
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-2.5 block">
                الفئة
              </Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 press-spring min-h-[36px] ${
                      form.category === c.value
                        ? "bg-primary text-white border-primary shadow-sm shadow-primary/20"
                        : "bg-muted/35 border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80"
                    }`}
                  >
                    <span>{c.icon}</span>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">عنوان المشكلة *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="وصف مختصر للمشكلة..."
                required
                className="h-10 rounded-xl border-border/50 focus:border-primary/40 focus:ring-2 focus:ring-primary/12 bg-card transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">تفاصيل المشكلة *</Label>
              <textarea
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="اشرح المشكلة بالتفصيل لنتمكن من مساعدتك بشكل أسرع..."
                required
                rows={4}
                className="w-full bg-card border border-border/50 rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 resize-none leading-relaxed transition-all hover:border-border/80 placeholder:text-muted-foreground"
                dir="rtl"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowCreate(false);
                  setForm({ title: "", message: "", category: "other" });
                }}
                className="flex-1 h-10 active:scale-[0.97] rounded-xl"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 h-10 bg-primary hover:bg-primary/90 active:scale-[0.97] shadow-md shadow-primary/22 rounded-xl gap-1.5"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جارٍ الإرسال...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    إرسال التذكرة
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tickets List ─────────────────────────────────────────── */}
      {!selectedTicket &&
        (loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl skeleton-shimmer border border-border/35" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border/45 rounded-2xl reveal-up">
            <div className="w-14 h-14 rounded-2xl bg-muted/40 border border-border/35 flex items-center justify-center mx-auto mb-4">
              <Headphones className="w-6 h-6 opacity-25" />
            </div>
            <p className="font-bold text-sm mb-1.5">لا توجد تذاكر دعم</p>
            <p className="text-xs text-muted-foreground mb-5 leading-relaxed max-w-xs mx-auto">
              أنشئ تذكرة جديدة وسيرد فريقنا خلال دقائق
            </p>
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 rounded-xl gap-1.5"
            >
              <Plus className="w-4 h-4" />
              تذكرة جديدة
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tickets.map((t, i) => {
              const s = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.open;
              const hasAdminReply = t.last_reply?.author_type === "admin";
              return (
                <button
                  key={t.id}
                  onClick={() => openTicket(t.id)}
                  className={`
                    float-in stagger-${Math.min(i, 8)}
                    w-full bg-card border border-border/50 border-r-[3px] rounded-2xl p-4
                    hover:border-border/80 hover:shadow-lg hover:shadow-black/12 hover:-translate-y-0.5
                    transition-all duration-220 text-right group active:scale-[0.995] active:translate-y-0
                    ${t.status === "open" ? "border-r-blue-500/55" : t.status === "in_progress" ? "border-r-yellow-500/55" : "border-r-border/40"}
                  `}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {t.status === "open" && (
                          <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 pulse-dot" />
                        )}
                        <span className="font-bold text-sm truncate flex-1 leading-snug group-hover:text-primary transition-colors duration-150">
                          {t.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-bold ${s.color} ${s.border}`}
                        >
                          {s.icon}
                          {s.label}
                        </span>
                        {t.category && (
                          <span className="text-[11px] text-muted-foreground bg-muted/30 border border-border/35 px-2 py-0.5 rounded-full">
                            {categoryIcon(t.category)} {categoryLabel(t.category)}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {formatRelativeTime(t.created_at)}
                        </span>
                      </div>

                      {t.last_reply && (
                        <div
                          className={`text-xs px-3 py-1.5 rounded-xl leading-relaxed line-clamp-1 border ${
                            hasAdminReply
                              ? "bg-primary/7 text-primary/75 border-primary/15"
                              : "bg-muted/35 text-muted-foreground border-border/35"
                          }`}
                        >
                          <span className="font-bold ml-1">
                            {hasAdminReply ? "فريق الدعم:" : "أنت:"}
                          </span>
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
        ))}

      {/* Bottom safe area */}
      <div className="h-6 md:h-0" />
    </div>
  );
}
