import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, ShoppingBag, Wallet, Package,
  Users, LogOut, Shield, Settings, RefreshCw,
  MessageSquare, ChevronRight, Menu
} from "lucide-react";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin",           label: "الرئيسية",      icon: LayoutDashboard },
  { href: "/admin/topups",    label: "طلبات الشحن",   icon: Wallet,         badgeKey: "pendingTopups" },
  { href: "/admin/orders",    label: "الطلبات",        icon: ShoppingBag },
  { href: "/admin/products",  label: "المنتجات",       icon: Package },
  { href: "/admin/users",     label: "المستخدمون",    icon: Users },
  { href: "/admin/tickets",   label: "الدعم الفني",   icon: MessageSquare,  badgeKey: "openTickets" },
  { href: "/admin/settings",  label: "الإعدادات",     icon: Settings },
];

interface AdminLayoutProps {
  children: ReactNode;
  onRefresh?: () => void;
  badges?: { pendingTopups?: number; openTickets?: number };
}

export function AdminLayout({ children, onRefresh, badges }: AdminLayoutProps) {
  const [location] = useLocation();
  const { adminLogout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => { setLastUpdated(new Date()); setSecondsAgo(0); }, [children]);
  useEffect(() => {
    const id = setInterval(() => setSecondsAgo(Math.round((Date.now() - lastUpdated.getTime()) / 1000)), 5000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  const refreshLabel = secondsAgo < 10 ? "الآن" : secondsAgo < 60 ? `${secondsAgo}ث` : `${Math.round(secondsAgo / 60)}د`;

  const NavItem = ({ item }: { item: typeof NAV[0] }) => {
    const active = location === item.href;
    const badge = item.badgeKey ? (badges as any)?.[item.badgeKey] : undefined;
    return (
      <Link href={item.href} onClick={() => setMobileOpen(false)}>
        <div className={`
          relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium
          transition-all duration-150 group
          ${active
            ? "bg-primary text-white shadow-md shadow-primary/25"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
          }
        `}>
          <item.icon className={`w-4 h-4 shrink-0 ${active ? "text-white" : ""}`} />
          {!collapsed && (
            <span className="flex-1 truncate">{item.label}</span>
          )}
          {!collapsed && badge ? (
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${active ? "bg-white/20 text-white" : "bg-yellow-400/20 text-yellow-400"}`}>
              {badge}
            </span>
          ) : null}
          {collapsed && badge ? (
            <span className="absolute -top-1 -left-1 w-4 h-4 bg-primary text-white text-[9px] font-black rounded-full flex items-center justify-center">
              {badge}
            </span>
          ) : null}
        </div>
      </Link>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`p-4 border-b border-border flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2`}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="font-black text-sm">لوحة الإدارة</span>
          </div>
        )}
        {collapsed && <Shield className="w-5 h-5 text-primary" />}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="hidden md:flex p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0"
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Nav */}
      <nav className={`flex-1 p-3 space-y-1 overflow-y-auto ${collapsed ? "items-center" : ""}`}>
        {NAV.map(item => <NavItem key={item.href} item={item} />)}
      </nav>

      {/* Logout */}
      <div className={`p-3 border-t border-border`}>
        <button
          onClick={adminLogout}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-150 ${collapsed ? "justify-center" : ""}`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>تسجيل الخروج</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex flex-col shrink-0 bg-card border-l border-border transition-all duration-200 ${collapsed ? "w-16" : "w-56"}`}>
        {sidebarContent}
      </aside>

      {/* Mobile overlay sidebar */}
      {mobileOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="md:hidden fixed right-0 top-0 bottom-0 w-64 bg-card border-l border-border z-50 shadow-2xl">
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur-md px-4 md:px-6 py-2.5 flex items-center gap-3">
          <button
            className="md:hidden p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
            onClick={() => setMobileOpen(v => !v)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            <span>آخر تحديث: {refreshLabel}</span>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
