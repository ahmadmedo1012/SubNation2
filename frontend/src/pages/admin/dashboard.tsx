import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, statusColor, statusLabel } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminStatsQueryKey,
  getListAdminOrdersQueryKey,
  useGetAdminStats,
  useListAdminOrders,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart2,
  CheckCircle,
  Clock,
  Download,
  ListOrdered,
  Package,
  Plus,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
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
          <span className="font-black tabular-nums">
            {CURRENCY_KEYS.has(p.name) ? formatCurrency(Number(p.value)) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

const PERIOD_OPTIONS = [
  { label: "٧ أيام", days: 7 },
  { label: "١٤ يوماً", days: 14 },
  { label: "شهر", days: 30 },
  { label: "٣ أشهر", days: 90 },
];

const GRANULARITY_OPTIONS = [
  { label: "يومي", value: "daily" },
  { label: "أسبوعي", value: "weekly" },
  { label: "شهري", value: "monthly" },
];

// Aggregate chart data into weekly or monthly buckets
function aggregateData(data: ChartDay[], granularity: string): ChartDay[] {
  if (granularity === "daily" || data.length === 0) return data;

  const buckets: Record<string, ChartDay> = {};

  data.forEach((d) => {
    const date = new Date(d.date);
    let key: string;
    if (granularity === "weekly") {
      const week = new Date(date);
      week.setDate(date.getDate() - date.getDay());
      key = week.toLocaleDateString("ar", { month: "short", day: "numeric" });
    } else {
      key = date.toLocaleDateString("ar", { year: "numeric", month: "short" });
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
      className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${up ? "text-emerald-400" : "text-red-400"}`}
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
  const [chartData, setChartData] = useState<ChartDay[]>([]);
  const [chartDays, setChartDays] = useState(7);
  const [chartLoading, setChartLoading] = useState(false);
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("daily");

  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  const {
    data: stats,
    isLoading: statsLoading,
    refetch,
  } = useGetAdminStats({
    query: { queryKey: getGetAdminStatsQueryKey(), enabled: !!adminToken, refetchInterval: 30_000 },
    request: { headers },
  });

  const { data: recentOrders = [] } = useListAdminOrders(
    { limit: 8 },
    {
      query: {
        queryKey: getListAdminOrdersQueryKey({ limit: 8 }),
        enabled: !!adminToken,
        refetchInterval: 30_000,
      },
      request: { headers },
    },
  );

  const fetchChart = (days = chartDays) => {
    if (!adminToken) return;
    setChartLoading(true);
    fetch(`/api/admin/chart-data?days=${days}`, { headers })
      .then((r) => r.json())
      .then((d) => setChartData(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setChartLoading(false));
  };

  useEffect(() => {
    if (adminToken) fetchChart(chartDays);
  }, [adminToken, chartDays]);
  if (!adminToken) {
    navigate("/admin/login");
    return null;
  }

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAdminOrdersQueryKey({ limit: 8 }) });
    fetchChart(chartDays);
  };

  const badges = { pendingTopups: stats?.pending_topups ?? 0, openTickets: 0 };

  const displayData = aggregateData(chartData, granularity);

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
          sparkColor: "#e11d48",
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
          sparkColor: "#10b981",
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
          sparkColor: "#3b82f6",
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
                  className={`float-in stagger-${i + 1} bg-card border rounded-2xl p-4 card-spring cursor-pointer group ${card.urgent ? "border-yellow-400/25 hover:border-yellow-400/40 hover:shadow-yellow-400/10" : card.highlight ? "border-primary/20 hover:border-primary/35 hover:shadow-primary/10" : "border-border/60 hover:border-border"}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div
                      className={`w-8 h-8 ${card.bg} border ${card.border} rounded-xl flex items-center justify-center shrink-0`}
                    >
                      <card.icon className={`w-4 h-4 ${card.color}`} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {card.sparkKey && <TrendBadge data={chartData} dataKey={card.sparkKey} />}
                      <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                  <div className="font-black text-xl leading-none mb-0.5 tabular-nums">
                    {card.value}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{card.label}</div>
                  {card.sub && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</div>
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
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest hidden sm:inline">
              إجراءات:
            </span>
            {(stats.pending_topups ?? 0) > 0 && (
              <Link href="/admin/topups">
                <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-yellow-400/8 hover:bg-yellow-400/15 border border-yellow-400/20 hover:border-yellow-400/35 text-yellow-400 transition-all duration-150 font-medium press-spring">
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
          {/* Charts */}
          {(chartData.length > 0 || chartLoading) && (
            <div className="xl:col-span-3 space-y-5 float-in stagger-7">
              {/* Revenue + Orders chart */}
              <div className="bg-card border border-border/60 rounded-2xl p-5">
                <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
                  <div>
                    <h2 className="font-bold text-sm">الإيرادات والطلبات</h2>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="w-3 h-0.5 bg-primary rounded inline-block" />
                        الإيرادات
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="w-3 h-0.5 bg-emerald-400 rounded inline-block" />
                        الطلبات
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
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
                          onClick={() => setGranularity(g.value as "day" | "week" | "month")}
                          className={`px-2 py-1 rounded text-[10px] font-bold transition-all duration-150 ${
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
                          className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all duration-150 ${
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
                          <stop offset="5%" stopColor="#e11d48" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="discGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.04)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        name="الإيرادات"
                        stroke="#e11d48"
                        fill="url(#revGrad)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="orders"
                        name="الطلبات"
                        stroke="#10b981"
                        fill="url(#ordGrad)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="discounts"
                        name="الخصومات"
                        stroke="#f59e0b"
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
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      قيمة الخصم اليومي وعدد الطلبات باستخدام كوبون
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
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
                        stroke="rgba(255,255,255,0.04)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="discounts"
                        name="الخصومات"
                        fill="#f59e0b"
                        radius={[3, 3, 0, 0]}
                        maxBarSize={24}
                        fillOpacity={0.8}
                      />
                      <Bar
                        dataKey="coupon_orders"
                        name="طلبات بكوبون"
                        fill="#10b981"
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
                    <span className="text-[11px] text-muted-foreground bg-muted/40 border border-border/60 px-2 py-0.5 rounded-full">
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
                        stroke="rgba(255,255,255,0.04)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="users"
                        name="مستخدمون جدد"
                        fill="#3b82f6"
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* Recent orders stream */}
          <div
            className={`${chartData.length > 0 ? "xl:col-span-2" : "xl:col-span-5"} bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col`}
          >
            <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
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
              {(
                recentOrders as Array<{
                  id: number;
                  user_phone: string;
                  total: number;
                  status: string;
                  created_at: string;
                  product_name: string;
                }>
              ).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ShoppingBag className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">لا توجد طلبات بعد</p>
                </div>
              ) : (
                (
                  recentOrders as Array<{
                    id: number;
                    user_phone: string;
                    total: number;
                    status: string;
                    created_at: string;
                    product_name: string;
                  }>
                )
                  .slice(0, 8)
                  .map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-xs truncate">{order.product_name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {order.user_phone}
                          </span>
                          {order.created_at && (
                            <span className="text-[10px] text-muted-foreground">
                              {formatDate(order.created_at)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-black text-xs text-primary tabular-nums">
                          {formatCurrency(order.amount)}
                        </div>
                        <div className="mt-0.5">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${statusColor(order.status)}`}
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
