import { useState, useEffect } from "react";
import { useGetAdminStats, useListAdminOrders, getGetAdminStatsQueryKey, getListAdminOrdersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import {
  Users, ShoppingBag, TrendingUp, Clock, Package,
  Wallet, BarChart2, AlertTriangle, ArrowUpRight, CheckCircle, Zap
} from "lucide-react";
import { AdminLayout } from "./layout";
import { useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";

interface ChartDay { date: string; orders: number; revenue: number; users: number }

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl text-xs min-w-[140px]">
      <p className="font-bold text-muted-foreground mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center justify-between gap-4 mb-1 last:mb-0">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </div>
          <span className="font-black tabular-nums">
            {p.name === "الإيرادات" ? `${Number(p.value).toFixed(1)}` : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function AdminDashboardPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [chartData, setChartData] = useState<ChartDay[]>([]);

  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  const { data: stats, isLoading: statsLoading, refetch } = useGetAdminStats({
    query: { queryKey: getGetAdminStatsQueryKey(), enabled: !!adminToken, refetchInterval: 30_000 },
    request: { headers },
  });

  const { data: recentOrders = [] } = useListAdminOrders({ limit: "8" }, {
    query: { queryKey: getListAdminOrdersQueryKey({ limit: "8" }), enabled: !!adminToken, refetchInterval: 30_000 },
    request: { headers },
  });

  const fetchChart = () => {
    if (!adminToken) return;
    fetch("/api/admin/chart-data", { headers })
      .then(r => r.json()).then(d => setChartData(Array.isArray(d) ? d : [])).catch(() => {});
  };

  useEffect(() => { fetchChart(); }, [adminToken]);
  if (!adminToken) { navigate("/admin/login"); return null; }

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAdminOrdersQueryKey({ limit: "8" }) });
    fetchChart();
  };

  const badges = { pendingTopups: stats?.pending_topups ?? 0, openTickets: 0 };

  const METRIC_CARDS = stats ? [
    {
      label: "إيرادات اليوم",   value: formatCurrency(stats.today_revenue ?? 0),
      sub: `${stats.today_orders ?? 0} طلب اليوم`,
      icon: TrendingUp, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20",
      link: "/admin/orders", highlight: true,
    },
    {
      label: "طلبات الشحن المعلقة", value: stats.pending_topups,
      sub: "تحتاج مراجعة يدوية",
      icon: Clock, color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/20",
      link: "/admin/topups", urgent: (stats.pending_topups ?? 0) > 0,
    },
    {
      label: "إجمالي الإيرادات", value: formatCurrency(stats.total_revenue ?? 0),
      sub: `${stats.total_orders ?? 0} طلب إجمالاً`,
      icon: BarChart2, color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20",
      link: "/admin/orders",
    },
    {
      label: "المستخدمون",      value: stats.total_users,
      sub: `${formatCurrency(stats.total_wallet_balance ?? 0)} رصيد كلي`,
      icon: Users, color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20",
      link: "/admin/users",
    },
    {
      label: "المخزون المتاح",   value: stats.available_stock,
      sub: "وحدة في المخزون",
      icon: Package, color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/20",
      link: "/admin/products",
    },
    {
      label: "رصيد المحافظ",     value: formatCurrency(stats.total_wallet_balance ?? 0),
      sub: "إجمالي أرصدة المستخدمين",
      icon: Wallet, color: "text-cyan-400", bg: "bg-cyan-400/10", border: "border-cyan-400/20",
      link: "/admin/users",
    },
  ] : [];

  return (
    <AdminLayout onRefresh={handleRefresh} badges={badges}>
      <div className="space-y-6">

        {/* Urgent alert */}
        {(stats?.pending_topups ?? 0) > 0 && (
          <div className="flex items-center justify-between p-4 bg-yellow-400/8 border border-yellow-400/20 rounded-xl gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-yellow-400/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <p className="font-bold text-sm text-yellow-400">{stats!.pending_topups} طلب شحن بانتظار المراجعة</p>
                <p className="text-xs text-muted-foreground">يحتاج إلى موافقة يدوية فورية</p>
              </div>
            </div>
            <Link href="/admin/topups">
              <span className="shrink-0 text-xs font-bold text-yellow-400 border border-yellow-400/30 px-3 py-1.5 rounded-lg hover:bg-yellow-400/10 transition-colors cursor-pointer whitespace-nowrap">
                مراجعة الآن
              </span>
            </Link>
          </div>
        )}

        {/* KPI cards */}
        {statsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl h-24 skeleton-shimmer" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {METRIC_CARDS.map(card => (
              <Link key={card.label} href={card.link}>
                <div className={`bg-card border rounded-xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 cursor-pointer group ${card.urgent ? "border-yellow-400/25 hover:border-yellow-400/40" : card.highlight ? "border-primary/20 hover:border-primary/35" : "border-border hover:border-border/60"}`}>
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className={`w-8 h-8 ${card.bg} border ${card.border} rounded-lg flex items-center justify-center shrink-0`}>
                      <card.icon className={`w-4 h-4 ${card.color}`} />
                    </div>
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/25 group-hover:text-primary transition-colors mt-0.5" />
                  </div>
                  <div className="font-black text-xl leading-none mb-0.5 tabular-nums">{card.value}</div>
                  <div className="text-[11px] text-muted-foreground">{card.label}</div>
                  {card.sub && <div className="text-[10px] text-muted-foreground/55 mt-0.5">{card.sub}</div>}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Charts + Recent Orders row */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          {/* Charts */}
          {chartData.length > 0 && (
            <div className="xl:col-span-3 space-y-5">
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-sm">الإيرادات والطلبات</h2>
                  <span className="text-[11px] text-muted-foreground bg-muted/40 border border-border/60 px-2 py-0.5 rounded-full">آخر 7 أيام</span>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#e11d48" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="revenue" name="الإيرادات" stroke="#e11d48" fill="url(#revGrad)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                    <Area type="monotone" dataKey="orders"  name="الطلبات"   stroke="#10b981" fill="url(#ordGrad)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-sm">المستخدمون الجدد</h2>
                  <span className="text-[11px] text-muted-foreground bg-muted/40 border border-border/60 px-2 py-0.5 rounded-full">آخر 7 أيام</span>
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="users" name="مستخدمون جدد" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Recent orders stream */}
          <div className={`${chartData.length > 0 ? "xl:col-span-2" : "xl:col-span-5"} bg-card border border-border rounded-xl overflow-hidden flex flex-col`}>
            <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <h2 className="font-bold text-sm">آخر الطلبات</h2>
              </div>
              <Link href="/admin/orders">
                <span className="text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer">عرض الكل</span>
              </Link>
            </div>
            <div className="flex-1 divide-y divide-border/40">
              {(recentOrders as any[]).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ShoppingBag className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">لا توجد طلبات بعد</p>
                </div>
              ) : (
                (recentOrders as any[]).slice(0, 8).map((order: any) => (
                  <div key={order.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs truncate">{order.product_name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-[10px] text-muted-foreground/60">{order.user_phone}</span>
                        {order.created_at && (
                          <span className="text-[10px] text-muted-foreground/40">{formatDate(order.created_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-black text-xs text-primary tabular-nums">{formatCurrency(order.amount)}</div>
                      <div className="mt-0.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${statusColor(order.status)}`}>
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
