import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { LayoutDashboard, ShoppingBag, Wallet, Package, Users, LogOut, Shield, Settings, RefreshCw, MessageSquare } from "lucide-react";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin", label: "الرئيسية", icon: LayoutDashboard },
  { href: "/admin/topups", label: "طلبات الشحن", icon: Wallet },
  { href: "/admin/orders", label: "الطلبات", icon: ShoppingBag },
  { href: "/admin/products", label: "المنتجات", icon: Package },
  { href: "/admin/users", label: "المستخدمون", icon: Users },
  { href: "/admin/tickets", label: "الدعم الفني", icon: MessageSquare },
  { href: "/admin/settings", label: "الإعدادات", icon: Settings },
];

export function AdminLayout({ children, onRefresh }: { children: ReactNode; onRefresh?: () => void }) {
  const [location] = useLocation();
  const { adminLogout } = useAuth();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    setLastUpdated(new Date());
    setSecondsAgo(0);
  }, [children]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsAgo(Math.round((Date.now() - lastUpdated.getTime()) / 1000));
    }, 5000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  const refreshLabel = secondsAgo < 10 ? "الآن" : secondsAgo < 60 ? `${secondsAgo}ث` : `${Math.round(secondsAgo / 60)}د`;

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 bg-card border-l border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-black">لوحة الإدارة</span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(item => (
            <Link key={item.href} href={item.href}>
              <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${location === item.href ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                <item.icon className="w-4 h-4" />
                {item.label}
              </div>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <button
            onClick={adminLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="border-b border-border bg-card/50 px-6 py-2 flex items-center justify-end gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            آخر تحديث: {refreshLabel}
          </div>
          {onRefresh && (
            <button onClick={onRefresh} className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
