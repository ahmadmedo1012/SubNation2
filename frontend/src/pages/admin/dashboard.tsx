import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useChartColors } from "@/lib/chart-theme";
// R125-I2 (A5-F3): the recharts bridge is loaded through the SAME
// retry-wrapping lazy loader every route rides (App.tsx / layout.tsx
// idiom) — vendor-charts is a post-deploy-stale-chunk risk like any
// other, and lazyWithRetry's one-reload recovery covers it.
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
// R122 (A2-P1): the recent-orders error state surfaces the backend's
// Arabic envelope (403 permission body / 5xx) via the shared mapper.
import { getErrorMessage } from "@/lib/errors";
import { formatCount, formatCurrency, formatDate, statusLabel } from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminStatsQueryKey,
  getListAdminOrdersQueryKey,
  useGetAdminStats,
  useListAdminOrders,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowUpLeft,
  BarChart2,
  CheckCircle,
  Clock,
  Download,
  ListOrdered,
  Package,
  Plus,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  WifiOff,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { AdminLayout } from "./layout";

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

const ChartsLoader = lazyWithRetry(() =>
  import("recharts").then((rc) => ({
    default: function RechartsBridge({ children }: { children: (rc: RechartsNS) => ReactNode }) {
      return children(rc);
    },
  })),
);

/** Shared Suspense fallbacks: height-reserved shimmer blocks so the
 * lazy vendor-charts fetch never shifts layout (charts) and the KPI
 * sparkline rows keep their 32px slot. */
function ChartPanelFallback({ heightClass }: { heightClass: string }) {
  return <div className={`${heightClass} skeleton-shimmer rounded-lg`} />;
}

/** R125 (A6-B10 / A1-6 + the chart-race pins): the granularity/period
 * chip pickers, extracted so BOTH chart states render them — the
 * empty-state block previously offered no way to switch period, yet
 * “7d empty” does not mean “90d empty” (a store with last-month
 * orders showed the no-data-yet copy with no honest way to look
 * further back). Each cluster is a named role="group" whose chips
 * expose aria-pressed (the coupons.tsx/orders.tsx chip-bar idiom). */
function ChartPickers({
  granularity,
  onGranularityChange,
  chartDays,
  onDaysChange,
  onExport,
}: {
  granularity: "daily" | "weekly" | "monthly";
  onGranularityChange: (g: "daily" | "weekly" | "monthly") => void;
  chartDays: number;
  onDaysChange: (d: number) => void;
  onExport?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Granularity picker */}
      <div
        role="group"
        aria-label="دقة المخطط الزمني"
        className="flex items-center gap-0.5 bg-muted/40 border border-border/60 rounded-lg p-0.5"
      >
        {GRANULARITY_OPTIONS.map((g) => (
          <button
            key={g.value}
            onClick={() => onGranularityChange(g.value)}
            aria-pressed={granularity === g.value}
            className={`px-2 py-1 rounded text-3xs font-bold transition-all duration-150 ${
              granularity === g.value
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Period picker */}
      <div
        role="group"
        aria-label="الفترة الزمنية للمخطط"
        className="flex items-center gap-0.5 bg-muted/40 border border-border/60 rounded-lg p-0.5"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.days}
            onClick={() => onDaysChange(opt.days)}
            aria-pressed={chartDays === opt.days}
            className={`px-2.5 py-1 rounded text-2xs font-bold transition-all duration-150 ${
              chartDays === opt.days
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Export chart data (meaningful only with data on screen) */}
      {onExport && (
        <button
          onClick={onExport}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="تصدير بيانات المخطط CSV"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

interface ChartDay {
  date: string;
  orders: number;
  revenue: number;
  users: number;
  discounts: number;
  coupon_orders: number;
}

const CURRENCY_KEYS = new Set(["الإيرادات", "الخصومات"]);

/** R120-B5 (A5-F13): the money columns in the CSV export render in
 *  formatCurrency's underlying en-US 2-decimal shape — but WITHOUT the
 *  " د.ل" suffix (CSV cells stay numeric) and WITHOUT grouping: the
 *  rows join on ",", so a grouped "1,234.50" would split into two
 *  columns. Same digits as every money tile, CSV-parse-safe. */
const CSV_DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}

const ChartTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl text-xs min-w-[150px]">
      <p className="font-bold text-muted-foreground mb-2">{label}</p>
      {payload.map((p: { value: number; name: string; color: string }) => (
        <div key={p.name} className="flex items-center justify-between gap-4 mb-1 last:mb-0">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </div>
          <span className="font-bold tabular-nums">
            {CURRENCY_KEYS.has(p.name) ? formatCurrency(Number(p.value)) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// Round-3 (8-e §2): period chips hardcoded Arabic-Indic digits ("٧
// أيام") while the same screen shows Latin percentages, Latin money
// tiles and Latin chart counts — three numeral regimes on one dashboard.
// Latin everywhere (the site-wide numeral policy); the Arabic words stay.
const PERIOD_OPTIONS = [
  { label: "7 أيام", days: 7 },
  { label: "14 يوماً", days: 14 },
  { label: "شهر", days: 30 },
  { label: "3 أشهر", days: 90 },
];

const GRANULARITY_OPTIONS = [
  { label: "يومي", value: "daily" },
  { label: "أسبوعي", value: "weekly" },
  { label: "شهري", value: "monthly" },
] as const;

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
const fmtChartTick = (value: string) => {
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
function aggregateData(data: ChartDay[], granularity: string): ChartDay[] {
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

// Mini sparkline for KPI trend — uses last N days of chart data.
// R125-I2 (A5-F3): rides the lazy recharts bridge (see ChartsLoader)
// with a height-reserved fallback — the KPI tiles paint before
// vendor-charts lands and the 32px slot never shifts.
function Sparkline({
  data,
  dataKey,
  color,
}: {
  data: ChartDay[];
  dataKey: keyof ChartDay;
  color: string;
}) {
  if (data.length < 2) return null;
  return (
    <Suspense fallback={<ChartPanelFallback heightClass="h-8" />}>
      <ChartsLoader>
        {(rc) => (
          <rc.ResponsiveContainer width="100%" height={32}>
            <rc.LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
              <rc.Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={1.5}
                dot={false}
              />
            </rc.LineChart>
          </rc.ResponsiveContainer>
        )}
      </ChartsLoader>
    </Suspense>
  );
}

// Trend badge: compare first half vs second half of the period
function TrendBadge({ data, dataKey }: { data: ChartDay[]; dataKey: keyof ChartDay }) {
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

function exportChartCSV(data: ChartDay[], days: number) {
  const headers = [
    "التاريخ",
    "الطلبات",
    "الإيرادات",
    "الخصومات",
    "طلبات بكوبون",
    "المستخدمون الجدد",
  ];
  const rows = data.map((d) => [
    d.date,
    d.orders,
    CSV_DECIMAL_FORMATTER.format(d.revenue ?? 0),
    CSV_DECIMAL_FORMATTER.format((d.discounts ?? 0) || 0),
    d.coupon_orders || 0,
    d.users,
  ]);
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chart_${days}d_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminDashboardPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  // R115-A6 #7: every series/axis/grid color rides the theme tokens
  // (see lib/chart-theme.ts) — recharts no longer hardcodes hexes.
  const chart = useChartColors();
  const [chartData, setChartData] = useState<ChartDay[]>([]);
  const [chartDays, setChartDays] = useState(7);
  const [chartLoading, setChartLoading] = useState(false);
  // 93-C6 / F-07 (A5 DA-1): the chart fetch failure was swallowed
  // (`.catch(() => {})`) — the whole charts section silently vanished
  // with zero signal while the page around it looked healthy.
  const [chartError, setChartError] = useState<string | null>(null);
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
      // mirrors chart-data's fetchChart early-return above (the
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

  // R125-I2 (A5-F1 / A1-3): the chart fetch race — the GlobalSearch
  // recipe (layout.tsx:94-C2 A2 P2-3). The period chips fire a new
  // fetch per flip; two rapid flips (7d → 90d) previously left two
  // un-ordered fetches in flight, and a slow OLD response landing after
  // the new one silently fed the KPI Sparklines / TrendBadge /
  // new-users-today tile the wrong period's series (A1's deepened blast
  // radius) while its .finally cleared chartLoading early (fake-idle
  // skeleton gap). Every call now aborts the previous controller and
  // every state write (incl. the finally) is guarded — last call wins.
  const chartAbortRef = useRef<AbortController | null>(null);

  const fetchChart = useCallback(
    (days = chartDays) => {
      if (!adminToken) return;
      // R123 (E3 item 5): the chart-data payload carries the revenue +
      // discount series in the SAME response as the users series (one
      // computeChartData over orders+users, backend routes/admin/stats.ts)
      // — canSeeMoney previously gated only the RENDERING/export, so a
      // non-finance operator's network tab received the full daily money
      // series on every dashboard visit. The fetch now gates on the scope:
      // no revenue/discount bytes reach a non-finance admin at all.
      // RESIDUAL (documented): the new-users chart rides the same payload,
      // so it goes dark for non-finance operators too — restoring it needs
      // a backend split (a ?series=users param or a users-only endpoint on
      // stats.ts), which is outside this round's admin-frontend file
      // ownership. The users TILE (total_users) keeps loading for everyone
      // via the stats query below.
      if (!canSeeMoney) {
        setChartData([]);
        setChartError(null);
        return;
      }
      // Abort the still-in-flight predecessor — its response (however it
      // resolves) is stale for the chips the operator now sees.
      chartAbortRef.current?.abort();
      const controller = new AbortController();
      chartAbortRef.current = controller;
      setChartLoading(true);
      const url = `/api/admin/chart-data?days=${days}`;
      fetch(url, { headers, signal: controller.signal })
        .then(async (r) => {
          // 93-C6 / F-07 (A5 S-3): expired session → global handler (toast
          // + redirect); not a chart error banner.
          if (isAdminUnauthorized(r, url)) return null;
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as unknown;
        })
        .then((d) => {
          if (controller.signal.aborted) return; // stale — last call wins
          if (d === null) return; // session-expiry path — redirect in flight
          setChartData(Array.isArray(d) ? d : []);
          setChartError(null);
        })
        .catch(() => {
          if (controller.signal.aborted) return; // the abort is not a failure
          // 93-C6 / F-07 (A5 DA-1): surface the failure with a retry
          // instead of silently dropping the section.
          setChartError("تعذّر تحميل بيانات الرسوم البيانية — تحقّق من الشبكة ثم أعد المحاولة");
        })
        .finally(() => {
          // The aborted (older) fetch must not fake-idle the newer one.
          if (!controller.signal.aborted) setChartLoading(false);
        });
    },
    [adminToken, canSeeMoney, chartDays, headers],
  );

  useEffect(() => {
    if (adminToken) fetchChart(chartDays);
  }, [adminToken, chartDays, fetchChart]);
  // Unmount (or admin-token drop): the in-flight chart request dies with
  // the page — its setState writes would land on an unmounted component.
  useEffect(() => () => chartAbortRef.current?.abort(), []);
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
    fetchChart(chartDays);
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
  // then). R123 (E3 item 5): a non-finance operator never fetches the
  // chart payload (see fetchChart) — the column hides entirely instead
  // of rendering the misleading «لا توجد بيانات بعد» empty block for
  // what is really a scope gate.
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

  const METRIC_CARDS = stats
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
          color: "text-emerald-400",
          bg: "bg-emerald-400/10",
          border: "border-emerald-400/20",
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
          color: "text-blue-400",
          bg: "bg-blue-400/10",
          border: "border-blue-400/20",
          link: "/admin/users",
          sparkKey: "users" as keyof ChartDay,
          sparkColor: chart.info,
        },
        {
          label: "المخزون المتاح",
          value: stats.available_stock,
          sub: "وحدة في المخزون",
          icon: Package,
          color: "text-orange-400",
          bg: "bg-orange-400/10",
          border: "border-orange-400/20",
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
          color: "text-cyan-400",
          bg: "bg-cyan-400/10",
          border: "border-cyan-400/20",
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
        {/* Urgent alert */}
        {/* R122 (A2-P2): finance-gated — the topups page is finance-scoped
            (nav + backend), and the old banner deep-linked EVERY admin
            into an honest-but-dead 403 card. */}
        {canSeeMoney && (stats?.pending_topups ?? 0) > 0 && (
          /* R125-I2 (A6-B4): every raw yellow-400 ink/tint on this banner
             collapses to ~1.4-1.5:1 on the shipped light admin theme —
             the --status-warning token family replaces them (the
             StatusBadge ink — both-theme safe). */
          <div className="flex items-center justify-between p-4 bg-status-warning/8 border border-status-warning/20 rounded-2xl gap-4 float-in">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-status-warning/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4.5 h-4.5 text-status-warning" />
              </div>
              <div>
                <p className="font-bold text-sm text-status-warning">
                  {stats!.pending_topups} طلب شحن بانتظار المراجعة
                </p>
                <p className="text-xs text-muted-foreground">يحتاج إلى موافقة يدوية فورية</p>
              </div>
            </div>
            <Link href="/admin/topups">
              <span className="shrink-0 text-xs font-bold text-status-warning border border-status-warning/30 px-3 py-1.5 rounded-xl hover:bg-status-warning/10 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" />
                مراجعة الكل
              </span>
            </Link>
          </div>
        )}

        {/* KPI cards */}
        {statsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-2xl h-28 skeleton-shimmer"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {METRIC_CARDS.map((card, i) => (
              <Link key={card.label} href={card.link}>
                <div
                  className={`float-in stagger-${i + 1} bg-card border rounded-2xl p-4 card-spring cursor-pointer group ${card.urgent ? "border-status-warning/25 hover:border-status-warning/40 hover:shadow-status-warning/10" : card.lowStock ? "border-orange-400/30 hover:border-orange-400/45 shadow-[0_0_0_1px_rgba(251,146,60,0.12)] hover:shadow-orange-400/15" : card.highlight ? "border-primary/20 hover:border-primary/35 hover:shadow-primary/10" : "border-border/60 hover:border-border"}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div
                      className={`relative w-8 h-8 ${card.bg} border ${card.border} rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110`}
                    >
                      <card.icon className={`w-4 h-4 ${card.color}`} />
                      {card.lowStock && (
                        <span
                          className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-orange-400 ring-2 ring-card badge-pulse"
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
                  <div className="font-bold text-xl leading-none mb-0.5 tabular-nums">
                    {card.value}
                  </div>
                  <div className="text-2xs text-muted-foreground">{card.label}</div>
                  {card.sub && (
                    <div className="text-3xs text-muted-foreground mt-0.5">{card.sub}</div>
                  )}
                  {/* Mini sparkline */}
                  {card.sparkKey && chartData.length >= 3 && (
                    <div className="mt-2 -mx-1 opacity-60">
                      <Sparkline data={chartData} dataKey={card.sparkKey} color={card.sparkColor} />
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Quick actions strip */}
        {stats && !statsLoading && (
          <div className="flex flex-wrap items-center gap-2">
            {/* 94-C2 (A2 P2-10): uppercase/tracking dropped — the label
                is Arabic (A11 §8). */}
            <span className="text-3xs text-muted-foreground font-semibold hidden sm:inline">
              إجراءات:
            </span>
            {/* R122 (A1): the four quick-action CTAs were
                <Link><button>…</button></Link> — invalid
                interactive-in-interactive nesting + a doubled tab stop
                (the A4-F1 class; the admin pages escaped that sweep).
                Same fix as the app standard: ONE interactive element —
                the file's own urgent-banner idiom (Link > styled span
                with cursor-pointer). R122 (A2-P2): the topups CTA is
                additionally finance-gated (see canSeeMoney above). */}
            {canSeeMoney && (stats.pending_topups ?? 0) > 0 && (
              <Link href="/admin/topups">
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-status-warning/8 hover:bg-status-warning/15 border border-status-warning/20 hover:border-status-warning/35 text-status-warning transition-all duration-150 font-semibold press-spring cursor-pointer">
                  <Clock className="w-3 h-3" /> موافقة الشحن ({stats.pending_topups})
                </span>
              </Link>
            )}
            <Link href="/admin/orders">
              <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150 cursor-pointer">
                <ListOrdered className="w-3 h-3" /> الطلبات
              </span>
            </Link>
            <Link href="/admin/products">
              <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150 cursor-pointer">
                <Plus className="w-3 h-3" /> منتج جديد
              </span>
            </Link>
            <Link href="/admin/users">
              <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150 cursor-pointer">
                <Users className="w-3 h-3" /> المستخدمون
              </span>
            </Link>
          </div>
        )}

        {/* Charts + Recent Orders row */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          {/* Charts — 93-C6 / F-07 (A5 DA-1): an explicit error banner
              with retry replaces the silent vanishing of the section
              when the chart fetch fails. */}
          {chartError && !chartLoading && (
            <div
              role="alert"
              className="xl:col-span-3 p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
            >
              <WifiOff className="w-4 h-4 shrink-0" />
              <span className="min-w-0">{chartError}</span>
              <button
                type="button"
                onClick={() => fetchChart(chartDays)}
                className="ms-auto flex items-center gap-1 text-xs underline underline-offset-2 hover:opacity-80"
              >
                <RefreshCw className="w-3 h-3" />
                إعادة المحاولة
              </button>
            </div>
          )}
          {showChartsColumn &&
            (chartEmpty ? (
              /* R115 (A9 P2): the honest no-data-yet block — a brand-new
                 store's dashboard no longer loses its whole charts
                 column in silence. */
              <div className="xl:col-span-3 bg-card border border-border/60 rounded-2xl p-5 float-in stagger-7">
                <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
                  <div>
                    <h2 className="font-bold text-sm">الرسوم البيانية</h2>
                    <p className="text-3xs text-muted-foreground mt-1">
                      بيانات الفترة الحالية فارغة — جرّب فترة أطول
                    </p>
                  </div>
                  {/* R125: the pickers render in the EMPTY state too —
                      “no data this week” must not strand the operator
                      with no way to look further back (ChartPickers). */}
                  <ChartPickers
                    granularity={granularity}
                    onGranularityChange={setGranularity}
                    chartDays={chartDays}
                    onDaysChange={onChangeDays}
                  />
                </div>
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-8">
                  <BarChart2 className="w-9 h-9 mb-3 opacity-20" />
                  <p className="text-sm font-bold text-foreground/80">لا توجد بيانات بعد</p>
                  <p className="text-xs mt-1 leading-relaxed">
                    ستظهر الرسوم البيانية مع أول طلب أو تسجيل مستخدم جديد
                  </p>
                </div>
              </div>
            ) : (
              <div className="xl:col-span-3 space-y-5 float-in stagger-7">
                {/* Revenue + Orders chart + Discounts & Coupon Orders
                    chart — R122 (A2-P2): finance-gated. Both series carry
                    money (revenue, discount value) and the CSV export
                    rides the first panel's header; the non-finance
                    operator keeps the new-users chart below. */}
                {canSeeMoney && (
                  <>
                    {/* Revenue + Orders chart */}
                    <div className="bg-card border border-border/60 rounded-2xl p-5">
                      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
                        <div>
                          <h2 className="font-bold text-sm">الإيرادات والطلبات</h2>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1 text-3xs text-muted-foreground">
                              <span className="w-3 h-0.5 bg-primary rounded inline-block" />
                              الإيرادات
                            </span>
                            <span className="flex items-center gap-1 text-3xs text-muted-foreground">
                              <span className="w-3 h-0.5 bg-emerald-400 rounded inline-block" />
                              الطلبات
                            </span>
                            <span className="flex items-center gap-1 text-3xs text-muted-foreground">
                              <span className="w-3 h-px border-t-2 border-amber-400 border-dashed inline-block" />
                              الخصومات
                            </span>
                          </div>
                        </div>
                        <ChartPickers
                          granularity={granularity}
                          onGranularityChange={setGranularity}
                          chartDays={chartDays}
                          onDaysChange={onChangeDays}
                          onExport={() => exportChartCSV(displayData, chartDays)}
                        />
                      </div>
                      {/* R125-I2 (A5-F8): period switches keep the charts
                          MOUNTED — the old unmount-to-skeleton on every
                          chip flip forced a full recharts re-init
                          (~100-300 ms low-end) + a visual flash. The
                          skeleton now shows only on the FIRST load (no
                          data yet); afterwards the previous series stays
                          visible, dimmed, until the new one lands
                          (recharts updates in place cheaply on
                          identity-stable data). The charts ride the lazy
                          recharts bridge (A5-F3) — the Suspense fallback
                          reserves the exact panel height. */}
                      {chartLoading && chartData.length === 0 ? (
                        <ChartPanelFallback heightClass="h-40" />
                      ) : (
                        <div className={chartLoading ? "opacity-60 transition-opacity" : undefined}>
                          <Suspense fallback={<ChartPanelFallback heightClass="h-40" />}>
                            <ChartsLoader>
                              {(rc) => (
                                <rc.ResponsiveContainer width="100%" height={160}>
                                  <rc.AreaChart
                                    data={displayData}
                                    margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                                  >
                                    <defs>
                                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop
                                          offset="5%"
                                          stopColor={chart.primary}
                                          stopOpacity={0.2}
                                        />
                                        <stop
                                          offset="95%"
                                          stopColor={chart.primary}
                                          stopOpacity={0}
                                        />
                                      </linearGradient>
                                      <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop
                                          offset="5%"
                                          stopColor={chart.success}
                                          stopOpacity={0.2}
                                        />
                                        <stop
                                          offset="95%"
                                          stopColor={chart.success}
                                          stopOpacity={0}
                                        />
                                      </linearGradient>
                                      <linearGradient id="discGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop
                                          offset="5%"
                                          stopColor={chart.warning}
                                          stopOpacity={0.15}
                                        />
                                        <stop
                                          offset="95%"
                                          stopColor={chart.warning}
                                          stopOpacity={0}
                                        />
                                      </linearGradient>
                                    </defs>
                                    <rc.CartesianGrid
                                      strokeDasharray="3 3"
                                      stroke={chart.grid}
                                      vertical={false}
                                    />
                                    <rc.XAxis
                                      dataKey="date"
                                      tickFormatter={fmtChartTick}
                                      tick={{ fontSize: 10, fill: chart.muted }}
                                      axisLine={false}
                                      tickLine={false}
                                    />
                                    <rc.YAxis
                                      tick={{ fontSize: 10, fill: chart.muted }}
                                      axisLine={false}
                                      tickLine={false}
                                    />
                                    <rc.Tooltip content={<ChartTooltip />} />
                                    <rc.Area
                                      type="monotone"
                                      dataKey="revenue"
                                      name="الإيرادات"
                                      stroke={chart.primary}
                                      fill="url(#revGrad)"
                                      strokeWidth={2}
                                      dot={false}
                                      activeDot={{ r: 3 }}
                                    />
                                    <rc.Area
                                      type="monotone"
                                      dataKey="orders"
                                      name="الطلبات"
                                      stroke={chart.success}
                                      fill="url(#ordGrad)"
                                      strokeWidth={2}
                                      dot={false}
                                      activeDot={{ r: 3 }}
                                    />
                                    <rc.Area
                                      type="monotone"
                                      dataKey="discounts"
                                      name="الخصومات"
                                      stroke={chart.warning}
                                      fill="url(#discGrad)"
                                      strokeWidth={1.5}
                                      dot={false}
                                      activeDot={{ r: 3 }}
                                      strokeDasharray="4 2"
                                    />
                                  </rc.AreaChart>
                                </rc.ResponsiveContainer>
                              )}
                            </ChartsLoader>
                          </Suspense>
                        </div>
                      )}
                    </div>

                    {/* Discounts & Coupon Orders chart */}
                    <div className="bg-card border border-border/60 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h2 className="font-bold text-sm">الخصومات والكوبونات</h2>
                          <p className="text-3xs text-muted-foreground mt-0.5">
                            قيمة الخصم اليومي وعدد الطلبات باستخدام كوبون
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-3xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-0.5 bg-amber-400 rounded inline-block" />
                            الخصومات
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded bg-emerald-500/60 inline-block" />
                            طلبات بكوبون
                          </span>
                        </div>
                      </div>
                      {/* R125-I2 (A5-F8 + F3): same keep-mounted rule as
                          the revenue panel (skeleton only on first load,
                          dimmed otherwise) + the lazy recharts bridge. */}
                      {chartLoading && chartData.length === 0 ? (
                        <ChartPanelFallback heightClass="h-28" />
                      ) : !chartLoading &&
                        displayData.every(
                          (d) => (d.discounts || 0) === 0 && (d.coupon_orders || 0) === 0,
                        ) ? (
                        <div className="h-28 flex items-center justify-center text-muted-foreground text-xs">
                          لا يوجد استخدام كوبونات في هذه الفترة
                        </div>
                      ) : (
                        <div className={chartLoading ? "opacity-60 transition-opacity" : undefined}>
                          <Suspense fallback={<ChartPanelFallback heightClass="h-28" />}>
                            <ChartsLoader>
                              {(rc) => (
                                <rc.ResponsiveContainer width="100%" height={120}>
                                  <rc.BarChart
                                    data={displayData}
                                    margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                                  >
                                    <rc.CartesianGrid
                                      strokeDasharray="3 3"
                                      stroke={chart.grid}
                                      vertical={false}
                                    />
                                    <rc.XAxis
                                      dataKey="date"
                                      tickFormatter={fmtChartTick}
                                      tick={{ fontSize: 10, fill: chart.muted }}
                                      axisLine={false}
                                      tickLine={false}
                                    />
                                    <rc.YAxis
                                      tick={{ fontSize: 10, fill: chart.muted }}
                                      axisLine={false}
                                      tickLine={false}
                                    />
                                    <rc.Tooltip content={<ChartTooltip />} />
                                    <rc.Bar
                                      dataKey="discounts"
                                      name="الخصومات"
                                      fill={chart.warning}
                                      radius={[3, 3, 0, 0]}
                                      maxBarSize={24}
                                      fillOpacity={0.8}
                                    />
                                    <rc.Bar
                                      dataKey="coupon_orders"
                                      name="طلبات بكوبون"
                                      fill={chart.success}
                                      radius={[3, 3, 0, 0]}
                                      maxBarSize={24}
                                      fillOpacity={0.6}
                                    />
                                  </rc.BarChart>
                                </rc.ResponsiveContainer>
                              )}
                            </ChartsLoader>
                          </Suspense>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* New users chart */}
                <div className="bg-card border border-border/60 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-sm">المستخدمون الجدد</h2>
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-muted-foreground bg-muted/40 border border-border/60 px-2 py-0.5 rounded-full">
                        {granularity === "daily"
                          ? "يومي"
                          : granularity === "weekly"
                            ? "أسبوعي"
                            : "شهري"}{" "}
                        · آخر {chartDays} يوم
                      </span>
                      <button
                        onClick={() => {
                          const usersData = displayData.map((d) => [d.date, d.users]);
                          const csv = [["التاريخ", "المستخدمون الجدد"], ...usersData]
                            .map((r) => r.join(","))
                            .join("\n");
                          const blob = new Blob(["\uFEFF" + csv], {
                            type: "text/csv;charset=utf-8;",
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `users_${chartDays}d.csv`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-muted-foreground"
                        title="تصدير CSV"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {/* R125-I2 (A5-F8 + F3): keep-mounted across period
                      switches + the lazy recharts bridge (see the
                      revenue panel comment). */}
                  {chartLoading && chartData.length === 0 ? (
                    <ChartPanelFallback heightClass="h-28" />
                  ) : (
                    <div className={chartLoading ? "opacity-60 transition-opacity" : undefined}>
                      <Suspense fallback={<ChartPanelFallback heightClass="h-28" />}>
                        <ChartsLoader>
                          {(rc) => (
                            <rc.ResponsiveContainer width="100%" height={120}>
                              <rc.BarChart
                                data={displayData}
                                margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                              >
                                <rc.CartesianGrid
                                  strokeDasharray="3 3"
                                  stroke={chart.grid}
                                  vertical={false}
                                />
                                <rc.XAxis
                                  dataKey="date"
                                  tickFormatter={fmtChartTick}
                                  tick={{ fontSize: 10, fill: chart.muted }}
                                  axisLine={false}
                                  tickLine={false}
                                />
                                <rc.YAxis
                                  tick={{ fontSize: 10, fill: chart.muted }}
                                  axisLine={false}
                                  tickLine={false}
                                  allowDecimals={false}
                                />
                                <rc.Tooltip content={<ChartTooltip />} />
                                <rc.Bar
                                  dataKey="users"
                                  name="مستخدمون جدد"
                                  fill={chart.info}
                                  radius={[3, 3, 0, 0]}
                                  maxBarSize={28}
                                />
                              </rc.BarChart>
                            </rc.ResponsiveContainer>
                          )}
                        </ChartsLoader>
                      </Suspense>
                    </div>
                  )}
                </div>
              </div>
            ))}

          {/* Recent orders stream */}
          <div
            className={`${showChartsColumn ? "xl:col-span-2" : "xl:col-span-5"} bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col`}
          >
            <div className="sticky top-0 z-10 px-4 py-3.5 border-b border-border flex items-center justify-between bg-card/80 supports-[backdrop-filter]:bg-card/60 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <h2 className="font-bold text-sm">آخر الطلبات</h2>
              </div>
              <Link href="/admin/orders">
                <span className="text-xs text-muted-foreground hover:text-primary-text transition-colors cursor-pointer">
                  عرض الكل
                </span>
              </Link>
            </div>
            <div className="flex-1 divide-y divide-border/40 overflow-y-auto">
              {recentOrdersLoading ? (
                /* Skeleton rows — the "no orders yet" empty state used to
                   flash before the first fetch resolved. */
                <div className="space-y-1 p-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                      <div className="w-9 h-9 rounded-lg bg-muted skeleton-shimmer shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 bg-muted skeleton-shimmer rounded w-2/5" />
                        <div className="h-2.5 bg-muted skeleton-shimmer rounded w-1/4" />
                      </div>
                      <div className="h-4 bg-muted skeleton-shimmer rounded w-14" />
                    </div>
                  ))}
                </div>
              ) : recentOrdersError ? (
                /* R122 (A2-P1): a failed load (403 for an orders-less
                   scope, or a 5xx outage) is NOT "no orders" — the false
                   «لا توجد طلبات بعد» empty state rendered while the
                   same screen's stats showed real order counts. Same
                   triad discipline as the page's chart section and every
                   admin list page: error card + retry. getErrorMessage
                   surfaces the backend's Arabic 403 body («ليست لديك
                   صلاحية…») when that's what failed. */
                <div
                  role="alert"
                  className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center"
                >
                  <div className="w-12 h-12 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
                    <WifiOff className="w-6 h-6 text-status-error/70" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground/80">تعذّر تحميل الطلبات</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {getErrorMessage(recentOrdersErrorDetail) ||
                        "حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => void refetchRecentOrders()}
                  >
                    <RefreshCw className="w-3 h-3" />
                    إعادة المحاولة
                  </Button>
                </div>
              ) : recentOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ShoppingBag className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">لا توجد طلبات بعد</p>
                </div>
              ) : (
                recentOrders.slice(0, 8).map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs truncate">{order.product_name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-3xs text-muted-foreground">
                          {displayUserName(
                            userFromRow(order as unknown as Parameters<typeof userFromRow>[0]),
                          )}
                        </span>
                        {order.created_at && (
                          <span className="text-3xs text-muted-foreground">
                            {formatDate(order.created_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {/* R125-I2 (A6-B6): raw --primary on a dark card is
                          3.76:1 — under the 4.5:1 text floor (dark is the
                          admin default). --primary-text (348 80% 65%) is
                          the text-safe variant (5.75:1 dark / 5.30 light —
                          button.tsx:35-37 documents raw text-primary as
                          surface-only). */}
                      <div className="font-bold text-xs text-primary-text tabular-nums">
                        {formatCurrency(order.amount)}
                      </div>
                      <div className="mt-0.5">
                        {/* R116: shared StatusBadge (STATUS_TONE) replaces
                            the deprecated statusColor() — 93-C7 follow-up. */}
                        <StatusBadge
                          variant={
                            STATUS_TONE[order.status as keyof typeof STATUS_TONE] ??
                            UNKNOWN_STATUS_TONE
                          }
                          size="xs"
                        >
                          {statusLabel(order.status)}
                        </StatusBadge>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
