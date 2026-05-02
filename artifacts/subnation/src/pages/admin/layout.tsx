import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, ShoppingBag, Wallet, Package,
  Users, LogOut, Shield, Settings, RefreshCw,
  MessageSquare, ChevronRight, Menu, X
} from "lucide-react";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";

const NAV_SECTIONS = [
  {
    label: "التشغيل",
    items: [
      { href: "/admin",           label: "الرئيسية",      icon: LayoutDashboard },
      { href: "/admin/topups",    label: "طلبات الشحن",   icon: Wallet,          badgeKey: "pendingTopups" },
      { href: "/admin/orders",    label: "الطلبات",        icon: ShoppingBag },
      { href: "/admin/tickets",   label: "الدعم الفني",   icon: MessageSquare,   badgeKey: "openTickets" },
    ],
  },
  {
    label: "الكتالوج",
    items: [
      { href: "/admin/products",  label: "المنتجات",      icon: Package },
      { href: "/admin/users",     label: "المستخدمون",   icon: Users },
    ],
  },
  {
    label: "النظام",
    items: [
      { href: "/admin/settings",  label: "الإعدادات",    icon: Settings },
    ],
  },
];

const ALL_NAV = NAV_SECTIONS.flatMap(s => s.items);

const PAGE_TITLES: Record<string, string> = {
  "/admin":           "لوحة التحكم",
  "/admin/topups":    "طلبات الشحن",
  "/admin/orders":    "الطلبات",
  "/admin/products":  "المنتجات",
  "/admin/users":     "المستخدمون",
  "/admin/tickets":   "الدعم الفني",
  "/admin/settings":  "الإعدادات",
};

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
  const pageTitle = PAGE_TITLES[location] ?? "الإدارة";
  const totalBadges = (badges?.pendingTopups ?? 0) + (badges?.openTickets ?? 0);

  const NavItem = ({ item }: { item: typeof ALL_NAV[0] }) => {
    const active = location === item.href;
    const badge = item.badgeKey ? (badges as any)?.[item.badgeKey] : undefined;
    return (
      <Link href={item.href} onClick={() => setMobileOpen(false)}>
        <div className={`
          relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-medium
          transition-all duration-150 group
          ${active
            ? "bg-primary/15 text-primary font-bold border border-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          }
          ${collapsed ? "justify-center px-2" : ""}
        `}>
          <item.icon className={`w-4 h-4 shrink-0 transition-colors ${active ? "text-primary" : ""}`} />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {!collapsed && badge ? (
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${active ? "bg-primary/20 text-primary" : "bg-yellow-400/20 text-yellow-400 border border-yellow-400/20"}`}>
              {badge}
            </span>
          ) : null}
          {collapsed && badge ? (
            <span className="absolute -top-0.5 -left-0.5 w-3.5 h-3.5 bg-yellow-400 text-black text-[8px] font-black rounded-full flex items-center justify-center">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </div>
      </Link>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Sidebar header */}
      <div className={`p-3 border-b border-border flex items-center gap-2 ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <div className="font-black text-xs leading-none">SubNation</div>
              <div className="text-[10px] text-muted-foreground leading-none mt-0.5">لوحة الإدارة</div>
            </div>
          </div>
        ) : (
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center relative">
            <Shield className="w-3.5 h-3.5 text-white" />
            {totalBadges > 0 && (
              <span className="absolute -top-1 -left-1 w-3.5 h-3.5 bg-yellow-400 text-black text-[8px] font-black rounded-full flex items-center justify-center">
                {totalBadges > 9 ? "9+" : totalBadges}
              </span>
            )}
          </div>
        )}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="hidden md:flex p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0"
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 p-2.5 space-y-4 overflow-y-auto">
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            {!collapsed && (
              <div className="px-2 mb-1.5">
                <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">{section.label}</span>
              </div>
            )}
            {collapsed && <div className="h-px bg-border/40 mb-2" />}
            <div className="space-y-0.5">
              {section.items.map(item => <NavItem key={item.href} item={item} />)}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-2.5 border-t border-border">
        <button
          onClick={adminLogout}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-all duration-150 ${collapsed ? "justify-center" : ""}`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>خروج</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex flex-col shrink-0 bg-card border-l border-border transition-all duration-200 ${collapsed ? "w-[52px]" : "w-52"}`}>
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/65 z-40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="md:hidden fixed right-0 top-0 bottom-0 w-60 bg-card border-l border-border z-50 shadow-2xl animate-in slide-in-from-right-4 duration-200">
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-30 border-b border-border bg-card/92 backdrop-blur-md px-4 md:px-5 h-12 flex items-center gap-3">
          <button
            className="md:hidden p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground relative"
            onClick={() => setMobileOpen(v => !v)}
          >
            {mobileOpen ? <X className="w-4.5 h-4.5" /> : <Menu className="w-4.5 h-4.5" />}
            {!mobileOpen && totalBadges > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-yellow-400 text-black text-[8px] font-black rounded-full flex items-center justify-center">
                {totalBadges > 9 ? "9+" : totalBadges}
              </span>
            )}
          </button>

          {/* Page title */}
          <h1 className="font-bold text-sm flex-1 truncate">{pageTitle}</h1>

          {/* Last updated */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            <span className="hidden sm:inline">{refreshLabel}</span>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90 shrink-0"
              title="تحديث البيانات"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Page content */}
        <div className="max-w-7xl mx-auto px-4 md:px-5 py-5 md:py-7">
          {children}
        </div>
      </main>
    </div>
  );
}
