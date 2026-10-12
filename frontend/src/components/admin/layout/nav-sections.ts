import {
  Activity,
  Bell,
  Calculator,
  Gift,
  LayoutDashboard,
  MessageSquare,
  Package,
  QrCode,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

// R137 (1-f decomposition): extracted verbatim from pages/admin/layout.tsx —
// the admin shell's nav route table. NAV_SECTIONS is a PUBLIC export of the
// layout module (admin-layout-nav-scope.test.tsx + admin-document-title.test
// import it from @/pages/admin/layout, which re-exports it from here), and
// NavItemShape types every nav item the sidebar renders. The move only
// changes the table's address — zero behavior, zero markup change.

// R120-B4 (A2-F1): exported for the nav-scope parity regression test
// (admin-layout-nav-scope.test.tsx asserts each scoped item matches the
// requirePermission its page's APIs actually enforce).
export const NAV_SECTIONS = [
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
    // R124-I5 (A6 F16): the group holds catalog entities (products /
    // enrichment / pricing / promotions) AND customer+pricing entities
    // (users / referrals / coupons) — «الكتالوج» alone mislabeled four
    // of seven items. The label now names both halves of what it
    // actually contains.
    label: "الكتالوج والعملاء",
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
      // R120-B4 (A2-F1): scope parity — every coupon admin API is
      // requirePermission("finance") (backend/src/routes/coupons.ts
      // list/create/patch/delete), so an inventory-only operator saw
      // the nav item and hit a 403 wall on click. The scope now matches
      // the enforced permission (pinned by admin-layout-nav-scope.test.tsx).
      { href: "/admin/coupons", label: "الكوبونات", icon: Tag, scope: "finance" },
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

export type NavItemShape = (typeof NAV_SECTIONS)[number]["items"][number];
