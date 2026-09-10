import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
// 93-C7 / C-UX6 (A12 §5): the hand-rolled bare "لا توجد أنشطة" empty
// state adopts the shared EmptyState card.
import { EmptyState } from "@/components/admin/EmptyState";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { Activity, CheckCircle, Download, RefreshCw, Shield, WifiOff, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminLayout } from "./layout";

interface AuthActivity {
  id: number;
  userId: number;
  identifier: string;
  action: string;
  success: boolean;
  provider: string | null;
  failureReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AuthStats {
  total: number;
  success: number;
  failure: number;
  last24h: number;
}

/** 94-C2 (A2 P3-18): the timeline used to render the raw backend
 *  `action` enum in English ("login") while the filter select next to
 *  it showed the same value in Arabic — one shared map keeps the two
 *  in lockstep. */
const ACTION_LABELS: Record<string, string> = {
  login: "تسجيل دخول",
  register: "تسجيل",
  logout: "تسجيل خروج",
  change_password: "تغيير كلمة المرور",
  unlink_provider: "فصل مزوّد",
};

const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

export function AdminSecurityDashboard() {
  const { adminToken } = useAuth();
  const headers = useAdminHeaders();
  const [stats, setStats] = useState<AuthStats | null>(null);
  const [activities, setActivities] = useState<AuthActivity[]>([]);
  const [loading, setLoading] = useState(true);
  // 94-C2 (A2 P2-1): both fetches previously swallowed failures with
  // console.error — `stats` stayed null (the cards silently vanished)
  // and `activities` stayed [] ⇒ the "لا توجد أنشطة" empty state during
  // an outage or an expired session. The failure is now a first-class
  // surface: an error card with retry (referrals.tsx idiom).
  const [statsError, setStatsError] = useState<string | null>(null);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    action: "all",
    success: "all",
  });

  // 94-C2 (A2 P3-18): stats are UNFILTERED — the effect used to re-run
  // `fetchStats` on every filter change, re-requesting the same
  // unfiltered numbers each time the operator flipped a select.
  useEffect(() => {
    if (adminToken) {
      fetchStats();
    }
  }, [adminToken]);

  useEffect(() => {
    if (adminToken) {
      fetchActivities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchActivities closes over `filters`/`headers` deliberately
  }, [adminToken, filters]);

  const fetchStats = async () => {
    setStatsError(null);
    try {
      const response = await fetch("/api/admin/auth-stats/summary", {
        headers,
      });
      // 94-C2 (A2 P2-14): a mid-session 401 is the global handler's
      // job (toast + redirect) — don't render a local error card on top.
      if (isAdminUnauthorized(response, "/api/admin/auth-stats/summary")) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(
          getErrorMessage(body) || `فشل تحميل الإحصاءات (HTTP ${response.status})`,
        );
      }
      const data = (await response.json()) as AuthStats;
      setStats(data);
    } catch (error) {
      // 94-C2 (A2 P2-1): surfaced to the operator, not just the console.
      setStatsError(
        error instanceof Error && error.message ? error.message : "تعذّر تحميل الإحصاءات",
      );
    }
  };

  const fetchActivities = async () => {
    setActivitiesError(null);
    try {
      const params = new URLSearchParams();
      if (filters.action !== "all") params.append("action", filters.action);
      if (filters.success !== "all") params.append("success", filters.success);

      const url = `/api/admin/auth-activity?${params}`;
      const response = await fetch(url, {
        headers,
      });
      if (isAdminUnauthorized(response, url)) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(
          getErrorMessage(body) || `فشل تحميل سجل النشاط (HTTP ${response.status})`,
        );
      }
      const data = (await response.json()) as { activities?: AuthActivity[] };
      setActivities(Array.isArray(data.activities) ? data.activities : []);
    } catch (error) {
      setActivitiesError(
        error instanceof Error && error.message ? error.message : "تعذّر تحميل سجل النشاط",
      );
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    const headers = [
      "ID",
      "User ID",
      "Identifier",
      "Action",
      "Success",
      "Provider",
      "Failure Reason",
      "IP Address",
      "Created At",
    ];
    const rows = activities.map((a) => [
      a.id,
      a.userId,
      a.identifier,
      a.action,
      a.success,
      a.provider || "",
      a.failureReason || "",
      a.ipAddress || "",
      a.createdAt,
    ]);

    const escapeCsvField = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

    const csvContent =
      "\uFEFF" + [headers, ...rows].map((row) => row.map(escapeCsvField).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `auth-activity-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // 94-C2 (A2 P3-18): the loading state renders INSIDE the admin shell
  // (the previous bare centered div appeared before the layout — a
  // flash of structure-less text on every visit).
  const refreshAll = () => {
    void fetchStats();
    void fetchActivities();
  };

  return (
    <AdminLayout onRefresh={refreshAll}>
      {loading ? (
        <div className="text-center py-8 text-muted-foreground" role="status">
          جارٍ التحميل…
        </div>
      ) : (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">لوحة أمان المصادقة</h1>
          </div>
          <Button onClick={exportToCSV} variant="outline" size="sm">
            <Download className="w-4 h-4 ml-2" />
            تصدير CSV
          </Button>
        </div>

        {/* Stats Cards */}
        {/* 94-C2 (A2 P2-1): a failed stats load surfaces an error card
            with retry instead of the cards silently disappearing. */}
        {statsError && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="min-w-0">{statsError}</span>
            <button
              type="button"
              onClick={() => void fetchStats()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border/55 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الأنشطة</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border/55 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-status-success" />
                <div>
                  <p className="text-sm text-muted-foreground">ناجحة</p>
                  <p className="text-2xl font-bold text-status-success">{stats.success}</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border/55 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <XCircle className="w-5 h-5 text-destructive" />
                <div>
                  <p className="text-sm text-muted-foreground">فاشلة</p>
                  <p className="text-2xl font-bold text-destructive">{stats.failure}</p>
                </div>
              </div>
            </div>
            <div className="bg-card border border-border/55 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">آخر 24 ساعة</p>
                  <p className="text-2xl font-bold">{stats.last24h}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-card border border-border/55 rounded-xl p-4 flex gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">الإجراء:</label>
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="px-3 py-1.5 border rounded text-sm"
            >
              <option value="all">الكل</option>
              <option value="login">تسجيل دخول</option>
              <option value="register">تسجيل</option>
              <option value="logout">تسجيل خروج</option>
              <option value="change_password">تغيير كلمة المرور</option>
              <option value="unlink_provider">فصل مزود</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">الحالة:</label>
            <select
              value={filters.success}
              onChange={(e) => setFilters({ ...filters, success: e.target.value })}
              className="px-3 py-1.5 border rounded text-sm"
            >
              <option value="all">الكل</option>
              <option value="true">ناجح</option>
              <option value="false">فاشل</option>
            </select>
          </div>
        </div>

        {/* Activity Timeline */}
        <div className="bg-card border border-border/55 rounded-xl p-4">
          <h2 className="text-lg font-bold mb-4">سجل النشاط</h2>
          {/* 94-C2 (A2 P2-1): a failed activity load is an error card
              with retry — NOT the "لا توجد أنشطة" false-empty state an
              expired session used to render. */}
          {activitiesError ? (
            <div className="text-center py-10 text-muted-foreground">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
                <WifiOff className="w-7 h-7 text-status-error/70" />
              </div>
              <p className="font-black text-base mb-1.5 text-foreground/80">تعذّر تحميل سجل النشاط</p>
              <p className="text-sm mb-5 max-w-xs mx-auto leading-relaxed">{activitiesError}</p>
              <Button
                onClick={() => void fetchActivities()}
                className="gap-2 font-bold"
                variant="outline"
                size="sm"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                إعادة المحاولة
              </Button>
            </div>
          ) : activities.length === 0 ? (
            <EmptyState icon={Activity} title="لا توجد أنشطة" />
          ) : (
            <div className="space-y-3">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-4 p-4 border border-border/40 rounded-lg bg-muted/20"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                    {activity.success ? (
                      <CheckCircle className="w-4 h-4 text-status-success" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{actionLabel(activity.action)}</span>
                      <span className="text-xs text-muted-foreground">
                        {/* 96-F7 (R96 A6 #6): -u-nu-latn pins Latin digits —
                            engines without ar-LY data fall back to the
                            "ar" root and emit Arabic-Indic numerals. */}
                        {new Date(activity.createdAt).toLocaleString("ar-LY-u-nu-latn")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{activity.identifier}</p>
                    {activity.failureReason && (
                      <p className="text-xs text-destructive mt-1">{activity.failureReason}</p>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      {activity.provider && <span>المزود: {activity.provider}</span>}
                      {activity.ipAddress && <span>IP: {activity.ipAddress}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </AdminLayout>
  );
}

export default AdminSecurityDashboard;
