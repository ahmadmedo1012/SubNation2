import { ArrowUpLeft, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import type { ChartDay } from "./chart-data";
import { Sparkline } from "./Sparkline";
import { TrendBadge } from "./TrendBadge";

// R137 (FE admin decomposition): one KPI stat card moved verbatim from
// pages/admin/dashboard.tsx — the card DEFINITIONS (METRIC_CARDS, built
// from stats + the chart palette + newUsersToday) and the loading
// skeleton branch stay in the page; this extract renders a page-built
// card def + the chart series as values, with no state of its own.

/** One KPI tile as the page's METRIC_CARDS array builds it (the page
 *  owns the stats-derived values; the tile just renders them). */
export interface MetricCardDef {
  label: string;
  /** R122 (A2-P2): finance-gated tile — filtered out by the page for
   *  non-finance operators before the grid ever renders. */
  finance?: boolean;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  border: string;
  link: string;
  highlight?: boolean;
  urgent?: boolean;
  lowStock?: boolean;
  sparkKey: keyof ChartDay | null;
  sparkColor: string;
}

export function MetricCard({
  card,
  index,
  chartData,
}: {
  card: MetricCardDef;
  index: number;
  chartData: ChartDay[];
}) {
  return (
    <Link href={card.link}>
      <div
        /* R128 (A1-D5/F1): the low-stock card's orange KPI border
           + the codebase's ONLY ad-hoc rgba shadow
           (shadow-[0_0_0_1px_rgba(251,146,60,0.12)]) migrate to
           the --status-low-stock token and the urgent sibling's
           exact shape (border + hover border/shadow, no ring).
           R139 (precision): the KPI grid is the dashboard's prominent
           surface (the mission's own call), so the tiles adopt the
           r138 two-layer calm elevation at REST — the tight contact
           line (1px 2px @30%) + contained ambient wash (10px 28px
           −14px @40%), deliberately NEUTRAL black (status-tinted
           shadows read as color on .light, the same reason
           ProductCard's elevation went neutral). The hover ladder
           rides the family's neutral step — hover:shadow-xl
           hover:shadow-black/25 — which RETIRES the R128 colored
           hover-shadow tints (/10–/15 barely registered and a colored
           haze is not how a quiet-premium surface says "hover"); the
           state signal stays where it always lived: the token BORDER
           (warning/low-stock/primary edges below + their hover
           steps). Charts-column cards stay flat on purpose — one
           elevated register per page. */
        className={`float-in stagger-${index + 1} bg-card border rounded-2xl p-4 card-spring cursor-pointer group shadow-calm hover:shadow-xl hover:shadow-black/25 ${card.urgent ? "border-status-warning/25 hover:border-status-warning/40" : card.lowStock ? "border-status-low-stock/30 hover:border-status-low-stock/45" : card.highlight ? "border-primary/20 hover:border-primary/35" : "border-border/60 hover:border-border"}`}
      >
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div
            className={`relative w-8 h-8 ${card.bg} border ${card.border} rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110`}
          >
            <card.icon className={`w-4 h-4 ${card.color}`} />
            {card.lowStock && (
              <span
                className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-status-low-stock ring-2 ring-card badge-pulse"
                aria-label="مخزون منخفض"
              />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {card.sparkKey && <TrendBadge data={chartData} dataKey={card.sparkKey} />}
            {/* RTL: forward/"go to" points left (unified icon-direction decision) */}
            <ArrowUpLeft className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
        </div>
        <div className="font-bold text-xl leading-none mb-0.5 tabular-nums">{card.value}</div>
        <div className="text-2xs text-muted-foreground">{card.label}</div>
        {card.sub && <div className="text-3xs text-muted-foreground mt-0.5">{card.sub}</div>}
        {/* Mini sparkline */}
        {card.sparkKey && chartData.length >= 3 && (
          <div className="mt-2 -mx-1 opacity-60">
            <Sparkline data={chartData} dataKey={card.sparkKey} color={card.sparkColor} />
          </div>
        )}
      </div>
    </Link>
  );
}
