import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCount, formatDate, formatRelativeTime } from "@/lib/utils";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  ChevronDown,
  Inbox,
  Info,
  Package,
  RefreshCw,
  Tag,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { AdminLayout } from "./layout";

type AlertType =
  | "coupon_maxed"
  | "coupon_expiring"
  | "low_stock"
  | "no_stock"
  | "system"
  | "forecast_stockout";

interface AdminAlertItem {
  id: number;
  type: AlertType;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: string;
}

const TYPE_META: Record<
  AlertType,
  { icon: React.ElementType; color: string; bg: string; border: string; label: string }
> = {
  coupon_maxed: {
    icon: Tag,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
    label: "كوبون استُنفد",
  },
  coupon_expiring: {
    icon: Tag,
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/20",
    label: "كوبون منتهٍ",
  },
  low_stock: {
    icon: Package,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/20",
    label: "مخزون منخفض",
  },
  no_stock: {
    icon: AlertTriangle,
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/20",
    label: "نفاد المخزون",
  },
  system: {
    icon: Info,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/20",
    label: "نظام",
  },
  forecast_stockout: {
    icon: AlertTriangle,
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/20",
    label: "نفاد متوقع",
  },
};

type FilterType = "all" | "unread" | "coupon_maxed" | "coupon_expiring" | "low_stock" | "no_stock";

/** 94-C2 (A2 P1-1): page size for the alerts inbox — the backend's
 *  DEFAULT_LIMIT is 50 with `page`/`limit` (and total/hasMore) already
 *  supported; the UI previously loaded one silent 50-row window while
 *  the footer claimed «N تنبيه إجمالاً». The frozen `?page=&limit=`
 *  contract now accumulates in place. */
const ALERTS_PAGE_SIZE = 50;

/** Query key — keeps the "admin-alerts" prefix so the existing
 *  invalidations (`["admin-alerts"]`) refresh the accumulated pages. */
const ALERTS_LIST_KEY = ["admin-alerts", "inbox"] as const;

/** 94-C2 (A2 P2-11): the inbox mutations get the same error surface as
 *  every other admin action (r.ok + parsed envelope + onError toast) —
 *  a failed delete/read used to invalidate the cache and silently
 *  resurrect the rows. */
function alertActionToast(title: string, description: string) {
  return { title, description, variant: "destructive" as const };
}

interface AlertsPageData {
  alerts: AdminAlertItem[];
  unreadCount: number;
  /** Present in the current backend response (was ignored by the
   *  declared type — surfaced defensively, A2 P1-1). */
  total?: number;
  page?: number;
  limit?: number;
  hasMore?: boolean;
}

type AlertsInfiniteData = { pages: AlertsPageData[]; pageParams: number[] };

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

const FILTERS: { value: FilterType; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "unread", label: "غير مقروء" },
  { value: "no_stock", label: "نفاد مخزون" },
  { value: "low_stock", label: "مخزون منخفض" },
  { value: "coupon_maxed", label: "كوبون استُنفد" },
  { value: "coupon_expiring", label: "كوبون منتهٍ" },
];

function groupByDate(alerts: AdminAlertItem[]): { label: string; items: AdminAlertItem[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const weekAgo = today - 7 * 86_400_000;

  const groups: { label: string; items: AdminAlertItem[] }[] = [
    { label: "اليوم", items: [] },
    { label: "أمس", items: [] },
    { label: "هذا الأسبوع", items: [] },
    { label: "أقدم", items: [] },
  ];

  for (const a of alerts) {
    const t = new Date(a.createdAt).getTime();
    if (t >= today) groups[0].items.push(a);
    else if (t >= yesterday) groups[1].items.push(a);
    else if (t >= weekAgo) groups[2].items.push(a);
    else groups[3].items.push(a);
  }

  return groups.filter((g) => g.items.length > 0);
}

export default function AdminAlertsPage() {
  const { adminToken } = useAuth();
  const qc = useQueryClient();
  const headers = useAdminHeaders();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("all");
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

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
    queryFn: ({ pageParam, signal }) =>
      customFetch<AlertsPageData>(`/api/admin/alerts?page=${pageParam}&limit=${ALERTS_PAGE_SIZE}`, {
        signal,
        headers,
      }),
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
    enabled: !!adminToken,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-alerts"] });
    qc.invalidateQueries({ queryKey: ["admin-alerts-unread-count"] });
  };

  const markRead = useMutation({
    // 94-C2 (A2 P2-11): r.ok + parsed envelope — a failed PATCH used to
    // "succeed" (fetch resolves on HTTP errors), invalidate, and
    // silently resurrect the unread dot.
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/alerts/${id}/read`, { method: "PATCH", headers });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `فشل تعيين التنبيه كمقروء (HTTP ${r.status})`);
      }
      return r.json().catch(() => null);
    },
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
      toast(alertActionToast("فشل تعيين التنبيه كمقروء", getErrorMessage(err)));
    },
    onSettled: () => invalidateAll(),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/alerts/read-all", { method: "PATCH", headers });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `فشل تعيين الكل كمقروء (HTTP ${r.status})`);
      }
      return r.json().catch(() => null);
    },
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
      toast(alertActionToast("فشل تعيين الكل كمقروء", getErrorMessage(err)));
    },
    onSettled: () => invalidateAll(),
  });

  const deleteAlert = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/alerts/${id}`, { method: "DELETE", headers });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `فشل حذف التنبيه (HTTP ${r.status})`);
      }
      return r.json().catch(() => null);
    },
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
      toast(alertActionToast("فشل حذف التنبيه", getErrorMessage(err)));
    },
    onSettled: () => invalidateAll(),
  });

  const deleteRead = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/alerts/read", { method: "DELETE", headers });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `فشل حذف المقروءة (HTTP ${r.status})`);
      }
      return r.json().catch(() => null);
    },
    onSuccess: () => invalidateAll(),
    onError: (err) =>
      toast(alertActionToast("فشل حذف التنبيهات المقروءة", getErrorMessage(err))),
  });

  const deleteAll = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/alerts", { method: "DELETE", headers });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `فشل حذف كل التنبيهات (HTTP ${r.status})`);
      }
      return r.json().catch(() => null);
    },
    onSuccess: () => {
      setConfirmDeleteAll(false);
      invalidateAll();
    },
    onError: (err) =>
      toast(alertActionToast("فشل حذف كل التنبيهات", getErrorMessage(err))),
  });

  const alerts = data?.pages.flatMap((p) => p.alerts) ?? [];
  // The global unread count rides the first page (server-side truth).
  const unreadCount = data?.pages[0]?.unreadCount ?? 0;
  const totalAlerts = data?.pages[0]?.total;
  const readCount = alerts.filter((a) => a.isRead).length;

  const displayed = alerts.filter((a) => {
    if (filter === "unread") return !a.isRead;
    if (filter === "all") return true;
    return a.type === filter;
  });

  const groups = groupByDate(displayed);

  return (
    <AdminLayout badges={{ unreadAlerts: unreadCount }}>
      <div className="space-y-5 page-in">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">صندوق التنبيهات</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              سجل تنبيهات النظام — المخزون، الكوبونات، والأحداث المهمة
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              onClick={() => refetch()}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="تحديث"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="gap-1.5 text-xs h-8"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                قراءة الكل
              </Button>
            )}

            {readCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteRead.mutate()}
                disabled={deleteRead.isPending}
                className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-destructive hover:border-destructive/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                حذف المقروءة ({readCount})
              </Button>
            )}

            {alerts.length > 0 &&
              (confirmDeleteAll ? (
                <div className="flex items-center gap-1.5 bg-destructive/10 border border-destructive/20 rounded-lg px-2.5 py-1.5">
                  <span className="text-xs text-destructive font-semibold">تأكيد حذف الكل؟</span>
                  <button
                    onClick={() => deleteAll.mutate()}
                    disabled={deleteAll.isPending}
                    className="text-2xs font-bold text-destructive hover:text-destructive/80 transition-colors px-1"
                  >
                    نعم
                  </button>
                  <button
                    onClick={() => setConfirmDeleteAll(false)}
                    className="text-2xs text-muted-foreground hover:text-foreground transition-colors px-1"
                  >
                    لا
                  </button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDeleteAll(true)}
                  className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  حذف الكل
                </Button>
              ))}
          </div>
        </div>

        {/* Stats row */}
        {!isLoading && alerts.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { key: "no_stock", count: alerts.filter((a) => a.type === "no_stock").length },
              { key: "low_stock", count: alerts.filter((a) => a.type === "low_stock").length },
              {
                key: "coupon_maxed",
                count: alerts.filter((a) => a.type === "coupon_maxed").length,
              },
            ]
              .filter((s) => s.count > 0)
              .map((s) => {
                const m = TYPE_META[s.key as AlertType];
                return (
                  <button
                    key={s.key}
                    onClick={() => setFilter(filter === s.key ? "all" : (s.key as FilterType))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border text-xs font-bold transition-all duration-150 ${
                      filter === s.key
                        ? `${m.bg} ${m.border} ${m.color}`
                        : "bg-muted/20 border-border/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <m.icon className="w-3 h-3" />
                    {m.label}
                    <span
                      className={`text-3xs px-1 rounded-full font-bold ${filter === s.key ? "bg-white/10" : "bg-muted/60"}`}
                    >
                      {s.count}
                    </span>
                  </button>
                );
              })}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-muted/30 border border-border/40 p-1 rounded-2xl overflow-x-auto scrollbar-none w-fit max-w-full">
          {FILTERS.map((tab) => {
            const cnt =
              tab.value === "all"
                ? alerts.length
                : tab.value === "unread"
                  ? unreadCount
                  : alerts.filter((a) => a.type === tab.value).length;
            return (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap shrink-0 ${
                  filter === tab.value
                    ? "bg-card text-foreground shadow-sm font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {cnt > 0 && (
                  <span
                    className={`text-3xs font-bold px-1.5 py-px rounded-full ${
                      filter === tab.value
                        ? "bg-primary/15 text-primary"
                        : "bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    {cnt}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Alert list */}
        {/* 93-C6 / F-07 (A5 AL-1): a failed poll is NOT "no alerts" —
            the 20 s poll failing (outage/expired session) used to
            render the "لا توجد تنبيهات" empty state with zero signal
            while role="alert" banners existed elsewhere in the app. */}
        {isError && alerts.length > 0 && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="min-w-0">{getErrorMessage(error)}</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-2xl skeleton-shimmer" />
            ))}
          </div>
        ) : isError && alerts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
              <WifiOff className="w-8 h-8 text-status-error/70" />
            </div>
            <p className="font-bold text-lg mb-1.5 text-foreground/80">تعذّر تحميل التنبيهات</p>
            <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
              {getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة
            </p>
            <Button
              onClick={() => refetch()}
              className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة المحاولة
            </Button>
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center">
              {filter === "unread" ? (
                <Bell className="w-7 h-7 text-muted-foreground" />
              ) : (
                <BellOff className="w-7 h-7 text-muted-foreground" />
              )}
            </div>
            <div className="text-center">
              <div className="font-semibold text-foreground/60">
                {filter === "unread" ? "لا توجد تنبيهات غير مقروءة" : "لا توجد تنبيهات"}
              </div>
              <div className="text-xs mt-1 text-muted-foreground">
                {filter === "unread"
                  ? "أنت على اطلاع كامل بكل شيء ✓"
                  : "ستظهر هنا تنبيهات المخزون والكوبونات تلقائياً"}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.label}>
                {/* Date group header */}
                <div className="flex items-center gap-3 mb-3">
                  {/* 94-C2 (A2 P2-10): uppercase/tracking dropped —
                      letter-spacing severs Arabic letter connections
                      (A11 §8, rule documented in layout.tsx). */}
                  <span className="text-2xs font-bold text-muted-foreground">
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-border/40" />
                  <span className="text-3xs text-muted-foreground">{group.items.length}</span>
                </div>

                <div className="space-y-1.5">
                  {group.items.map((alert) => {
                    const meta = TYPE_META[alert.type] ?? TYPE_META.system;
                    const Icon = meta.icon;
                    return (
                      <div
                        key={alert.id}
                        onClick={() => !alert.isRead && markRead.mutate(alert.id)}
                        className={`group flex items-start gap-3 px-4 py-3 rounded-2xl border transition-all duration-150 ${
                          alert.isRead
                            ? "bg-card/40 border-border/40 opacity-60 cursor-default"
                            : "bg-card border-border/60 shadow-sm cursor-pointer hover:border-border hover:shadow-md hover:shadow-black/10"
                        }`}
                      >
                        {/* Unread dot */}
                        <div className="relative shrink-0 mt-0.5">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center ${meta.bg}`}
                          >
                            <Icon className={`w-4 h-4 ${meta.color}`} />
                          </div>
                          {!alert.isRead && (
                            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-background badge-pulse" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm leading-snug ${alert.isRead ? "font-semibold text-foreground/70" : "font-bold"}`}
                            >
                              {alert.title}
                            </span>
                            <span
                              className={`text-3xs px-1.5 py-px rounded-full border shrink-0 ${meta.bg} ${meta.color} ${meta.border}`}
                            >
                              {meta.label}
                            </span>
                          </div>
                          {alert.message && (
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                              {alert.message}
                            </p>
                          )}
                          <div className="mt-1">
                            <span
                              className="text-2xs text-muted-foreground"
                              title={formatDate(alert.createdAt)}
                            >
                              {formatRelativeTime(alert.createdAt)}
                            </span>
                          </div>
                        </div>

                        {/* Actions — visible on hover (desktop) / always
                            visible on touch: opacity-0 makes them unreachable
                            on phones where there is no hover. */}
                        <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                          {!alert.isRead && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markRead.mutate(alert.id);
                              }}
                              className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                              title="تعيين كمقروء"
                            >
                              <CheckCheck className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAlert.mutate(alert.id);
                            }}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                            title="حذف"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Footer summary — 94-C2 (A2 P1-1): «عرض N» (+ the
                server-side `total` when the response carries it);
                never a false «إجمالاً N» over a truncated window. */}
            <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
              <Inbox className="w-3.5 h-3.5" />
              <span>
                عرض {formatCount(alerts.length, {
                  zero: "تنبيهات",
                  one: "تنبيه",
                  two: "تنبيهان",
                  few: "تنبيهات",
                  many: "تنبيهًا",
                  other: "تنبيه",
                })}
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
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  disabled={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  {isFetchingNextPage ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> جارٍ التحميل…
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" /> تحميل المزيد
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
