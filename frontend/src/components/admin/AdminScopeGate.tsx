import type { ReactNode } from "react";
import { AdminLayout } from "../../pages/admin/layout";

/**
 * R134 (A3-F1): the honest-reason scope gate, shared by every
 * scope-gated admin page — the R133 risk.tsx/system.tsx/risk-event.tsx
 * idiom, finally propagated.
 *
 * The nav (layout.tsx NAV_SECTIONS) already hides each page from admins
 * without its scope, so this banner is reached ONLY via a deep link —
 * but a deep link used to mount the page, fire every query (a
 * synchronized 403 burst per poll cycle), and land on a FetchErrorCard
 * whose Arabic 403 body reads as a load failure with a retry that can
 * never succeed: an authorization outcome dressed as an outage.
 *
 * Usage (the risk.tsx:107 pattern, with this banner as the early return):
 *
 *   const { adminToken, hasAdminPermission } = useAuth();
 *   const canView = hasAdminPermission("inventory"); // R134 (A3-F1)
 *   // … every query: enabled: !!adminToken && canView
 *   if (!canView) return <AdminScopeGate scope="inventory" />;
 *
 * The gate must sit AFTER every hook (the queries' `enabled` gates keep
 * a scope-less mount fetch-free); the banner keeps the status-warning
 * token (AA contrast in both themes) the R133 trio established.
 */

/** Arabic labels for the permission scopes, for the honest-reason banner. */
const ADMIN_SCOPE_LABELS: Record<string, string> = {
  users: "المستخدمين",
  inventory: "المنتجات والمخزون",
  finance: "المعاملات المالية",
  support: "الدعم",
  admins: "المسؤولين",
  orders: "الطلبات",
  settings: "الإعدادات",
};

export function AdminScopeGate({ scope }: { scope: string }): ReactNode {
  const label = ADMIN_SCOPE_LABELS[scope] ?? scope;
  return (
    <AdminLayout>
      {/* R139 (precision): VERIFIED, no visual change — the gate already
          rides the quiet-warning register r138 pinned for banners: the
          AA --status-warning ink pair on a /10 tint + /30 edge (both
          themes safe, the R125-I2 A6-B4 decision), with the severity
          living in the CONTENT (the honest reason line — which scope is
          missing + who to ask), never in a heavier red/amber wall. The
          one-line density is the admin dialect; six r139 domain agents
          inherit this gate verbatim. */}
      <p className="text-sm text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2">
        هذه الصفحة تتطلب صلاحية {label} — تواصل مع مسؤول النظام
      </p>
    </AdminLayout>
  );
}
