import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { Input } from "@/components/ui/input";
// R120-B5 (A2-F9): the hand-rolled card-list skeleton joins the shared
// admin TableSkeleton (the orders/users/coupons console idiom).
import { TableSkeleton } from "@/components/admin/TableSkeleton";
// 93-C7 / C-UX2 (A12 B1): the hand-rolled STATUS_CONFIG map (raw
// blue/yellow hues + a parallel duplicate in storefront support.tsx)
// is replaced by the canonical STATUS_TONE mapper + statusLabel.
import {
  STATUS_TONE,
  StatusBadge,
  TICKET_STATUSES,
  UNKNOWN_STATUS_TONE,
  type SemanticStatus,
} from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCount, formatDate, formatRelativeTime, statusLabel } from "@/lib/utils";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
// R127-L1 (B1 §3.4 / A4 §C batch-A): the four adminFetchJson calls ride
// the generated client (batch-1 spec exposure) — listAdminTickets inside
// the existing useInfiniteQuery, getAdminTicket / replyAdminTicket /
// updateAdminTicketStatus for the detail actions. customFetch owns the
// ok-guard + the safe error-body parse (the R123 E3 contract) AND fires
// the registered global 401 handler (useAdminHeaders registers it) before
// throwing ApiError — a support cookie expiring mid-work still gets the
// global «انتهت الجلسة» toast + redirect, and the catches below stay
// quiet on the ApiError shape (alerts.tsx's `err.status === 401`
// duck-type).
import {
  getAdminTicket,
  listAdminTickets,
  replyAdminTicket,
  updateAdminTicketStatus,
  type AdminTicketStatusBodyStatus,
  type AdminTicketSummary,
  type AdminTicketThread,
  type ListAdminTicketsStatus,
} from "@workspace/api-client-react";
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AdminLayout } from "./layout";

// Ticket status rendering now derives from the shared canonical maps:
// tone = STATUS_TONE[status] (info/warning/neutral on the --status-*
// tokens), label = statusLabel(status) — one source shared with the
// storefront wallet/orders surfaces (93-C7 / C-UX2).
const CATEGORIES: Record<string, string> = {
  billing: "الدفع",
  order: "الطلبات",
  technical: "تقني",
  account: "الحساب",
  other: "أخرى",
};

// Filter labels derive from statusLabel (93-C7 / C-UX5, A12 §2.4): the
// tabs previously hand-repeated the same words as the badges — now one
// map feeds both, so the «معلق/قيد الانتظار»-class drift can't recur.
const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  ...TICKET_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
];

const CATEGORY_FILTERS = [
  { value: "", label: "جميع الفئات" },
  { value: "billing", label: "الدفع" },
  { value: "order", label: "الطلبات" },
  { value: "technical", label: "تقني" },
  { value: "account", label: "الحساب" },
  { value: "other", label: "أخرى" },
];

/** 94-C2 (A2 P1-1): page size for the support queue — the backend
 *  truncates at 100 rows with no page param; the UI now drives the
 *  frozen `?page=&limit=` contract and accumulates in place. */
const TICKETS_PAGE_SIZE = 100;

/** Arabic plural forms for the queue counter (formatCount, A2 P3-4). */
const TICKET_COUNT_FORMS = {
  zero: "تذاكر",
  one: "تذكرة",
  two: "تذكرتان",
  few: "تذاكر",
  many: "تذكرةً",
  other: "تذكرة",
};

// R127-L1: the hand-rolled row/thread interfaces are the generated
// AdminTicketSummary / AdminTicketThread (field-identical — the batch-1
// contract row pins the shapes); aliased so the file's render code keeps
// its local names.
type TicketSummary = AdminTicketSummary;
type TicketDetail = AdminTicketThread;

/** R127-L1 (B1 §3.4 step 5): a 401 from the generated fetcher is the
 * global admin-session handler's business (toast + redirect fired inside
 * customFetch) — the catches below stay quiet on it. ApiError is
 * type-only from the package, so the check duck-types `status` (the
 * alerts.tsx R126-L8b idiom). */
function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}

export default function AdminTicketsPage() {
  // Round-3 (react-hooks/rules-of-hooks): this useState previously sat
  // AFTER an early return — a conditional hook that would crash React
  // on the logged-out render path. Hoisted to the top of the component.
  const [statusBusy, setStatusBusy] = useState<number | null>(null);

  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  // R125-I4 (A4-B-3): stats co-invalidation — open_tickets feeds the
  // layout badge + the dashboard, and /admin/stats has no write-side
  // cache invalidation (30s server cache, stats.ts:129-133); without
  // this a closed ticket left the badge lagging ≤5 min. R125-I6
  // landed the backend `admin-stats-update` emits for ticket
  // status/reply; R126-L3 (A2-1) closed the frontend half — the
  // socket handler now invalidates BOTH this stats key AND the
  // "/api/admin/tickets" list family, so another admin's reply
  // refreshes this tab's queue too (this page has no polling).
  // The invalidations below still cover the ACTING tab immediately.
  const qc = useQueryClient();
  // R123 (E3 P3a): two-way URL filter sync (?status= / ?category=) —
  // follows the settings.tsx ?tab= idiom: URL → state on mount/param
  // change, state → URL via replaceState (filter flips don't spam the
  // history stack). A shared support queue link can now pin a filter.
  const searchParam = useSearch();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  // R123 (E3 P3c): a drafted reply is un-submitted work — the same
  // beforeunload guard the long admin forms ride (the reply box resets
  // only on submit/success or opening another ticket).
  useDirtyGuard(!!replyText.trim());

  const headers = useAdminHeaders();

  // R120-B5 (A2-F9): the hand-rolled fetch/page/abort state machine is
  // replaced by the orders.tsx useInfiniteQuery idiom (94-C2 A2 P1-1):
  // page accumulation + append-in-place load-more, AbortSignal via the
  // queryFn (React Query cancels the in-flight request on unmount and on
  // queryKey change — the manual ticketsAbortRef controller is gone),
  // and the 401/500/network failure surfaces through `isError` instead
  // of a local loadError string (B5-04's outage-≠-empty contract is
  // unchanged: a failed first load renders the error card, a failed
  // refresh of an already-rendered list keeps the stale cards + inline
  // banner).
  const listParams = { status: statusFilter || undefined, limit: TICKETS_PAGE_SIZE };
  const {
    data: ticketsPages,
    isLoading: loading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: loadingMoreTickets,
  } = useInfiniteQuery<TicketSummary[], Error>({
    // Key keeps the "/api/admin/tickets" prefix so any future
    // invalidation family (socket pushes, reply mutations) still finds
    // this query (the R127-L1 flip keeps this HAND key verbatim — the
    // SocketInitializer + the stats co-invalidation below ride the
    // "/api/admin/tickets" prefix, the alerts.tsx ALERTS_LIST_KEY
    // precedent); `statusFilter` in the key restarts at page 1 and
    // aborts the in-flight request via the queryFn's AbortSignal (the
    // 94-C2 debounce + abort lesson — no manual controller needed).
    queryKey: ["/api/admin/tickets", "load-more", listParams],
    queryFn: ({ pageParam, signal }) =>
      // R127-L1: the generated fetcher — the URL builder emits the same
      // frozen `?page=&limit=&status=` contract; customFetch owns the
      // ok-guard + the safe error-body parse (the Array.isArray guard
      // retires — the contract suite pins the plain-array shape).
      listAdminTickets(
        {
          page: pageParam as number,
          limit: TICKETS_PAGE_SIZE,
          status: (statusFilter || undefined) as ListAdminTicketsStatus | undefined,
        },
        { signal, headers },
      ),
    initialPageParam: 1,
    // Frozen contract (backend returns a plain array with no total
    // meta): a full page means the next page MIGHT exist; the first
    // short/empty page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === TICKETS_PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: !!adminToken,
  });

  // Accumulated queue — dedup by id (the previous loadMoreTickets guard,
  // kept): new arrivals at the top shift offset boundaries between page
  // requests, so a row can legitimately repeat across pages.
  const tickets = useMemo(() => {
    const seen = new Set<number>();
    const rows: TicketSummary[] = [];
    for (const page of ticketsPages?.pages ?? []) {
      for (const t of page) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        rows.push(t);
      }
    }
    return rows;
  }, [ticketsPages]);

  const loadError = isError ? getErrorMessage(error) || "تعذّر تحميل التذاكر" : null;

  // A single short page is the only case where the total is provably
  // known — otherwise the honest count is «عرض N» (orders.tsx wording,
  // 94-C2 A2 P1-1: never a grand total the plain-array contract can't
  // know).
  const knownTotal = (ticketsPages?.pages.length ?? 0) <= 1 && tickets.length < TICKETS_PAGE_SIZE;

  // B5-14 (round-92 audit, P2): openTicket had no `res.ok` check and
  // was invoked unawaited from onClick — a 401/500 detail fetch became
  // an unhandled promise rejection with zero UI feedback.
  // R123 (E3 item 1): the ok-guard rides adminFetchJson now.
  // R127-L1: getAdminTicket (customFetch owns the ok-guard; AdminTicketThread
  // is field-superset-compatible with the old hand parse).
  const openTicket = async (id: number) => {
    try {
      const d = await getAdminTicket(id, { headers });
      setSelected(d);
      setReplyText("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err) {
      // Session expiry already toasted + redirected — stay quiet.
      if (isSessionExpiredError(err)) return;
      toast({
        title: "خطأ",
        // R127-L1 (B1 F-3): getErrorMessage strips ApiError's English
        // "HTTP <n>" prefix and keeps the Arabic suffix — the Arabic-toast
        // discipline survives the generated-client flip.
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  // R120-B5 (A2-F9): the dependency array previously keyed ONLY on
  // `selected?.replies?.length` — opening a DIFFERENT ticket with the
  // same reply count (1 ↔ 1, extremely common: opener + one user reply)
  // never re-fired the scroll-to-bottom, landing the pane mid-thread.
  // The ticket id joins the key so every switch scrolls to the newest.
  useEffect(() => {
    if (selected) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected?.id, selected?.replies?.length]);

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R123 (E3 P3a): URL → filters (a ?status=/?category= change lands
  // without clobbering a filter the operator already picked locally —
  // the settings.tsx ?tab= contract). Deliberately BEFORE the early
  // return below: a logged-out render must not skip a hook.
  useEffect(() => {
    const q = new URLSearchParams(searchParam);
    const s = q.get("status");
    if (s && STATUS_FILTERS.some((x) => x.value === s)) {
      setStatusFilter((prev) => (prev === s ? prev : s));
    }
    const c = q.get("category");
    if (c && CATEGORY_FILTERS.some((x) => x.value === c)) {
      setCategoryFilter((prev) => (prev === c ? prev : c));
    }
  }, [searchParam]);

  // R123 (E3 P3a): filters → URL (replaceState — filter flips don't
  // spam the history stack; empty values drop the param entirely).
  const syncFilterParams = (status: string, category: string) => {
    const url = new URL(window.location.href);
    if (status) url.searchParams.set("status", status);
    else url.searchParams.delete("status");
    if (category) url.searchParams.set("category", category);
    else url.searchParams.delete("category");
    window.history.replaceState(null, "", url.toString());
  };

  if (!adminToken) return null;

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !replyText.trim()) return;
    setSending(true);
    try {
      // R127-L1: the generated fetcher sets Content-Type itself and
      // serializes the body (the manual header merge retires).
      await replyAdminTicket(selected.id, { message: replyText }, { headers });
      setReplyText("");
      await openTicket(selected.id);
      void refetch();
      // R125-I4 (A4-B-3): see the qc declaration — the reply/status
      // family keeps the shared stats key fresh (server 30s cache
      // makes the extra GET cheap).
      void qc.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    } catch (err: unknown) {
      // Session expiry already toasted + redirected — keep the drafted
      // reply in the box (it survives the redirect round-trip) and stay
      // quiet instead of layering a «فشلت العملية» toast on top.
      if (isSessionExpiredError(err)) return;
      toast({
        title: "خطأ",
        description: getErrorMessage(err), // R127-L1 (B1 F-3): Arabic-first
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
      // R127-L1: the FE only ever sends the three filter values
      // (STATUS_FILTERS / TICKET_STATUSES), so the enum cast is total.
      await updateAdminTicketStatus(
        id,
        { status: status as AdminTicketStatusBodyStatus },
        { headers },
      );
      if (selected?.id === id) await openTicket(id);
      void refetch();
      // R125-I4 (A4-B-3): a status flip changes open_tickets — refresh
      // the stats key the layout badge + dashboard read from.
      void qc.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: status === "closed" ? "تم إغلاق التذكرة" : "تمت إعادة فتح التذكرة",
        variant: "success",
      });
    } catch (err: unknown) {
      if (isSessionExpiredError(err)) return;
      toast({
        title: "خطأ",
        description: getErrorMessage(err), // R127-L1 (B1 F-3): Arabic-first
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
  // R125-I4 (A3-3): the awaiting-reply signal — the backend already
  // computes has_unread_admin (last reply came from the USER,
  // backend admin/tickets.ts:145) on every row; the queue rendered it
  // nowhere, so every in_progress ticket with a fresh customer reply
  // (the exact tickets that need a response) carried no cue at all —
  // the open-status pulse dot misses them by design. A closed ticket
  // the admin closed after the customer's last word is NOT awaiting
  // anyone (its reply box is disabled).
  const awaitingReplyCount = tickets.filter(
    (t) => t.has_unread_admin && t.status !== "closed",
  ).length;
  const visibleTickets = tickets.filter((t) => {
    const matchCategory = !categoryFilter || t.category === categoryFilter;
    return matchCategory;
  });
  // R126-L3 (A2-4): the Arabic label of the active category — feeds the
  // partial-empty block + the honest hard-empty title below (the
  // users.tsx tierLabel idiom).
  const categoryLabel =
    CATEGORY_FILTERS.find((c) => c.value === categoryFilter)?.label ?? categoryFilter;
  // R126-L3 (A2-4): the partial-empty gate — the category filter runs
  // CLIENT-side over the accumulated pages, so a category can read
  // empty while matching tickets sit on UNLOADED pages
  // (hasNextPage=true). The users.tsx A1-7 partial-empty block
  // (R125-I4) mirrors this exact class; tickets missed it — the hard
  // «لا توجد تذاكر» asserted global emptiness over a partial window
  // AND the load-more (inside the non-empty branch) vanished with it,
  // leaving no path to the pages that contain the category.
  const categoryPartialEmpty = visibleTickets.length === 0 && categoryFilter !== "" && hasNextPage;

  return (
    <AdminLayout onRefresh={() => void refetch()} badges={{ openTickets: openCount }}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">تذاكر الدعم</h1>
              {pendingCount > 0 && (
                <span className="bg-status-info/15 text-status-info border border-status-info/30 text-xs font-bold px-2.5 py-1 rounded-full">
                  {pendingCount} نشطة
                </span>
              )}
              {/* R125-I4 (A3-3): the queue's most important number — how
                  many customers are waiting on US right now. */}
              {awaitingReplyCount > 0 && (
                <span className="bg-status-warning/15 text-status-warning border border-status-warning/30 text-xs font-bold px-2.5 py-1 rounded-full">
                  {awaitingReplyCount} بانتظار ردك
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs mt-0.5">
              {/* 94-C2 (A2 P1-1) + R120-B5 (A2-F9): honest count in the
                  orders.tsx wording — «إجمالاً» only when the whole queue
                  provably fits one page (a single short page), otherwise
                  «عرض N» over the accumulated pages, never a false
                  total the plain-array contract can't know. */}
              {knownTotal
                ? `${formatCount(tickets.length, TICKET_COUNT_FORMS)} إجمالاً`
                : `عرض ${formatCount(tickets.length, TICKET_COUNT_FORMS)} (الأحدث أولاً)`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-secondary/50 border border-border/60 rounded-2xl p-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => {
                    setStatusFilter(s.value);
                    syncFilterParams(s.value, categoryFilter);
                  }}
                  /* R124-C2 (A6 F10): the active tab was purely visual —
                     aria-pressed exposes the toggle state (the
                     orders.tsx/topups.tsx chip-bar idiom). */
                  aria-pressed={statusFilter === s.value}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${statusFilter === s.value ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}
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
              onClick={() => {
                setCategoryFilter(c.value);
                syncFilterParams(statusFilter, c.value);
              }}
              /* R124-C2 (A6 F10): same toggle-state exposure as the
                 status tabs above. */
              aria-pressed={categoryFilter === c.value}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                categoryFilter === c.value
                  ? "bg-primary/10 border-primary/30 text-primary-text font-bold"
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
                  onClick={() => void refetch()}
                  className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}
            {loading ? (
              /* R120-B5 (A2-F9): the shared admin TableSkeleton replaces
                 the five hand-rolled h-20 shimmer cards — same console
                 idiom as orders/users/coupons. */
              <TableSkeleton rows={5} cells={["w-10 rounded-xl", "flex-1", "w-16 rounded-full"]} />
            ) : loadError && tickets.length === 0 ? (
              /* Distinct from "no data": an outage/expired session previously
                 masqueraded as the empty state below (B5-04). Same
                 error-card idiom the storefront pages use (loyalty.tsx /
                 orders.tsx) — an admin on a flaky network must never
                 believe the support queue is empty. */
              <FetchErrorCard
                size="page"
                className="flex-1"
                title="تعذّر تحميل التذاكر"
                description="حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"
                onRetry={() => void refetch()}
              />
            ) : visibleTickets.length === 0 ? (
              categoryPartialEmpty ? (
                /* R126-L3 (A2-4): zero matches over PARTIAL data — the
                   users.tsx:1309-1330 partial-empty idiom (R125-I4
                   A1-7): honest incompleteness wording + the load-more
                   STAYS VISIBLE (it was previously trapped inside the
                   non-empty branch) + a one-tap filter escape. The
                   ?category= URL filter makes this dead-end shareable,
                   so the block must be the honest default. */
                <div className="flex-1 flex flex-col items-center justify-center py-14 text-muted-foreground bg-card border border-border/60 rounded-2xl space-y-3">
                  <MessageSquare className="w-10 h-10 mb-1 opacity-20" />
                  <p className="text-sm font-bold text-foreground/80">
                    لا تذاكر بفئة {categoryLabel} ضمن الصفحات المحمّلة
                  </p>
                  <p className="text-xs">قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل</p>
                  <div className="flex justify-center gap-2 flex-wrap">
                    <LoadMoreButton
                      busy={loadingMoreTickets}
                      disabled={loading}
                      onClick={() => void fetchNextPage()}
                    />
                    <button
                      onClick={() => {
                        setCategoryFilter("");
                        syncFilterParams(statusFilter, "");
                      }}
                      className="text-xs text-primary-text hover:underline mt-1.5"
                    >
                      إلغاء فلتر الفئة
                    </button>
                  </div>
                </div>
              ) : (
                /* R126-L3 (A2-4): the hard empty is now only reached over
                   a PROVABLY complete window (no more pages) or with no
                   category filter — and its copy names the filter when
                   one is active (the users tier-empty wording) instead
                   of claiming the whole queue is empty. */
                <div className="flex-1 flex flex-col items-center justify-center py-16 text-muted-foreground bg-card border border-border/60 rounded-2xl">
                  <MessageSquare className="w-10 h-10 mb-3 opacity-25" />
                  <p className="font-bold">
                    {categoryFilter ? `لا توجد تذاكر بفئة ${categoryLabel}` : "لا توجد تذاكر"}
                  </p>
                  <p className="text-sm mt-1">
                    {categoryFilter ? "جرّب فئة أخرى أو أزل الفلتر" : "ستظهر تذاكر الدعم هنا"}
                  </p>
                  {categoryFilter && (
                    <button
                      onClick={() => {
                        setCategoryFilter("");
                        syncFilterParams(statusFilter, "");
                      }}
                      className="text-xs text-primary-text hover:underline mt-3"
                    >
                      إلغاء فلتر الفئة
                    </button>
                  )}
                </div>
              )
            ) : (
              <>
                {visibleTickets.map((t, i) => {
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
                              <span className="w-2 h-2 rounded-full bg-status-info shrink-0 animate-pulse" />
                            )}
                            <span className="font-bold text-sm truncate leading-snug flex-1">
                              {t.title}
                            </span>
                            {(t.last_reply_at || t.created_at) && (
                              <span className="text-3xs text-muted-foreground shrink-0 tabular-nums">
                                {formatRelativeTime(t.last_reply_at ?? t.created_at)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground font-mono">
                              {displayUserName(userFromRow(t))}
                            </span>
                            {t.category && (
                              <span className="text-2xs text-muted-foreground bg-muted/40 border border-border/40 px-1.5 py-0.5 rounded-md">
                                {CATEGORIES[t.category] ?? t.category}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            {/* 93-C7 / C-UX2 (A12 B1): canonical tone + label
                              from the shared maps — same pill the detail
                              pane and the storefront use. */}
                            <StatusBadge
                              variant={
                                STATUS_TONE[t.status as SemanticStatus] ?? UNKNOWN_STATUS_TONE
                              }
                              size="sm"
                            >
                              {statusLabel(t.status)}
                            </StatusBadge>
                            {/* R125-I4 (A3-3): the awaiting-reply cue — the
                                customer's reply is the last word on this
                                ticket. Text + tone (never a color-only
                                dot) so the signal survives grayscale +
                                screen readers. */}
                            {t.has_unread_admin && t.status !== "closed" && (
                              <StatusBadge variant="warning" size="sm">
                                بانتظار ردك
                              </StatusBadge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {t.reply_count} ردود
                            </span>
                          </div>
                        </div>
                        <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-muted-foreground transition-colors" />
                      </div>
                    </button>
                  );
                })}

                {/* 94-C2 (A2 P1-1): "load more" appends the next page of
                  the frozen `?page=N+1&limit=` contract in place — the
                  support queue's history past the silent 100-row cap
                  becomes reachable. The button hides once a short page
                  arrives. R120-B5 (A2-F9): fetchNextPage replaces the
                  hand-rolled page counter — React Query tracks the
                  pages, the fetching flag, and the has-more verdict. */}
                {hasNextPage && (
                  <div className="flex justify-center pt-1">
                    <LoadMoreButton
                      busy={loadingMoreTickets}
                      onClick={() => void fetchNextPage()}
                    />
                  </div>
                )}
              </>
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
                  <h2 className="font-bold text-sm truncate mb-1">{selected.title}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span className="font-mono">{displayUserName(userFromRow(selected))}</span>
                    </div>
                    <StatusBadge
                      variant={
                        STATUS_TONE[selected.status as SemanticStatus] ?? UNKNOWN_STATUS_TONE
                      }
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
                      onClick={() => handleStatus(selected.id, "closed")}
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
                      onClick={() => handleStatus(selected.id, "open")}
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
                    onClick={() => setSelected(null)}
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
              <form onSubmit={handleReply} className="border-t border-border p-4">
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
