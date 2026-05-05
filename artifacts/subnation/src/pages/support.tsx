import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MessageSquare, Plus, ChevronLeft, Clock, CheckCircle, AlertCircle,
  Send, X, Loader2, Shield, User, Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  { value: "billing",   label: "الدفع والفواتير",  icon: "💳" },
  { value: "order",     label: "الطلبات",          icon: "📦" },
  { value: "technical", label: "مشكلة تقنية",      icon: "⚙️" },
  { value: "account",   label: "الحساب",           icon: "👤" },
  { value: "other",     label: "أخرى",             icon: "💬" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; dotColor: string; icon: React.ReactNode }> = {
  open:        { label: "مفتوحة",        color: "text-blue-400 bg-blue-400/10 border-blue-400/25",    dotColor: "bg-blue-400",    icon: <Clock className="w-3 h-3" /> },
  in_progress: { label: "قيد المعالجة", color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/25", dotColor: "bg-yellow-400", icon: <AlertCircle className="w-3 h-3" /> },
  closed:      { label: "مغلقة",         color: "text-muted-foreground bg-muted/30 border-border",    dotColor: "bg-muted-foreground", icon: <CheckCircle className="w-3 h-3" /> },
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
  return CATEGORIES.find(c => c.value === cat)?.label ?? "أخرى";
}
function categoryIcon(cat: string | null) {
  return CATEGORIES.find(c => c.value === cat)?.icon ?? "💬";
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
      .then(r => r.json())
      .then(d => setTickets(Array.isArray(d) ? d : []))
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
    if (!token) { navigate("/login"); return; }
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
      toast({ title: "تم إنشاء التذكرة", description: "سيرد الفريق قريباً" });
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

  const openCount = tickets.filter(t => t.status === "open").length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black">الدعم الفني</h1>
              {openCount > 0 && !selectedTicket && (
                <span className="text-xs font-black bg-blue-400/15 text-blue-400 border border-blue-400/25 px-2 py-0.5 rounded-full">
                  {openCount} مفتوحة
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">نحن هنا للمساعدة على مدار الساعة</p>
          </div>
        </div>
        {!selectedTicket && !showCreate && (
          <Button
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 active:scale-[0.97] transition-transform"
          >
            <Plus className="w-4 h-4 ml-1.5" />
            تذكرة جديدة
          </Button>
        )}
        {selectedTicket && (
          <button
            onClick={() => setSelectedTicket(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-secondary"
          >
            <ChevronLeft className="w-4 h-4 rotate-180" />
            كل التذاكر
          </button>
        )}
      </div>

      {/* Ticket Detail View */}
      {selectedTicket && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          {/* Ticket header */}
          <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-muted/10">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-bold ${STATUS_CONFIG[selectedTicket.status]?.color}`}>
                  {STATUS_CONFIG[selectedTicket.status]?.icon}
                  {STATUS_CONFIG[selectedTicket.status]?.label}
                </span>
                {selectedTicket.category && (
                  <span className="text-xs text-muted-foreground/60 bg-muted/40 border border-border/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Tag className="w-2.5 h-2.5" />
                    {categoryLabel(selectedTicket.category)}
                  </span>
                )}
                <span className="text-xs text-muted-foreground/40">
                  {formatRelativeTime(selectedTicket.created_at)}
                </span>
              </div>
              <h2 className="font-black text-base truncate">{selectedTicket.title}</h2>
            </div>
          </div>

          {/* Messages */}
          {ticketLoading ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="p-5 space-y-4 overflow-y-auto" style={{ maxHeight: "420px" }}>
              {selectedTicket.replies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">لا توجد رسائل بعد</p>
                </div>
              ) : (
                selectedTicket.replies.map(r => {
                  const isUser = r.author_type === "user";
                  return (
                    <div key={r.id} className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${isUser ? "bg-primary text-white" : "bg-muted border border-border text-muted-foreground"}`}>
                        {isUser ? <User className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                      </div>
                      <div className={`max-w-[78%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
                        {!isUser && (
                          <span className="text-[11px] font-bold text-primary mr-1">فريق الدعم</span>
                        )}
                        <div className={`rounded-2xl px-4 py-2.5 ${isUser ? "bg-primary text-white rounded-tl-sm" : "bg-muted/60 border border-border/50 rounded-tr-sm"}`}>
                          <p className="text-sm leading-relaxed">{r.message}</p>
                        </div>
                        <div className={`flex items-center gap-1 text-[10px] text-muted-foreground/50 px-1 ${isUser ? "flex-row-reverse" : ""}`}>
                          <Clock className="w-2.5 h-2.5" />
                          <span title={formatDate(r.created_at)}>{formatRelativeTime(r.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Reply box */}
          <div className="border-t border-border p-4">
            {selectedTicket.status === "closed" ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/50 rounded-xl px-4 py-3 text-center justify-center">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                هذه التذكرة مغلقة — تواصل مع الدعم لفتح تذكرة جديدة إذا لزم الأمر
              </div>
            ) : (
              <form onSubmit={handleReply} className="flex gap-2.5">
                <Input
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="اكتب ردك هنا..."
                  className="flex-1 h-10"
                  dir="rtl"
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(e as any); } }}
                />
                <Button
                  type="submit"
                  size="icon"
                  className="bg-primary hover:bg-primary/90 h-10 w-10 shrink-0 active:scale-90 transition-transform"
                  disabled={sending || !replyText.trim()}
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Create Form */}
      {!selectedTicket && showCreate && (
        <div className="bg-card border border-primary/25 rounded-2xl overflow-hidden shadow-lg shadow-primary/5 mb-6 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/10">
            <h2 className="font-black text-sm flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              تذكرة دعم جديدة
            </h2>
            <button
              onClick={() => { setShowCreate(false); setForm({ title: "", message: "", category: "other" }); }}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreate} className="p-5 space-y-4">
            {/* Category pills */}
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-2 block">الفئة</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, category: c.value }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 ${
                      form.category === c.value
                        ? "bg-primary text-white border-primary shadow-sm"
                        : "bg-muted/40 border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                    }`}
                  >
                    <span>{c.icon}</span>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">عنوان المشكلة *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="وصف مختصر للمشكلة..."
                required
                className="h-10"
              />
            </div>

            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">تفاصيل المشكلة *</Label>
              <textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="اشرح المشكلة بالتفصيل لمساعدتك بشكل أفضل..."
                required
                rows={4}
                className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed"
                dir="rtl"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowCreate(false); setForm({ title: "", message: "", category: "other" }); }}
                className="flex-1 h-10 active:scale-[0.97]"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 h-10 bg-primary hover:bg-primary/90 active:scale-[0.97] shadow-md shadow-primary/20"
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin ml-1.5" />جارٍ الإرسال...</>
                  : <><Send className="w-4 h-4 ml-1.5" />إرسال التذكرة</>
                }
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Tickets List */}
      {!selectedTicket && (
        loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl h-24 skeleton-shimmer border border-border/40" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-muted/40 border border-border/40 flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="w-6 h-6 opacity-25" />
            </div>
            <p className="font-bold text-sm mb-1">لا توجد تذاكر دعم</p>
            <p className="text-xs text-muted-foreground/60 mb-4">أنشئ تذكرة جديدة إذا واجهت أي مشكلة</p>
            <Button onClick={() => setShowCreate(true)} className="bg-primary hover:bg-primary/90 h-9 text-sm shadow-md shadow-primary/20">
              <Plus className="w-4 h-4 ml-1.5" />
              تذكرة جديدة
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tickets.map(t => {
              const s = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.open;
              const hasAdminReply = t.last_reply?.author_type === "admin";
              return (
                <button
                  key={t.id}
                  onClick={() => openTicket(t.id)}
                  className="w-full bg-card border border-border rounded-xl p-4 hover:border-primary/30 hover:shadow-md hover:shadow-black/5 transition-all text-right group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {t.status === "open" && (
                          <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 animate-pulse" />
                        )}
                        <span className="font-bold text-sm truncate flex-1 leading-snug">{t.title}</span>
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-bold ${s.color}`}>
                          {s.icon}
                          {s.label}
                        </span>
                        {t.category && (
                          <span className="text-[11px] text-muted-foreground/50 bg-muted/30 border border-border/40 px-1.5 py-0.5 rounded-full">
                            {categoryIcon(t.category)} {categoryLabel(t.category)}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground/40">
                          {formatRelativeTime(t.created_at)}
                        </span>
                      </div>

                      {/* Last reply preview */}
                      {t.last_reply && (
                        <div className={`text-xs px-3 py-1.5 rounded-lg leading-relaxed line-clamp-1 ${
                          hasAdminReply
                            ? "bg-primary/8 text-primary/80 border border-primary/15"
                            : "bg-muted/40 text-muted-foreground border border-border/40"
                        }`}>
                          {hasAdminReply ? (
                            <span className="font-bold ml-1">فريق الدعم:</span>
                          ) : (
                            <span className="font-bold ml-1">أنت:</span>
                          )}
                          {t.last_reply.message}
                        </div>
                      )}
                    </div>

                    <ChevronLeft className="w-4 h-4 text-muted-foreground/30 shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
