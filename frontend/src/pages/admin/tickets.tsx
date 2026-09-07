import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
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
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  open: {
    label: "مفتوحة",
    color: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    dot: "bg-blue-400",
  },
  in_progress: {
    label: "قيد المعالجة",
    color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    dot: "bg-yellow-400",
  },
  closed: {
    label: "مغلقة",
    color: "text-muted-foreground bg-muted/30 border-border",
    dot: "bg-muted-foreground",
  },
};

const CATEGORIES: Record<string, string> = {
  billing: "الدفع",
  order: "الطلبات",
  technical: "تقني",
  account: "الحساب",
  other: "أخرى",
};

const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  { value: "open", label: "مفتوحة" },
  { value: "in_progress", label: "قيد المعالجة" },
  { value: "closed", label: "مغلقة" },
];

const CATEGORY_FILTERS = [
  { value: "", label: "جميع الفئات" },
  { value: "billing", label: "الدفع" },
  { value: "order", label: "الطلبات" },
  { value: "technical", label: "تقني" },
  { value: "account", label: "الحساب" },
  { value: "other", label: "أخرى" },
];

interface TicketSummary {
  id: number;
  user_phone: string;
  user_display_name?: string | null;
  user_email?: string | null;
  user_auth_provider?: string | null;
  user_has_google?: boolean;
  user_has_telegram?: boolean;
  user_has_firebase?: boolean;
  user_has_whatsapp?: boolean;
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
  // Round-3 (react-hooks/rules-of-hooks): this useState previously sat
  // AFTER an early return — a conditional hook that would crash React
  // on the logged-out render path. Hoisted to the top of the component.
  const [statusBusy, setStatusBusy] = useState<number | null>(null);

  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // B5-04 (round-92 audit): fetchTickets had `.catch(() => {})` — a
  // failed queue load rendered the false "لا توجد تذاكر" empty state,
  // so an admin on a flaky network believed the support queue was
  // empty. The failure now surfaces as the distinct error card (C5
  // storefront idiom) on the initial load, and as an inline banner
  // when a refresh of an already-rendered list fails.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const headers = useAdminHeaders();

  const fetchTickets = async () => {
    if (!adminToken) return;
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    try {
      const r = await fetch(`/api/admin/tickets${qs}`, { headers });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        // getErrorMessage maps the backend `code` to Arabic when present.
        throw new Error(getErrorMessage(body) || `فشل تحميل التذاكر (HTTP ${r.status})`);
      }
      const d = await r.json();
      setTickets(Array.isArray(d) ? d : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "تعذّر تحميل التذاكر");
    } finally {
      setLoading(false);
    }
  };

  // B5-14 (round-92 audit, P2): openTicket had no `res.ok` check and
  // was invoked unawaited from onClick — a 401/500 detail fetch became
  // an unhandled promise rejection with zero UI feedback.
  const openTicket = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/tickets/${id}`, { headers });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `فشل فتح التذكرة (HTTP ${res.status})`);
      }
      const d = await res.json();
      setSelected(d);
      setReplyText("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "تعذّر فتح التذكرة",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [adminToken, statusFilter]);

  useEffect(() => {
    if (selected) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected?.replies?.length]);

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  if (!adminToken) return null;

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
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشلت العملية",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handleStatus = async (id: number, status: string) => {
    // In-flight guard: without it a double-click fired two PATCHes and
    // no UI state ever reflected the pending transition.
    if (statusBusy !== null) return;
    setStatusBusy(id);
    try {
      const res = await fetch(`/api/admin/tickets/${id}/status`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      if (selected?.id === id) await openTicket(id);
      fetchTickets();
      toast({
        title: status === "closed" ? "تم إغلاق التذكرة" : "تمت إعادة فتح التذكرة",
        variant: "success",
      });
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشل تنفيذ العملية",
        variant: "destructive",
      });
    } finally {
      setStatusBusy(null);
    }
  };

  const openCount = tickets.filter((t) => t.status === "open").length;
  const pendingCount = tickets.filter(
    (t) => t.status === "open" || t.status === "in_progress",
  ).length;
  const visibleTickets = tickets.filter((t) => {
    const matchCategory = !categoryFilter || t.category === categoryFilter;
    return matchCategory;
  });

  return (
    <AdminLayout onRefresh={() => void fetchTickets()} badges={{ openTickets: openCount }}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-black">تذاكر الدعم</h1>
              {pendingCount > 0 && (
                <span className="bg-blue-400/20 text-blue-400 border border-blue-400/30 text-xs font-black px-2.5 py-1 rounded-full">
                  {pendingCount} نشطة
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs mt-0.5">
              {visibleTickets.length}
              {visibleTickets.length !== tickets.length ? ` / ${tickets.length}` : ""} تذكرة
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-secondary/50 border border-border/60 rounded-2xl p-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStatusFilter(s.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${statusFilter === s.value ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategoryFilter(c.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                categoryFilter === c.value
                  ? "bg-primary/10 border-primary/30 text-primary font-bold"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Split pane */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 min-h-[520px]">
          {/* Ticket list */}
          <div className={`lg:col-span-2 ${selected ? "hidden lg:flex" : "flex"} flex-col gap-2`}>
            {/* Refresh of an already-rendered queue failed — keep the
                stale cards visible, surface the failure inline
                (coupons.tsx banner idiom) instead of blanking the list. */}
            {!loading && loadError && tickets.length > 0 && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={() => void fetchTickets()}
                  className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-card border border-border/60 rounded-2xl h-20 skeleton-shimmer"
                />
              ))
            ) : loadError && tickets.length === 0 ? (
              /* Distinct from "no data": an outage/expired session previously
                 masqueraded as the empty state below (B5-04). Same
                 error-card idiom the storefront pages use (loyalty.tsx /
                 orders.tsx) — an admin on a flaky network must never
                 believe the support queue is empty. */
              <div className="flex-1 text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl">
                <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
                  <WifiOff className="w-8 h-8 text-status-error/70" />
                </div>
                <p className="font-black text-lg mb-1.5 text-foreground/80">تعذّر تحميل التذاكر</p>
                <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
                  حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة
                </p>
                <Button
                  onClick={() => void fetchTickets()}
                  className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
                >
                  إعادة المحاولة
                </Button>
              </div>
            ) : visibleTickets.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-16 text-muted-foreground bg-card border border-border/60 rounded-2xl">
                <MessageSquare className="w-10 h-10 mb-3 opacity-25" />
                <p className="font-bold">لا توجد تذاكر</p>
                <p className="text-sm mt-1">ستظهر تذاكر الدعم هنا</p>
              </div>
            ) : (
              visibleTickets.map((t, i) => {
                const sc = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.open;
                const isActive = selected?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => openTicket(t.id)}
                    className={`float-in stagger-${Math.min(i + 1, 8)} w-full bg-card border rounded-2xl p-4 text-right transition-all duration-150 hover:shadow-md group ${isActive ? "border-primary/40 bg-primary/4 shadow-sm shadow-primary/5" : "border-border/60 hover:border-border"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {t.status === "open" && (
                            <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 animate-pulse" />
                          )}
                          <span className="font-bold text-sm truncate leading-snug flex-1">
                            {t.title}
                          </span>
                          {(t.last_reply_at || t.created_at) && (
                            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                              {formatRelativeTime(t.last_reply_at ?? t.created_at)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground font-mono">
                            {displayUserName(userFromRow(t))}
                          </span>
                          {t.category && (
                            <span className="text-[11px] text-muted-foreground bg-muted/40 border border-border/40 px-1.5 py-0.5 rounded-md">
                              {CATEGORIES[t.category] ?? t.category}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full border font-bold ${sc.color}`}
                          >
                            {sc.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t.reply_count} ردود
                          </span>
                        </div>
                      </div>
                      <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Detail pane */}
          {selected ? (
            <div className="lg:col-span-3 bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-muted/15">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => setSelected(null)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1.5 lg:hidden transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5 rotate-180" /> العودة
                  </button>
                  <h2 className="font-black text-sm truncate mb-1">{selected.title}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span className="font-mono">{displayUserName(userFromRow(selected))}</span>
                    </div>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border font-bold ${STATUS_CONFIG[selected.status]?.color}`}
                    >
                      {STATUS_CONFIG[selected.status]?.label}
                    </span>
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
                      onClick={() => handleStatus(selected.id, "closed")}
                      disabled={statusBusy === selected.id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
                      onClick={() => handleStatus(selected.id, "open")}
                      disabled={statusBusy === selected.id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
                    onClick={() => setSelected(null)}
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
                          {isAdmin ? (
                            <Shield className="w-3.5 h-3.5" />
                          ) : (
                            <User className="w-3.5 h-3.5" />
                          )}
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
                            className={`flex items-center gap-1 text-[10px] text-muted-foreground ${isAdmin ? "flex-row-reverse" : ""}`}
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
              <form onSubmit={handleReply} className="border-t border-border p-4">
                {selected.status === "closed" && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/50 rounded-lg px-3 py-2 mb-3">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    هذه التذكرة مغلقة — أعد فتحها للرد
                  </div>
                )}
                <div className="flex gap-2.5">
                  <Input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={
                      selected.status === "closed" ? "التذكرة مغلقة..." : "اكتب ردك هنا..."
                    }
                    className="flex-1 h-10"
                    disabled={selected.status === "closed"}
                    dir="rtl"
                  />
                  <Button
                    type="submit"
                    size="icon"
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
          ) : (
            <div className="hidden lg:flex lg:col-span-3 bg-card border border-border rounded-2xl items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-15" />
                <p className="font-bold text-sm">اختر تذكرة للعرض</p>
                <p className="text-xs mt-1">انقر على تذكرة من القائمة</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
