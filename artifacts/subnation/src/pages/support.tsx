import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquare, Plus, ChevronRight, Clock, CheckCircle, AlertCircle, Send, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  { value: "billing", label: "الدفع والفواتير" },
  { value: "order", label: "الطلبات" },
  { value: "technical", label: "مشكلة تقنية" },
  { value: "account", label: "الحساب" },
  { value: "other", label: "أخرى" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  open: { label: "مفتوحة", color: "text-blue-400 bg-blue-400/10 border-blue-400/20", icon: <Clock className="w-3 h-3" /> },
  in_progress: { label: "قيد المعالجة", color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20", icon: <AlertCircle className="w-3 h-3" /> },
  closed: { label: "مغلقة", color: "text-muted-foreground bg-muted/30 border-border", icon: <CheckCircle className="w-3 h-3" /> },
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

export default function SupportPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
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
    } catch {
    } finally {
      setTicketLoading(false);
    }
  };

  useEffect(() => { fetchTickets(); }, [token]);

  if (!token) { navigate("/login"); return null; }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) { toast({ title: "أدخل العنوان والرسالة", variant: "destructive" }); return; }
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

  const categoryLabel = (cat: string | null) => CATEGORIES.find(c => c.value === cat)?.label ?? "أخرى";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black">الدعم الفني</h1>
            <p className="text-sm text-muted-foreground">نحن هنا للمساعدة</p>
          </div>
        </div>
        {!selectedTicket && (
          <Button onClick={() => setShowCreate(v => !v)} className="bg-primary hover:bg-primary/90">
            {showCreate ? <><X className="w-4 h-4 ml-1" />إلغاء</> : <><Plus className="w-4 h-4 ml-1" />تذكرة جديدة</>}
          </Button>
        )}
      </div>

      {/* Ticket Detail View */}
      {selectedTicket && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div>
              <button onClick={() => setSelectedTicket(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
                ← العودة للتذاكر
              </button>
              <h2 className="font-black">{selectedTicket.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-bold ${STATUS_CONFIG[selectedTicket.status]?.color}`}>
                  {STATUS_CONFIG[selectedTicket.status]?.icon}
                  {STATUS_CONFIG[selectedTicket.status]?.label}
                </span>
                <span className="text-xs text-muted-foreground">{categoryLabel(selectedTicket.category)}</span>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
            {selectedTicket.replies.map(r => (
              <div key={r.id} className={`flex ${r.author_type === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${r.author_type === "user" ? "bg-primary text-white rounded-tl-sm" : "bg-muted rounded-tr-sm"}`}>
                  {r.author_type === "admin" && (
                    <div className="text-xs font-bold text-primary mb-1">فريق الدعم</div>
                  )}
                  <p className="text-sm leading-relaxed">{r.message}</p>
                  <div className={`text-xs mt-1.5 ${r.author_type === "user" ? "text-white/60" : "text-muted-foreground"}`}>
                    {formatDate(r.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {selectedTicket.status !== "closed" && (
            <form onSubmit={handleReply} className="border-t border-border p-4 flex gap-3">
              <Input
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder="اكتب ردك هنا..."
                className="flex-1"
              />
              <Button type="submit" disabled={sending || !replyText.trim()} size="icon" className="bg-primary hover:bg-primary/90 shrink-0">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </form>
          )}
          {selectedTicket.status === "closed" && (
            <div className="border-t border-border p-4 text-center text-sm text-muted-foreground">
              هذه التذكرة مغلقة
            </div>
          )}
        </div>
      )}

      {/* Create Form */}
      {!selectedTicket && showCreate && (
        <div className="bg-card border border-primary/30 rounded-2xl p-6 mb-6">
          <h2 className="font-black mb-4">تذكرة جديدة</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label>الفئة</Label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <Label>عنوان المشكلة *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="وصف مختصر للمشكلة" required className="mt-1" />
            </div>
            <div>
              <Label>تفاصيل المشكلة *</Label>
              <textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="اشرح المشكلة بالتفصيل..."
                required
                className="w-full mt-1 h-28 bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>إلغاء</Button>
              <Button type="submit" disabled={submitting} className="bg-primary hover:bg-primary/90">
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin ml-1" />جارٍ الإرسال...</> : "إرسال التذكرة"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Tickets List */}
      {!selectedTicket && (
        loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-20 animate-pulse" />)}</div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-2xl">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-bold mb-1">لا توجد تذاكر</p>
            <p className="text-sm">أنشئ تذكرة جديدة إذا واجهت أي مشكلة</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map(t => {
              const s = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.open;
              return (
                <button key={t.id} onClick={() => openTicket(t.id)} className="w-full bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-all text-right">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm truncate">{t.title}</span>
                        <span className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-bold ${s.color}`}>
                          {s.icon}{s.label}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-1.5">{categoryLabel(t.category)} · {formatDate(t.created_at)}</div>
                      {t.last_reply && (
                        <div className={`text-xs px-2.5 py-1.5 rounded-lg ${t.last_reply.author_type === "admin" ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground"}`}>
                          {t.last_reply.author_type === "admin" ? "رد الفريق: " : "آخر رسالة: "}{t.last_reply.message}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
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
