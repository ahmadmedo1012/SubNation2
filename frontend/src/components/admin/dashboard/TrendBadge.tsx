import { TrendingDown, TrendingUp } from "lucide-react";
import type { ChartDay } from "./chart-data";

// R137 (FE admin decomposition): the half-period trend badge moved verbatim
// from pages/admin/dashboard.tsx — pure icon+text over the page-passed
// series (stays eager; no recharts dependency).

// Trend badge: compare first half vs second half of the period
export function TrendBadge({ data, dataKey }: { data: ChartDay[]; dataKey: keyof ChartDay }) {
  if (data.length < 4) return null;
  const half = Math.floor(data.length / 2);
  const first = data.slice(0, half).reduce((s, d) => s + Number(d[dataKey] ?? 0), 0);
  const second = data.slice(half).reduce((s, d) => s + Number(d[dataKey] ?? 0), 0);
  if (first === 0) return null;
  const pct = Math.round(((second - first) / first) * 100);
  const up = pct >= 0;
  return (
    <span
      /* R125-I2 (A6-B4): raw -400 hues collapse to 1.92:1 (emerald) /
         2.77:1 (red) on the shipped LIGHT admin theme — the --status-*
         token family (the StatusBadge ink, index.css:155-158/:319-324)
         is contrast-safe in BOTH themes (success 9.68 dark / 4.98
         light; error 6.73 / 5.23 — A6 §A-17 measured). */
      className={`inline-flex items-center gap-0.5 text-3xs font-bold ${
        up ? "text-status-success" : "text-status-error"
      }`}
    >
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {Math.abs(pct)}%
    </span>
  );
}
