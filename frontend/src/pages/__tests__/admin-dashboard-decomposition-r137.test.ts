/**
 * R137 (FE) — the admin/dashboard.tsx decomposition contract.
 *
 * The admin landing page was a 1,365-line single component — the KPI
 * tile grid, three recharts panels, the granularity/period chip
 * pickers, the urgent pending-topups banner, the quick-actions strip
 * and the recent-orders stream all inline in one function, beside the
 * module-level lazy recharts bridge and the pure aggregation / CSV /
 * axis-tick helpers. The r136 checkout.tsx precedent (1,665 → 9
 * extracts) applied here: orchestration (pages/admin/dashboard.tsx) +
 * seventeen verbatim extracts under components/admin/dashboard/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the chart-race last-wins, the
 * finance scope gates, the picker aria semantics) is already pinned by
 * dashboard-chart-race / dashboard-chart-scope-gate /
 * admin-layout-shell-a11y + the skeleton-primitives adoption floor;
 * this file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,365 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (or by its consumer extract — a dropped import = a section
 *      silently vanished);
 *   3. data-path ownership — the three queries (stats / recent
 *      orders / chart-data), the range-change handler, the refresh
 *      invalidations and BOTH CSV export actions stay IN the page: a
 *      stale closure in a presentational extract could export the
 *      wrong period's series;
 *   4. state ownership — the chartDays/granularity atoms, the
 *      chartData/displayData memos and the canSeeMoney scope gate
 *      stay centralized in the page; the extracts take values +
 *      callbacks only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/dashboard.tsx");

describe("R137 (FE) — admin/dashboard.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/dashboard.tsx stays under the 1,000-line ceiling (was 1,365 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/dashboard/chart-csv",
      "@/components/admin/dashboard/chart-data",
      "@/components/admin/dashboard/chart-errors",
      "@/components/admin/dashboard/ChartErrorBanner",
      "@/components/admin/dashboard/ChartsEmptyState",
      "@/components/admin/dashboard/DiscountsCouponsChart",
      "@/components/admin/dashboard/MetricCard",
      "@/components/admin/dashboard/NewUsersChart",
      "@/components/admin/dashboard/QuickActionsStrip",
      "@/components/admin/dashboard/RecentOrdersStream",
      "@/components/admin/dashboard/RevenueOrdersChart",
      "@/components/admin/dashboard/UrgentTopupsBanner",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
    // The nested extracts render inside their consumer, not the page —
    // their deletion guards read the consumer's import instead.
    const nested: Array<[string, string]> = [
      ["src/components/admin/dashboard/ChartsEmptyState.tsx", "./ChartPickers"],
      ["src/components/admin/dashboard/RevenueOrdersChart.tsx", "./ChartPickers"],
      ["src/components/admin/dashboard/RevenueOrdersChart.tsx", "./ChartTooltip"],
      ["src/components/admin/dashboard/DiscountsCouponsChart.tsx", "./ChartTooltip"],
      ["src/components/admin/dashboard/NewUsersChart.tsx", "./ChartTooltip"],
      ["src/components/admin/dashboard/Sparkline.tsx", "./ChartsLoader"],
      ["src/components/admin/dashboard/RevenueOrdersChart.tsx", "./ChartsLoader"],
      ["src/components/admin/dashboard/DiscountsCouponsChart.tsx", "./ChartsLoader"],
      ["src/components/admin/dashboard/NewUsersChart.tsx", "./ChartsLoader"],
      ["src/components/admin/dashboard/MetricCard.tsx", "./Sparkline"],
      ["src/components/admin/dashboard/MetricCard.tsx", "./TrendBadge"],
    ];
    for (const [file, specifier] of nested) {
      expect(read(file), `${file} → ${specifier}`).toContain(`from "${specifier}"`);
    }
    // The chart-CSV implementation lives in the pure module the page
    // imports by name (never duplicated inline) — the r136
    // checkout-unit-key idiom.
    expect(read("src/components/admin/dashboard/chart-csv.ts")).toContain(
      "export function exportChartCSV(",
    );
    // And the lazy recharts bridge stays the ONE runtime "recharts"
    // reference (the R125-I2 vendor-charts boundary the chart-race
    // mock intercepts).
    expect(read("src/components/admin/dashboard/ChartsLoader.tsx")).toContain('import("recharts")');
  });

  it("the queries + range changes + export actions stay IN the page (the extracts render; the page owns the fetches)", () => {
    // All three data probes — stats (finance-gated), the recent-orders
    // stream, the chart-data series — ride the generated client from
    // the page; an extract must never grow its own query.
    expect(page).toContain("useGetAdminStats({");
    expect(page).toContain("useListAdminOrders(");
    expect(page).toContain("useGetAdminChartData(");
    expect(page).toContain("queryKey: getGetAdminChartDataQueryKey({ days: chartDays })");
    // The auth gate + the refresh invalidations (the single-fire pins
    // the dashboard-chart-race suite asserts at the fetch level).
    expect(page).toContain('navigate("/admin/login");');
    expect(page).toContain("const handleRefresh = () => {");
    expect(page).toContain(
      "queryClient.invalidateQueries({ queryKey: getGetAdminChartDataQueryKey() });",
    );
    // The range change (chartDays swap + granularity auto-set) — the
    // pickers only call back into it.
    expect(page).toContain("const onChangeDays = (days: number) => {");
    // BOTH export actions: the chart CSV call site (implementation in
    // the pure chart-csv module above) and the users CSV handler
    // (verbatim body, page-owned — the panel takes it as a callback).
    expect(page).toContain("exportChartCSV(displayData, chartDays)");
    expect(page).toContain("const handleExportUsersChart = () => {");
    expect(page).toContain("users_${chartDays}d.csv");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the KPI tiles, the three chart panels, the pickers
    // and the CSV exports all key off the same atoms — canSeeMoney
    // gates five of them (stats query, urgent banner, money tiles,
    // both money charts + their export).
    for (const atom of [
      "const [chartDays, setChartDays] = useState(7);",
      'const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("daily");',
      "const chart = useChartColors();",
      "const headers = useAdminHeaders();",
      'const canSeeMoney = hasAdminPermission("finance");',
      "const chartData = useMemo(() => chartQuery.data ?? [], [chartQuery.data]);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The memos + the mount guard stay with them (the displayData
    // identity stability is the R125-I2 A5-F7 recharts guard; the
    // chartData fallback memo feeds it).
    expect(page).toContain("const displayData = useMemo(");
    expect(page).toContain("if (!adminToken) return null;");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved dashboard markup rides along verbatim (the chart-race/scope-gate pins follow the surface)", () => {
    // The urgent banner's plural-routed counter + CTA moved to
    // UrgentTopupsBanner.tsx, the KPI tile's staggered card frame to
    // MetricCard.tsx, the stream's empty/error states to
    // RecentOrdersStream.tsx — the render suites read the page ∪
    // extracts union; these spot-pins keep the verbatim shapes at
    // their new address so those pins stay meaningful.
    const banner = read("src/components/admin/dashboard/UrgentTopupsBanner.tsx");
    expect(banner).toContain("طلبان شحن بانتظار المراجعة");
    expect(banner).toContain("مراجعة الكل");
    const tile = read("src/components/admin/dashboard/MetricCard.tsx");
    expect(tile).toContain("stagger-${index + 1}");
    expect(tile).toContain('aria-label="مخزون منخفض"');
    const stream = read("src/components/admin/dashboard/RecentOrdersStream.tsx");
    expect(stream).toContain("لا توجد طلبات بعد");
    expect(stream).toContain("text-primary-text");
    // The R136 skeleton-primitives adoption floor pins the PAGE's
    // primitive import — the statsLoading SkeletonText branch stays in
    // the page on purpose (MetricCard renders only loaded tiles).
    expect(page).toMatch(/from "@\/components\/ui\/Skeleton"/);
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a panel needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the admin landing page is how the R125-I2
    // chart-race class of desync bugs happens.
    const files = [
      "ChartErrorBanner",
      "ChartPickers",
      "ChartTooltip",
      "ChartsEmptyState",
      "ChartsLoader",
      "DiscountsCouponsChart",
      "MetricCard",
      "NewUsersChart",
      "QuickActionsStrip",
      "RecentOrdersStream",
      "RevenueOrdersChart",
      "Sparkline",
      "TrendBadge",
      "UrgentTopupsBanner",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/dashboard/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the pure helper modules are React-free (chart data/CSV/error logic — importable by any lane)", () => {
    const files = ["chart-csv", "chart-data", "chart-errors"];
    for (const name of files) {
      const src = read(`src/components/admin/dashboard/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
    // The aggregation + tick helpers every chart extract shares, and
    // the generated-client alias they key off.
    const chartData = read("src/components/admin/dashboard/chart-data.ts");
    expect(chartData).toContain("export function aggregateData(");
    expect(chartData).toContain("export const fmtChartTick = ");
    expect(chartData).toContain("export type ChartDay = AdminChartDay;");
    // The 401 duck-type the page's chartError gate reads (the global
    // session handler owns that failure mode).
    expect(read("src/components/admin/dashboard/chart-errors.ts")).toContain(
      "export function isSessionExpiredError(",
    );
    // The R120-B5 CSV decimal bound — no grouping, no " د.ل" suffix
    // (a grouped "1,234.50" would split into two columns).
    expect(read("src/components/admin/dashboard/chart-csv.ts")).toContain("useGrouping: false,");
  });
});
