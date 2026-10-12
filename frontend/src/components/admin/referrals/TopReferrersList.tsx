import { Trophy } from "lucide-react";
import { MEDAL_COLORS, type AdminTopReferrer } from "@/components/admin/referrals/referrals-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/referrals.tsx —
// the top-referrers leaderboard (the medal trio riding the --tier-* inks,
// the honest credited/total counts — the derived points column is gone,
// R125-I3 A2-7). topReferrers is a page-owned value passed DOWN; the
// {topReferrers.length > 0 && …} branch stays in the page. The move only
// changes its address; DOM, classes and Arabic copy are byte-identical.

export function TopReferrersList({ topReferrers }: { topReferrers: AdminTopReferrer[] }) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4 float-in stagger-5">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="w-3.5 h-3.5 text-tier-gold" />
        <h2 className="font-bold text-sm">أكثر المستخدمين إحالةً</h2>
      </div>
      <div className="space-y-2">
        {topReferrers.map((r, i) => (
          <div
            key={r.id}
            className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/20 hover:bg-muted/35 transition-colors"
          >
            <div
              className={`w-6 h-6 rounded-full border flex items-center justify-center text-2xs font-bold shrink-0 ${MEDAL_COLORS[i] ?? "text-muted-foreground bg-muted/40 border-border/40"}`}
            >
              {i + 1}
            </div>
            <span className="font-mono text-sm font-bold flex-1 truncate">{r.phone}</span>
            <div className="flex items-center gap-3 text-xs shrink-0">
              <span className="text-status-success font-bold">{r.credited_count} ناجحة</span>
              <span className="text-muted-foreground">{r.total_count} إجمالي</span>
              {/* R125-I3 (A2-7): the derived «{credited_count * 50}
                        نقطة» column is GONE — it hardcoded the
                        POINTS_PER_REFERRAL money constant (the backend
                        derives it from lib/loyalty-policy, which the
                        frontend cannot import). The rows below already
                        show each referral's points from the API
                        (points_earned), and the stat cards show the
                        server-computed total_points — a policy change
                        can no longer make this column lie. */}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
