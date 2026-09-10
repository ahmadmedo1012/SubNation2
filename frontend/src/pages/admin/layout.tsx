import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { formatCurrency } from "@/lib/utils";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { ADMIN_ALERT_NEW_EVENT } from "@/lib/socket-events";
import { CopilotPanel } from "@/components/admin/copilot/CopilotPanel";
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
  QrCode,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
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
      {
        href: "/admin/topups",
        label: "طلبات الشحن",
        icon: Wallet,
        badgeKey: "pendingTopups",
        scope: "finance",
      },
      { href: "/admin/orders", label: "الطلبات", icon: ShoppingBag, scope: "orders" },
      {
        href: "/admin/tickets",
        label: "الدعم الفني",
        icon: MessageSquare,
        badgeKey: "openTickets",
        scope: "support",
      },
      {
        href: "/admin/alerts",
        label: "التنبيهات",
        icon: Bell,
        badgeKey: "unreadAlerts",
        scope: "support",
      },
    ],
  },
  {
    label: "الكتالوج",
    items: [
      { href: "/admin/products", label: "المنتجات", icon: Package, scope: "inventory" },
      {
        href: "/admin/products/enrichment",
        label: "مراجعة المحتوى",
        icon: Sparkles,
        scope: "inventory",
      },
      { href: "/admin/pricing", label: "حاسبة الأسعار", icon: Calculator, scope: "inventory" },
      { href: "/admin/users", label: "المستخدمون", icon: Users, scope: "users" },
      { href: "/admin/referrals", label: "الإحالات", icon: Gift, scope: "users" },
      { href: "/admin/coupons", label: "الكوبونات", icon: Tag, scope: "inventory" },
      { href: "/admin/promotions", label: "العروض السريعة", icon: Zap, scope: "inventory" },
    ],
  },
  {
    label: "النظام",
    items: [
      { href: "/admin/admins", label: "إدارة المسؤولين", icon: ShieldCheck, scope: "admins" },
      { href: "/admin/risk", label: "مراقبة المخاطر", icon: Shield, scope: "users" },
      // /admin/security was routed + titled but missing from the nav —
      // URL-only access for a security page is the worst place for an
      // orphan route.
      { href: "/admin/security", label: "سجل الأمان", icon: ShieldAlert, scope: "admins" },
      { href: "/admin/system", label: "حالة النظام", icon: Activity, scope: "settings" },
      { href: "/admin/whatsapp", label: "جلسة واتساب", icon: QrCode, scope: "settings" },
      { href: "/admin/settings", label: "الإعدادات", icon: Settings },
    ],
  },
];

type NavItemShape = (typeof NAV_SECTIONS)[number]["items"][number];

// Module-scope so it is NOT redefined on every AdminLayout render
// (react-doctor/no-nested-component-definition). All previously-closed-over
// values are passed as props.
function NavItem({
  item,
  location,
  activeHref,
  badge,
  collapsed,
  contextActions,
  onNavigate,
}: {
  item: NavItemShape;
  location: string;
  /** Longest-prefix-matching nav href for the current location — see
      computeActiveHref in AdminLayout. Exact `location === item.href`
      matching left detail routes (risk-event, enrichment) unlit. */
  activeHref: string;
  badge: number | undefined;
  collapsed: boolean;
  contextActions: { label: string; icon: React.ElementType; href: string }[];
  onNavigate: () => void;
}) {
  const active = item.href === activeHref;
  return (
    <div>
      <Link href={item.href} onClick={onNavigate}>
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

      {active && !collapsed && contextActions.length > 0 && (
        <div className="mt-1 mr-3 space-y-0.5 border-r border-primary/15 pr-2">
          {contextActions.map((action) => (
            <Link key={action.href + action.label} href={action.href} onClick={onNavigate}>
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
}

const PAGE_TITLES: Record<string, string> = {
  "/admin": "لوحة التحكم",
  "/admin/topups": "طلبات الشحن",
  "/admin/orders": "الطلبات",
  "/admin/products": "المنتجات",
  "/admin/products/enrichment": "مراجعة المحتوى",
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
  "/admin/whatsapp": "جلسة واتساب",
  "/admin/admins": "إدارة المسؤولين",
  "/admin/risk": "مراقبة المخاطر",
};

/** Detail-route title fallbacks (no exact PAGE_TITLES entry possible). */
function pageTitleFor(location: string): string {
  if (PAGE_TITLES[location]) return PAGE_TITLES[location];
  if (location.startsWith("/admin/risk/events/")) return "تفاصيل الحدث — مراقبة المخاطر";
  return "الإدارة";
}

/**
 * Longest-prefix match across all nav hrefs: the most specific nav item
 * stays highlighted on detail/sub routes (e.g. /admin/risk/events/:id
 * lights up مراقبة المخاطر, /admin/products/enrichment lights up its own
 * entry rather than المنتجات). Exact-match only used to leave these
 * routes dark.
 */
const ALL_NAV_HREFS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
function computeActiveHref(location: string): string {
  const matches = ALL_NAV_HREFS.filter((h) => h === location || location.startsWith(h + "/"));
  if (matches.length === 0) return location;
  return matches.sort((a, b) => b.length - a.length)[0];
}

const CONTEXT_ACTIONS: Record<string, { label: string; icon: React.ElementType; href: string }[]> =
  {
    "/admin/products": [{ label: "إضافة منتج جديد", icon: Plus, href: "/admin/products#new" }],
    "/admin/topups": [{ label: "المعلقة فقط", icon: Clock, href: "/admin/topups" }],
    "/admin/orders": [{ label: "آخر الطلبات", icon: Zap, href: "/admin/orders" }],
  };

// ── Global search component ──────────────────────────────────────────────────

function GlobalSearch({ onClose }: { onClose: () => void }) {
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
  const headers = useAdminHeaders();
  // 94-C2 (A2 P2-3): the footer promises «↵ اختيار» — this index backs
  // that promise with real ↑/↓/↵ navigation over the flattened result
  // list (the promise was previously a dead hint).
  const [activeIndex, setActiveIndex] = useState(0);

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
    // 94-C2 (A2 P2-3): every new keystroke aborts the previous request
    // — "abc"→"abcd" previously raced two overlapping fetches, and a
    // late-resolving OLDER response overwrote the newer results while
    // its finally() cleared the loading flag early.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      // 94-C2 (A2 P2-3): r.ok checked BEFORE parsing — an error body
      // (401/500 JSON envelope) previously parsed to a non-array and
      // silently became "لا نتائج" during an outage.
      const jsonList = async (url: string): Promise<unknown[]> => {
        const r = await fetch(url, { headers, signal: controller.signal });
        if (!r.ok) return [];
        const d = await r.json().catch(() => null);
        return Array.isArray(d) ? d : [];
      };
      Promise.all([
        jsonList(`/api/admin/orders?search=${encodeURIComponent(q)}`),
        jsonList(`/api/admin/users?search=${encodeURIComponent(q)}`),
        jsonList(`/api/admin/products?search=${encodeURIComponent(q)}`),
      ])
        .then(([orders, users, products]) => {
          if (controller.signal.aborted) return;
          setResults({
            orders: (orders as AdminOrder[]).slice(0, 4),
            users: (users as AdminUser[]).slice(0, 4),
            products: (products as AdminProduct[]).slice(0, 4),
          });
        })
        .catch(() => {
          /* aborted or network — the next keystroke owns the state */
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, headers]);

  const total = results.orders.length + results.users.length + results.products.length;

  // 94-C2 (A2 P2-3): flat result list with its navigation action —
  // drives both the highlight and the Enter key. Clamped safely when
  // results shrink (typing narrows the list mid-navigation).
  const safeActive = Math.min(activeIndex, Math.max(0, total - 1));

  const goTo = (href: string) => {
    navigate(href);
    onClose();
  };

  // 94-C2 (A2 P2-3): result clicks KEEP the query — the orders page
  // consumes ?search= on arrival (server-side search, users'/orders'
  // pages read it on mount) instead of dropping what the operator
  // just searched for.
  const goToOrders = () => goTo(`/admin/orders?search=${encodeURIComponent(query.trim())}`);
  const goToUsers = () => goTo(`/admin/users?search=${encodeURIComponent(query.trim())}`);
  const goToProducts = () => goTo(`/admin/products?search=${encodeURIComponent(query.trim())}`);

  const flatResults = [
    ...results.orders.map(() => "order" as const),
    ...results.users.map(() => "user" as const),
    ...results.products.map(() => "product" as const),
  ];
  const runActive = () => {
    const kind = flatResults[safeActive];
    if (kind === "order") goToOrders();
    else if (kind === "user") goToUsers();
    else if (kind === "product") goToProducts();
  };

  // Reset the highlight whenever the result set changes (new query).
  useEffect(() => {
    setActiveIndex(0);
  }, [total]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (total === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(total - 1, Math.min(i, total - 1) + 1));
    } else if (e.key === "ArrowUp") {
      if (total === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, Math.min(i, total - 1) - 1));
    } else if (e.key === "Enter") {
      if (total > 0) {
        e.preventDefault();
        runActive();
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="بحث سريع"
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
            placeholder="بحث في الطلبات، المستخدمين، المنتجات…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={total > 0}
            aria-controls="global-search-results"
            aria-activedescendant={total > 0 ? `global-search-option-${safeActive}` : undefined}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-right"
          />
          <kbd className="text-[10px] font-mono text-muted-foreground bg-muted/50 border border-border/60 px-1.5 py-0.5 rounded shrink-0">
            esc
          </kbd>
        </div>

        {/* Results */}
        {query.length >= 2 && (
          <div id="global-search-results" role="listbox" className="max-h-72 overflow-y-auto">
            {!loading && total === 0 && (
              <div className="py-10 text-center text-muted-foreground text-sm">
                لا نتائج لـ "{query}"
              </div>
            )}

            {results.orders.length > 0 && (
              <div className="p-2">
                <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground">الطلبات</div>
                {results.orders.map((o, i) => (
                  <button
                    key={o.id}
                    id={`global-search-option-${i}`}
                    role="option"
                    aria-selected={safeActive === i}
                    onClick={goToOrders}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-right outline-none ${
                      safeActive === i
                        ? "bg-primary/10 ring-1 ring-primary/25"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{o.product_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {o.order_code} · {displayUserName(userFromRow(o))}
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
                <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground">
                  المستخدمون
                </div>
                {results.users.map((u, i) => {
                  const flatIdx = results.orders.length + i;
                  return (
                    <button
                      key={u.id}
                      id={`global-search-option-${flatIdx}`}
                      role="option"
                      aria-selected={safeActive === flatIdx}
                      onClick={goToUsers}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-right outline-none ${
                        safeActive === flatIdx
                          ? "bg-primary/10 ring-1 ring-primary/25"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="w-7 h-7 rounded-lg bg-status-info/10 flex items-center justify-center shrink-0">
                        <Users className="w-3.5 h-3.5 text-status-info" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm font-bold">{u.phone}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(u.wallet_balance)} رصيد · {u.order_count} طلب
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {results.products.length > 0 && (
              <div className="p-2">
                <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground">
                  المنتجات
                </div>
                {results.products.map((p, i) => {
                  const flatIdx = results.orders.length + results.users.length + i;
                  return (
                    <button
                      key={p.id}
                      id={`global-search-option-${flatIdx}`}
                      role="option"
                      aria-selected={safeActive === flatIdx}
                      onClick={goToProducts}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-right outline-none ${
                        safeActive === flatIdx
                          ? "bg-primary/10 ring-1 ring-primary/25"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden border border-border/40">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt={p.name ?? ""}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-contain p-1"
                          />
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
                  );
                })}
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
        {/* 94-C2 (A2 P2-3): the hints now tell the truth — ↑/↓ move the
            highlight, ↵ opens the highlighted result (keeping the query). */}
        {/* 96-F7 (R96 M13): hidden below sm — the ↑↓/↵/esc/⌘K promises
            are keyboard-only and dead weight on touch devices (no
            hardware keyboard to fulfill them; the backdrop tap closes). */}
        <div className="hidden sm:flex px-4 py-2 border-t border-border bg-muted/10 items-center gap-4 text-[10px] text-muted-foreground">
          <span>
            <kbd className="font-mono bg-muted/60 px-1 rounded border border-border/40">↑↓</kbd>{" "}
            تنقّل
          </span>
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
  const { adminToken, adminLogout, hasAdminPermission } = useAuth();
  const headers = useAdminHeaders();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Auto-fetch unread alerts count for the badge — works on every page.
  // Round-4 (perf P1-5): the admin-room socket listener invalidates this
  // query on every `admin-alert-new` push; the 5-minute interval is only
  // a socket-dropout fallback (was 30 s).
  const { data: alertCountData } = useQuery<{ count: number }>({
    queryKey: ["admin-alerts-unread-count"],
    queryFn: () =>
      fetch("/api/admin/alerts/unread-count", {
        headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" },
      }).then((r) => r.json()),
    refetchInterval: 300_000,
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

  // 93-C7 / C-UX3 (A12 H9): ESC closes the mobile nav drawer — it was
  // the only mobile surface with no keyboard exit (backdrop-click only).
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  // Real-time alert toasts. Round-4 (perf P1-5): the SocketInitializer's
  // admin-room listener fires ADMIN_ALERT_NEW_EVENT the moment a row is
  // inserted (jobs/alertLogger emits on insert) — poll() runs immediately
  // and toasts land at alert time. The 5-minute interval is only a
  // socket-dropout fallback (was 30 s).
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
        headers,
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

    poll();
    const onSocketAlert = () => poll();
    window.addEventListener(ADMIN_ALERT_NEW_EVENT, onSocketAlert);
    const id = setInterval(poll, 300_000);
    return () => {
      clearInterval(id);
      window.removeEventListener(ADMIN_ALERT_NEW_EVENT, onSocketAlert);
    };
  }, [adminToken, headers]);

  const refreshLabel =
    secondsAgo < 10
      ? "الآن"
      : secondsAgo < 60
        ? `${secondsAgo} ث`
        : `${Math.round(secondsAgo / 60)} د`;
  const pageTitle = pageTitleFor(location);
  const activeHref = computeActiveHref(location);
  const totalBadges =
    (mergedBadges.pendingTopups ?? 0) +
    (mergedBadges.openTickets ?? 0) +
    (mergedBadges.unreadAlerts ?? 0);

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
        {NAV_SECTIONS.map((section) => {
          // Filter section items by RBAC: items without a scope are
          // always visible (dashboard / self-service settings).
          // hasAdminPermission("all") short-circuits true for super
          // admins so they see every nav item exactly as before.
          const visibleItems = section.items.filter(
            (item) => !("scope" in item) || !item.scope || hasAdminPermission(item.scope),
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label}>
              {!collapsed && (
                <div className="px-2 mb-1.5">
                  {/* 93-C7 / C-UX5 (A11 §8): Arabic section labels dropped
                      `uppercase tracking-widest` — letter-spacing severs
                      Arabic letter connections; uppercase is a no-op on
                      Arabic and only added visual noise. */}
                  <span className="text-[10px] font-bold text-muted-foreground">
                    {section.label}
                  </span>
                </div>
              )}
              {collapsed && <div className="h-px bg-border/40 mb-2" />}
              <div className="space-y-0.5">
                {visibleItems.map((item) => (
                  <NavItem
                    key={item.href}
                    item={item}
                    location={location}
                    activeHref={activeHref}
                    badge={
                      item.badgeKey
                        ? (mergedBadges as Record<string, number>)?.[item.badgeKey]
                        : undefined
                    }
                    collapsed={collapsed}
                    contextActions={CONTEXT_ACTIONS[location] ?? []}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </div>
            </div>
          );
        })}
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
            <kbd className="text-[10px] font-mono bg-muted/60 border border-border/50 px-1 py-0.5 rounded group-hover:border-border transition-colors">
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
      {showSearch && adminToken && <GlobalSearch onClose={() => setShowSearch(false)} />}

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-card border-l border-border transition-all duration-200 ${collapsed ? "w-[52px]" : "w-52"}`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay — 93-C7 / C-UX3 (A12 H9): the drawer gains
          dialog semantics (role/aria-modal/label) + ESC-to-close; full
          Radix Drawer migration is a documented follow-up (§11.2 rule 6). */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/65 z-40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="قائمة الإدارة"
            className="md:hidden fixed right-0 top-0 bottom-0 w-[min(18rem,85vw)] bg-card border-l border-border z-50 shadow-2xl animate-in slide-in-from-right-4 duration-200"
          >
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-30 border-b border-border bg-card/93 backdrop-blur-md px-4 md:px-5 h-12 flex items-center gap-3">
          <button
            /* 96-F7 (R96 M12): p-2 + w-5 icons ≈ 36×36px hit area (was
               p-1.5 + w-4 ≈ 28px) — this is the screen-edge button, the
               hardest region to hit with a thumb. */
            className="md:hidden p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground relative"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
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
            <kbd className="text-[10px] font-mono bg-muted border border-border/50 px-1 py-0.5 rounded opacity-60 group-hover:opacity-100 transition-opacity">
              ⌘K
            </kbd>
          </button>

          {/* Mobile search icon */}
          <button
            onClick={() => setShowSearch(true)}
            /* 96-F7 (R96 M12): p-2 + w-5 icon ≈ 36px (edge-adjacent
               target, was ~28px). */
            className="sm:hidden p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
          >
            <Search className="w-5 h-5" />
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
            /* 96-F7 (R96 M12): p-2 + w-5 icon ≈ 36px (was ~25px). */
            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90 shrink-0"
            title={theme === "dark" ? "وضع نهاري" : "وضع ليلي"}
            aria-label={theme === "dark" ? "تبديل المظهر (داكن/فاتح)" : "تبديل المظهر (فاتح/داكن)"}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          {onRefresh && (
            <button
              onClick={onRefresh}
              /* 96-F7 (R96 M12): p-2 + w-5 icon ≈ 36px (was ~25px). */
              className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90 shrink-0"
              title="تحديث البيانات"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Page content */}
        <div className="max-w-7xl mx-auto px-4 md:px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] md:py-7">
          {children}
        </div>
      </main>
      <CopilotPanel />
    </div>
  );
}
