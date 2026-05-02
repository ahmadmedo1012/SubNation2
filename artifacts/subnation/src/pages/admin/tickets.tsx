import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatDate } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { MessageSquare, Filter, Send, ChevronRight, Clock, AlertCircle, CheckCircle, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: "مفتوحة", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  in_progress: { label: "قيد المعالجة", color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
  closed: { label: "مغلقة", color: "text-muted-foreground bg-muted/30 border-border" },
};

const CATEGORIES: Record<string, string> = {
  billing: "الدفع", order: "الطلبات", technical: "تقني", account: "الحساب", other: "أخرى",
};

interface TicketSummary {
  id: number;
  user_phone: string;
  title: string;
  category: string | null;
  status: string;
  created_at: string;
  reply_count: number;
  last_reply_at: string | null;
  has_unread_admin: boolean;
}

interface TicketDetail extends TicketSummary {
  replies: { id: number; author_type: string; message: string; created_at: string }[];
}

export default function AdminTicketsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  const fetchTickets = () => {
    if (!adminToken) return;
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    fetch(`/api/admin/tickets${qs}`, { headers })
      .then(r => r.json())
      .then(d => setTickets(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const openTicket = async (id: number) => {
    const res = await fetch(`/api/admin/tickets/${id}`, { headers });
    const d = await res.json();
    setSelected(d);
    setReplyText("");
  };

  useEffect(() => { fetchTickets(); }, [adminToken, statusFilter]);

  if (!adminToken) { navigate("/admin/login"); return null; }

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !replyText.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/tickets/${selected.id}/reply`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyText }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setReplyText("");
      await openTicket(selected.id);
      fetchTickets();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleStatus = async (id: number, status: string) => {
    await fetch(`/api/admin/tickets/${id}/status`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (selected?.id === id) await openTicket(id);
    fetchTickets();
  };

  const pendingCount = tickets.filter(t => t.status === "open").length;

  return (
    <AdminLayout onRefresh={fetchTickets}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black">تذاكر الدعم</h1>
            {pendingCount > 0 && (
              <span className="bg-blue-400/20 text-blue-400 border border-blue-400/30 text-xs font-black px-2.5 py-1 rounded-full">
                {pendingCount} جديدة
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {["", "open", "in_progress", "closed"].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? "bg-primary text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                {s === "" ? "الكل" : STATUS_CONFIG[s]?.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* List */}
          <div className={`${selected ? "hidden lg:block lg:col-span-2" : "lg:col-span-5"}`}>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-20 animate-pulse" />)}</div>
            ) : tickets.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>لا توجد تذاكر</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tickets.map(t => {
                  const s = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.open;
                  return (
                    <button key={t.id} onClick={() => openTicket(t.id)}
                      className={`w-full bg-card border rounded-xl p-4 text-right transition-all hover:border-primary/30 ${selected?.id === t.id ? "border-primary/50" : "border-border"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            {t.status === "open" && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />}
                            <span className="font-bold text-sm truncate">{t.title}</span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{t.user_phone}</div>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full border font-bold ${s.color}`}>{s.label}</span>
                            {t.category && <span className="text-xs text-muted-foreground">{CATEGORIES[t.category] ?? t.category}</span>}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0 text-left">
                          <div>{t.reply_count} ردود</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Detail */}
          {selected && (
            <div className="lg:col-span-3 bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
              <div className="flex items-start justify-between p-5 border-b border-border">
                <div className="flex-1">
                  <button onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:text-foreground mb-2 lg:hidden">← العودة</button>
                  <h2 className="font-black text-sm mb-1">{selected.title}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{selected.user_phone}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${STATUS_CONFIG[selected.status]?.color}`}>
                      {STATUS_CONFIG[selected.status]?.label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selected.status !== "closed" && (
                    <button onClick={() => handleStatus(selected.id, "closed")}
                      className="text-xs px-2.5 py-1 rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> إغلاق
                    </button>
                  )}
                  {selected.status === "closed" && (
                    <button onClick={() => handleStatus(selected.id, "open")}
                      className="text-xs px-2.5 py-1 rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
                      إعادة فتح
                    </button>
                  )}
                  <button onClick={() => setSelected(null)} className="hidden lg:block p-1.5 rounded-lg hover:bg-secondary"><X className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-96">
                {selected.replies.map(r => (
                  <div key={r.id} className={`flex ${r.author_type === "admin" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${r.author_type === "admin" ? "bg-primary text-white rounded-tl-sm" : "bg-muted rounded-tr-sm"}`}>
                      <div className={`text-xs font-bold mb-1 ${r.author_type === "admin" ? "text-white/70" : "text-muted-foreground"}`}>
                        {r.author_type === "admin" ? "أنت (الإدارة)" : "المستخدم"}
                      </div>
                      <p className="text-sm leading-relaxed">{r.message}</p>
                      <div className={`text-xs mt-1.5 ${r.author_type === "admin" ? "text-white/60" : "text-muted-foreground"}`}>
                        {formatDate(r.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleReply} className="border-t border-border p-4 flex gap-3">
                <Input
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="اكتب ردك للمستخدم..."
                  className="flex-1"
                  disabled={selected.status === "closed"}
                />
                <Button type="submit" size="icon" className="bg-primary hover:bg-primary/90 shrink-0"
                  disabled={sending || !replyText.trim() || selected.status === "closed"}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
