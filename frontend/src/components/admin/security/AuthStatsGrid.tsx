import { Activity, CheckCircle, Shield, XCircle } from "lucide-react";
import type { AdminAuthStatsSummary } from "@/components/admin/security/security-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the auth pane's four KPI cards (loaded tiles only: the page keeps the
// `stats &&` mount guard, the statsError banner and the query itself).
// Values arrive via the `stats` prop; ZERO hooks here.

export function AuthStatsGrid({ stats }: { stats: AdminAuthStatsSummary }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="bg-card border border-border/60 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-primary" />
          <div>
            <p className="text-sm text-muted-foreground">إجمالي الأنشطة</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </div>
        </div>
      </div>
      <div className="bg-card border border-border/60 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-status-success" />
          <div>
            <p className="text-sm text-muted-foreground">ناجحة</p>
            <p className="text-2xl font-bold text-status-success">{stats.success}</p>
          </div>
        </div>
      </div>
      {/* R139 (precision): the resting edge joins the family value
          (/55 → /60, the table-container register) and the failure ink
          migrates to --status-error (the §6 status-token source — the
          destructive pair was the shadcn channel, near-identical red but
          off-source; icon + value move together, the reason-bearing
          context stays the timeline rows below). */}
      <div className="bg-card border border-border/60 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <XCircle className="w-5 h-5 text-status-error" />
          <div>
            <p className="text-sm text-muted-foreground">فاشلة</p>
            <p className="text-2xl font-bold text-status-error">{stats.failure}</p>
          </div>
        </div>
      </div>
      <div className="bg-card border border-border/60 rounded-xl p-4">
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
