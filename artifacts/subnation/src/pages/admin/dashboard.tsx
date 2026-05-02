import { useGetAdminStats, getGetAdminStatsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { formatCurrency } from "@/lib/utils";
import { Users, ShoppingBag, TrendingUp, Clock, Package, Wallet, BarChart2, ArrowUpRight } from "lucide-react";
import { AdminLayout } from "./layout";

export default function AdminDashboardPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();

  const { data: stats, isLoading } = useGetAdminStats({
    query: { queryKey: getGetAdminStatsQueryKey(), enabled: !!adminToken },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  if (!adminToken) {
    navigate("/admin/login");
    return null;
  }

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

  return (
    <AdminLayout>
      <div>
        <h1 className="text-2xl font-black mb-6">لوحة التحكم</h1>

        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse h-28" />
            ))}
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="font-bold mb-3 text-sm text-muted-foreground">وصول سريع</h2>
            <div className="space-y-2">
              {[
                { label: "مراجعة طلبات الشحن المعلقة", href: "/admin/topups", urgent: (stats?.pending_topups ?? 0) > 0 },
                { label: "إدارة المنتجات", href: "/admin/products", urgent: false },
                { label: "عرض الطلبات", href: "/admin/orders", urgent: false },
                { label: "إدارة المستخدمين", href: "/admin/users", urgent: false },
              ].map(item => (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary transition-colors cursor-pointer">
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
