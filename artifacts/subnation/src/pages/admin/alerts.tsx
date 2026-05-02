import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "./layout";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/utils";
import {
  Bell, BellOff, CheckCheck, Trash2,
  Tag, Package, AlertTriangle, ShieldAlert, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type AlertType = "coupon_maxed" | "coupon_expiring" | "low_stock" | "no_stock" | "system";

interface AdminAlertItem {
  id: number;
  type: AlertType;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: string;
}

const TYPE_META: Record<AlertType, { icon: any; color: string; bg: string; label: string }> = {
  coupon_maxed:    { icon: Tag,          color: "text-amber-400",  bg: "bg-amber-400/10",  label: "كوبون" },
  coupon_expiring: { icon: Tag,          color: "text-orange-400", bg: "bg-orange-400/10", label: "كوبون" },
  low_stock:       { icon: Package,      color: "text-yellow-400", bg: "bg-yellow-400/10", label: "مخزون" },
  no_stock:        { icon: AlertTriangle,color: "text-red-400",    bg: "bg-red-400/10",    label: "نفاد" },
  system:          { icon: Info,         color: "text-blue-400",   bg: "bg-blue-400/10",   label: "نظام" },
};

export default function AdminAlertsPage() {
  const { adminToken } = useAuth();
  const qc = useQueryClient();
  const headers = { Authorization: `Bearer ${adminToken}` };
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const { data, isLoading } = useQuery<{ alerts: AdminAlertItem[]; unreadCount: number }>({
    queryKey: ["admin-alerts"],
    queryFn: () => fetch("/api/admin/alerts", { headers }).then(r => r.json()),
    refetchInterval: 30_000,
    enabled: !!adminToken,
  });

  const markRead = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/alerts/${id}/read`, { method: "PATCH", headers }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-alerts"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      fetch("/api/admin/alerts/read-all", { method: "PATCH", headers }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-alerts"] }),
  });

  const deleteAlert = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/alerts/${id}`, { method: "DELETE", headers }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-alerts"] }),
  });

  const alerts = data?.alerts ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const displayed = filter === "unread" ? alerts.filter(a => !a.isRead) : alerts;

  return (
    <AdminLayout badges={{}}>
      <div className="space-y-5 page-in">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black">صندوق التنبيهات</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              سجل تنبيهات النظام — المخزون، الكوبونات، والأحداث المهمة
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-xl w-fit">
          {(["all", "unread"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-2 ${
                filter === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "all" ? "الكل" : "غير المقروءة"}
              {tab === "unread" && unreadCount > 0 && (
                <span className="text-[10px] font-black px-1.5 py-0.5 bg-primary/15 text-primary rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Alert list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl skeleton-shimmer" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center">
              <BellOff className="w-7 h-7 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <div className="font-semibold text-foreground/60">لا توجد تنبيهات</div>
              <div className="text-xs mt-1">ستظهر هنا تنبيهات المخزون والكوبونات تلقائياً</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {displayed.map((alert, i) => {
              const meta = TYPE_META[alert.type] ?? TYPE_META.system;
              const Icon = meta.icon;
              return (
                <div
                  key={alert.id}
                  className={`stagger-${Math.min(i, 5)} reveal-up flex items-start gap-3 p-4 rounded-2xl border transition-all duration-150 group cursor-default ${
                    alert.isRead
                      ? "bg-card/50 border-border/50 opacity-70"
                      : "bg-card border-border shadow-sm"
                  }`}
                  onClick={() => !alert.isRead && markRead.mutate(alert.id)}
                >
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}>
                    <Icon className={`w-4.5 h-4.5 ${meta.color}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="font-bold text-sm leading-snug">{alert.title}</span>
                      {!alert.isRead && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5 badge-pulse" />
                      )}
                    </div>
                    {alert.message && (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{alert.message}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <Badge variant="outline" className={`text-[10px] py-0 h-4 border-0 ${meta.bg} ${meta.color}`}>
                        {meta.label}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground/60">
                        {formatRelativeTime(alert.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!alert.isRead && (
                      <button
                        onClick={e => { e.stopPropagation(); markRead.mutate(alert.id); }}
                        className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        title="تعيين كمقروء"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); deleteAlert.mutate(alert.id); }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                      title="حذف التنبيه"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
