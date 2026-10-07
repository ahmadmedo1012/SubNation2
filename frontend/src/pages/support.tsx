import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatCount, formatDate, formatRelativeTime } from "@/lib/utils";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  Clock,
  Headphones,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Shield,
  User,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useSeo } from "@/hooks/useSeo";
import { buildFaqLd, type FaqItem } from "@/lib/seo-builders";

const CATEGORIES = [
  { value: "billing", label: "الدفع والفواتير", icon: "💳" },
  { value: "order", label: "الطلبات", icon: "📦" },
  { value: "technical", label: "مشكلة تقنية", icon: "⚙️" },
  { value: "account", label: "الحساب", icon: "👤" },
  { value: "other", label: "أخرى", icon: "💬" },
];

/**
 * SEO FAQ — answers questions real users ask before they sign up.
 *
 * IMPORTANT: every item here is grounded in actual product behaviour
 * (wallet ledger, topup approvals, instant credentials delivery, the
 * 5 LYD welcome bonus on the referred user's first APPROVED topup —
 * R115 policy B, etc.). Do NOT fabricate
 * answers — Google can downgrade FAQ rich-results that don't match
 * the rendered page content. Update both the Q&A objects AND any UI
 * copy that asserts the same fact when policies change.
 *
 * Schema rules (from Google):
 *   - Q&A must also be visible on the page (not just in JSON-LD).
 *   - Answers must be the publisher's, not the user's.
 *   - Don't mark up advertising content as FAQ.
 */
const SUPPORT_FAQ: FaqItem[] = [
  {
    question: "كيف أشتري اشتراكاً عبر SubNation؟",
    answer:
      "اختر المنتج من المتجر، تأكد من رصيد المحفظة، ثم اضغط شراء. سيتم خصم المبلغ من محفظتك فوراً وستصلك بيانات الاشتراك في صفحة الطلب وعبر الإشعارات.",
  },
  {
    question: "ما طرق الدفع المتاحة؟",
    answer:
      "يتم الشراء من رصيد محفظتك داخل SubNation. يمكنك شحن المحفظة بالدينار الليبي عبر طلبات الشحن (Top-up) ضمن صفحة المحفظة، ثم يتم اعتماد الشحن من قِبَل الإدارة قبل توفر الرصيد للشراء.",
  },
  {
    question: "متى أستلم بيانات الاشتراك بعد الشراء؟",
    answer:
      "التسليم فوري في أغلب الحالات. إذا كان المنتج يتطلب تجهيز يدوي ستُحدَّد مدة الانتظار في صفحة الطلب وتصلك بيانات الاشتراك بمجرد الجاهزية.",
  },
  {
    question: "هل يمكنني استرداد المبلغ إذا واجهت مشكلة؟",
    answer:
      "نعم. إذا لم يصلك الاشتراك أو واجهتك مشكلة في تفعيل الحساب، تواصل مع الدعم خلال 24 ساعة من الشراء وسنُرجع المبلغ إلى محفظتك بعد التحقق. الاشتراكات المسلَّمة والمستخدَمة لا تُسترَد.",
  },
  {
    question: "كم تستغرق الموافقة على شحن المحفظة؟",
    answer:
      "عادةً خلال 15 دقيقة إلى ساعة في أوقات العمل. ستظهر حالة الطلب في صفحة المحفظة، وتصلك إشعارات بالقبول أو الرفض.",
  },
  {
    question: "نسيت كلمة المرور — كيف أستعيد حسابي؟",
    answer:
      "يدعم SubNation الدخول عبر البريد الإلكتروني وGoogle وTelegram. اذهب لصفحة الدخول واختر طريقة الدخول التي استخدمتها للتسجيل أصلاً. لا حاجة لكلمات مرور تقليدية.",
  },
  {
    question: "هل بياناتي الشخصية محمية؟",
    answer:
      "نعم. جميع البيانات تُرسَل عبر اتصال مشفّر (HTTPS)، ولا نشارك بياناتك مع أطراف ثالثة. للاطلاع على التفاصيل راجع صفحة سياسة الخصوصية.",
  },
  {
    question: "هل يمكنني مشاركة حساب الاشتراك مع شخص آخر؟",
    answer:
      "تخضع المشاركة لشروط الخدمة الأصلية لكل منصة (Netflix، Spotify، …). نحن لا نمنع المشاركة لكن أي قيود من جانب المنصة الأصلية تظل سارية ولا نتحمّل مسؤوليتها.",
  },
  {
    question: "هل أحصل على مكافأة عند دعوة أصدقائي؟",
    answer:
      "نعم. عندما يعتمد فريقنا أول شحن لصديقٍ انضم عبر رمز إحالتك، تحصل أنت على نقاط ولاء قابلة للتحويل لرصيد، ويحصل صديقك على مكافأة ترحيب 5 د.ل تُضاف لمحفظته في الوقت نفسه.",
  },
  {
    question: "كيف أتواصل مع الدعم؟",
    answer:
      "افتح تذكرة دعم جديدة من هذه الصفحة باختيار التصنيف المناسب وإرفاق التفاصيل. يصلك الرد عبر الإشعارات وداخل التذكرة.",
  },
  {
    question: "هل المتجر متاح خارج ليبيا؟",
    answer:
      "SubNation مصمَّم لمستخدمي ليبيا والدفع بالدينار الليبي. يمكن لأي شخص تصفح المنتجات، لكن قد يتطلب الشراء وسيلة شحن متاحة محلياً.",
  },
];

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode; border: string }
> = {
  open: {
    label: "مفتوحة",
    // R94-A1 #5 (P2, WCAG AA): raw blue-400/yellow-400 on white cards
    // measured 2.54:1 / 1.53:1 in the light theme — the shared --status-*
    // tokens carry theme-aware values tuned for card surfaces.
    color: "text-status-info bg-status-info/10",
    icon: <Clock className="w-3 h-3" />,
    border: "border-status-info/25",
  },
  in_progress: {
    label: "قيد المعالجة",
    color: "text-status-warning bg-status-warning/10",
    icon: <AlertCircle className="w-3 h-3" />,
    border: "border-status-warning/25",
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
  // R120-B3 (A7-F2 P1): /support is robots-Allow'ed and sitemap-listed —
  // anonymous visitors now get the PUBLIC FAQ surface (accordion +
  // FAQPage JSON-LD + the support meta); only the ticket inbox/create
  // form is auth-gated. `isAuthenticated` gates every ticket UI below.
  const isAuthenticated = !!token;
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  // 93-C5 / F-05 (A4 P2 #6): a failed list fetch used to fall through to
  // the "لا توجد تذاكر دعم" empty state — an outage masquerading as "no
  // tickets" (the exact class round-92 claimed closed for tickets).
  const [listError, setListError] = useState(false);
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
      .then(async (r) => {
        // 93-C5 / F-05: no res.ok check — a 401/5xx envelope used to be
        // `.json()`-parsed into a non-array and silently rendered as the
        // empty list. Distinguish failure from emptiness.
        if (!r.ok) throw new Error("tickets fetch failed");
        return r.json();
      })
      .then((d) => {
        setTickets(Array.isArray(d) ? d : []);
        setListError(false);
      })
      .catch(() => {
        setListError(true);
      })
      .finally(() => setLoading(false));
  };

  const openTicket = async (id: number) => {
    setTicketLoading(true);
    try {
      const res = await fetch(`/api/support/tickets/${id}`, { headers });
      const d = await res.json().catch(() => null);
      // 93-C5 / F-05 (A4 P2 #6): openTicket had NO res.ok / shape guard —
      // a 401/5xx body {error} was set as selectedTicket and the render
      // path dereferenced `selectedTicket.replies.length` → TypeError →
      // the route-level ErrorBoundary replaced the whole page. Any
      // session expiry / API blip while clicking a ticket nuked the page.
      if (!res.ok || !d || !Array.isArray(d.replies)) {
        toast({
          title: "تعذّر تحميل التذكرة",
          description: "حدث خطأ في الاتصال — أعد المحاولة",
          variant: "destructive",
        });
        return;
      }
      setSelectedTicket(d);
      setReplyText("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch {
      toast({
        title: "تعذّر تحميل التذكرة",
        description: "حدث خطأ في الاتصال — أعد المحاولة",
        variant: "destructive",
      });
    } finally {
      setTicketLoading(false);
    }
  };

  useEffect(() => {
    // R120-B3 (A7-F2 P1): NO anonymous redirect — the FAQ surface is
    // public. The ticket fetch itself is already token-guarded inside
    // fetchTickets; anonymous visitors simply never load the inbox.
    if (token) fetchTickets();
  }, [token]);

  useEffect(() => {
    if (selectedTicket) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    // R120-B3 (A5-F8): re-run when SWITCHING tickets too — the old
    // [replies.length] key skipped the scroll when a second ticket had
    // the SAME reply count (e.g. both empty) as the previously open one.
  }, [selectedTicket?.id, selectedTicket?.replies?.length]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    // R94-A1 #3 (P2, consistency with handleReply): a second submit while
    // the first POST is in flight must be a no-op — the submit button is
    // disabled, but a double form-submit (Enter) bypasses it.
    if (submitting) return;
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
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        // R111-F2 Q1: calm + actionable fallback (was the vague «فشلت العملية»).
        description: err instanceof Error ? err.message : "تعذّر إتمام العملية — حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    // R94-A1 #3 (P2): the Enter keydown handler calls this directly,
    // bypassing the disabled submit button — two quick Enters during the
    // in-flight POST duplicated the reply in the ticket. `sending` is the
    // single source of truth for in-flight state.
    if (sending) return;
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
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        // R111-F2 Q1 (same family as handleCreate above).
        description: err instanceof Error ? err.message : "تعذّر إتمام العملية — حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const openCount = tickets.filter((t) => t.status === "open").length;

  // R94-A1 #12 (P3): order-detail's failure card links here with
  // ?ref=<order_code> — the exact moment the user needs context. Read it
  // once at mount; when present, auto-open the create form with the
  // orders category and a prefilled title so the code never has to be
  // copied manually.
  const refParam = useMemo(() => {
    if (typeof window === "undefined") return "";
    return (new URLSearchParams(window.location.search).get("ref") ?? "").trim().slice(0, 32);
  }, []);
  useEffect(() => {
    if (!refParam || !token) return;
    setShowCreate(true);
    setForm((f) => (f.title ? f : { ...f, title: `بخصوص الطلب ${refParam}`, category: "order" }));
  }, [refParam, token]);

  // SEO — title, canonical, OG, Twitter, robots, plus FAQPage JSON-LD
  // built from SUPPORT_FAQ. Note: the same Q&A is rendered visibly on
  // the page below (Google requires JSON-LD content to also be visible).
  const seoBlock = useSeo({
    title: "الدعم والأسئلة الشائعة — SubNation",
    description:
      "إجابات حول الدفع وشحن المحفظة والاشتراكات والاسترداد وتسجيل الدخول في SubNation. افتح تذكرة دعم في أي وقت.",
    path: "/support",
    locale: "ar",
    type: "website",
    jsonLd: [buildFaqLd(SUPPORT_FAQ)],
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-7 page-in">
      {seoBlock}
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {selectedTicket ? (
            /* 96-F6 (R96 A2 P2-6): back button at the 44px touch floor. */
            <button
              onClick={() => setSelectedTicket(null)}
              aria-label="رجوع لقائمة التذاكر"
              className="w-11 h-11 rounded-xl flex items-center justify-center bg-secondary/60 hover:bg-secondary border border-border/50 transition-all press-spring"
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
              <h1 className="text-xl font-bold leading-tight break-words">
                {selectedTicket ? selectedTicket.title : "الدعم الفني"}
              </h1>
              {!selectedTicket && openCount > 0 && (
                <span className="text-2xs font-bold bg-status-info/12 text-status-info border border-status-info/25 px-2 py-0.5 rounded-full">
                  {formatCount(openCount, {
                    one: "مفتوحة",
                    two: "مفتوحتان",
                    few: "مفتوحة",
                    many: "مفتوحة",
                    other: "مفتوحة",
                  })}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedTicket
                ? `#${selectedTicket.id} · ${formatRelativeTime(selectedTicket.created_at)}`
                : "نرد عادةً خلال 15 دقيقة إلى ساعة في أوقات العمل — التذاكر خارجها تُعالَج أول النهار"}
            </p>
          </div>
        </div>

        {!selectedTicket && !showCreate && isAuthenticated && (
          <Button
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 active:scale-[0.97] transition-all gap-1.5 rounded-xl shrink-0"
          >
            <Plus className="w-4 h-4" />
            تذكرة جديدة
          </Button>
        )}
        {showCreate && !selectedTicket && (
          /* 96-F6 (R96 A2 P2-6): close button at the 44px touch floor. */
          <button
            onClick={() => {
              setShowCreate(false);
              setForm({ title: "", message: "", category: "other" });
            }}
            aria-label="إغلاق نموذج التذكرة الجديدة"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all press-spring"
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
                ? "bg-gradient-to-l from-status-info/80 via-status-info/40 to-transparent"
                : selectedTicket.status === "in_progress"
                  ? "bg-gradient-to-l from-status-warning/80 via-status-warning/40 to-transparent"
                  : "bg-gradient-to-l from-border to-transparent"
            }`}
          />

          {/* Ticket meta */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border/25 bg-muted/8 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 text-2xs px-2 py-1 rounded-full border font-bold ${STATUS_CONFIG[selectedTicket.status]?.color} ${STATUS_CONFIG[selectedTicket.status]?.border}`}
            >
              {STATUS_CONFIG[selectedTicket.status]?.icon}
              {STATUS_CONFIG[selectedTicket.status]?.label}
            </span>
            {selectedTicket.category && (
              <span className="text-2xs text-muted-foreground bg-muted/40 border border-border/40 px-2 py-1 rounded-full flex items-center gap-1">
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
                <div className="h-12 w-3/5 skeleton-shimmer rounded-2xl" />
              </div>
              <div className="flex justify-end">
                <div className="h-16 w-2/3 skeleton-shimmer rounded-2xl" />
              </div>
              <div className="flex justify-start">
                <div className="h-10 w-1/2 skeleton-shimmer rounded-2xl" />
              </div>
            </div>
          ) : (
            <div
              className="p-5 space-y-5 overflow-y-auto scrollbar-none"
              style={{ maxHeight: "min(460px, calc(100dvh - 260px))" }}
            >
              {selectedTicket.replies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <div className="w-12 h-12 rounded-2xl bg-muted/40 border border-border/30 flex items-center justify-center mb-3">
                    <MessageSquare className="w-5 h-5 opacity-20" />
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
                          <span className="text-2xs font-bold text-primary/80 px-1">
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
          <div className="border-t border-border/25 p-4">
            {selectedTicket.status === "closed" ? (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/25 border border-border/30 rounded-xl px-4 py-3">
                <CheckCircle className="w-3.5 h-3.5 text-status-success shrink-0" />
                التذكرة مغلقة — أنشئ تذكرة جديدة إذا احتجت مساعدة إضافية
              </div>
            ) : (
              <form onSubmit={handleReply} className="flex gap-2">
                <Input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="اكتب ردك هنا…"
                  aria-label="نص الرد على التذكرة"
                  /* 96-F6 (R96 A2 P2-6 + P3-3): 44px row (matches the send
                     button) + mobile Enter key labelled “send” + the
                     backend's reply cap (TicketMessageBody, 4000 chars) as
                     a live client-side limit instead of a server
                     round-trip error. */
                  maxLength={4000}
                  enterKeyHint="send"
                  className="flex-1 h-11 rounded-xl bg-muted/30 border-border/50 focus:border-primary/40 transition-all"
                  dir="rtl"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleReply(e as React.FormEvent);
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  aria-label="إرسال الرد"
                  className="w-11 h-11 rounded-xl bg-primary hover:bg-primary/90 text-white flex items-center justify-center shrink-0 transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-primary/25 press-spring"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    /* 93-C5 / F-03 (A12 C-UX1): Send is a directional glyph —
                       mirror it in RTL like admin/tickets.tsx (B5-17), the
                       last 2 un-mirrored Send icons in the app. */
                    <Send className="w-4 h-4 -scale-x-100" />
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
            <h2 className="font-bold text-sm">تذكرة دعم جديدة</h2>
          </div>

          <form onSubmit={handleCreate} className="p-5 space-y-4">
            {/* Category pills */}
            <div>
              {/* 96-F6 (R96 A6 #10): the category control is a pill GROUP,
                 not a single form control — htmlFor can't bind to it. The
                 group idiom: visible heading with an id +
                 role=group/aria-labelledby on the button row (same
                 labelling outcome as Label+htmlFor for a single field). */}
              <p
                id="support-ticket-category-label"
                className="text-xs font-bold text-muted-foreground mb-2.5"
              >
                الفئة
              </p>
              <div
                role="group"
                aria-labelledby="support-ticket-category-label"
                className="flex flex-wrap gap-2"
              >
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                    /* R122 (A1 P2-7): min-h-[36px] → min-h-11 — the 44px
                       tap-target floor the catalog chips already ride. */
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 press-spring min-h-11 ${
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
              {/* 96-F6 (R96 A6 #10): programmatic label + API-aligned cap
                  (backend CreateTicketBody: title ≤ 255, message ≤ 4000 —
                  A2 P3-3 turns the server round-trip error into a live
                  client-side limit). */}
              <Label
                htmlFor="support-ticket-title"
                className="text-xs font-bold text-muted-foreground"
              >
                عنوان المشكلة *
              </Label>
              <Input
                id="support-ticket-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="وصف مختصر للمشكلة..."
                required
                maxLength={255}
                className="h-10 rounded-xl border-border/50 focus:border-primary/40 bg-card transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="support-ticket-message"
                className="text-xs font-bold text-muted-foreground"
              >
                تفاصيل المشكلة *
              </Label>
              <textarea
                id="support-ticket-message"
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="اشرح المشكلة بالتفصيل لنتمكن من مساعدتك بشكل أسرع..."
                required
                rows={4}
                maxLength={4000}
                /* 96-F6 (R96 A1 #3 / A6 #10): 16px on mobile kills the
                   iOS focus-zoom (the shared Input does the same via its
                   own text-base; this raw textarea had text-sm). */
                className="w-full bg-card border border-border/50 rounded-xl px-3.5 py-3 text-base md:text-sm focus:border-primary/40 resize-none leading-relaxed transition-all hover:border-border/80 placeholder:text-muted-foreground"
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
                    {/* 93-C5 / F-03 (A12 C-UX1): RTL-mirrored Send (twin of
                        the reply box above). */}
                    <Send className="w-4 h-4 -scale-x-100" />
                    إرسال التذكرة
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tickets List ─────────────────────────────────────────── */}
      {/* R120-B3 (A7-F2 P1): the ticket inbox/create surface is the ONLY
          auth-gated part of /support. Anonymous visitors get a login CTA
          (the ?redirect=/support deep-link is the guarded-page convention
          login.tsx already validates) instead of the old hard redirect —
          the FAQ section below stays fully public. */}
      {!selectedTicket && !isAuthenticated && (
        <div className="text-center py-12 px-4 bg-card border border-primary/22 rounded-2xl reveal-up">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-6 h-6 text-primary" />
          </div>
          <p className="font-bold text-sm mb-1.5 text-foreground/80">تحتاج مساعدة شخصية؟</p>
          <p className="text-xs text-muted-foreground mb-5 leading-relaxed max-w-xs mx-auto">
            سجّل الدخول لفتح تذكرة دعم ومتابعة الرد من هذه الصفحة
          </p>
          <Button
            asChild
            className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 rounded-xl gap-1.5"
          >
            <Link href="/login?redirect=/support">
              <Headphones className="w-4 h-4" />
              سجّل الدخول لفتح تذكرة
            </Link>
          </Button>
        </div>
      )}
      {!selectedTicket &&
        isAuthenticated &&
        (loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl skeleton-shimmer border border-border/35" />
            ))}
          </div>
        ) : listError ? (
          /* 93-C5 / F-05: distinct from "no tickets" — an outage/expired
             session previously read as "لا توجد تذاكر دعم". Same error-card
             idiom as orders/loyalty (B4 P1-4 class). */
          <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl reveal-up">
            <div className="w-14 h-14 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center mx-auto mb-4">
              <WifiOff className="w-6 h-6 text-status-error/70" />
            </div>
            <p className="font-bold text-sm mb-1.5 text-foreground/80">تعذّر تحميل التذاكر</p>
            <p className="text-xs text-muted-foreground mb-5 leading-relaxed max-w-xs mx-auto">
              حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة
            </p>
            <Button
              onClick={fetchTickets}
              className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 rounded-xl gap-1.5"
            >
              إعادة المحاولة
            </Button>
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
                    ${t.status === "open" ? "border-r-status-info/55" : t.status === "in_progress" ? "border-r-status-warning/55" : "border-r-border/40"}
                  `}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {t.status === "open" && (
                          <span className="w-2 h-2 rounded-full bg-status-info shrink-0 pulse-dot" />
                        )}
                        <span className="font-bold text-sm truncate flex-1 leading-snug group-hover:text-primary transition-colors duration-150">
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

      {/* ── Visible FAQ — backs the JSON-LD FAQPage claim ─────────────────
          Google requires every Q&A in FAQPage JSON-LD to also be visible
          on the page. We hide this section when a ticket is selected so
          the message thread stays focused.
      */}
      {!selectedTicket && (
        <section className="mt-10 mb-6">
          <h2 className="text-base font-bold mb-3 flex items-center gap-2 border-r-2 border-primary pr-3">
            الأسئلة الشائعة
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            الأسئلة التي يطرحها المستخدمون قبل أول عملية شراء — اضغط على أي سؤال لرؤية الإجابة.
          </p>
          <div className="space-y-2">
            {SUPPORT_FAQ.map((item, i) => (
              <details
                key={i}
                className="group bg-card border border-border/55 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none"
              >
                <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-muted/15 transition-colors select-none">
                  <span className="text-sm font-bold flex-1">{item.question}</span>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground transition-transform group-open:-rotate-90 shrink-0" />
                </summary>
                <div className="px-4 pt-1 pb-4 border-t border-border/40 text-sm text-muted-foreground leading-relaxed">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Bottom safe area */}
      <div className="h-6 md:h-0" />
    </div>
  );
}
