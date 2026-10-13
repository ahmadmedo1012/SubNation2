import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatCount, formatRelativeTime } from "@/lib/utils";
import { ArrowRight, Headphones, MessageSquare, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useSeo } from "@/hooks/useSeo";
import { buildFaqLd } from "@/lib/seo-builders";
import { SUPPORT_FAQ } from "@/components/support/support-faq";
import { type Ticket, type TicketDetail } from "@/components/support/support-meta";
import { TicketThread } from "@/components/support/TicketThread";
import { CreateTicketForm } from "@/components/support/CreateTicketForm";
import { TicketsList } from "@/components/support/TicketsList";
import { FaqSection } from "@/components/support/FaqSection";

/* R137 (FE decomposition): this page is the /support orchestration core.
   The presentational surfaces live as verbatim extracts under
   components/support/ (TicketThread, CreateTicketForm, TicketsList,
   FaqSection + the support-meta taxonomy and the support-faq data
   module) — they take values + callbacks only. Everything that
   coordinates stays HERE: every state atom, the list/thread fetches,
   the create/reply POSTs with their double-submit guards, the 25 s
   open-ticket poll and the ?ref= / ?ticket= deep-link effects. The
   structure is pinned by support-decomposition-r137.test.ts; the DOM
   contract by the support-* render suites. */

/**
 * B-10 (R128-IMP-5 / B13 §3): user-side ticket threads have NO socket
 * event today (admin replies reach the user through the notification
 * bell; the B6-2/B6-3 resync lane covers admin surfaces + money
 * screens), so while an open/awaiting ticket is selected the page polls
 * its thread at this cadence. 25 s sits between admin alerts (20 s) and
 * risk (30 s) — the repo's polling family. Gated to visible tabs (the
 * tick skips a hidden document, the same contract
 * refetchIntervalInBackground:false gives the query-based pages).
 */
const TICKET_THREAD_POLL_MS = 25_000;

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
          description: "حدث خطأ في الاتصال — حاول مجدداً",
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
        description: "حدث خطأ في الاتصال — حاول مجدداً",
        variant: "destructive",
      });
    } finally {
      setTicketLoading(false);
    }
  };

  // B-10 (R128-IMP-5 / B13 §3): the poll's SILENT thread refresh. It must
  // NOT reuse openTicket — that one flashes the reply skeleton
  // (ticketLoading), clears the reply draft and force-scrolls on every
  // call, none of which is acceptable on a background tick. Here only
  // setSelectedTicket swaps, and only when THIS ticket is still the
  // selected one (an in-flight poll can resolve after the user backed
  // out to the list or switched tickets — the functional set drops it
  // instead of re-opening the detail view). The scroll effect below
  // stays quiet unless a new reply actually landed (replies.length
  // changed), which is exactly when a scroll is wanted.
  const refreshOpenTicketSilently = useCallback(
    async (id: number) => {
      if (!token) return;
      try {
        const res = await fetch(`/api/support/tickets/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await res.json().catch(() => null);
        // Same res.ok + shape guard as openTicket (93-C5 / F-05) — a
        // 401/5xx envelope must never reach selectedTicket; on failure
        // the previous thread stays and the next tick retries.
        if (!res.ok || !d || !Array.isArray(d.replies)) return;
        setSelectedTicket((prev) => (prev && prev.id === id ? (d as TicketDetail) : prev));
      } catch {
        // network blip — the next 25 s tick retries
      }
    },
    [token],
  );

  // B-10 (R128-IMP-5): the poll itself. Armed ONLY while the selected
  // ticket is still live (open / in_progress) — a closed ticket or the
  // list view never arms the interval, and a poll that observes the
  // ticket transition to closed disarms it on the next effect run.
  // Deps are deliberately the SCALARS (status-liveness, ticket id): a
  // keystroke in the reply box re-renders but must not reset the 25 s
  // cadence, and refreshOpenTicketSilently is useCallback-stable on
  // [token].
  const ticketIsLive =
    selectedTicket != null &&
    (selectedTicket.status === "open" || selectedTicket.status === "in_progress");
  const polledTicketId = ticketIsLive ? selectedTicket.id : null;
  useEffect(() => {
    if (polledTicketId == null) return;
    const id = polledTicketId;
    const timer = setInterval(() => {
      // Hidden tab → no request (the bell's 60 s fallback uses the same
      // visibility gate; refetchIntervalInBackground:false for the
      // query-based pages).
      if (document.hidden) return;
      void refreshOpenTicketSilently(id);
    }, TICKET_THREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [polledTicketId, refreshOpenTicketSilently]);

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
        description: err instanceof Error ? err.message : "تعذّر إتمام العملية — حاول مجدداً",
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
        description: err instanceof Error ? err.message : "تعذّر إتمام العملية — حاول مجدداً",
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

  // A9-1 (R126-L6): the backend's reply notification deep-links to
  // /support?ticket=<id> (admin/tickets.ts — same continuation contract
  // as /orders/:code). Read it once at mount; once BOTH the authed
  // ticket list has resolved AND the id belongs to the user's list,
  // auto-open that ticket's thread — the user taps «التذكرة» in the
  // bell and lands ON the conversation instead of visually searching
  // the list for it. Membership is checked client-side so a foreign /
  // stale id is a silent no-op (never a 404 toast at the user). The
  // consumed-once ref keeps a later list refetch (e.g. after creating
  // another ticket) from re-opening the thread after the user backed
  // out to the list.
  const ticketParam = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = (new URLSearchParams(window.location.search).get("ticket") ?? "").trim();
    if (!/^\d{1,9}$/.test(raw)) return null;
    const id = Number.parseInt(raw, 10);
    return Number.isSafeInteger(id) ? id : null;
  }, []);
  const ticketParamConsumedRef = useRef(false);
  useEffect(() => {
    if (ticketParam == null || !token || ticketParamConsumedRef.current) return;
    if (loading) return; // list not resolved yet — retry on its arrival
    // B13 minor-2 (R128-IMP-5): a FAILED first load is not knowledge.
    // listError means `tickets` is the empty pre-error array, so the
    // membership check below would consume the deep link on an outage
    // and the notification's ?ticket=<id> would evaporate. Hold the
    // link armed; the FetchErrorCard retry re-runs this effect after a
    // successful refetch and the thread then opens as promised.
    if (listError) return;
    if (!tickets.some((t) => t.id === ticketParam)) {
      // Absent/foreign id: consume and give up silently.
      ticketParamConsumedRef.current = true;
      return;
    }
    ticketParamConsumedRef.current = true;
    void openTicket(ticketParam);
    // openTicket rides the deps honestly (it closes over token/headers);
    // re-runs after consumption are no-ops via the consumed-once ref.
  }, [ticketParam, token, loading, listError, tickets, openTicket]);

  // The create-card disclosure's one reset path — the header X button
  // and the form's cancel button both resolve through it (identical
  // effect to the two inline copies this replaced).
  const closeCreateForm = () => {
    setShowCreate(false);
    setForm({ title: "", message: "", category: "other" });
  };

  // SEO — title, canonical, OG, Twitter, robots, plus FAQPage JSON-LD
  // built from SUPPORT_FAQ. Note: the same Q&A is rendered visibly on
  // the page below (Google requires JSON-LD content to also be visible).
  // R-140-g (JSON-LD completeness audit): the volatility check PASSED —
  // SUPPORT_FAQ is a static in-repo canon (components/support/
  // support-faq.ts), NOT an API-driven list, so freezing it into ld+json
  // carries no staleness risk; it is single-sourced with the visible
  // FaqSection accordion (the parity rule Google's FAQ rich-results
  // require) and copy-pinned by support-faq-copy.test.tsx.
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
              className="w-11 h-11 rounded-xl flex items-center justify-center bg-secondary/60 hover:bg-secondary border border-border/60 transition-all press-spring"
            >
              {/* R139 (precision): border /50 → /60 — the resting-edge
                  family value (the secondary fill/hover stay: the X twin
                  and the layout-owned bell's own close button ride the
                  same secondary hover register). */}
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Headphones className="w-5 h-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {/* R128-A4 (F-3): leading-tight removed — the base h1–h4 1.3
                  Arabic-safe floor (index.css) owns the leading. */}
              <h1 className="text-xl font-bold break-words">
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
            /* R124-I4 (A5 #2): disclosure wiring — aria-expanded/
               aria-controls per the Navbar hamburger idiom
               (Navbar.tsx). A disclosure is expanded-state semantics,
               not pressed-state, so it deliberately diverges from the
               aria-pressed pills below. */
            aria-expanded={showCreate}
            aria-controls="support-create-ticket"
            /* R139 (precision): canonical CTA — the hand-rolled stack
               (flat bg-primary + hover:bg-primary/90 + shadow-md
               shadow-primary/22 + active:scale) retires for
               buttonVariants: the default variant owns the fill,
               elevation, hover and press-spring, exactly like the
               FetchErrorCard retry's r138 conversion. aria wiring
               byte-identical. */
            className="gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4" />
            تذكرة جديدة
          </Button>
        )}
        {showCreate && !selectedTicket && (
          /* 96-F6 (R96 A2 P2-6): close button at the 44px touch floor. */
          <button
            onClick={closeCreateForm}
            aria-label="إغلاق نموذج التذكرة الجديدة"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all press-spring"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Ticket Detail View ──────────────────────────────────── */}
      {selectedTicket && (
        <TicketThread
          selectedTicket={selectedTicket}
          ticketLoading={ticketLoading}
          replyText={replyText}
          onReplyTextChange={setReplyText}
          sending={sending}
          onReply={handleReply}
          messagesEndRef={messagesEndRef}
        />
      )}

      {/* ── Create Form ──────────────────────────────────────────── */}
      {!selectedTicket && showCreate && (
        <CreateTicketForm
          form={form}
          onFormChange={setForm}
          submitting={submitting}
          onSubmit={handleCreate}
          onCancel={closeCreateForm}
        />
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
          {/* R127-L7 (B3-K2): 12px/400 muted ink measured 3.5:1
              pixel-median (anti-alias density) — lifted to text-xs +
              font-semibold (design-system gate: 400/600/700 only), same
              treatment as register.tsx's consent line. */}
          <p className="text-xs font-semibold text-muted-foreground mb-5 leading-relaxed max-w-xs mx-auto">
            سجّل الدخول لفتح تذكرة دعم ومتابعة الرد من هذه الصفحة
          </p>
          <Button
            asChild
            /* R139 (precision): canonical CTA — same de-hand-roll as the
               header's «تذكرة جديدة»: buttonVariants owns fill/shadow/
               hover/press; the label + Link target byte-identical. */
            className="gap-1.5"
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
          /* R136 (UX-1): SkeletonText — the 3-row ticket stack, geometry
             verbatim; the pair is net-new. (The chat-transcript skeleton
             above stays hand-rolled: alternating sender alignment is
             page structure, not repeating row geometry.) */
          <SkeletonText
            count={3}
            wrapperClassName="space-y-3"
            className="h-24 rounded-2xl border border-border/60"
            lastShorter={false}
          />
        ) : /* R139 (precision): /35 → /60 — row-frame parity with the
             loaded TicketsList rows (which rest at /60 after this
             round; the 139-a loading→loaded discipline). */
        listError ? (
          /* 93-C5 / F-05: distinct from "no tickets" — an outage/expired
             session previously read as "لا توجد تذاكر دعم". Same error-card
             idiom as orders/loyalty (B4 P1-4 class). */
          <FetchErrorCard
            size="section"
            className="py-16"
            titleClassName="text-sm"
            title="تعذّر تحميل التذاكر"
            description="حدث خطأ في الاتصال — تحقّق من شبكتك ثم حاول مجدداً"
            /* R139 (precision): the retry's hand-rolled chrome override
               (flat bg-primary + shadow-md shadow-primary/22) is RETIRED
               — dropping retryClassName lets the card's r138 canonical
               default ride (Button default recipe + min-h-11 + gap-2,
               the exact conversion FetchErrorCard itself shipped). */
            onRetry={fetchTickets}
          />
        ) : tickets.length === 0 ? (
          /* R123-E4b (P3-l): the empty state promised «خلال دقائق» while
             the header above says «15 دقيقة إلى ساعة في أوقات العمل» —
             two different ticket SLAs on one page. Both mentions now
             carry the same claim (the topup-approval SLA in the FAQ is
             a different, topup-specific promise and stays as-is).
             R135 (FE-2): converged on the storefront EmptyState — the
             hand-rolled card had drifted one step off the compact-tile
             family (w-14 tile, w-6 icon at opacity-25, py-16); the
             Arabic strings and the «تذكرة جديدة» CTA are untouched.
             Adoption nets role="status" so the loading→empty swap
             announces (R125 A6 B-8, admin parity — the block was
             silent). */
          <EmptyState
            icon={Headphones}
            title="لا توجد تذاكر دعم"
            description="أنشئ تذكرة جديدة — نرد عادةً خلال 15 دقيقة إلى ساعة في أوقات العمل"
            action={
              <Button
                onClick={() => setShowCreate(true)}
                /* R139 (precision): THE flagged EmptyState action-slot
                   hand-roll (138-h) → the canonical recipe — the flat
                   bg-primary + hover:bg-primary/90 + shadow-md
                   shadow-primary/22 stack retires for buttonVariants
                   (the shared component owns fill, elevation, hover,
                   press + the ONE focus ring). EmptyState itself is
                   shared/polished — the CTA passes through its action
                   slot with canonical classes only. Label + handler
                   byte-identical. */
                className="gap-1.5"
              >
                <Plus className="w-4 h-4" />
                تذكرة جديدة
              </Button>
            }
            className="reveal-up"
          />
        ) : (
          <TicketsList tickets={tickets} onOpenTicket={openTicket} />
        ))}

      {/* ── Visible FAQ — backs the JSON-LD FAQPage claim ─────────────────
          Google requires every Q&A in FAQPage JSON-LD to also be visible
          on the page. We hide this section when a ticket is selected so
          the message thread stays focused.
      */}
      {!selectedTicket && <FaqSection />}

      {/* Bottom safe area */}
      <div className="h-6 md:h-0" />
    </div>
  );
}
