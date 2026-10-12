import { type ReactNode } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the page's lazy recharts bridge. A module-level singleton by design:
// the diagnostics MetricCard sparklines (extract), the page's own rps
// trend chart and any future surface share ONE ChartsLoader instance —
// exactly the single dynamic import() the R125-I2 boundary promised. The
// move only changes its address; retry semantics are byte-identical.

/* ── R125-I2 (A5-F3): the recharts lazy boundary (the dashboard.tsx
 * bridge, duplicated in-file — this round's file ownership is the four
 * admin pages, so the shared components/admin/charts.tsx wrapper A5
 * sketched stays a follow-up). system.tsx statically imported recharts
 * for two below-the-fold surfaces (the diagnostics MetricCard
 * sparklines + the SECTION-2 rps trend chart); its route chunk paid the
 * full 109.48 KB gz vendor-charts download + parse before ANY panel
 * painted. The only runtime reference to "recharts" is now the dynamic
 * import() below — vendor-charts streams in on demand while the health
 * overview renders on the system chunk alone. The type-only alias
 * erases at compile time. */
type RechartsNS = typeof import("recharts");

export const ChartsLoader = lazyWithRetry(() =>
  import("recharts").then((rc) => ({
    default: function RechartsBridge({ children }: { children: (rc: RechartsNS) => ReactNode }) {
      return children(rc);
    },
  })),
);
