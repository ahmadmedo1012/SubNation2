import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useChartColors } from "@/lib/chart-theme";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, statusColor, statusLabel } from "@/lib/utils";
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
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link, useLocation } from "wouter";
import { AdminLayout } from "./layout";

interface ChartDay {
  date: string;
  orders: number;
  revenue: number;
  users: number;
  discounts: number;
  coupon_orders: number;
}

const CURRENCY_KEYS = new Set(["الإيرادات", "الخصومات"]);

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
      key = week.toLocaleDateString("ar-LY", { month: "short", day: "numeric" });
    } else {
      key = date.toLocaleDateString("ar-LY", { year: "numeric", month: "short" });
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

// Mini sparkline for KPI trend — uses last N days of chart data
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
    <ResponsiveContainer width="100%" height={32}>
      <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
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
      className={`inline-flex items-center gap-0.5 text-3xs font-bold ${up ? "text-emerald-400" : "text-red-400"}`}
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
    (d.revenue ?? 0).toFixed(2),
    ((d.discounts ?? 0) || 0).toFixed(2),
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
  const { adminToken } = useAuth();
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

  const {
    data: stats,
    isLoading: statsLoading,
    refetch,
  } = useGetAdminStats({
    query: {
      queryKey: getGetAdminStatsQueryKey(),
      enabled: !!adminToken,
      // Round-4 (perf P1-3): the admin-room socket listener invalidates
      // stats/orders on every `admin-stats-update` push (topup approve/
      // reject, order bulk updates) — this 5-min interval is only a
      // socket-dropout fallback (was 30 s).
      refetchInterval: 300_000,
      refetchIntervalInBackground: false,
    },
    request: { headers },
  });

  const { data: recentOrders = [], isLoading: recentOrdersLoading } = useListAdminOrders(
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

  const fetchChart = (days = chartDays) => {
    if (!adminToken) return;
    setChartLoading(true);
    const url = `/api/admin/chart-data?days=${days}`;
    fetch(url, { headers })
      .then(async (r) => {
        // 93-C6 / F-07 (A5 S-3): expired session → global handler (toast
        // + redirect); not a chart error banner.
        if (isAdminUnauthorized(r, url)) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as unknown;
      })
      .then((d) => {
        if (d === null) return; // session-expiry path — redirect in flight
        setChartData(Array.isArray(d) ? d : []);
        setChartError(null);
      })
      .catch(() => {
        // 93-C6 / F-07 (A5 DA-1): surface the failure with a retry
        // instead of silently dropping the section.
        setChartError("تعذّر تحميل بيانات الرسوم البيانية — تحقّق من الشبكة ثم أعد المحاولة");
      })
      .finally(() => setChartLoading(false));
  };

  useEffect(() => {
    if (adminToken) fetchChart(chartDays);
  }, [adminToken, chartDays]);
  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  if (!adminToken) return null;

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAdminOrdersQueryKey({ limit: 8 }) });
    fetchChart(chartDays);
  };

  const badges = { pendingTopups: stats?.pending_topups ?? 0, openTickets: 0 };

  const displayData = aggregateData(chartData, granularity);

  // R115 (A9 P2): an EMPTY chart response (no error, not loading) used
  // to make the whole charts column vanish silently — an honest empty
  // block renders instead. The column also hides for a failed load
  // with no stale data (the error banner above is the honest state
  // then).
  const chartEmpty = !chartLoading && !chartError && chartData.length === 0;
  const showChartsColumn = chartData.length > 0 || chartLoading || chartEmpty;
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

  const METRIC_CARDS = stats
    ? [
        {
          label: "إيرادات اليوم",
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
          label: "طلبات الشحن المعلقة",
          value: stats.pending_topups,
          sub: "تحتاج مراجعة يدوية",
          icon: Clock,
          color: "text-yellow-400",
          bg: "bg-yellow-400/10",
          border: "border-yellow-400/20",
          link: "/admin/topups",
          urgent: (stats.pending_topups ?? 0) > 0,
          sparkKey: null,
          sparkColor: "",
        },
        {
          label: "إجمالي الإيرادات",
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
          sub: `${formatCurrency(stats.total_wallet_balance ?? 0)} رصيد كلي`,
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
    : [];

  return (
    <AdminLayout onRefresh={handleRefresh} badges={badges}>
      <div className="space-y-6">
        {/* Urgent alert */}
        {(stats?.pending_topups ?? 0) > 0 && (
          <div className="flex items-center justify-between p-4 bg-yellow-400/8 border border-yellow-400/20 rounded-2xl gap-4 float-in">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-yellow-400/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4.5 h-4.5 text-yellow-400" />
              </div>
              <div>
                <p className="font-bold text-sm text-yellow-400">
                  {stats!.pending_topups} طلب شحن بانتظار المراجعة
                </p>
                <p className="text-xs text-muted-foreground">يحتاج إلى موافقة يدوية فورية</p>
              </div>
            </div>
            <Link href="/admin/topups">
              <span className="shrink-0 text-xs font-bold text-yellow-400 border border-yellow-400/30 px-3 py-1.5 rounded-xl hover:bg-yellow-400/10 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5">
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
                  className={`float-in stagger-${i + 1} bg-card border rounded-2xl p-4 card-spring cursor-pointer group ${card.urgent ? "border-yellow-400/25 hover:border-yellow-400/40 hover:shadow-yellow-400/10" : card.lowStock ? "border-orange-400/30 hover:border-orange-400/45 shadow-[0_0_0_1px_rgba(251,146,60,0.12)] hover:shadow-orange-400/15" : card.highlight ? "border-primary/20 hover:border-primary/35 hover:shadow-primary/10" : "border-border/60 hover:border-border"}`}
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
            {(stats.pending_topups ?? 0) > 0 && (
              <Link href="/admin/topups">
                <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-yellow-400/8 hover:bg-yellow-400/15 border border-yellow-400/20 hover:border-yellow-400/35 text-yellow-400 transition-all duration-150 font-semibold press-spring">
                  <Clock className="w-3 h-3" /> موافقة الشحن ({stats.pending_topups})
                </button>
              </Link>
            )}
            <Link href="/admin/orders">
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150">
                <ListOrdered className="w-3 h-3" /> الطلبات
              </button>
            </Link>
            <Link href="/admin/products">
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150">
                <Plus className="w-3 h-3" /> منتج جديد
              </button>
            </Link>
            <Link href="/admin/users">
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-150">
                <Users className="w-3 h-3" /> المستخدمون
              </button>
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
              <div className="xl:col-span-3 bg-card border border-border/60 rounded-2xl p-10 flex flex-col items-center justify-center text-center text-muted-foreground">
                <BarChart2 className="w-9 h-9 mb-3 opacity-20" />
                <p className="text-sm font-bold text-foreground/80">لا توجد بيانات بعد</p>
                <p className="text-xs mt-1 leading-relaxed">
                  ستظهر الرسوم البيانية مع أول طلب أو تسجيل مستخدم جديد
                </p>
              </div>
            ) : (
              <div className="xl:col-span-3 space-y-5 float-in stagger-7">
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
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Granularity picker */}
                    <div className="flex items-center gap-0.5 bg-muted/40 border border-border/60 rounded-lg p-0.5">
                      {GRANULARITY_OPTIONS.map((g) => (
                        <button
                          key={g.value}
                          onClick={() => setGranularity(g.value)}
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
                    <div className="flex items-center gap-0.5 bg-muted/40 border border-border/60 rounded-lg p-0.5">
                      {PERIOD_OPTIONS.map((opt) => (
                        <button
                          key={opt.days}
                          onClick={() => onChangeDays(opt.days)}
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

                    {/* Export chart data */}
                    <button
                      onClick={() => exportChartCSV(displayData, chartDays)}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                      title="تصدير بيانات المخطط CSV"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {chartLoading ? (
                  <div className="h-40 skeleton-shimmer rounded-lg" />
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart
                      data={displayData}
                      margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={chart.primary} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={chart.primary} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={chart.success} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={chart.success} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="discGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={chart.warning} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={chart.warning} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={chart.grid}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        // Round-3 (8-e §1.4): daily buckets carry the raw
                        // backend ISO key ("2026-09-06") — unlocalized and
                        // inconsistent with the Arabic month names the same
                        // axis shows in weekly/monthly mode. Format it.
                        tickFormatter={(value: string) => {
                          const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
                          return Number.isNaN(d.getTime())
                            ? value
                            : d.toLocaleDateString("ar-LY", {
                                month: "short",
                                day: "numeric",
                                timeZone: "UTC",
                              });
                        }}
                        tick={{ fontSize: 10, fill: chart.muted }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: chart.muted }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        name="الإيرادات"
                        stroke={chart.primary}
                        fill="url(#revGrad)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="orders"
                        name="الطلبات"
                        stroke={chart.success}
                        fill="url(#ordGrad)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Area
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
                    </AreaChart>
                  </ResponsiveContainer>
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
                {chartLoading ? (
                  <div className="h-28 skeleton-shimmer rounded-lg" />
                ) : displayData.every(
                    (d) => (d.discounts || 0) === 0 && (d.coupon_orders || 0) === 0,
                  ) ? (
                  <div className="h-28 flex items-center justify-center text-muted-foreground text-xs">
                    لا يوجد استخدام كوبونات في هذه الفترة
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart
                      data={displayData}
                      margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={chart.grid}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        // Round-3 (8-e §1.4): daily buckets carry the raw
                        // backend ISO key ("2026-09-06") — unlocalized and
                        // inconsistent with the Arabic month names the same
                        // axis shows in weekly/monthly mode. Format it.
                        tickFormatter={(value: string) => {
                          const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
                          return Number.isNaN(d.getTime())
                            ? value
                            : d.toLocaleDateString("ar-LY", {
                                month: "short",
                                day: "numeric",
                                timeZone: "UTC",
                              });
                        }}
                        tick={{ fontSize: 10, fill: chart.muted }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: chart.muted }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="discounts"
                        name="الخصومات"
                        fill={chart.warning}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={24}
                        fillOpacity={0.8}
                      />
                      <Bar
                        dataKey="coupon_orders"
                        name="طلبات بكوبون"
                        fill={chart.success}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={24}
                        fillOpacity={0.6}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

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
                {chartLoading ? (
                  <div className="h-28 skeleton-shimmer rounded-lg" />
                ) : (
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart
                      data={displayData}
                      margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={chart.grid}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        // Round-3 (8-e §1.4): daily buckets carry the raw
                        // backend ISO key ("2026-09-06") — unlocalized and
                        // inconsistent with the Arabic month names the same
                        // axis shows in weekly/monthly mode. Format it.
                        tickFormatter={(value: string) => {
                          const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
                          return Number.isNaN(d.getTime())
                            ? value
                            : d.toLocaleDateString("ar-LY", {
                                month: "short",
                                day: "numeric",
                                timeZone: "UTC",
                              });
                        }}
                        tick={{ fontSize: 10, fill: chart.muted }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: chart.muted }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="users"
                        name="مستخدمون جدد"
                        fill={chart.info}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
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
                <span className="text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer">
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
                      <div className="font-bold text-xs text-primary tabular-nums">
                        {formatCurrency(order.amount)}
                      </div>
                      <div className="mt-0.5">
                        <span
                          className={`text-3xs font-bold px-1.5 py-0.5 rounded-full border ${statusColor(order.status)}`}
                        >
                          {statusLabel(order.status)}
                        </span>
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
