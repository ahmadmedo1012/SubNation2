import { Star, Users, Wallet } from "lucide-react";
import { formatCount, formatCurrency } from "@/lib/utils";
import { USER_COUNT_FORMS } from "@/components/admin/users/user-directory-meta";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the loaded-sample summary strip (count / total wallet balances /
// total lifetime spend / average spend). The aggregates are the page's
// memoized reductions over the accumulated pages; they flow down as
// values. The move only changes its address; DOM and classes are
// byte-identical.

export function UsersStatsStrip({
  usersCount,
  totalWallet,
  totalSpend,
}: {
  usersCount: number;
  totalWallet: number;
  totalSpend: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        {
          label: "المستخدمون المعروضون",
          value: formatCount(usersCount, USER_COUNT_FORMS),
          icon: Users,
          color: "text-status-info",
          bg: "bg-status-info/10",
          border: "border-status-info/15",
        },
        {
          label: "أرصدة المعروضين",
          value: formatCurrency(totalWallet),
          icon: Wallet,
          color: "text-status-info",
          bg: "bg-status-info/10",
          border: "border-status-info/15",
        },
        {
          label: "إنفاق المعروضين",
          value: formatCurrency(totalSpend),
          icon: Star,
          color: "text-status-success",
          bg: "bg-status-success/10",
          border: "border-status-success/15",
        },
        {
          label: "متوسط الإنفاق",
          value: formatCurrency(usersCount > 0 ? totalSpend / usersCount : 0),
          icon: Star,
          color: "text-status-purple",
          bg: "bg-status-purple/10",
          border: "border-status-purple/15",
        },
      ].map((stat) => (
        <div
          key={stat.label}
          className={`float-in bg-card border ${stat.border} rounded-2xl px-4 py-3 flex items-center gap-3`}
        >
          <div
            className={`w-8 h-8 ${stat.bg} rounded-lg flex items-center justify-center shrink-0`}
          >
            <stat.icon className={`w-4 h-4 ${stat.color}`} />
          </div>
          <div>
            {/* R139 (precision): money emphasis by weight+size, not color —
                the loaded-sample values drop their status inks for plain
                foreground (the MetricCard value idiom + the OrdersStatsPanel
                revenue-tile decision: wallet totals / spend / averages are
                not statuses). The token tint stays where the MetricCard keeps
                it — the icon stage + the quiet /15 tile border; tabular-nums
                already rode every amount. */}
            <div className="font-bold text-sm tabular-nums">{stat.value}</div>
            <div className="text-3xs text-muted-foreground leading-tight mt-0.5">{stat.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
