import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  Inbox,
  Info,
  Package,
  RefreshCw,
  Tag,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { AdminLayout } from "./layout";

type AlertType = "coupon_maxed" | "coupon_expiring" | "low_stock" | "no_stock" | "system";

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
};

type FilterType = "all" | "unread" | "coupon_maxed" | "coupon_expiring" | "low_stock" | "no_stock";

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
  const [filter, setFilter] = useState<FilterType>("all");
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ alerts: AdminAlertItem[]; unreadCount: number }>({
    queryKey: ["admin-alerts"],
    queryFn: () => fetch("/api/admin/alerts", { headers }).then((r) => r.json()),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    enabled: !!adminToken,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-alerts"] });
    qc.invalidateQueries({ queryKey: ["admin-alerts-unread-count"] });
  };

  const markRead = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/alerts/${id}/read`, { method: "PATCH", headers }).then((r) => r.json()),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["admin-alerts"] });
      const prev = qc.getQueryData<{ alerts: AdminAlertItem[]; unreadCount: number }>([
        "admin-alerts",
      ]);
      qc.setQueryData<{ alerts: AdminAlertItem[]; unreadCount: number }>(["admin-alerts"], (old) =>
        old
          ? {
              alerts: old.alerts.map((a) => (a.id === id ? { ...a, isRead: true } : a)),
              unreadCount: Math.max(0, old.unreadCount - 1),
            }
          : old,
      );
      qc.setQueryData<{ count: number }>(["admin-alerts-unread-count"], (old) =>
        old ? { count: Math.max(0, old.count - 1) } : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-alerts"], ctx.prev);
    },
    onSettled: () => invalidateAll(),
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      fetch("/api/admin/alerts/read-all", { method: "PATCH", headers }).then((r) => r.json()),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["admin-alerts"] });
      const prev = qc.getQueryData<{ alerts: AdminAlertItem[]; unreadCount: number }>([
        "admin-alerts",
      ]);
      qc.setQueryData<{ alerts: AdminAlertItem[]; unreadCount: number }>(["admin-alerts"], (old) =>
        old ? { alerts: old.alerts.map((a) => ({ ...a, isRead: true })), unreadCount: 0 } : old,
      );
      qc.setQueryData<{ count: number }>(["admin-alerts-unread-count"], { count: 0 });
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-alerts"], ctx.prev);
    },
    onSettled: () => invalidateAll(),
  });

  const deleteAlert = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/alerts/${id}`, { method: "DELETE", headers }).then((r) => r.json()),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["admin-alerts"] });
      const prev = qc.getQueryData<{ alerts: AdminAlertItem[]; unreadCount: number }>([
        "admin-alerts",
      ]);
      qc.setQueryData<{ alerts: AdminAlertItem[]; unreadCount: number }>(
        ["admin-alerts"],
        (old) => {
          if (!old) return old;
          const removed = old.alerts.find((a) => a.id === id);
          return {
            alerts: old.alerts.filter((a) => a.id !== id),
            unreadCount:
              removed && !removed.isRead ? Math.max(0, old.unreadCount - 1) : old.unreadCount,
          };
        },
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-alerts"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin-alerts"] }),
  });

  const deleteRead = useMutation({
    mutationFn: () =>
      fetch("/api/admin/alerts/read", { method: "DELETE", headers }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-alerts"] }),
  });

  const deleteAll = useMutation({
    mutationFn: () =>
      fetch("/api/admin/alerts", { method: "DELETE", headers }).then((r) => r.json()),
    onSuccess: () => {
      setConfirmDeleteAll(false);
      qc.invalidateQueries({ queryKey: ["admin-alerts"] });
    },
  });

  const alerts = data?.alerts ?? [];
  const unreadCount = data?.unreadCount ?? 0;
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
            <h1 className="text-xl font-black">صندوق التنبيهات</h1>
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
                  <span className="text-xs text-destructive font-medium">تأكيد حذف الكل؟</span>
                  <button
                    onClick={() => deleteAll.mutate()}
                    disabled={deleteAll.isPending}
                    className="text-[11px] font-black text-destructive hover:text-destructive/80 transition-colors px-1"
                  >
                    نعم
                  </button>
                  <button
                    onClick={() => setConfirmDeleteAll(false)}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1"
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
                      className={`text-[10px] px-1 rounded-full font-black ${filter === s.key ? "bg-white/10" : "bg-muted/60"}`}
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap shrink-0 ${
                  filter === tab.value
                    ? "bg-card text-foreground shadow-sm font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {cnt > 0 && (
                  <span
                    className={`text-[10px] font-black px-1.5 py-px rounded-full ${
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
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-2xl skeleton-shimmer" />
            ))}
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
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-border/40" />
                  <span className="text-[10px] text-muted-foreground">{group.items.length}</span>
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
                              className={`text-sm leading-snug ${alert.isRead ? "font-medium text-foreground/70" : "font-bold"}`}
                            >
                              {alert.title}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-px rounded-full border shrink-0 ${meta.bg} ${meta.color} ${meta.border}`}
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
                              className="text-[11px] text-muted-foreground"
                              title={formatDate(alert.createdAt)}
                            >
                              {formatRelativeTime(alert.createdAt)}
                            </span>
                          </div>
                        </div>

                        {/* Actions — visible on hover */}
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
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

            {/* Footer summary */}
            <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
              <Inbox className="w-3.5 h-3.5" />
              <span>
                {alerts.length} تنبيه إجمالاً · {unreadCount} غير مقروء
              </span>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
