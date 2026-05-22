import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { formatCurrency } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { AdminOrder, AdminProduct, AdminUser } from "@workspace/api-client-react";
import {
  Activity,
  Bell,
  Calculator,
  ChevronRight,
  Clock,
  Gift,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  Sun,
  Tag,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";

const NAV_SECTIONS = [
  {
    label: "التشغيل",
    items: [
      { href: "/admin", label: "الرئيسية", icon: LayoutDashboard },
      { href: "/admin/topups", label: "طلبات الشحن", icon: Wallet, badgeKey: "pendingTopups" },
      { href: "/admin/orders", label: "الطلبات", icon: ShoppingBag },
      {
        href: "/admin/tickets",
        label: "الدعم الفني",
        icon: MessageSquare,
        badgeKey: "openTickets",
      },
      { href: "/admin/alerts", label: "التنبيهات", icon: Bell, badgeKey: "unreadAlerts" },
    ],
  },
  {
    label: "الكتالوج",
    items: [
      { href: "/admin/products", label: "المنتجات", icon: Package },
      { href: "/admin/pricing", label: "حاسبة الأسعار", icon: Calculator },
      { href: "/admin/users", label: "المستخدمون", icon: Users },
      { href: "/admin/referrals", label: "الإحالات", icon: Gift },
      { href: "/admin/coupons", label: "الكوبونات", icon: Tag },
      { href: "/admin/promotions", label: "العروض السريعة", icon: Zap },
    ],
  },
  {
    label: "النظام",
    items: [
      { href: "/admin/system", label: "حالة النظام", icon: Activity },
      { href: "/admin/settings", label: "الإعدادات", icon: Settings },
    ],
  },
];

const ALL_NAV = NAV_SECTIONS.flatMap((s) => s.items);

const PAGE_TITLES: Record<string, string> = {
  "/admin": "لوحة التحكم",
  "/admin/topups": "طلبات الشحن",
  "/admin/orders": "الطلبات",
  "/admin/products": "المنتجات",
  "/admin/pricing": "حاسبة الأسعار",
  "/admin/users": "المستخدمون",
  "/admin/tickets": "الدعم الفني",
  "/admin/settings": "الإعدادات",
  "/admin/referrals": "الإحالات",
  "/admin/coupons": "الكوبونات",
  "/admin/promotions": "العروض السريعة",
  "/admin/alerts": "صندوق التنبيهات",
  "/admin/security": "الأمان",
  "/admin/system": "حالة النظام",
};

const CONTEXT_ACTIONS: Record<string, { label: string; icon: React.ElementType; href: string }[]> =
  {
    "/admin/products": [{ label: "إضافة منتج جديد", icon: Plus, href: "/admin/products#new" }],
    "/admin/topups": [{ label: "المعلقة فقط", icon: Clock, href: "/admin/topups" }],
    "/admin/orders": [{ label: "آخر الطلبات", icon: Zap, href: "/admin/orders" }],
  };

// ── Global search component ──────────────────────────────────────────────────

function GlobalSearch({ adminToken, onClose }: { adminToken: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    orders: AdminOrder[];
    users: AdminUser[];
    products: AdminProduct[];
  }>({
    orders: [],
    users: [],
    products: [],
  });
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const headers = { Authorization: `Bearer ${adminToken}` };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults({ orders: [], users: [], products: [] });
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      Promise.all([
        fetch(`/api/admin/orders?search=${encodeURIComponent(q)}`, { headers })
          .then((r) => r.json())
          .catch(() => []),
        fetch(`/api/admin/users?search=${encodeURIComponent(q)}`, { headers })
          .then((r) => r.json())
          .catch(() => []),
        fetch(`/api/admin/products?search=${encodeURIComponent(q)}`, { headers })
          .then((r) => r.json())
          .catch(() => []),
      ])
        .then(([orders, users, products]) => {
          setResults({
            orders: Array.isArray(orders) ? orders.slice(0, 4) : [],
            users: Array.isArray(users) ? users.slice(0, 4) : [],
            products: Array.isArray(products) ? products.slice(0, 4) : [],
          });
        })
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const total = results.orders.length + results.users.length + results.products.length;

  const goTo = (href: string) => {
    navigate(href);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-sm flex items-start justify-center pt-[8vh] sm:pt-[12vh] px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[84vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          {loading ? (
            <Loader2 className="w-4 h-4 text-muted-foreground shrink-0 animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder="بحث في الطلبات، المستخدمين، المنتجات..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-right"
          />
          <kbd className="text-[10px] font-mono text-muted-foreground bg-muted/50 border border-border/60 px-1.5 py-0.5 rounded shrink-0">
            esc
          </kbd>
        </div>

        {/* Results */}
        {query.length >= 2 && (
          <div className="max-h-72 overflow-y-auto">
            {!loading && total === 0 && (
              <div className="py-10 text-center text-muted-foreground text-sm">
                لا نتائج لـ "{query}"
              </div>
            )}

            {results.orders.length > 0 && (
              <div className="p-2">
                <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  الطلبات
                </div>
                {results.orders.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => goTo("/admin/orders")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/40 transition-colors text-right"
                  >
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{o.product_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {o.order_code} · {o.user_phone}
                      </div>
                    </div>
                    <span className="font-black text-primary text-xs tabular-nums shrink-0">
                      {formatCurrency(o.amount)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {results.users.length > 0 && (
              <div className="p-2">
                <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  المستخدمون
                </div>
                {results.users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => goTo("/admin/users")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/40 transition-colors text-right"
                  >
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Users className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm font-bold">{u.phone}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(u.wallet_balance)} رصيد · {u.order_count} طلب
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {results.products.length > 0 && (
              <div className="p-2">
                <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  المنتجات
                </div>
                {results.products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => goTo("/admin/products")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/40 transition-colors text-right"
                  >
                    <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden border border-border/40">
                      {p.image_url ? (
                        <img src={p.image_url} className="w-full h-full object-contain p-1" />
                      ) : (
                        <Package className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(p.price)} · {p.stock_count} وحدة
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Idle hint */}
        {query.length < 2 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            ابحث باسم المنتج، رقم الطلب، أو رقم الهاتف
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border bg-muted/10 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>
            <kbd className="font-mono bg-muted/60 px-1 rounded border border-border/40">↵</kbd>{" "}
            اختيار
          </span>
          <span>
            <kbd className="font-mono bg-muted/60 px-1 rounded border border-border/40">esc</kbd>{" "}
            إغلاق
          </span>
          <span className="mr-auto">
            <kbd className="font-mono bg-muted/60 px-1 rounded border border-border/40">⌘K</kbd> فتح
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main layout ──────────────────────────────────────────────────────────────

interface AdminLayoutProps {
  children: ReactNode;
  onRefresh?: () => void;
  badges?: { pendingTopups?: number; openTickets?: number; unreadAlerts?: number };
}

export function AdminLayout({ children, onRefresh, badges }: AdminLayoutProps) {
  const [location] = useLocation();
  const { adminToken, adminLogout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Auto-fetch unread alerts count for the badge — works on every page
  const { data: alertCountData } = useQuery<{ count: number }>({
    queryKey: ["admin-alerts-unread-count"],
    queryFn: () =>
      fetch("/api/admin/alerts/unread-count", {
        headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" },
      }).then((r) => r.json()),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    enabled: !!adminToken,
    staleTime: 15_000,
  });

  const mergedBadges = {
    ...badges,
    unreadAlerts: alertCountData?.count ?? badges?.unreadAlerts ?? 0,
  };

  useEffect(() => {
    setLastUpdated(new Date());
    setSecondsAgo(0);
  }, [children]);
  useEffect(() => {
    const id = setInterval(
      () => setSecondsAgo(Math.round((Date.now() - lastUpdated.getTime()) / 1000)),
      5000,
    );
    return () => clearInterval(id);
  }, [lastUpdated]);

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Real-time alert polling: show toast for new alerts every 30s
  useEffect(() => {
    if (!adminToken) return;

    const ALERT_LABELS: Record<string, string> = {
      coupon_maxed: "كوبون استُنفد",
      coupon_expiring: "كوبون منتهٍ قريباً",
      low_stock: "مخزون منخفض",
      no_stock: "نفاد مخزون",
      system: "إشعار النظام",
    };

    const poll = () => {
      const lastId = Number(localStorage.getItem("sn_last_alert_id") ?? "0");
      fetch(`/api/admin/alerts/new?since=${lastId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
        .then((r) => (r.ok ? r.json() : { alerts: [] }))
        .then((data: { alerts?: Array<{ id: number; type: string; message: string }> }) => {
          const alerts = data?.alerts ?? [];
          if (alerts.length === 0) return;
          alerts.forEach((alert) => {
            toast({
              title: ALERT_LABELS[alert.type] ?? "تنبيه",
              description: alert.message,
            });
          });
          const maxId = Math.max(...alerts.map((a) => a.id));
          localStorage.setItem("sn_last_alert_id", String(maxId));
        })
        .catch(() => {});
    };

    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [adminToken]);

  const refreshLabel =
    secondsAgo < 10
      ? "الآن"
      : secondsAgo < 60
        ? `${secondsAgo}ث`
        : `${Math.round(secondsAgo / 60)}د`;
  const pageTitle = PAGE_TITLES[location] ?? "الإدارة";
  const totalBadges =
    (mergedBadges.pendingTopups ?? 0) +
    (mergedBadges.openTickets ?? 0) +
    (mergedBadges.unreadAlerts ?? 0);
  const contextActions = CONTEXT_ACTIONS[location] ?? [];

  const NavItem = ({ item }: { item: (typeof ALL_NAV)[0] }) => {
    const active = location === item.href;
    const badge = item.badgeKey
      ? (mergedBadges as Record<string, number>)?.[item.badgeKey]
      : undefined;
    return (
      <div>
        <Link href={item.href} onClick={() => setMobileOpen(false)}>
          <div
            className={`
            relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-medium
            transition-all duration-150 group
            ${
              active
                ? "bg-primary/15 text-primary font-bold border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }
            ${collapsed ? "justify-center px-2" : ""}
          `}
          >
            <item.icon
              className={`w-4 h-4 shrink-0 transition-colors ${active ? "text-primary" : ""}`}
            />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {!collapsed && badge ? (
              <span
                className={`text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${active ? "bg-primary/20 text-primary" : "bg-yellow-400/20 text-yellow-400 border border-yellow-400/20"}`}
              >
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

        {/* Context quick actions — only when active and not collapsed */}
        {active && !collapsed && contextActions.length > 0 && (
          <div className="mt-1 mr-3 space-y-0.5 border-r border-primary/15 pr-2">
            {contextActions.map((action) => (
              <Link
                key={action.href + action.label}
                href={action.href}
                onClick={() => setMobileOpen(false)}
              >
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-primary hover:bg-primary/8 transition-all duration-100">
                  <action.icon className="w-3 h-3 shrink-0" />
                  <span>{action.label}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Sidebar header */}
      <div
        className={`p-3 border-b border-border flex items-center gap-2 ${collapsed ? "justify-center" : "justify-between"}`}
      >
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0 shadow-sm shadow-primary/30">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <div className="font-black text-xs leading-none">SubNation</div>
              <div className="text-[10px] text-muted-foreground leading-none mt-0.5">
                لوحة الإدارة
              </div>
            </div>
          </div>
        ) : (
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center relative shadow-sm shadow-primary/30">
            <Shield className="w-3.5 h-3.5 text-white" />
            {totalBadges > 0 && (
              <span className="absolute -top-1 -left-1 w-3.5 h-3.5 bg-yellow-400 text-black text-[8px] font-black rounded-full flex items-center justify-center">
                {totalBadges > 9 ? "9+" : totalBadges}
              </span>
            )}
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="hidden md:flex p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 p-2.5 space-y-4 overflow-y-auto">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <div className="px-2 mb-1.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  {section.label}
                </span>
              </div>
            )}
            {collapsed && <div className="h-px bg-border/40 mb-2" />}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: search hint + logout */}
      <div className="p-2.5 border-t border-border space-y-0.5">
        {!collapsed && (
          <button
            onClick={() => setShowSearch(true)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all duration-150 group press-spring"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-right">بحث سريع</span>
            <kbd className="text-[9px] font-mono bg-muted/60 border border-border/50 px-1 py-0.5 rounded group-hover:border-border transition-colors">
              ⌘K
            </kbd>
          </button>
        )}
        <button
          onClick={adminLogout}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-all duration-150 press-spring ${collapsed ? "justify-center" : ""}`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>خروج</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Global search overlay */}
      {showSearch && adminToken && (
        <GlobalSearch adminToken={adminToken} onClose={() => setShowSearch(false)} />
      )}

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-card border-l border-border transition-all duration-200 ${collapsed ? "w-[52px]" : "w-52"}`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/65 z-40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed right-0 top-0 bottom-0 w-[min(18rem,85vw)] bg-card border-l border-border z-50 shadow-2xl animate-in slide-in-from-right-4 duration-200">
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-30 border-b border-border bg-card/93 backdrop-blur-md px-4 md:px-5 h-12 flex items-center gap-3">
          <button
            className="md:hidden p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground relative"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            {!mobileOpen && totalBadges > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-yellow-400 text-black text-[8px] font-black rounded-full flex items-center justify-center">
                {totalBadges > 9 ? "9+" : totalBadges}
              </span>
            )}
          </button>

          <h1 className="font-bold text-sm flex-1 truncate">{pageTitle}</h1>

          {/* Global search trigger */}
          <button
            onClick={() => setShowSearch(true)}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 hover:border-border transition-all duration-150 text-muted-foreground text-xs group"
          >
            <Search className="w-3 h-3" />
            <span>بحث...</span>
            <kbd className="text-[9px] font-mono bg-muted border border-border/50 px-1 py-0.5 rounded opacity-60 group-hover:opacity-100 transition-opacity">
              ⌘K
            </kbd>
          </button>

          {/* Mobile search icon */}
          <button
            onClick={() => setShowSearch(true)}
            className="sm:hidden p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Last updated */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            <span className="hidden sm:inline">{refreshLabel}</span>
          </div>

          {/* Theme toggle — always visible. Reuses the app-level
              ThemeProvider context so the toggle in the public navbar
              and this one stay in lockstep. */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90 shrink-0"
            title={theme === "dark" ? "وضع نهاري" : "وضع ليلي"}
            aria-label="تبديل الثيم"
          >
            {theme === "dark" ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
          </button>

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
        <div className="max-w-7xl mx-auto px-4 md:px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] md:py-7">
          {children}
        </div>
      </main>
    </div>
  );
}
