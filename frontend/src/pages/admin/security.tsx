import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { Activity, CheckCircle, Download, Shield, XCircle } from "lucide-react";
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

export function AdminSecurityDashboard() {
  const { adminToken } = useAuth();
  const [stats, setStats] = useState<AuthStats | null>(null);
  const [activities, setActivities] = useState<AuthActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    action: "all",
    success: "all",
  });

  useEffect(() => {
    if (adminToken) {
      fetchStats();
      fetchActivities();
    }
  }, [adminToken, filters]);

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/admin/auth-stats/summary", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!response.ok) throw new Error("Failed to fetch stats");
      const data = await response.json();
      setStats(data);
      setError(null);
    } catch (error) {
      console.error("Failed to fetch stats:", error);
      setError("فشل في جلب الإحصائيات");
    }
  };

  const fetchActivities = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.action !== "all") params.append("action", filters.action);
      if (filters.success !== "all") params.append("success", filters.success);

      const response = await fetch(`/api/admin/auth-activity?${params}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!response.ok) throw new Error("Failed to fetch activities");
      const data = await response.json();
      setActivities(data.activities || []);
      setError(null);
    } catch (error) {
      console.error("Failed to fetch activities:", error);
      setError("فشل في جلب سجل النشاط");
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

    const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `auth-activity-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (loading) {
    return <div className="text-center py-8">جاري التحميل...</div>;
  }

  const refreshAll = () => {
    void fetchStats();
    void fetchActivities();
  };

  return (
    <AdminLayout onRefresh={refreshAll}>
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
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <div>
                <p className="text-sm text-muted-foreground">ناجحة</p>
                <p className="text-2xl font-bold text-emerald-500">{stats.success}</p>
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
        {activities.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">لا توجد أنشطة</p>
        ) : (
          <div className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 p-4 border border-border/40 rounded-lg bg-muted/20"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                  {activity.success ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{activity.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(activity.createdAt).toLocaleString("ar-LY")}
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
    </AdminLayout>
  );
}

export default AdminSecurityDashboard;
