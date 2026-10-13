import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
// R136 (UX-1): the page-shaped loading skeleton stays inline — the
// skeleton-primitives adoption floor pins THIS file as a SkeletonText
// importer (components/__tests__/skeleton-primitives.test.tsx SWEPT_FILES).
import { SkeletonText } from "@/components/ui/Skeleton";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
// R123→R126-L8b: the five mutation fetches ride the orval-generated
// client from the batch-1 spec exposure — the list is a typed
// listAdminAlerts fetcher inside the SAME accumulating useInfiniteQuery
// (same "admin-alerts" key, so every existing invalidation still
// refreshes the accumulated pages), and the five mutations are the
// generated fetchers (markAdminAlertRead / markAllAdminAlertsRead /
// deleteAdminAlert / deleteReadAdminAlerts / deleteAllAdminAlerts).
// customFetch owns the ok-guard + error envelope + the global 401
// observer (useAdminHeaders registers it), so a session expiring
// mid-work still gets the «انتهت الجلسة» toast + redirect — the
// per-mutation 401 quiet-catch below duck-types the ApiError status
// field (ApiError is type-only from the package; the App.tsx
// isRetryableQueryError idiom — the A4 §C batch-A `err.status === 401`).
import {
  deleteAdminAlert,
  deleteAllAdminAlerts,
  deleteReadAdminAlerts,
  listAdminAlerts,
  markAdminAlertRead,
  markAllAdminAlertsRead,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCount } from "@/lib/utils";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox, RefreshCw, WifiOff } from "lucide-react";
import { useState } from "react";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the inbox's presentational sections and pure
// helpers moved to @/components/admin/alerts/* (verbatim moves — the
// mutation path stays HERE: the accumulating infinite query, all five
// mutations with their optimistic cache patches + 401 quiet-catches, and
// the three confirm-gated destructive flows; the extracts render the
// byte-identical DOM they rendered inline yesterday). Import surface:
//   • alerts-inbox-meta — the pure module (the row/page/filter types,
//     the FILTERS tab list, the frozen page size, the list key, the
//     Arabic plural forms, the 401 predicate + failure-toast factory the
//     mutations ride, and the date grouping)
//   • alerts-meta — the TYPE_META icon/tone/label map (page: the
//     delete-confirm's type label; extracts: chips + rows)
//   • AlertsHeader — h1 + refresh + قراءة الكل / حذف المقروءة / حذف الكل
//   • AlertsTypeChips / AlertsFilterTabs — the two filter bars (one
//     page-owned filter atom behind both)
//   • AlertsEmptyState — the loaded-but-empty branch
//   • AlertsGroupedList — the date-grouped rows (mark-read on row tap;
//     delete confirm-gated in the page's confirmDeleteAlert)
import {
  ALERT_COUNT_FORMS,
  ALERTS_LIST_KEY,
  ALERTS_PAGE_SIZE,
  alertActionToast,
  groupByDate,
  isSessionExpiredError,
  type AdminAlertItem,
  type AlertType,
  type AlertsInfiniteData,
  type AlertsPageData,
  type FilterType,
} from "@/components/admin/alerts/alerts-inbox-meta";
import { TYPE_META } from "@/components/admin/alerts/alerts-meta";
import { AlertsHeader } from "@/components/admin/alerts/AlertsHeader";
import { AlertsTypeChips } from "@/components/admin/alerts/AlertsTypeChips";
import { AlertsFilterTabs } from "@/components/admin/alerts/AlertsFilterTabs";
import { AlertsEmptyState } from "@/components/admin/alerts/AlertsEmptyState";
import { AlertsGroupedList } from "@/components/admin/alerts/AlertsGroupedList";

/** Maps the cached infinite shape with one shared helper so the three
 *  optimistic mutations below stay in lockstep. */
function patchCachedAlerts(
  qc: ReturnType<typeof useQueryClient>,
  fn: (page: AlertsPageData) => AlertsPageData,
) {
  qc.setQueryData<AlertsInfiniteData>(ALERTS_LIST_KEY, (old) =>
    old ? { ...old, pages: old.pages.map(fn) } : old,
  );
}

export default function AdminAlertsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("support");
  const qc = useQueryClient();
  const headers = useAdminHeaders();
  const { toast } = useToast();
  // R120-B4 (A2-F6): the shared styled confirm — the single-alert
  // delete was a ONE-TAP destructive action (the bulk paths all had
  // confirmation friction). The dialog names the alert's type + title
  // so the operator knows exactly what is being removed.
  const { confirm, ConfirmDialog } = useConfirm();
  const [filter, setFilter] = useState<FilterType>("all");

  // 94-C2 (A2 P1-1): the inbox is an accumulating infinite query over
  // the frozen `?page=&limit=` contract. The backend already returns
  // `hasMore`/`total` — hasMore is the precise "more exists" flag, with
  // the full-page heuristic as a defensive fallback. The key keeps the
  // "admin-alerts" prefix so every existing invalidation refreshes the
  // accumulated pages.
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AlertsPageData, Error>({
    queryKey: ALERTS_LIST_KEY,
    // R126-L8b (A4 §C batch-C): the generated fetcher builds the same
    // frozen `?page=&limit=` URL from typed params (spec-exposed in
    // batch-1) — the accumulating key/semantics above are untouched.
    // (pageParam cast: the 2-generic form leaves TPageParam as unknown —
    // the risk.tsx `pageParam as string | null` idiom; every value here
    // is a number by construction — initialPageParam 1, next = pages+1.)
    queryFn: ({ pageParam, signal }) =>
      listAdminAlerts({ page: pageParam as number, limit: ALERTS_PAGE_SIZE }, { signal, headers }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore === true
        ? allPages.length + 1
        : lastPage.hasMore === false
          ? undefined
          : lastPage.alerts.length === ALERTS_PAGE_SIZE
            ? allPages.length + 1
            : undefined,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    enabled: !!adminToken && canView,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-alerts"] });
    qc.invalidateQueries({ queryKey: ["admin-alerts-unread-count"] });
  };

  const markRead = useMutation({
    // 94-C2 (A2 P2-11): r.ok + parsed envelope — a failed PATCH used to
    // "succeed" (fetch resolves on HTTP errors), invalidate, and
    // silently resurrect the unread dot.
    // R126-L8b: the generated fetcher owns that contract now (typed
    // {success} response; non-2xx rejects with ApiError).
    mutationFn: (id: number) => markAdminAlertRead(id, { headers }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ALERTS_LIST_KEY });
      const prev = qc.getQueryData<AlertsInfiniteData>(ALERTS_LIST_KEY);
      const target = prev?.pages.flatMap((p) => p.alerts).find((a) => a.id === id);
      const wasUnread = target ? !target.isRead : true;
      patchCachedAlerts(qc, (p) => ({
        ...p,
        alerts: p.alerts.map((a) => (a.id === id ? { ...a, isRead: true } : a)),
        unreadCount: wasUnread ? Math.max(0, p.unreadCount - 1) : p.unreadCount,
      }));
      if (wasUnread) {
        qc.setQueryData<{ count: number }>(["admin-alerts-unread-count"], (old) =>
          old ? { count: Math.max(0, old.count - 1) } : old,
        );
      }
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ALERTS_LIST_KEY, ctx.prev);
      // R126-L8b: a 401 is the global handler's business (toast +
      // redirect already fired inside customFetch) — the rollback
      // above keeps the cache truthful, no local failure toast on top.
      if (isSessionExpiredError(err)) return;
      toast(alertActionToast("فشل تعيين التنبيه كمقروء", getErrorMessage(err)));
    },
    onSettled: () => invalidateAll(),
  });

  const markAllRead = useMutation({
    mutationFn: () => markAllAdminAlertsRead({ headers }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ALERTS_LIST_KEY });
      const prev = qc.getQueryData<AlertsInfiniteData>(ALERTS_LIST_KEY);
      patchCachedAlerts(qc, (p) => ({
        ...p,
        alerts: p.alerts.map((a) => ({ ...a, isRead: true })),
        unreadCount: 0,
      }));
      qc.setQueryData<{ count: number }>(["admin-alerts-unread-count"], { count: 0 });
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ALERTS_LIST_KEY, ctx.prev);
      if (isSessionExpiredError(err)) return;
      toast(alertActionToast("فشل تعيين الكل كمقروء", getErrorMessage(err)));
    },
    onSettled: () => invalidateAll(),
  });

  const deleteAlert = useMutation({
    mutationFn: (id: number) => deleteAdminAlert(id, { headers }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ALERTS_LIST_KEY });
      const prev = qc.getQueryData<AlertsInfiniteData>(ALERTS_LIST_KEY);
      const removed = prev?.pages.flatMap((p) => p.alerts).find((a) => a.id === id);
      const wasUnread = removed ? !removed.isRead : false;
      patchCachedAlerts(qc, (p) => ({
        ...p,
        alerts: p.alerts.filter((a) => a.id !== id),
        unreadCount: wasUnread ? Math.max(0, p.unreadCount - 1) : p.unreadCount,
      }));
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ALERTS_LIST_KEY, ctx.prev);
      if (isSessionExpiredError(err)) return;
      toast(alertActionToast("فشل حذف التنبيه", getErrorMessage(err)));
    },
    onSettled: () => invalidateAll(),
  });

  const deleteRead = useMutation({
    mutationFn: () => deleteReadAdminAlerts({ headers }),
    onSuccess: () => invalidateAll(),
    onError: (err) => {
      if (isSessionExpiredError(err)) return;
      toast(alertActionToast("فشل حذف التنبيهات المقروءة", getErrorMessage(err)));
    },
  });

  const deleteAll = useMutation({
    mutationFn: () => deleteAllAdminAlerts({ headers }),
    onSuccess: () => invalidateAll(),
    onError: (err) => {
      if (isSessionExpiredError(err)) return;
      toast(alertActionToast("فشل حذف كل التنبيهات", getErrorMessage(err)));
    },
  });

  const alerts = data?.pages.flatMap((p) => p.alerts) ?? [];
  // The global unread count rides the first page (server-side truth).
  const unreadCount = data?.pages[0]?.unreadCount ?? 0;
  const totalAlerts = data?.pages[0]?.total;
  const readCount = alerts.filter((a) => a.isRead).length;

  // R120-B4 (A2-F6): confirm BEFORE the DELETE fires — the destructive
  // single-alert path now matches the bulk-delete friction (the dialog
  // carries the alert type + title, the same context the bulk confirm
  // names its count).
  const confirmDeleteAlert = async (alert: AdminAlertItem) => {
    const typeLabel = TYPE_META[alert.type as AlertType]?.label ?? "تنبيه";
    const confirmed = await confirm({
      title: "حذف التنبيه؟",
      description: `سيتم حذف تنبيه «${alert.title}» (${typeLabel}) نهائياً${alert.message ? ` — «${alert.message}»` : ""}. لا يمكن التراجع عن الحذف.`,
      confirmLabel: "حذف",
      destructive: true,
    });
    if (!confirmed) return;
    deleteAlert.mutate(alert.id);
  };

  // R123 (E3 item 3): «حذف المقروءة» was the LAST one-tap destructive
  // bulk action on the page — the single-alert delete (R120-B4 A2-F6)
  // and حذف الكل (inline نعم/لا) both have confirmation friction, but
  // deleteRead fired immediately on tap. The mounted styled confirm
  // now names the read-count the button itself displays, in the same
  // copy style as the single-delete dialog above.
  const confirmDeleteRead = async () => {
    const confirmed = await confirm({
      title: "حذف التنبيهات المقروءة؟",
      description: `سيتم حذف ${formatCount(readCount, ALERT_COUNT_FORMS)} مقروء نهائياً — لا يمكن التراجع عن الحذف. التنبيهات غير المقروءة لن تُمس.`,
      confirmLabel: "حذف",
      destructive: true,
    });
    if (!confirmed) return;
    deleteRead.mutate();
  };

  // R125 (A3 #6): حذف الكل was the page's ONLY destructive action not
  // riding the shared useConfirm dialog its two siblings use — an
  // inline «تأكيد حذف الكل؟ نعم / لا» block whose bare نعم/لا button
  // names are the anti-pattern the clarify rule names. The dialog now
  // names the count (server `total` when the window carries it) and
  // states explicitly that read AND unread alerts go — the same copy
  // style as the two confirms above. The mutation itself is untouched.
  const confirmDeleteAll = async () => {
    const count = typeof totalAlerts === "number" && totalAlerts > 0 ? totalAlerts : alerts.length;
    const confirmed = await confirm({
      title: "حذف كل التنبيهات؟",
      description: `سيتم حذف ${formatCount(count, ALERT_COUNT_FORMS)} نهائياً — المقروءة وغير المقروءة. لا يمكن التراجع عن الحذف.`,
      confirmLabel: "حذف الكل",
      destructive: true,
    });
    if (!confirmed) return;
    deleteAll.mutate();
  };

  const displayed = alerts.filter((a) => {
    if (filter === "unread") return !a.isRead;
    if (filter === "all") return true;
    return a.type === filter;
  });

  const groups = groupByDate(displayed);

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="support" />;
  }

  return (
    <AdminLayout badges={{ unreadAlerts: unreadCount }}>
      <div className="space-y-5 page-in">
        {/* Header */}
        <AlertsHeader
          unreadCount={unreadCount}
          readCount={readCount}
          alertsCount={alerts.length}
          markAllPending={markAllRead.isPending}
          deleteReadPending={deleteRead.isPending}
          deleteAllPending={deleteAll.isPending}
          onRefresh={() => refetch()}
          onMarkAllRead={() => markAllRead.mutate()}
          onDeleteRead={() => void confirmDeleteRead()}
          onDeleteAll={() => void confirmDeleteAll()}
        />

        {/* Stats row — R125 (A3 #6): all six TYPE_META types are now
            quick-filter chips (system + forecast_stockout rows were
            rendered but had no filter affordance anywhere). Each chip
            carries aria-pressed (A3 #6 / A6 B-10 — the R124-C2 chip-bar
            idiom, applied to the last two bars that lacked it). */}
        {!isLoading && alerts.length > 0 && (
          <AlertsTypeChips alerts={alerts} filter={filter} onSetFilter={setFilter} />
        )}

        {/* Filter tabs — R125 (A3 #6 / A6 B-10): aria-pressed exposes
            the active tab (the in-repo chip-bar idiom; the active state
            was visual-only on the last two chip bars in the console). */}
        <AlertsFilterTabs
          alerts={alerts}
          unreadCount={unreadCount}
          filter={filter}
          onSetFilter={setFilter}
        />

        {/* Alert list */}
        {/* 93-C6 / F-07 (A5 AL-1): a failed poll is NOT "no alerts" —
            the 20 s poll failing (outage/expired session) used to
            render the "لا توجد تنبيهات" empty state with zero signal
            while role="alert" banners existed elsewhere in the app. */}
        {isError && alerts.length > 0 && (
          <div
            role="alert"
            /* R139 (precision): the poll-failure banner joins the r138
               calm-error register (the ChartErrorBanner idiom): the
               frame drops its status-error/10 + /25 red wall for the
               card family's resting chrome (bg-card + border-border/60
               + rounded-2xl), the error tone concentrates in the icon
               stage (an error/8 fill + /22 edge + full-ink WifiOff —
               the ONE red accent), the message moves to the /80
               foreground headline ink and the retry keeps the error
               ink — severity lives in CONTENT (message + role=alert +
               glyph), not a tinted wall. role/onClick byte-identical. */
            className="p-4 rounded-2xl bg-card border border-border/60 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0">
              <WifiOff className="w-4 h-4 text-status-error" />
            </div>
            <span className="min-w-0 text-sm font-bold text-foreground/80">
              {getErrorMessage(error)}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="ms-auto shrink-0 text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {isLoading ? (
          /* R136 (UX-1): SkeletonText — R125's page-shaped skeleton. Same
              DOM: ONE announcing wrapper (role=status + sr-only
              preserved) + 4 plain card rows, geometry verbatim — the
              loading→loaded swap keeps announcing to screen readers
              (4.1.3), the pair the shared TableSkeleton got. */
          <SkeletonText
            count={4}
            wrapperClassName="space-y-3"
            className="h-[72px] rounded-2xl"
            lastShorter={false}
          />
        ) : isError && alerts.length === 0 ? (
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل التنبيهات"
            description={`${getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة`}
            onRetry={() => refetch()}
          />
        ) : displayed.length === 0 ? (
          <AlertsEmptyState filter={filter} />
        ) : (
          <div className="space-y-6">
            <AlertsGroupedList
              groups={groups}
              onMarkRead={(id) => markRead.mutate(id)}
              onDelete={(alert) => void confirmDeleteAlert(alert)}
            />

            {/* Footer summary — 94-C2 (A2 P1-1): «عرض N» (+ the
                server-side `total` when the response carries it);
                never a false «إجمالاً N» over a truncated window. */}
            <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
              <Inbox className="w-3.5 h-3.5" />
              <span>
                عرض {formatCount(alerts.length, ALERT_COUNT_FORMS)}
                {typeof totalAlerts === "number" && totalAlerts > alerts.length
                  ? ` من ${totalAlerts}`
                  : ""}{" "}
                · {unreadCount} غير مقروء
              </span>
            </div>

            {/* 94-C2 (A2 P1-1): "load more" appends the next page of
                the frozen `?page=N+1&limit=` contract in place; the
                button hides when the server says hasMore=false (or a
                short page arrives). */}
            {hasNextPage && (
              <div className="flex justify-center pt-1">
                <LoadMoreButton
                  spinner={RefreshCw}
                  busy={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                />
              </div>
            )}
          </div>
        )}
      </div>
      {/* R120-B4 (A2-F6): the single-delete confirm dialog mount. */}
      <ConfirmDialog />
    </AdminLayout>
  );
}
