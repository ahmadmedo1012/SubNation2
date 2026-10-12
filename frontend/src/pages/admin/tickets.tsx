import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
// R120-B5 (A2-F9): the hand-rolled card-list skeleton joins the shared
// admin TableSkeleton (the orders/users/coupons console idiom).
import { TableSkeleton } from "@/components/admin/TableSkeleton";
import { useToast } from "@/hooks/use-toast";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCount } from "@/lib/utils";
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
  type ListAdminTicketsStatus,
} from "@workspace/api-client-react";
import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the queue's presentational panes and pure
// filter metadata moved to @/components/admin/tickets/* (verbatim
// moves — the money path stays HERE: every state atom incl. the reply
// draft + the dirty guard, the accumulating infinite query, openTicket
// (the decrypt-on-demand detail fetch), handleReply / handleStatus
// (the reply + status PATCHes with their stats co-invalidation), the
// two-way ?status=/?category= URL sync and the scroll-to-bottom ref;
// the extracts render the byte-identical DOM they rendered inline
// yesterday). Import surface:
//   • tickets-meta — the queue's pure module (the CATEGORIES /
//     STATUS_FILTERS / CATEGORY_FILTERS lists, the frozen page size,
//     the Arabic plural forms, the TicketSummary/TicketDetail aliases
//     and the 401 session-expiry predicate the catches duck-type)
//   • StatusFilterTabs / CategoryFilterChips — the two filter bars
//     (the setFilter + syncFilterParams closures became page-owned
//     onSelect wrappers — the ?status=/?category= write-back stays HERE)
//   • StaleQueueBanner — the refresh-failed inline banner
//   • TicketsEmptyStates — the partial-window + hard empty branches
//     (the R126-L3 category honesty contract)
//   • TicketCard — the queue row (pulse dot, awaiting-reply cue,
//     canonical status pill)
//   • TicketDetailPane — the detail card (thread header, messages,
//     reply form — submits through the page-owned onSubmit/onStatus
//     handlers; messagesEndRef rides down as a prop)
import {
  CATEGORY_FILTERS,
  isSessionExpiredError,
  STATUS_FILTERS,
  TICKET_COUNT_FORMS,
  TICKETS_PAGE_SIZE,
  type TicketDetail,
  type TicketSummary,
} from "@/components/admin/tickets/tickets-meta";
import { StatusFilterTabs } from "@/components/admin/tickets/StatusFilterTabs";
import { CategoryFilterChips } from "@/components/admin/tickets/CategoryFilterChips";
import { StaleQueueBanner } from "@/components/admin/tickets/StaleQueueBanner";
import {
  TicketsHardEmptyState,
  TicketsPartialEmptyState,
} from "@/components/admin/tickets/TicketsEmptyStates";
import { TicketCard } from "@/components/admin/tickets/TicketCard";
import { TicketDetailPane } from "@/components/admin/tickets/TicketDetailPane";

export default function AdminTicketsPage() {
  // Round-3 (react-hooks/rules-of-hooks): this useState previously sat
  // AFTER an early return — a conditional hook that would crash React
  // on the logged-out render path. Hoisted to the top of the component.
  const [statusBusy, setStatusBusy] = useState<number | null>(null);

  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("support");
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
    enabled: !!adminToken && canView,
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

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="support" />;
  }

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
            <StatusFilterTabs
              statusFilter={statusFilter}
              onSelect={(value) => {
                setStatusFilter(value);
                syncFilterParams(value, categoryFilter);
              }}
            />
          </div>
        </div>

        {/* Category filter chips */}
        <CategoryFilterChips
          categoryFilter={categoryFilter}
          onSelect={(value) => {
            setCategoryFilter(value);
            syncFilterParams(statusFilter, value);
          }}
        />

        {/* Split pane */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 min-h-[520px]">
          {/* Ticket list */}
          <div className={`lg:col-span-2 ${selected ? "hidden lg:flex" : "flex"} flex-col gap-2`}>
            {/* Refresh of an already-rendered queue failed — keep the
                stale cards visible, surface the failure inline
                (coupons.tsx banner idiom) instead of blanking the list. */}
            {!loading && loadError && tickets.length > 0 && (
              <StaleQueueBanner loadError={loadError} onRetry={() => void refetch()} />
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
                <TicketsPartialEmptyState
                  categoryLabel={categoryLabel}
                  loadingMoreTickets={loadingMoreTickets}
                  loading={loading}
                  onFetchNext={() => void fetchNextPage()}
                  onClearCategory={() => {
                    setCategoryFilter("");
                    syncFilterParams(statusFilter, "");
                  }}
                />
              ) : (
                <TicketsHardEmptyState
                  categoryFilter={categoryFilter}
                  categoryLabel={categoryLabel}
                  onClearCategory={() => {
                    setCategoryFilter("");
                    syncFilterParams(statusFilter, "");
                  }}
                />
              )
            ) : (
              <>
                {visibleTickets.map((t, i) => {
                  const isActive = selected?.id === t.id;
                  return (
                    <TicketCard key={t.id} t={t} idx={i} isActive={isActive} onOpen={openTicket} />
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
            <TicketDetailPane
              selected={selected}
              statusBusy={statusBusy}
              replyText={replyText}
              setReplyText={setReplyText}
              sending={sending}
              onSubmit={handleReply}
              onClose={() => setSelected(null)}
              onStatus={handleStatus}
              messagesEndRef={messagesEndRef}
            />
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
