import { Skeleton } from "@/components/ui/Skeleton";
// R125-I2 (A5-F3): the recharts bridge is loaded through the SAME
// retry-wrapping lazy loader every route rides (App.tsx / layout.tsx
// idiom) — vendor-charts is a post-deploy-stale-chunk risk like any
// other, and lazyWithRetry's one-reload recovery covers it.
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import type { ReactNode } from "react";

// R137 (FE admin decomposition): the lazy recharts boundary + its shared
// fallbacks moved verbatim from pages/admin/dashboard.tsx — every recharts
// surface in components/admin/dashboard/* rides the SAME bridge (one
// dynamic import, one vendor-charts chunk), and the page imports no
// recharts at all. The move only changes its address; the dynamic-import
// shape, the fallback geometry and the vi.mock("recharts") seam the
// dashboard-chart-race suite intercepts are byte-identical.

/* ── R125-I2 (A5-F3): the recharts lazy boundary ──────────────────────────
 * The dashboard statically imported recharts, so the admin LANDING
 * page's route chunk (dashboard-*.js) statically dragged vendor-charts
 * (403.54 KB raw / 109.48 KB gz at the R125-A5 build) — the route's
 * Suspense fallback (RouteSkeleton) stayed up until the whole static
 * import graph downloaded AND evaluated, 79% of which was charts code
 * the first paint never shows (the KPI tiles + recent-orders stream
 * need no recharts; every chart renders below them).
 *
 * THE BRIDGE: the only runtime reference to "recharts" is the dynamic
 * import() below, so Rollup keeps vendor-charts OUT of the dashboard
 * chunk's static graph — it streams in parallel on first mount while
 * the tiles/recent-orders paint on the dashboard chunk alone (SW
 * CacheFirst serves it on every subsequent visit). The type-only
 * import above/below erases at compile time — zero runtime bytes.
 *
 * LANE NOTE: A5's sketch preferred a shared components/admin/charts.tsx
 * wrapper file; this round's file ownership is dashboard/system only,
 * so the boundary lives in-file as a render-prop bridge with the SAME
 * network shape (one dynamic import, one chunk, consumed by every
 * recharts surface in this file). A future shared wrapper can absorb
 * it verbatim.
 *
 * DECISION (documented per the round brief): charts ARE lazy here on
 * the money landing page — the above-the-fold content is the KPI grid
 * + urgent banner + recent orders; the chart column sits below them
 * and already renders a chart-data loading skeleton on first paint,
 * which masks the vendor-charts fetch. The KPI sparklines get a
 * height-reserved placeholder (h-8) so recharts landing causes no
 * layout shift. TrendBadge is pure icon+text and stays eager. */
type RechartsNS = typeof import("recharts");

export const ChartsLoader = lazyWithRetry(() =>
  import("recharts").then((rc) => ({
    default: function RechartsBridge({ children }: { children: (rc: RechartsNS) => ReactNode }) {
      return children(rc);
    },
  })),
);

/** Shared Suspense fallbacks: height-reserved shimmer blocks so the
 * lazy vendor-charts fetch never shifts layout (charts) and the KPI
 * sparkline rows keep their 32px slot.
 * R136 (UX-1): the block is a ui/Skeleton now — geometry verbatim
 * (the dashboard-chart-race pin reads .skeleton-shimmer, which the
 * primitive keeps), the role=status + sr-only pair net-new. */
export function ChartPanelFallback({ heightClass }: { heightClass: string }) {
  return <Skeleton className={`${heightClass} rounded-lg`} />;
}
