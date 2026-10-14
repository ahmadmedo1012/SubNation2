import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useChartColors } from "@/lib/chart-theme";
import { useAuth } from "@/lib/auth";
import { formatCount, formatCurrency } from "@/lib/utils";
// R137 (FE admin decomposition): the page's self-contained presentational
// sections and pure chart helpers moved to @/components/admin/dashboard/*
// (verbatim moves — every query, every range/export action, every
// cross-section atom and the displayData aggregation stay HERE; the
// extracts render the byte-identical DOM they rendered inline yesterday).
// Import surface:
//   • chart-data / chart-csv / chart-errors — the page's pure modules
//     (the ChartDay alias + the weekly/monthly bucket aggregation + the
//     axis tick formatter, the CSV export implementation, the 401
//     classifier that keeps the chart banner quiet on session expiry)
//   • UrgentTopupsBanner / MetricCard / QuickActionsStrip — the
//     above-the-fold status sections (the finance scope gate, the
//     METRIC_CARDS defs and the statsLoading SkeletonText branch stay
//     here — the skeleton-primitives adoption floor pins the page's
//     primitive import)
//   • ChartsEmptyState / RevenueOrdersChart / DiscountsCouponsChart /
//     NewUsersChart — the charts column (ChartPickers + ChartTooltip +
//     Sparkline/TrendBadge + the lazy recharts ChartsLoader bridge ride
//     along inside their consumers)
//   • ChartErrorBanner / RecentOrdersStream — the honest error + retry
//     states (the refetch mutations stay here)
import { exportChartCSV } from "@/components/admin/dashboard/chart-csv";
import { aggregateData, type ChartDay } from "@/components/admin/dashboard/chart-data";
import { isSessionExpiredError } from "@/components/admin/dashboard/chart-errors";
import { ChartErrorBanner } from "@/components/admin/dashboard/ChartErrorBanner";
import { ChartsEmptyState } from "@/components/admin/dashboard/ChartsEmptyState";
import { DiscountsCouponsChart } from "@/components/admin/dashboard/DiscountsCouponsChart";
import { MetricCard, type MetricCardDef } from "@/components/admin/dashboard/MetricCard";
import { NewUsersChart } from "@/components/admin/dashboard/NewUsersChart";
import { QuickActionsStrip } from "@/components/admin/dashboard/QuickActionsStrip";
import { RecentOrdersStream } from "@/components/admin/dashboard/RecentOrdersStream";
import { RevenueOrdersChart } from "@/components/admin/dashboard/RevenueOrdersChart";
import { UrgentTopupsBanner } from "@/components/admin/dashboard/UrgentTopupsBanner";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
// R127-L1 (B1 §3.1): the chart-data series rides the generated client
// from the batch-1 spec exposure — useGetAdminChartData (days in the
// queryKey). The R125-I2 abort-guard/stale-drop/fake-idle-guard state
// machine is now TanStack-native: a chip flip swaps queries and the
// stale response can only land in the OLD key's cache; customFetch owns
// the ok-guard + the global 401 observer (isSessionExpiredError below
// keeps the banner quiet on it).
import {
  getGetAdminChartDataQueryKey,
  getGetAdminStatsQueryKey,
  getListAdminOrdersQueryKey,
  useGetAdminChartData,
  useGetAdminStats,
  useListAdminOrders,
} from "@workspace/api-client-react";
import { BarChart2, Clock, Package, TrendingUp, Users, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

export default function AdminDashboardPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  // R115-A6 #7: every series/axis/grid color rides the theme tokens
  // (see lib/chart-theme.ts) — recharts no longer hardcodes hexes.
  const chart = useChartColors();
  const [chartDays, setChartDays] = useState(7);
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("daily");

  const headers = useAdminHeaders();

  // R122 (A2-P2): the stats + chart-data endpoints are requireAdmin-only
  // (no scope), but the money they carry (today/total revenue, aggregate
  // wallet balance, the revenue series + CSV export) is finance-class
  // data the panel elsewhere scope-gates (wallet edits, refunds, coupons
  // nav). The dashboard is the one nav item with no scope, so the UI is
  // the only honest gate: non-finance operators get the non-money tiles
  // (users / stock / topups queue count stays visible via the finance
  // branches below) — same hasAdminPermission idiom as the nav filter
  // and users.tsx canEditMoney.
  const canSeeMoney = hasAdminPermission("finance");

  const { data: stats, isLoading: statsLoading } = useGetAdminStats({
    query: {
      queryKey: getGetAdminStatsQueryKey(),
      // R126 (R1-P3): /api/admin/stats is finance-gated server-side
      // since this round — a scoped support/admin-session polling it
      // every 5 min is a guaranteed 403 zombie. The scope-honest gate
      // mirrors the chart query's `enabled` arm below (the
      // non-finance dashboard renders only its scope-safe tiles).
      enabled: !!adminToken && canSeeMoney,
      // Round-4 (perf P1-3): the admin-room socket listener invalidates
      // stats/orders on every `admin-stats-update` push (topup approve/
      // reject, order bulk updates) — this 5-min interval is only a
      // socket-dropout fallback (was 30 s).
      refetchInterval: 300_000,
      refetchIntervalInBackground: false,
    },
    request: { headers },
  });

  // R122 (A2-P1): `isError`/`error` were never destructured — on a 403
  // (support/finance-only admin without the orders scope) or a 5xx
  // outage, `data` stayed undefined, the `= []` default kicked in and
  // the stream rendered the false «لا توجد طلبات بعد» empty state while
  // the same screen's stats showed real order counts (the exact
  // false-empty class killed on every list page; orders.tsx pins its own
  // copy in orders-false-empty-pagination.test.tsx).
  const {
    data: recentOrders = [],
    isLoading: recentOrdersLoading,
    isError: recentOrdersError,
    error: recentOrdersErrorDetail,
    refetch: refetchRecentOrders,
  } = useListAdminOrders(
    { limit: 8 },
    {
      query: {
        queryKey: getListAdminOrdersQueryKey({ limit: 8 }),
        enabled: !!adminToken,
        // Socket-driven refresh (see stats above) — fallback only (was 30 s).
        refetchInterval: 300_000,
        refetchIntervalInBackground: false,
      },
      request: { headers },
    },
  );

  // R127-L1 (B1 §3.1 — the R126-L8b deferral lifted): the chart series
  // rides useGetAdminChartData, mirroring the stats sibling above.
  // Guard-by-guard migration from the retired raw fetch:
  //   • `!adminToken` + the canSeeMoney zero-bytes scope gate (R123 E3
  //     item 5) → `enabled` — a disabled query sends NO bytes at all
  //     (strictly better than fetch-then-error for a scoped admin).
  //   • predecessor abort + stale-drop + fake-idle guard (R125-I2)
  //     → structural: `days` sits in the queryKey, a chip flip swaps
  //     queries and RQ aborts the old observer's signal; a late
  //     response can only land in the OLD key's cache; isFetching
  //     belongs to the ACTIVE key only.
  //   • 401 quiet-return → customFetch fires the registered global
  //     handler then throws ApiError; chartError suppresses it locally.
  //   • unmount abort → structural (observer removal cancels).
  const chartQuery = useGetAdminChartData(
    { days: chartDays },
    {
      query: {
        queryKey: getGetAdminChartDataQueryKey({ days: chartDays }),
        enabled: !!adminToken && canSeeMoney,
        // F-4 (B1): never serve data staler than the backend's own
        // window — stats.ts wraps chart-data in a 30 s server cache
        // (cacheWrap), so a remount/flip-back within 30 s serving the
        // RQ cache is EXACTLY as fresh as a re-GET would be.
        staleTime: 30_000,
        // R125-I2 (A5-F8) parity: a period flip keeps the previous
        // series mounted + dimmed while the new one loads (the
        // first-load skeleton still gates on chartData.length === 0).
        placeholderData: keepPreviousData,
        // Current semantics preserved: a 5xx banners immediately, no
        // retry — the App.tsx default (1 retry on 5xx) would add one
        // hidden request behind the banner.
        retry: false,
      },
      request: { headers },
    },
  );
  // useMemo keeps the fallback identity STABLE across renders (the raw
  // `?? []` re-minted a fresh array every render while data was still
  // undefined, tripping the displayData memo below — the R125-I2 A5-F7
  // recharts-reconciliation guard this flip must preserve).
  const chartData = useMemo(() => chartQuery.data ?? [], [chartQuery.data]);
  // Covers initial load AND refetch (the dim) — the old setChartLoading
  // pairs, minus the fake-idle hazard the abort guard used to patch.
  const chartLoading = chartQuery.isFetching;
  // 93-C6 / F-07 (A5 DA-1) preserved: the fetch failure surfaces as the
  // explicit error banner with retry (never a silently-vanished
  // section) — except a 401, which the global handler owns.
  const chartError =
    chartQuery.isError && !isSessionExpiredError(chartQuery.error)
      ? "تعذّر تحميل بيانات الرسوم البيانية — تحقّق من الشبكة ثم أعد المحاولة"
      : null;

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R125-I2 (A5-F7): memoized — aggregateData calls toLocaleDateString
  // per bucket (up to 90) and minted a fresh array identity on EVERY
  // dashboard re-render (the 300 s stats poll, any state flip), forcing
  // a full recharts reconciliation of all three charts + sparklines even
  // when chartData was unchanged. Stable per (chartData, granularity).
  // (Hooks must stay ABOVE the !adminToken early return — rules-of-hooks.)
  const displayData = useMemo(
    () => aggregateData(chartData, granularity),
    [chartData, granularity],
  );

  if (!adminToken) return null;

  // R125-I2 (A1-4): the manual refetch() is GONE — invalidateQueries on
  // the still-active query already refetches it, so each refresh click
  // fired TWO identical /admin/stats requests (the exact double-fire
  // class R124-A6 F11 killed on orders.tsx:856-865; the invalidate is
  // the single source of truth now).
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAdminOrdersQueryKey({ limit: 8 }) });
    // R127-L1: the base key prefix-matches every days-variant and
    // refetches only the ACTIVE one (single fire — the old direct
    // fetchChart call is the invalidate's replacement).
    queryClient.invalidateQueries({ queryKey: getGetAdminChartDataQueryKey() });
  };

  // R122 (A2-P2): the layout merges this page-passed fallback with its
  // own finance-gated server count (layout.tsx canSeeFinanceBadge) — a
  // non-finance operator would otherwise still see the pending-topups
  // total on the (finance-scoped, hidden) nav item's mobile hamburger
  // badge. Scope the page fallback to match.
  const badges = {
    pendingTopups: canSeeMoney ? (stats?.pending_topups ?? 0) : 0,
    openTickets: 0,
  };

  // R115 (A9 P2): an EMPTY chart response (no error, not loading) used
  // to make the whole charts column vanish silently — an honest empty
  // block renders instead. The column also hides for a failed load
  // with no stale data (the error banner above is the honest state
  // then). R123 (E3 item 5) → R127-L1: a non-finance operator's query
  // never fires at all (the `enabled` scope gate) — the column hides
  // entirely instead of rendering the misleading «لا توجد بيانات بعد»
  // empty block for what is really a scope gate.
  const chartEmpty = !chartLoading && !chartError && chartData.length === 0;
  const showChartsColumn = canSeeMoney && (chartData.length > 0 || chartLoading || chartEmpty);
  // R115 (A5 P3-7, skipped by design): loyalty/referral liability
  // widgets need Σ points / outstanding referral rewards — the stats
  // endpoint does not expose them and adding one is out of scope for
  // this round (no backend changes); summing the users list's first
  // page would present a partial sample as a total (the 94-C2
  // lesson). Deliberately NOT rendered.

  // Auto-set sensible default granularity based on period
  const onChangeDays = (days: number) => {
    setChartDays(days);
    if (days <= 14) setGranularity("daily");
    else if (days <= 30) setGranularity("daily");
    else setGranularity("weekly");
  };

  // R120-B5 (A2-F15): the users card used to repeat the WALLET card's
  // number (total_wallet_balance) as its sub-line — the same figure twice
  // within one glance. The wallet card stays the number's single home;
  // the users card now surfaces NEW USERS TODAY, already loaded in the
  // chart data (computeChartData's LAST bucket is anchored on the
  // Tripoli "today" — backend routes/admin/stats.ts). Null while the
  // chart fetch is still in flight (the sub-line renders conditionally).
  const newUsersToday =
    chartData.length > 0 ? Number(chartData[chartData.length - 1]?.users ?? 0) : null;

  // R137 (admin decomposition): the new-users chart's CSV export — the
  // verbatim inline onClick body lifted out of the panel markup into a
  // page-owned handler (export actions stay in the page; the extract's
  // button takes it as the onExportUsers callback).
  const handleExportUsersChart = () => {
    const usersData = displayData.map((d) => [d.date, d.users]);
    const csv = [["التاريخ", "المستخدمون الجدد"], ...usersData].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users_${chartDays}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const METRIC_CARDS: MetricCardDef[] = stats
    ? [
        {
          label: "إيرادات اليوم",
          // R122 (A2-P2): finance-gated tile — see canSeeMoney above.
          finance: true,
          value: formatCurrency(stats.today_revenue ?? 0),
          sub: `${stats.today_orders ?? 0} طلب اليوم`,
          icon: TrendingUp,
          color: "text-primary",
          bg: "bg-primary/10",
          border: "border-primary/20",
          link: "/admin/orders",
          highlight: true,
          sparkKey: "revenue" as keyof ChartDay,
          sparkColor: chart.primary,
        },
        {
          // R124-I5 (A6 F2): «معلقة» — the same statusLabel drift as the
          // topups tabs; the tile now reads exactly like the queue it
          // deep-links to (statusLabel("pending")).
          label: "طلبات الشحن قيد الانتظار",
          value: stats.pending_topups,
          sub: "تحتاج مراجعة يدوية",
          icon: Clock,
          /* R125-I2 (A6-B4): the raw yellow-400 ink/tints collapse to
             ~1.4-1.5:1 on the shipped light admin theme — the
             --status-warning token pair is contrast-safe in both. */
          color: "text-status-warning",
          bg: "bg-status-warning/10",
          border: "border-status-warning/20",
          link: "/admin/topups",
          urgent: (stats.pending_topups ?? 0) > 0,
          sparkKey: null,
          sparkColor: "",
        },
        {
          label: "إجمالي الإيرادات",
          // R122 (A2-P2): finance-gated tile — see canSeeMoney above.
          finance: true,
          value: formatCurrency(stats.total_revenue ?? 0),
          sub: `${stats.total_orders ?? 0} طلب إجمالاً`,
          icon: BarChart2,
          color: "text-status-success",
          bg: "bg-status-success/10",
          border: "border-status-success/20",
          link: "/admin/orders",
          sparkKey: "revenue" as keyof ChartDay,
          sparkColor: chart.success,
        },
        {
          label: "المستخدمون",
          value: stats.total_users,
          /* R120-B5 (A2-F15): new-users-today replaces the duplicated
             wallet-balance sub-line (see newUsersToday above) — a
             distinct, non-overlapping signal for the same tile. */
          sub:
            newUsersToday == null
              ? undefined
              : `${formatCount(newUsersToday, {
                  one: "مستخدم جديد",
                  two: "مستخدمان جديدان",
                  few: "مستخدمين جدد",
                  many: "مستخدماً جديداً",
                  other: "مستخدم جديد",
                })} اليوم`,
          icon: Users,
          color: "text-status-info",
          bg: "bg-status-info/10",
          border: "border-status-info/20",
          link: "/admin/users",
          sparkKey: "users" as keyof ChartDay,
          sparkColor: chart.info,
        },
        {
          label: "المخزون المتاح",
          value: stats.available_stock,
          sub: "وحدة في المخزون",
          icon: Package,
          color: "text-status-low-stock",
          bg: "bg-status-low-stock/10",
          border: "border-status-low-stock/20",
          link: "/admin/products",
          lowStock: (stats.available_stock ?? 0) < 5,
          sparkKey: null,
          sparkColor: "",
        },
        {
          label: "رصيد المحافظ",
          // R122 (A2-P2): finance-gated tile — see canSeeMoney above.
          finance: true,
          value: formatCurrency(stats.total_wallet_balance ?? 0),
          sub: "إجمالي أرصدة المستخدمين",
          icon: Wallet,
          color: "text-status-info",
          bg: "bg-status-info/10",
          border: "border-status-info/20",
          link: "/admin/users",
          sparkKey: null,
          sparkColor: "",
        },
      ]
        // R122 (A2-P2): hide the money tiles for non-finance operators —
        // the non-money tiles (pending-topups count, users, stock) stay
        // for every scope.
        .filter((c) => canSeeMoney || !(c as { finance?: boolean }).finance)
    : [];

  return (
    <AdminLayout onRefresh={handleRefresh} badges={badges}>
      <div className="space-y-6">
        {/* R139 (precision): the dashboard's ONE sanctioned atmosphere
            moment — .ambient-wash over the above-the-fold zone (the
            urgent banner + the KPI grid + the quick-actions strip:
            everything above the charts/orders row). The r139 brief pins
            exactly one wash per admin SESSION: every other admin page
            stays flat, and the charts column below stays quieter on
            purpose (the KPI grid is the page's prominent surface — it
            also rides the two-layer calm elevation in MetricCard — so
            the wash + elevation pair reads as ONE depth statement, the
            GuestHero/AuthedHero register). Static, GPU-free,
            pointer-events-none; absolute (out of flow) so the space-y
            rhythm is untouched. */}
        <div className="relative space-y-6">
          <div className="absolute inset-0 ambient-wash pointer-events-none" />
          {/* Urgent alert */}
          {/* R122 (A2-P2): finance-gated — the topups page is finance-scoped
              (nav + backend), and the old banner deep-linked EVERY admin
              into an honest-but-dead 403 card. */}
          {canSeeMoney && (stats?.pending_topups ?? 0) > 0 && (
            <UrgentTopupsBanner pendingTopups={stats!.pending_topups} />
          )}

          {/* KPI cards */}
          {/* R147 (2-c D1): the R126 `enabled` arm means a non-finance
              operator's stats observer never fires at all — stats stays
              undefined + statsLoading settles false, so the grid below
              renders ZERO tiles (EVERY tile rides the finance-gated
              endpoint; the R122 non-money filter has nothing left to
              keep) and the fold was an unexplained void above the
              recent-orders stream. The honest state is the
              AdminScopeGate banner idiom (same sentence shape + warning
              token pair): the tiles are hidden for the account's scope,
              not missing. */}
          {!canSeeMoney && !stats && !statsLoading ? (
            <p className="text-sm text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2">
              بطاقات المؤشرات تتطلب صلاحية المعاملات المالية — تواصل مع مسؤول النظام
            </p>
          ) : statsLoading ? (
            /* R136 (UX-1): SkeletonText — the 6-card KPI grid becomes one
               announcing wrapper with the grid classes + card geometry
               (bg-card border rounded-2xl h-28) verbatim.
               R139 (precision): the skeleton tiles mirror the loaded
               MetricCard's NEW resting chrome — border-border/60 + the
               two-layer calm elevation — so the loading→loaded swap never
               changes the frame, only fills it in. */
            <SkeletonText
              count={6}
              wrapperClassName="grid grid-cols-2 lg:grid-cols-3 gap-3"
              className="bg-card border border-border/60 rounded-2xl h-28 shadow-calm"
              lastShorter={false}
            />
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {METRIC_CARDS.map((card, i) => (
                <MetricCard key={card.label} card={card} index={i} chartData={chartData} />
              ))}
            </div>
          )}

          {/* Quick actions strip */}
          {stats && !statsLoading && (
            <QuickActionsStrip canSeeMoney={canSeeMoney} pendingTopups={stats.pending_topups} />
          )}
        </div>

        {/* Charts + Recent Orders row */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          {/* Charts — 93-C6 / F-07 (A5 DA-1): an explicit error banner
              with retry replaces the silent vanishing of the section
              when the chart fetch fails. */}
          <ChartErrorBanner
            error={chartError}
            loading={chartLoading}
            onRetry={() => void chartQuery.refetch()}
          />
          {showChartsColumn &&
            (chartEmpty ? (
              /* R115 (A9 P2): the honest no-data-yet block — a brand-new
                 store's dashboard no longer loses its whole charts
                 column in silence. */
              <ChartsEmptyState
                granularity={granularity}
                onGranularityChange={setGranularity}
                chartDays={chartDays}
                onDaysChange={onChangeDays}
              />
            ) : (
              <div className="xl:col-span-3 space-y-5 float-in stagger-7">
                {/* Revenue + Orders chart + Discounts & Coupon Orders
                    chart — R122 (A2-P2): finance-gated. Both series carry
                    money (revenue, discount value) and the CSV export
                    rides the first panel's header; the non-finance
                    operator keeps the new-users chart below. */}
                {canSeeMoney && (
                  <>
                    <RevenueOrdersChart
                      chart={chart}
                      chartLoading={chartLoading}
                      chartData={chartData}
                      displayData={displayData}
                      granularity={granularity}
                      onGranularityChange={setGranularity}
                      chartDays={chartDays}
                      onDaysChange={onChangeDays}
                      onExport={() => exportChartCSV(displayData, chartDays)}
                    />
                    <DiscountsCouponsChart
                      chart={chart}
                      chartLoading={chartLoading}
                      chartData={chartData}
                      displayData={displayData}
                    />
                  </>
                )}

                <NewUsersChart
                  chart={chart}
                  chartLoading={chartLoading}
                  chartData={chartData}
                  displayData={displayData}
                  granularity={granularity}
                  chartDays={chartDays}
                  onExportUsers={handleExportUsersChart}
                />
              </div>
            ))}

          {/* Recent orders stream */}
          <RecentOrdersStream
            showChartsColumn={showChartsColumn}
            orders={recentOrders}
            loading={recentOrdersLoading}
            error={recentOrdersError}
            errorDetail={recentOrdersErrorDetail}
            onRetry={() => void refetchRecentOrders()}
          />
        </div>
      </div>
    </AdminLayout>
  );
}
