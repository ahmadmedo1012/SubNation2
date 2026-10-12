import type { AdminChartDay } from "@workspace/api-client-react";

// R137 (FE admin decomposition): the dashboard's chart-data helpers moved
// verbatim from pages/admin/dashboard.tsx — pure, React-free (the queries,
// the granularity/chartDays state atoms and the displayData memo stay
// centralized in the page; the chart extracts import the tick formatter).

// R127-L1: the hand-rolled ChartDay interface is the generated
// AdminChartDay (field-identical — the batch-1 contract row pins the
// shape); aliased so the aggregation/export helpers keep local names.
export type ChartDay = AdminChartDay;

// R124-I5 (A8 F4 / 96-F7 class): every chart date below pins the
// -u-nu-latn extension. Bare "ar-LY" relies on the engine shipping
// ar-LY locale data; engines lacking it (older Safari/WebView) fall
// back to root "ar" whose CLDR default numbering is Arabic-Indic
// (٠١٢…) — silently flipping the chart axis digits vs the Latin stat
// tiles on the same screen (lib/utils.ts:61-70 documents the pin;
// dashboard was the last bare-locale outlier). Kept local — the shared
// formatters' option sets differ from the chart keys.
const AR_CHART_DATE_LOCALE = "ar-LY-u-nu-latn";

/** Aggregate-bucket key (weekly/monthly granularity). */
const fmtChartKey = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  d.toLocaleDateString(AR_CHART_DATE_LOCALE, opts);

/** XAxis tick: daily buckets carry the raw backend ISO key
 *  ("2026-09-06") — format it (Round-3 8-e §1.4). One helper feeds all
 *  three charts (was a triplicated inline tickFormatter). */
export const fmtChartTick = (value: string) => {
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(AR_CHART_DATE_LOCALE, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
};

// Aggregate chart data into weekly or monthly buckets
export function aggregateData(data: ChartDay[], granularity: string): ChartDay[] {
  if (granularity === "daily" || data.length === 0) return data;

  const buckets: Record<string, ChartDay> = {};

  data.forEach((d) => {
    const date = new Date(d.date);
    let key: string;
    // Round-3 (8-e §1.4): locale tag "ar" (not "ar-LY") resolves to
    // Arabic-Indic digits on pre-CLDR-45 browsers — flipping the chart
    // axis numerals vs the Latin stat tiles on the same page depending
    // on the viewer's device. "ar-LY" is Latin-digit by CLDR policy,
    // matching every other date label in the app.
    if (granularity === "weekly") {
      const week = new Date(date);
      week.setDate(date.getDate() - date.getDay());
      key = fmtChartKey(week, { month: "short", day: "numeric" });
    } else {
      key = fmtChartKey(date, { year: "numeric", month: "short" });
    }

    if (!buckets[key])
      buckets[key] = { date: key, orders: 0, revenue: 0, users: 0, discounts: 0, coupon_orders: 0 };
    buckets[key].orders += Number(d.orders) || 0;
    buckets[key].revenue += Number(d.revenue) || 0;
    buckets[key].users += Number(d.users) || 0;
    buckets[key].discounts += Number(d.discounts) || 0;
    buckets[key].coupon_orders += Number(d.coupon_orders) || 0;
  });

  return Object.values(buckets);
}
