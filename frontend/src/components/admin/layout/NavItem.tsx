import { Link } from "wouter";
import type { NavItemShape } from "./nav-sections";

// R137 (1-f decomposition): extracted verbatim from pages/admin/layout.tsx —
// the sidebar's nav item link (active styling, collapsed icon-only mode,
// badge pills, the active item's context-action sub-links). Presentational:
// every value (item/location/activeHref/badge/collapsed/contextActions) and
// callback (onNavigate) flows down as props — no own state, the page owns
// the truth. The move only changes its address — zero markup change.

// Module-scope so it is NOT redefined on every AdminLayout render
// (react-doctor/no-nested-component-definition). All previously-closed-over
// values are passed as props.
export function NavItem({
  item,
  activeHref,
  badge,
  collapsed,
  contextActions,
  onNavigate,
}: {
  item: NavItemShape;
  /** Accepted for interface parity with the pre-decomposition call site
      (layout.tsx still passes it); the active match rides `activeHref`
      alone, so the raw location is intentionally not destructured. */
  location?: string;
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
      {/* R125 (A6 B-12): aria-current="page" — the active item was
          visual-only (bg/border); the storefront MobileNav/Navbar already
          expose it (A5 #3), and this is the longest-prefix `active` the
          layout already computes. */}
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        /* R128 (A6 P3-1): collapsed = icon-only with NO accessible
           name — a screen-reader admin heard "link, link, link…" down
           the rail. The aria-label (present only when the visible
           <span> is hidden, so it never fights the text) + title
           restore the expanded label verbatim. */
        aria-label={collapsed ? item.label : undefined}
        title={collapsed ? item.label : undefined}
      >
        <div
          /* R139 (precision): the active item migrates to the r138 calm
             active pill — bg-primary/15 + text-primary-text +
             border-primary/30 + font-bold (the login tab pair /
             MobileNav / RiskFilterChips family, one vocabulary for every
             selected state). Two deltas vs the old border-primary/20:
             (1) /20 → /30 — the trio's pinned edge alpha (a /20 edge
             vanished on the muted sidebar); (2) BOTH states now carry
             the border box — the inactive branch adds
             border-transparent, so the active↔inactive toggle can never
             shift the label by a pixel (the jitter the duo killed on
             the storefront). The aria-current contract above is
             byte-identical — visual layer only. */
          className={`
            relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-semibold border
            transition-all duration-150 group
            ${
              active
                ? "bg-primary/15 text-primary-text font-bold border-primary/30"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }
            ${collapsed ? "justify-center px-2" : ""}
          `}
        >
          <item.icon
            className={`w-4 h-4 shrink-0 transition-colors ${active ? "text-primary" : ""}`}
          />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {!collapsed && badge ? (
            /* R116 (A8-07): the /20-tint pills measured 2.4:1 (active) and
               3.5:1 (idle) — both under AA even for bold small text. The
               solid tokens are the status-badge discipline applied here:
               primary pill when active, warning ink pair when idle. */
            <span
              className={`text-3xs font-bold px-1.5 py-0.5 rounded-full shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-status-warning/15 text-status-warning border border-status-warning/30"}`}
            >
              {badge}
            </span>
          ) : null}
          {collapsed && badge ? (
            /* R128 (A1-D3/F1): the solid raw-yellow corner dot (yellow
               surface + black ink) was off-token on both axes and
               un-derivable in light theme (black on the light warning
               ≈ 2:1). The EXPANDED sibling pill above already ships the
               AA warning ink-pair — the collapsed dot adopts it (one
               vocabulary, both themes). */
            <span className="absolute -top-0.5 -left-0.5 w-3.5 h-3.5 bg-status-warning/15 text-status-warning border border-status-warning/30 text-3xs font-bold rounded-full flex items-center justify-center">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </div>
      </Link>

      {active && !collapsed && contextActions.length > 0 && (
        <div className="mt-1 mr-3 space-y-0.5 border-r border-primary/15 pr-2">
          {contextActions.map((action) => (
            <Link key={action.href + action.label} href={action.href} onClick={onNavigate}>
              {/* R125 (A6 B-6): hover:text-primary on a muted link is
                  the dark-theme 3.76:1 family — the text-primary-text
                  token is the storefront sweep's fix applied to the
                  admin context actions. */}
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-primary-text hover:bg-primary/8 transition-all duration-100">
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
