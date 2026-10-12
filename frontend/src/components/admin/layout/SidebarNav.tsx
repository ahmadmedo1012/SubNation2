import { CONTEXT_ACTIONS } from "./layout-nav";
import { NavItem } from "./NavItem";
import { NAV_SECTIONS } from "./nav-sections";

// R137 (1-f decomposition): extracted verbatim from pages/admin/layout.tsx —
// the sidebar's nav section list: each NAV_SECTIONS group filtered by the
// admin's RBAC scopes (items without a scope are always visible), with the
// collapsed-rail divider variant and per-item badges. Presentational: every
// value (location/activeHref/collapsed/mergedBadges) and callback
// (hasAdminPermission/onNavigate) flows down from the page — the RBAC truth
// and the badge queries stay in the layout. The move only changes its
// address — zero markup change.

export function SidebarNav({
  location,
  activeHref,
  collapsed,
  mergedBadges,
  hasAdminPermission,
  onNavigate,
}: {
  location: string;
  activeHref: string;
  collapsed: boolean;
  mergedBadges: { pendingTopups?: number; openTickets?: number; unreadAlerts?: number };
  hasAdminPermission: (scope: string) => boolean;
  onNavigate: () => void;
}) {
  return (
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
                <span className="text-3xs font-bold text-muted-foreground">{section.label}</span>
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
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
