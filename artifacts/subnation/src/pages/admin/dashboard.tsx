import { useState, useEffect } from "react";
import { useGetAdminStats, getGetAdminStatsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { formatCurrency } from "@/lib/utils";
import { Users, ShoppingBag, TrendingUp, Clock, Package, Wallet, BarChart2, ArrowUpRight } from "lucide-react";
import { AdminLayout } from "./layout";
import { useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";

interface ChartDay { date: string; orders: number; revenue: number; users: number }

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

  const cards = stats ? [
    { label: "إجمالي المستخدمين", value: stats.total_users, icon: Users, color: "text-blue-400", bg: "bg-blue-400/10", link: "/admin/users" },
    { label: "إجمالي الطلبات", value: stats.total_orders, icon: ShoppingBag, color: "text-emerald-400", bg: "bg-emerald-400/10", link: "/admin/orders" },
    { label: "إجمالي الإيرادات", value: formatCurrency(stats.total_revenue ?? 0), icon: TrendingUp, color: "text-primary", bg: "bg-primary/10", link: "/admin/orders" },
    { label: "طلبات الشحن المعلقة", value: stats.pending_topups, icon: Clock, color: "text-yellow-400", bg: "bg-yellow-400/10", link: "/admin/topups" },
    { label: "طلبات اليوم", value: stats.today_orders, icon: BarChart2, color: "text-purple-400", bg: "bg-purple-400/10", link: "/admin/orders" },
    { label: "إيرادات اليوم", value: formatCurrency(stats.today_revenue ?? 0), icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-400/10", link: "/admin/orders" },
    { label: "المخزون المتاح", value: stats.available_stock, icon: Package, color: "text-orange-400", bg: "bg-orange-400/10", link: "/admin/products" },
    { label: "رصيد المحافظ الكلي", value: formatCurrency(stats.total_wallet_balance ?? 0), icon: Wallet, color: "text-cyan-400", bg: "bg-cyan-400/10", link: "/admin/users" },
  ] : [];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs">
        <p className="font-bold mb-2">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-bold">{p.name === "الإيرادات" ? `${p.value.toFixed(1)} د.ل` : p.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <AdminLayout onRefresh={handleRefresh}>
      <div>
        <h1 className="text-2xl font-black mb-6">لوحة التحكم</h1>

        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse h-28" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card) => (
              <Link key={card.label} href={card.link}>
                <div className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-all cursor-pointer group">
                  <div className={`w-10 h-10 ${card.bg} rounded-lg flex items-center justify-center mb-3`}>
                    <card.icon className={`w-5 h-5 ${card.color}`} />
                  </div>
                  <div className="font-black text-xl mb-0.5">{card.value}</div>
                  <div className="text-xs text-muted-foreground">{card.label}</div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary mt-2 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {(stats?.pending_topups ?? 0) > 0 && (
          <div className="mt-4 p-4 bg-yellow-400/10 border border-yellow-400/30 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-yellow-400 font-bold text-sm">{stats!.pending_topups} طلب شحن بانتظار المراجعة</span>
            </div>
            <Link href="/admin/topups">
              <span className="text-xs text-yellow-400 underline underline-offset-2 cursor-pointer">مراجعة الآن</span>
            </Link>
          </div>
        )}

        {/* Charts */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            {/* Orders + Revenue Area Chart */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-bold text-sm mb-4">الطلبات والإيرادات (7 أيام)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e11d48" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="revenue" name="الإيرادات" stroke="#e11d48" fill="url(#revGrad)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="orders" name="الطلبات" stroke="#10b981" fill="url(#ordGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* New Users Bar Chart */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-bold text-sm mb-4">المستخدمون الجدد (7 أيام)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="users" name="مستخدمون جدد" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="font-bold mb-3 text-sm text-muted-foreground">وصول سريع</h2>
            <div className="space-y-1">
              {[
                { label: "مراجعة طلبات الشحن المعلقة", href: "/admin/topups", urgent: (stats?.pending_topups ?? 0) > 0 },
                { label: "إدارة المنتجات والمخزون", href: "/admin/products", urgent: false },
                { label: "تذاكر الدعم الفني", href: "/admin/tickets", urgent: false },
                { label: "عرض الطلبات", href: "/admin/orders", urgent: false },
                { label: "إدارة المستخدمين", href: "/admin/users", urgent: false },
                { label: "إعدادات النظام", href: "/admin/settings", urgent: false },
              ].map(item => (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-secondary transition-colors cursor-pointer">
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.urgent && stats?.pending_topups ? (
                      <span className="text-xs bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 px-2 py-0.5 rounded-full font-bold">{stats.pending_topups} معلق</span>
                    ) : (
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
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
