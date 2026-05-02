import { useState, useEffect } from "react";
import { useGetAdminStats, getGetAdminStatsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { formatCurrency } from "@/lib/utils";
import {
  Users, ShoppingBag, TrendingUp, Clock, Package,
  Wallet, BarChart2, ArrowUpRight, AlertTriangle
} from "lucide-react";
import { AdminLayout } from "./layout";
import { useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";

interface ChartDay { date: string; orders: number; revenue: number; users: number }

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl text-xs min-w-36">
      <p className="font-bold mb-2 text-muted-foreground">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </div>
          <span className="font-black">
            {p.name === "الإيرادات" ? `${Number(p.value).toFixed(1)} د.ل` : p.value}
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

  const { data: stats, isLoading, refetch } = useGetAdminStats({
    query: {
      queryKey: getGetAdminStatsQueryKey(),
      enabled: !!adminToken,
      refetchInterval: 30_000,
    },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  const fetchChart = () => {
    if (!adminToken) return;
    fetch("/api/admin/chart-data", { headers: { Authorization: `Bearer ${adminToken}` } })
      .then(r => r.json())
      .then(d => setChartData(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  useEffect(() => { fetchChart(); }, [adminToken]);
  if (!adminToken) { navigate("/admin/login"); return null; }

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
    fetchChart();
  };

  const METRIC_CARDS = stats ? [
    { label: "إجمالي المستخدمين",    value: stats.total_users,                          icon: Users,       color: "text-blue-400",   bg: "bg-blue-400/10",   border: "border-blue-400/20",   link: "/admin/users" },
    { label: "إجمالي الطلبات",       value: stats.total_orders,                         icon: ShoppingBag, color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20", link: "/admin/orders" },
    { label: "إجمالي الإيرادات",     value: formatCurrency(stats.total_revenue ?? 0),   icon: TrendingUp,  color: "text-primary",    bg: "bg-primary/10",    border: "border-primary/20",    link: "/admin/orders" },
    { label: "طلبات الشحن المعلقة",  value: stats.pending_topups,                        icon: Clock,       color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/20", link: "/admin/topups", urgent: (stats.pending_topups ?? 0) > 0 },
    { label: "طلبات اليوم",          value: stats.today_orders,                         icon: BarChart2,   color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/20", link: "/admin/orders" },
    { label: "إيرادات اليوم",        value: formatCurrency(stats.today_revenue ?? 0),   icon: TrendingUp,  color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20", link: "/admin/orders" },
    { label: "المخزون المتاح",       value: stats.available_stock,                      icon: Package,     color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/20", link: "/admin/products" },
    { label: "رصيد المحافظ الكلي",   value: formatCurrency(stats.total_wallet_balance ?? 0), icon: Wallet, color: "text-cyan-400",   bg: "bg-cyan-400/10",   border: "border-cyan-400/20",   link: "/admin/users" },
  ] : [];

  const badges = {
    pendingTopups: stats?.pending_topups ?? 0,
    openTickets: 0,
  };

  return (
    <AdminLayout onRefresh={handleRefresh} badges={badges}>
      <div className="space-y-7">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-black mb-0.5">لوحة التحكم</h1>
          <p className="text-muted-foreground text-sm">مرحباً — إليك نظرة عامة على المنصة</p>
        </div>

        {/* Pending alert */}
        {(stats?.pending_topups ?? 0) > 0 && (
          <div className="flex items-center justify-between p-4 bg-yellow-400/10 border border-yellow-400/25 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-yellow-400/20 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <p className="font-bold text-sm text-yellow-400">{stats!.pending_topups} طلب شحن بانتظار المراجعة</p>
                <p className="text-xs text-muted-foreground">يحتاج إلى موافقة يدوية</p>
              </div>
            </div>
            <Link href="/admin/topups">
              <span className="text-xs font-bold text-yellow-400 border border-yellow-400/30 px-3 py-1.5 rounded-lg hover:bg-yellow-400/10 transition-colors cursor-pointer">مراجعة الآن</span>
            </Link>
          </div>
        )}

        {/* Metric cards */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-5 skeleton-shimmer h-28" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {METRIC_CARDS.map((card) => (
              <Link key={card.label} href={card.link}>
                <div className={`bg-card border rounded-xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer group ${card.urgent ? "border-yellow-400/30 hover:border-yellow-400/50" : "border-border hover:border-border/80"}`}>
                  <div className={`w-9 h-9 ${card.bg} border ${card.border} rounded-lg flex items-center justify-center mb-3`}>
                    <card.icon className={`w-4.5 h-4.5 ${card.color}`} />
                  </div>
                  <div className="font-black text-xl mb-0.5 tabular-nums">{card.value}</div>
                  <div className="text-xs text-muted-foreground leading-snug">{card.label}</div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary mt-1.5 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Charts */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-bold text-sm">الطلبات والإيرادات</h2>
                <span className="text-xs text-muted-foreground">آخر 7 أيام</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e11d48" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    iconType="circle" iconSize={7}
                    formatter={(v) => <span style={{ fontSize: 11, color: "#9ca3af" }}>{v}</span>}
                  />
                  <Area type="monotone" dataKey="revenue" name="الإيرادات" stroke="#e11d48" fill="url(#revGrad)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="orders" name="الطلبات" stroke="#10b981" fill="url(#ordGrad)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-bold text-sm">المستخدمون الجدد</h2>
                <span className="text-xs text-muted-foreground">آخر 7 أيام</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="users" name="مستخدمون جدد" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Quick access */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="font-bold text-sm mb-4 text-muted-foreground">وصول سريع</h2>
            <div className="space-y-1">
              {[
                { label: "مراجعة طلبات الشحن المعلقة", href: "/admin/topups",    badge: stats?.pending_topups, badgeClass: "bg-yellow-400/20 text-yellow-400 border-yellow-400/30" },
                { label: "إدارة المنتجات والمخزون",     href: "/admin/products",  badge: null, badgeClass: "" },
                { label: "تذاكر الدعم الفني",           href: "/admin/tickets",   badge: null, badgeClass: "" },
                { label: "عرض الطلبات",                 href: "/admin/orders",    badge: null, badgeClass: "" },
                { label: "إدارة المستخدمين",            href: "/admin/users",     badge: null, badgeClass: "" },
                { label: "إعدادات النظام",              href: "/admin/settings",  badge: null, badgeClass: "" },
              ].map(item => (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-secondary/70 transition-colors cursor-pointer group min-h-[44px]">
                    <span className="text-sm font-medium group-hover:text-foreground transition-colors">{item.label}</span>
                    {item.badge ? (
                      <span className={`text-xs border px-2 py-0.5 rounded-full font-bold ${item.badgeClass}`}>{item.badge} معلق</span>
                    ) : (
                      <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
