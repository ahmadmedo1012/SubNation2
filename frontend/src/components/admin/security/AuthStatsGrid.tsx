import { Activity, CheckCircle, Shield, XCircle } from "lucide-react";
import type { AdminAuthStatsSummary } from "@/components/admin/security/security-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the auth pane's four KPI cards (loaded tiles only: the page keeps the
// `stats &&` mount guard, the statsError banner and the query itself).
// Values arrive via the `stats` prop; ZERO hooks here.

export function AuthStatsGrid({ stats }: { stats: AdminAuthStatsSummary }) {
  return (
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
  );
}
