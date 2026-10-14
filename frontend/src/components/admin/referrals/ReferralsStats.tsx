import { CheckCircle, Clock, Star, Users } from "lucide-react";
import { type AdminReferralsStats } from "@/components/admin/referrals/referrals-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/referrals.tsx —
// the four-stat strip (total / credited / pending / total points) with
// its StatCard shell. The stats object is a page-owned value passed
// DOWN (hidden until the first successful load — the page keeps the
// {data && …} branch so a failed fetch never renders «—» cards that
// read as zero data, B5-03); this shell owns no state. The move only
// changes its address; DOM, classes and Arabic copy are byte-identical.

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  bg: string;
}) {
  return (
    /* R139 (precision): the four-stat strip is the referrals page's KPI
       moment — the tiles adopt the r138 two-layer calm elevation AT REST
       (the dashboard MetricCard recipe, neutral black; the page's one
       elevated register — table/leaderboard below stay flat) and the
       VALUE drops its per-tile hue for plain foreground ink + weight +
       size + tabular-nums (receipt register: the state identity stays
       in the icon stage, the number is data — the MetricCard value +
       OrdersStatsPanel revenue-tile rule).
       R143 (L2-1): the calm elevation is now the theme-aware
       `shadow-calm` token in index.css (dark byte-identical; .light
       re-tuned inside the documented 6–14% ceiling). */
    <div className="bg-card border border-border/60 rounded-2xl p-4 shadow-calm">
      <div className={`w-8 h-8 rounded-xl border flex items-center justify-center mb-3 ${bg}`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="text-2xl font-bold tabular-nums mb-0.5">{value}</div>
      <div className="text-xs text-muted-foreground font-semibold">{label}</div>
    </div>
  );
}

export function ReferralsStats({ stats }: { stats: AdminReferralsStats | undefined }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        label="إجمالي الإحالات"
        value={stats?.total ?? "—"}
        icon={Users}
        color="text-status-info"
        bg="bg-status-info/10 border-status-info/15"
      />
      <StatCard
        label="ناجحة (مكتسبة)"
        value={stats?.credited ?? "—"}
        icon={CheckCircle}
        color="text-status-success"
        bg="bg-status-success/10 border-status-success/15"
      />
      <StatCard
        label="قيد الانتظار"
        value={stats?.pending ?? "—"}
        icon={Clock}
        /* R126-L5 (A3 item-10): the pending StatCard joins the
                 warning sweep (yellow-400 fails the light theme). */
        color="text-status-warning"
        bg="bg-status-warning/10 border-status-warning/15"
      />
      <StatCard
        label="نقاط ممنوحة إجمالاً"
        value={stats?.total_points ?? "—"}
        icon={Star}
        color="text-primary"
        bg="bg-primary/10 border-primary/15"
      />
    </div>
  );
}
