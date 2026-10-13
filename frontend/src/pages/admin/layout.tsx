import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { adminFetch, adminFetchJson } from "@/lib/admin-session";
import { useTheme } from "@/lib/theme";
import { ADMIN_ALERT_NEW_EVENT } from "@/lib/socket-events";
// R124-I5 (A6 F12): CopilotPanel (1,676 lines + its history view) is no
// longer STATICALLY imported into the admin layout chunk — every admin
// route paid for a component that only mounts a floating launcher. It
// now rides its own code-split chunk via the App.tsx lazyWithRetry
// recipe (stale-deploy chunk recovery included); the import fires on
// the first admin mount, in parallel with the page's own chunk.
import { lazyWithRetry } from "@/lib/lazy-with-retry";
const CopilotPanel = lazyWithRetry(() =>
  import("@/components/admin/copilot/CopilotPanel").then((m) => ({ default: m.CopilotPanel })),
);
import { useQuery } from "@tanstack/react-query";
import { getGetAdminStatsQueryKey, useGetAdminStats } from "@workspace/api-client-react";
import { ChevronRight, LogOut, Menu, Moon, RefreshCw, Search, Shield, Sun, X } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
// R137 (1-f decomposition): the admin shell's verbatim extracts under
// components/admin/layout/ — GlobalSearch (the ⌘K palette, a CopilotPanel-
// style self-contained feature component owning its overlay-local state),
// SidebarNav (the RBAC-filtered nav section list), SearchTriggers (the
// top-bar search affordances), NavItem, and the React-free modules
// (nav-sections / layout-nav / focus-trap). This file stays the
// orchestration core: every coordinating state atom (auth/session,
// sidebar/drawer/search), both badge queries, the alert poll, the
// focus/drawer effects and the per-route document title live here; the
// extracts take values + callbacks only.
import { GlobalSearch } from "@/components/admin/layout/GlobalSearch";
import {
  computeActiveHref,
  pageTitleFor,
  STOREFRONT_DEFAULT_TITLE,
} from "@/components/admin/layout/layout-nav";
import { SearchTriggers } from "@/components/admin/layout/SearchTriggers";
import { SidebarNav } from "@/components/admin/layout/SidebarNav";
import { trapTabKey } from "@/components/admin/layout/focus-trap";
// R120-B4 (A2-F1): exported for the nav-scope parity regression test
// (admin-layout-nav-scope.test.tsx asserts each scoped item matches the
// requirePermission its page's APIs actually enforce) — the table itself
// moved verbatim to components/admin/layout/nav-sections.ts; this
// re-export keeps the layout module's public surface exactly as it was
// (AdminLayout + NAV_SECTIONS, no default export).
export { NAV_SECTIONS } from "@/components/admin/layout/nav-sections";

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
  // R125 (A6 B-11/B-15): the mobile drawer (focus move-in/return) and
  // its hamburger toggle are wired by ref below.
  const drawerRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  // R123 (E3 item 4): the alerts badge + poll machinery is support-
  // scoped — the التنبيهات nav item already gates on "support"
  // (NAV_SECTIONS above), but the unread-count query and the 5-min
  // /alerts/new poll below ran for EVERY admin, so a finance-only
  // operator silently 403-ed every 5 minutes for a badge whose nav
  // item they cannot even see. Declared up here so both the query and
  // the poll effect share one source of truth.
  const canSeeSupportBadge = hasAdminPermission("support");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // R122 (A2-P2): lastUpdated is null until the first badge query
  // actually lands data — the old new Date() seed made the pill read
  // «الآن» on mount even while every fetch was failing (see the pill
  // render in the top bar below).
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Auto-fetch unread alerts count for the badge — works on every page.
  // Round-4 (perf P1-5): the admin-room socket listener invalidates this
  // query on every `admin-alert-new` push; the 5-minute interval is only
  // a socket-dropout fallback (was 30 s).
  //
  // 98-F7 (R98-06): the queryFn previously did `.then((r) => r.json())`
  // with NO r.ok check AND hand-built `Authorization: adminToken ? ... :
  // ""` — a 401/500/503 error envelope parsed "successfully" into
  // `{error,code}` whose `.count` is undefined, and the badge silently
  // read 0 through the `?? 0` chain while the API was down (the exact
  // "error rendered as empty" class earlier rounds killed on every
  // page), and the empty-string bearer was the malformed-header shape
  // useAdminHeaders exists to prevent. Now: the page's existing
  // useAdminHeaders value, r.ok checked BEFORE parsing, and a thrown
  // Error on non-OK / malformed body — the query enters its error state
  // (data undefined ⇒ badge hides / falls back to the page-passed
  // count) instead of lying with a zero. 401/500/503 are "unknown",
  // never "0"; the next socket event or 5-min fallback refetch recovers.
  //
  // R123 (E3 items 1+4): the ok-guard + safe parse now ride the
  // session-aware adminFetchJson wrapper (a mid-work 401 throws
  // AdminSessionExpiredError after the global toast + redirect — a
  // non-JSON 502 body no longer surfaces an English SyntaxError), and
  // the query is gated on the support scope exactly like its nav item:
  // a scope-less admin has no badge to feed, and a disabled query
  // never errors (the "last updated" pill stays honest).
  const {
    data: alertCountData,
    dataUpdatedAt: alertsUpdatedAt,
    // R122 (A2-P2): feeds the "last updated" pill's error state (see
    // anyBadgeQueryError below).
    isError: alertsQueryError,
  } = useQuery<{ count: number }>({
    queryKey: ["admin-alerts-unread-count"],
    queryFn: async () => {
      const body = await adminFetchJson<{ count?: unknown }>("/api/admin/alerts/unread-count", {
        headers,
      });
      if (typeof body?.count !== "number") {
        // 200 with a non-numeric count is a contract break — same honest
        // error path as non-OK (never coerce undefined into 0).
        throw new Error("UNREAD_COUNT_BAD_SHAPE");
      }
      return { count: body.count };
    },
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
    enabled: !!adminToken && canSeeSupportBadge,
    staleTime: 15_000,
  });

  // R115 (A9 P2): the money-queue badge (pending topups) used to be
  // passed ONLY by the pages that loaded it (dashboard/topups) — it
  // blinked out on every other admin page while approvals waited. The
  // layout now subscribes to the SERVER count itself: the generated
  // useGetAdminStats hook rides the SAME TanStack key as the
  // dashboard's instance (dedup + the admin-room socket's
  // ["/api/admin/stats"] invalidation refreshes the badge on every
  // topup approve/reject), gated on the finance scope — the topups nav
  // item is finance-scoped, so there is no badge to render without it
  // and no reason to poll. A query error = unknown (never a lying 0):
  // mergedBadges falls back to whatever the current page passed.
  // R120-B4 (A2-F3): the open-tickets badge also rides the server
  // stats count (see A2-F3 below) — the query is enabled when EITHER
  // badge-owning nav scope is visible (finance → topups, support →
  // tickets), mirroring pendingTopups' finance gating.
  const canSeeFinanceBadge = hasAdminPermission("finance");
  const {
    data: layoutStats,
    dataUpdatedAt: statsUpdatedAt,
    // R122 (A2-P2): feeds the "last updated" pill's error state — a
    // disabled (scope-less) query never errors, so this is naturally
    // false for admins the stats subscription doesn't apply to.
    isError: statsQueryError,
  } = useGetAdminStats({
    query: {
      queryKey: getGetAdminStatsQueryKey(),
      // R126 (R1-P3): /api/admin/stats is finance-gated server-side
      // since this round — a support-only session polling it every 5
      // min is a guaranteed 403 zombie. Finance-scope admins keep the
      // server-sourced pendingTopups + openTickets pair; support-only
      // sessions ride the page-passed badge fallback (the documented
      // L4 residual — never a lying 0, the tickets page's count wins).
      enabled: !!adminToken && canSeeFinanceBadge,
      refetchInterval: 300_000,
      refetchIntervalInBackground: false,
    },
    request: { headers },
  });

  // R120-B4 (A2-F3): openTickets joins the layout-sourced badges. The
  // dashboard/tickets pages used to be the ONLY passers — every other
  // admin page rendered a hard 0 while tickets waited. The stats
  // endpoint now counts open/in_progress tickets (30s cacheWrap window,
  // the same staleness contract pending_topups already rides); the
  // tickets page keeps its local override via the `badges` fallback.
  // R127: the generated AdminStats type ships open_tickets since the
  // L1 batch-2 regen — the local widening cast is retired.

  const mergedBadges = {
    ...badges,
    // R115 (A9 P2): the layout's own SERVER-sourced count wins over the
    // page-passed one (the topups page used to pass its loaded-row
    // count — a partial that disagreed with the dashboard's server
    // number); the page-passed value stays as the error fallback.
    pendingTopups: layoutStats?.pending_topups ?? badges?.pendingTopups ?? 0,
    // R120-B4 (A2-F3): support-gated server truth with the same
    // page-passed error fallback (never a lying 0 — a stats failure
    // leaves openTickets undefined and the tickets page's local count
    // wins).
    openTickets: canSeeSupportBadge
      ? (layoutStats?.open_tickets ?? badges?.openTickets ?? 0)
      : (badges?.openTickets ?? 0),
    unreadAlerts: alertCountData?.count ?? badges?.unreadAlerts ?? 0,
  };

  // R120-B4 (A2-F10): the pill's timestamp is keyed on the layout's
  // OWN query data updates — the old `useEffect(…, [children])` fired
  // on every page render (any keystroke in any controlled input
  // restarted the "الآن" clock while the data sat stale). Both badge
  // queries always-on for every admin (alerts) or scoped (stats):
  // dataUpdatedAt advances only when fresh data actually landed.
  const dataRefreshedAt = Math.max(alertsUpdatedAt, statsUpdatedAt);
  // R122 (A2-P2): the "last updated" pill used to render an always-green
  // pulsing dot and a "الآن" seeded at mount — on a fresh mount with a
  // failing API it claimed freshness while nothing had landed, and the
  // dot stayed green through every query error (the sibling system.tsx
  // colors its aggregate pill by real status). The pill now derives from
  // the REAL query state: gray (no pulse) while the first fetch is in
  // flight, amber when a badge query sits in error (with the honest
  // stale age of whatever did land), emerald pulse only once data has
  // actually landed and no badge query is failing.
  const anyBadgeQueryError = alertsQueryError || statsQueryError;
  useEffect(() => {
    if (dataRefreshedAt > 0) {
      setLastUpdated(new Date(dataRefreshedAt));
      setSecondsAgo(0);
    }
  }, [dataRefreshedAt]);
  useEffect(() => {
    // No data has landed yet — there is no age to tick (the pill shows
    // the in-flight/error state instead of a fake "الآن").
    if (!lastUpdated) return;
    const id = setInterval(
      () => setSecondsAgo(Math.round((Date.now() - lastUpdated.getTime()) / 1000)),
      5000,
    );
    return () => clearInterval(id);
  }, [lastUpdated]);

  // R122 (A2-P2): the palette + its triggers render only for operators
  // holding at least one of the three searched scopes (GlobalSearch does
  // the per-section gating) — an admin whose scopes 403 all three
  // endpoints no longer sees a search affordance that can only ever
  // answer «لا نتائج». Declared before the ⌘K effect below so the
  // shortcut and the triggers share one source of truth.
  const canGlobalSearch =
    hasAdminPermission("orders") || hasAdminPermission("users") || hasAdminPermission("inventory");

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // R122 (A2-P2): the shortcut only opens the palette when the
        // operator holds at least one search scope (the triggers below
        // hide for scope-less admins — the shortcut must not promise
        // what they cannot use).
        if (!canGlobalSearch) return;
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // Scopes are fixed for the session (AuthProvider re-reads them only
    // on re-login) — the first-render capture below is the whole truth.
  }, [canGlobalSearch]);

  // 93-C7 / C-UX3 (A12 H9): ESC closes the mobile nav drawer — it was
  // the only mobile surface with no keyboard exit (backdrop-click only).
  // R125 (A6 B-15): Tab is trapped inside the drawer while it is open —
  // the aside claims role="dialog" aria-modal="true", and Tab previously
  // walked out of the "modal" into the page behind it.
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
      else if (e.key === "Tab" && drawerRef.current) trapTabKey(drawerRef.current, e);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  // R125 (A6 B-15): the drawer announced itself (role/aria-modal/Esc)
  // but focus never moved in — screen readers kept reading the page
  // behind the "modal" — and closing dropped focus to <body>. Move focus
  // into the dialog on open, return it to the hamburger (the only
  // opener) on close. Programmatic focus on tabIndex -1 shows no
  // :focus-visible outline (the global rule keys on focus-visible).
  useEffect(() => {
    if (!mobileOpen) return;
    drawerRef.current?.focus();
    return () => {
      hamburgerRef.current?.focus();
    };
  }, [mobileOpen]);

  // Real-time alert toasts. Round-4 (perf P1-5): the SocketInitializer's
  // admin-room listener fires ADMIN_ALERT_NEW_EVENT the moment a row is
  // inserted (jobs/alertLogger emits on insert) — poll() runs immediately
  // and toasts land at alert time. The 5-minute interval is only a
  // socket-dropout fallback (was 30 s).
  // R123 (E3 items 1+4): the poll rides the session-aware adminFetch
  // wrapper (a mid-work 401 → AdminSessionExpiredError, swallowed by the
  // existing catch — the global toast + redirect already fired) AND is
  // gated on the support scope like the alerts nav item: a finance-only
  // admin no longer 403-silently every 5 minutes for toasts whose page
  // they cannot open.
  useEffect(() => {
    if (!adminToken || !canSeeSupportBadge) return;

    const ALERT_LABELS: Record<string, string> = {
      coupon_maxed: "كوبون استُنفد",
      coupon_expiring: "كوبون منتهٍ قريباً",
      low_stock: "مخزون منخفض",
      no_stock: "نفاد مخزون",
      system: "إشعار النظام",
    };

    const poll = () => {
      // R104 (AG2-7): a hidden admin tab must NEVER poll — this is a raw
      // setInterval (react-query's refetchIntervalInBackground:false
      // does not apply here), and an operator's forgotten background tab
      // polling every 5 min keeps resetting Render's 15-minute idle
      // timer all night. Visible-tab semantics only; the socket event
      // listener below still covers background delivery while the admin
      // socket is parked-then-revived.
      if (document.visibilityState === "hidden") return;
      const lastId = Number(localStorage.getItem("sn_last_alert_id") ?? "0");
      adminFetch(`/api/admin/alerts/new?since=${lastId}`, {
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
    // Returning to the tab catches up anything missed while hidden.
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    window.addEventListener(ADMIN_ALERT_NEW_EVENT, onSocketAlert);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(poll, 300_000);
    return () => {
      clearInterval(id);
      window.removeEventListener(ADMIN_ALERT_NEW_EVENT, onSocketAlert);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Scopes are fixed for the session (AuthProvider re-reads them only
    // on re-login) — see the canGlobalSearch effect above.
  }, [adminToken, headers, canSeeSupportBadge]);

  const refreshLabel =
    secondsAgo < 10
      ? "الآن"
      : secondsAgo < 60
        ? `${secondsAgo} ث`
        : `${Math.round(secondsAgo / 60)} د`;
  const pageTitle = pageTitleFor(location);

  // R125 (A6 B-1): per-route document.title. Admin never set one, so
  // the App-level fallback MetaTags stamped the STOREFRONT title on
  // every /admin/* route and the RouteAnnouncer (App.tsx) — which
  // announces only title CHANGES — was silent on every admin→admin
  // navigation. PAGE_TITLES already drove the top-bar heading; it now
  // feeds the document title too, so SR users hear the destination
  // page's name on every admin navigation (2.4.2 + 4.1.3). Ordering:
  // this effect runs after the App-level fallback re-applies on the
  // same commit, so the admin title is the final write. On unmount the
  // app default is restored — /admin/login (the one admin route without
  // AdminLayout) lands back on the honest default instead of the last
  // visited page's name.
  useEffect(() => {
    document.title = `${pageTitle} — SubNation الإدارة`;
    return () => {
      document.title = STOREFRONT_DEFAULT_TITLE;
    };
  }, [pageTitle]);

  const activeHref = computeActiveHref(location);
  const totalBadges =
    (mergedBadges.pendingTopups ?? 0) +
    (mergedBadges.openTickets ?? 0) +
    (mergedBadges.unreadAlerts ?? 0);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Sidebar header */}
      <div
        /* R139 (precision): the sidebar's resting chrome joins the r138
           border/60 family — the storefront Navbar's resting edge
           (border-border/35) and the card family's border/60 are the two
           sanctioned resting weights; a full border-border edge on a
           permanent side rail read heavier than every card it frames. */
        className={`p-3 border-b border-border/60 flex items-center gap-2 ${collapsed ? "justify-center" : "justify-between"}`}
      >
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0 shadow-sm shadow-primary/30">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <div className="font-bold text-xs leading-none">SubNation</div>
              <div className="text-3xs text-muted-foreground leading-none mt-0.5">لوحة الإدارة</div>
            </div>
          </div>
        ) : (
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center relative shadow-sm shadow-primary/30">
            <Shield className="w-3.5 h-3.5 text-white" />
            {totalBadges > 0 && (
              /* R128 (A1-D3): same yellow-400 corner dot as the NavItem
                 collapsed badge — migrated to the sibling AA ink-pair. */
              <span className="absolute -top-1 -left-1 w-3.5 h-3.5 bg-status-warning/15 text-status-warning border border-status-warning/30 text-3xs font-bold rounded-full flex items-center justify-center">
                {totalBadges > 9 ? "9+" : totalBadges}
              </span>
            )}
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          /* R125 (A6 B-11): icon-only control had no accessible name and
             hid its expanded state. */
          aria-label="تصغير القائمة الجانبية"
          aria-expanded={!collapsed}
          className="hidden md:flex p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Nav sections */}
      <SidebarNav
        location={location}
        activeHref={activeHref}
        collapsed={collapsed}
        mergedBadges={mergedBadges}
        hasAdminPermission={hasAdminPermission}
        onNavigate={() => setMobileOpen(false)}
      />

      {/* Footer: search hint + logout */}
      {/* R139 (precision): border-border/60 — same resting-edge family as
          the header above and the rail's outer edge (one weight for all
          sidebar chrome dividers). */}
      <div className="p-2.5 border-t border-border/60 space-y-0.5">
        {!collapsed && canGlobalSearch && (
          <button
            onClick={() => setShowSearch(true)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all duration-150 group press-spring"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-right">بحث سريع</span>
            <kbd className="text-3xs font-mono bg-muted/60 border border-border/50 px-1 py-0.5 rounded group-hover:border-border transition-colors">
              ⌘K
            </kbd>
          </button>
        )}
        <button
          onClick={adminLogout}
          /* R128 (A6 P3-1): icon-only when collapsed — carry the expanded
             label «خروج» (same treatment as the NavItem links). */
          aria-label={collapsed ? "خروج" : undefined}
          title={collapsed ? "خروج" : undefined}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-all duration-150 press-spring ${collapsed ? "justify-center" : ""}`}
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
      {showSearch && adminToken && canGlobalSearch && (
        <GlobalSearch onClose={() => setShowSearch(false)} />
      )}

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-card border-l border-border/60 transition-all duration-200 ${collapsed ? "w-[52px]" : "w-52"}`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay — 93-C7 / C-UX3 (A12 H9): the drawer gains
          dialog semantics (role/aria-modal/label) + ESC-to-close; full
          Radix Drawer migration is a documented follow-up (§11.2 rule 6). */}
      {mobileOpen && (
        <>
          {/* R139 (precision): bg-black/65 → /70 — the drawer is a modal
              surface (role=dialog + aria-modal below); the app-dialog
              overlay family pins /70 + blur, and the two admin overlays
              (this drawer, the ⌘K palette) drift at /65. One scrim value
              across every modal in the app. */}
          <div
            className="md:hidden fixed inset-0 bg-black/70 z-40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            id="admin-mobile-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="قائمة الإدارة"
            tabIndex={-1}
            /* R139 (precision): the drawer panel retires its glass-era
               wide shadow + full border — border-border/60 (the resting
               family) and shadow-sm as the single contact shadow: the
               R124-A3 #10 "declare elevation once" rule the app-dialog
               shell already rides (over the dark blurred scrim a 2xl
               spread was invisible anyway — the border is the edge
               device). Focus-trap/drawer logic and every attribute
               above are byte-identical (R125 contract). */
            className="md:hidden fixed right-0 top-0 bottom-0 w-[min(18rem,85vw)] bg-card border-l border-border/60 z-50 shadow-sm animate-in slide-in-from-right-4 duration-200"
          >
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* Top bar */}
        {/* R126 (A13-F11): the sticky top bar grows by the top safe-area
            inset — the storefront Navbar's exact chrome pattern (env()
            padding on the sticky container, fixed-height row inside).
            viewport-fit=cover ships in the meta, and the admin console is
            phone-reachable (A13 F6/F7 measured it at 390px): in PWA
            standalone or landscape-Safari the h-12 bar otherwise sits
            under the notch/Dynamic Island. env() is 0 where no inset
            exists, so desktop is pixel-identical. */}
        {/* R139 (precision): the topbar retires the LAST glass surface in
            the admin shell — bg-card/93 + backdrop-blur-md → solid bg-card
            (the r138 "glass retired everywhere" rule; the Navbar's R96 F-4
            recipe). The resting edge drops to border-border/60 (the
            sidebar/card resting family — a full border-border under the
            brand hairline read as a double rule), and .hairline-glow adds
            the top-edge 1px primary/30 glint the storefront chrome family
            (Navbar/MobileNav) shares — the admin bar's top edge is the
            page's topmost chrome row, exactly where that vocabulary lives.
            Sticky establishes the containing block for the absolute
            hairline; safe-area chrome below is untouched (R126 A13-F11). */}
        <div className="sticky top-0 z-30 border-b border-border/60 bg-card pt-[env(safe-area-inset-top)]">
          <div className="hairline-glow" />
          <div className="px-4 md:px-5 h-12 flex items-center gap-3">
            <button
              /* 96-F7 (R96 M12): p-2 + w-5 icons ≈ 36×36px hit area (was
                 p-1.5 + w-4 ≈ 28px) — this is the screen-edge button, the
                 hardest region to hit with a thumb. */
              ref={hamburgerRef}
              className="md:hidden p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground relative"
              onClick={() => setMobileOpen((v) => !v)}
              /* R125 (A6 B-11): icon-only with no name and no expanded
                 state — the storefront Navbar's hamburger has both (A5
                 #4). The drawer itself is #admin-mobile-drawer above. */
              aria-label={mobileOpen ? "إغلاق قائمة الإدارة" : "فتح قائمة الإدارة"}
              aria-expanded={mobileOpen}
              aria-controls="admin-mobile-drawer"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              {!mobileOpen && totalBadges > 0 && (
                /* R128 (A1-D3): same yellow-400 corner dot family —
                   migrated to the AA warning ink-pair. */
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-status-warning/15 text-status-warning border border-status-warning/30 text-3xs font-bold rounded-full flex items-center justify-center">
                  {totalBadges > 9 ? "9+" : totalBadges}
                </span>
              )}
            </button>

            <h1 className="font-bold text-sm flex-1 truncate">{pageTitle}</h1>

            <SearchTriggers
              canGlobalSearch={canGlobalSearch}
              onOpenSearch={() => setShowSearch(true)}
            />

            {/* Last updated */}
            {/* R122 (A2-P2): the dot + label now reflect query reality —
                emerald pulse only when data landed and no badge query
                errors; amber (no pulse) while a query sits in error, with
                the honest stale age; gray while the first fetch is still
                in flight (never a fake "الآن/live"). */}
            {/* R125 (A6 B-15): below sm the colored dot was the SOLE
                state signal (color-only, 1.4.1) — the visible pill text
                is `hidden sm:inline`, so narrow-viewport SR users heard
                nothing. An sr-only twin carries the same text; sm:hidden
                removes it from the a11y tree once the visible text
                exists (no double read on ≥sm). */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
              {anyBadgeQueryError ? (
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full bg-status-warning inline-block"
                  title="تعذّر تحديث البيانات"
                />
              ) : lastUpdated ? (
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse inline-block"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 inline-block"
                />
              )}
              <span className="hidden sm:inline">
                {anyBadgeQueryError
                  ? lastUpdated
                    ? `تعذّر التحديث · آخر تحديث ${refreshLabel}`
                    : "تعذّر التحديث"
                  : lastUpdated
                    ? refreshLabel
                    : "جارٍ التحديث…"}
              </span>
              <span className="sr-only sm:hidden">
                {anyBadgeQueryError
                  ? lastUpdated
                    ? `تعذّر التحديث · آخر تحديث ${refreshLabel}`
                    : "تعذّر التحديث"
                  : lastUpdated
                    ? refreshLabel
                    : "جارٍ التحديث…"}
              </span>
            </div>

            {/* Theme toggle — always visible. Reuses the app-level
                ThemeProvider context so the toggle in the public navbar
                and this one stay in lockstep. */}
            <button
              onClick={toggleTheme}
              /* 96-F7 (R96 M12): p-2 + w-5 icon ≈ 36px (was ~25px). */
              className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90 shrink-0"
              title={theme === "dark" ? "وضع نهاري" : "وضع ليلي"}
              aria-label={
                theme === "dark" ? "تبديل المظهر (داكن/فاتح)" : "تبديل المظهر (فاتح/داكن)"
              }
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
        </div>

        {/* Page content */}
        <div className="max-w-7xl mx-auto px-4 md:px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] md:py-7">
          {children}
        </div>
      </main>
      {/* R124-I5 (A6 F12): the launcher pops in once its own chunk
          lands (first admin visit only — cached afterwards); a null
          fallback avoids layout shift for a floating, non-critical
          affordance. */}
      <Suspense fallback={null}>
        <CopilotPanel />
      </Suspense>
    </div>
  );
}
