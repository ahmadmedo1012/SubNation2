import { Link, useLocation } from "wouter";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { cartChangeAnnouncement, useCart } from "@/lib/cart";
import { useTheme } from "@/lib/theme";
import { cn, formatCount } from "@/lib/utils";
import { Menu, Moon, ShoppingCart, Sun, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
// R146 (components audit F1): the drawer’s Tab trap rides the shared
// React-free helper (lib/a11y) — importing it drags no admin shell.
import { trapTabKey } from "@/lib/a11y/trap-tab-key";
import { Logo } from "./Logo";
// R167 (layout decomposition — F13): the presentation seams moved
// verbatim to ./navbar/ — the two drawer panels (GuestDrawer /
// AuthedDrawer, sharing this file's drawer machinery via props), the
// «الفئات» section (DrawerCategoriesSection), the desktop «الأقسام»
// disclosure (DesktopCategoriesMenu — a self-contained unit in the
// GlobalSearch precedent), the desktop authed/guest action cluster
// (DesktopUserActions), the mobile wallet chip (MobileWalletChip) and
// the shared drawer data tables (drawer-data.ts). The header keeps the
// orchestration: the cart announcer, the drawer state + Esc/Tab/focus/
// scroll-lock effects, the viewport-meta guard, the /me query and the
// row chrome (theme toggle, bell mount, hamburger, cart link).
import { AuthedDrawer } from "./navbar/AuthedDrawer";
import { DesktopCategoriesMenu } from "./navbar/DesktopCategoriesMenu";
import { DesktopUserActions } from "./navbar/DesktopUserActions";
import { GuestDrawer } from "./navbar/GuestDrawer";
import { MobileWalletChip } from "./navbar/MobileWalletChip";

const NotificationBell = lazyWithRetry(() =>
  import("./NotificationBell").then((m) => ({ default: m.NotificationBell })),
);

/**
 * R126 (A13-F2): the Tab half of the drawer's aria-modal promise — the
 * shared React-free helper (lib/a11y/trap-tab-key; R146 components-audit
 * F1 folded the former local copy onto it — the body was byte-identical,
 * and importing the helper drags no admin shell into the storefront
 * chunk). The drawer claims role="dialog" aria-modal="true", so Tab must
 * cycle inside it instead of walking into the page behind (WCAG 2.1.2).
 * Only Tab/Shift+Tab are intercepted; every other key is left to the
 * drawer's own handlers.
 */

export function Navbar() {
  const { token, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { itemCount, isLoaded } = useCart();
  // R-140-k (money-adjacent async state — the cart-change announcer):
  // the badge count is visual chrome; its live announcement now rides a
  // dedicated sr-only polite region below (the RouteAnnouncer idiom —
  // aria-live="polite" + role="status" + .sr-only). The state machine:
  // the prev-count mirror stays null until the cart provider reports
  // isLoaded — the mount-time localStorage read is a LOAD, not a change,
  // so a persisted cart never announces «أُضيف إلى السلة» on every page
  // load. After that, every count DELTA (add, remove, undo re-add,
  // cross-tab storage re-sync, checkout clear) maps through
  // lib/cart.tsx's cartChangeAnnouncement — the toast-family Arabic
  // verbatim + formatCount over the same plural forms the cart link's
  // accessible name inlines (both tables are pinned to the same words:
  // this file's «السلة، N …» pin and the live-regions-r140 unit pins).
  // Polite, never assertive: a cart change is a state update, not an
  // interrupt (the assertive register stays reserved for errors the
  // user must act on).
  const prevCartCountRef = useRef<number | null>(null);
  const [cartAnnouncement, setCartAnnouncement] = useState("");
  useEffect(() => {
    if (!isLoaded) return;
    if (prevCartCountRef.current === null) {
      // First settled observation — record, stay silent.
      prevCartCountRef.current = itemCount;
      return;
    }
    const announcement = cartChangeAnnouncement(prevCartCountRef.current, itemCount);
    prevCartCountRef.current = itemCount;
    if (announcement) setCartAnnouncement(announcement);
  }, [itemCount, isLoaded]);
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // R126 (A13-F2): the drawer panel + its toggle, wired by ref for the
  // dialog focus contract below (move-in on open, return on close).
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Close menu on route change
  useEffect(() => {
    setOpen(false);
  }, [location]);

  // R126 (A13-F2): ESC closes the drawer + Tab is trapped inside it
  // while it is open — the exact admin-console drawer contract (layout.tsx,
  // 93-C7 + R125 A6 B-15). Before this, the guest drawer was the one
  // mobile surface with NO keyboard exit: two Esc presses left
  // aria-expanded="true" and the body scroll-lock engaged (A13 measured)
  // — only the toggle/X closed it.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "Tab" && drawerRef.current) trapTabKey(drawerRef.current, e);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // R126 (A13-F2): the drawer scrolled the page behind it and locked
  // body scroll, but focus never moved in — keyboard/SR users stayed on
  // the toggle while the dialog opened around them — and closing dropped
  // focus onto <body>. Move focus into the dialog on open, return it to
  // the hamburger (the only opener) on close — the admin drawer's exact
  // move-in/return pair. Programmatic focus on tabIndex -1 shows no
  // :focus-visible outline (the global rule keys on focus-visible).
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.focus();
    // R169 (lint-zero): capture the ref value for the cleanup — React
    // rewrites menuButtonRef.current between here and unmount, so the
    // cleanup must not read the ref again (the stale-ref race the rule
    // warns about).
    const opener = menuButtonRef.current;
    return () => {
      opener?.focus();
    };
  }, [open]);

  // R120-B1 (A3-F1): body scroll-lock while the drawer is open — the
  // manual equivalent of the Radix scroll-lock app-dialog rides
  // (save/restore the previous inline styles; compensate the scrollbar
  // width so the lock itself doesn't shift the sticky header). Route
  // changes close the drawer via the effect above, which also restores.
  // R135 (FE-1): serves BOTH drawers — only one panel is ever mounted,
  // so one lock (like the Esc/Tab/focus effects above) covers whichever
  // is open; that is also why both panels must scroll internally
  // (DRAWER_SCROLL_CAP) — this lock is what strands tall content
  // otherwise.
  useEffect(() => {
    if (!open) return;
    const { overflow, paddingRight } = document.body.style;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [open]);

  // 96-F5 (R96 P2-2a guard): index.html now ships
  // interactive-widget=resizes-content (Android reflows under the virtual
  // keyboard instead of only the visual viewport). MetaTags (owned by
  // another file) re-upserts the viewport meta with a fixed legacy content
  // string on every route, which silently strips the key at runtime. This
  // component-level guard keeps the key alive: it re-appends it on mount
  // and whenever the content attribute is overwritten (MutationObserver,
  // no index.css / foreign-file edits).
  useEffect(() => {
    const el = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!el) return;
    const KEY = "interactive-widget=resizes-content";
    const ensure = () => {
      const c = el.getAttribute("content") ?? "";
      if (!c.includes(KEY)) el.setAttribute("content", `${c.trimEnd()}, ${KEY}`);
    };
    ensure();
    const mo = new MutationObserver(ensure);
    mo.observe(el, { attributes: true, attributeFilter: ["content"] });
    return () => mo.disconnect();
  }, []);

  const { data: user } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: false,
      // No refetchInterval — the 30 s baseline polling was the single
      // largest source of /api/auth/me load (with 75 concurrent users
      // it produced 2.5 RPS just from this component alone). The
      // shared queryKey means sign-in / sign-out events already
      // invalidate this query across all consumers, and the
      // queryClient default staleTime of 60 s + on-mount refetch
      // gives a 60 s freshness ceiling on navigation.
    },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const navLink = (path: string, label: string) => {
    const active = location === path;
    return (
      <Link
        href={path}
        /* R124-A5 #3 (WCAG 2.4.8/1.3.1): programmatic current-page state —
           the visual (text-primary-text + underline bar) was already
           there; MobileNav.tsx has carried the same attribute since
           R120. */
        /* R138 (visual audit — deliberate no-change): the active state
           reads clear-but-calm at rest already (triple cue: primary-text
           ink + font-bold + the bg-primary/80 underline bar, the same
           /80 strength MobileNav's accent bar rides); no fourth cue
           added. */
        aria-current={active ? "page" : undefined}
      >
        <div
          className={`
          relative px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150
          ${
            active
              ? "text-primary-text font-bold"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          }
        `}
        >
          {label}
          {active && (
            <div className="absolute inset-x-2.5 -bottom-px h-[2px] rounded-full bg-primary/80 tab-slide-in" />
          )}
        </div>
      </Link>
    );
  };

  return (
    <header
      // 96-F5 (R96-M08): installed-PWA (black-translucent status bar)
      // sessions render page content behind the clock/notch — the sticky
      // header grows by the top inset (component-level style; index.css
      // is owned by another agent and stays untouched). The h-14 content
      // row below keeps its fixed height; only the chrome band grows.
      data-navbar-header="1"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      className={`
      sticky top-0 z-50
      ${
        /* R138 (visual — the nav glass refinement): this header was the
           nav family's LAST glass surface (bg-card/80–95 + backdrop-blur-
           xl/3xl). The R96 F-4 MobileNav removal rationale applies here
           verbatim: an always-mounted bar over constantly scrolling
           content pays per-frame GPU re-rasterization for a blur that
           was barely visible behind the 80–95%-opaque background — and
           the language contract (FINAL_UX_SYSTEM.md §1/§2, re-confirmed
           this round) reads backdrop-blur on nav as the glassmorphism
           the chrome deliberately dropped. Solid bg-card — the exact
           MobileNav recipe — now carries the surface. Scrolled edge:
           the raw `shadow-md shadow-black/20` forced black on light
           mode (the R116-S1 direction) and is replaced by the
           theme-toned shadow-sm token MobileNav rides; the firmer /70
           border stays as the "content is passing under" cue. Resting
           edge keeps /35 — the family value (Navbar border-b = MobileNav
           border-t = the Footer's top edge after this round). */
        scrolled
          ? "bg-card border-b border-border/70 shadow-sm"
          : "bg-card border-b border-border/35"
      }
    `}
    >
      {/* R138 (visual): the .hairline-glow utility adoption — the
          orchestrator-pinned top-edge brand hairline (transparent →
          primary/30 → transparent; index.css is the single source this
          round), the same vocabulary the MobileNav bottom bar carried
          inline since 96-F5 and the hero cards adopted this round.
          Audit note: the Navbar source never hand-rolled this gradient
          (rg + `git log -S` verified — index.css's dedupe note
          conflated the Footer's copy, whose own comment already claimed
          "unifies … with the Navbar treatment"). The line is ADDED,
          not replaced — closing the family gap that comment described.
          Top edge = the page's topmost chrome row (a whisper brand
          glint at the viewport edge); the content-facing bottom edge
          keeps the border-b family treatment below. The utility bakes
          absolute/top-0/inset-inline/pointer-events-none — no inline
          positioning to drift. */}
      <div className="hairline-glow" />
      {/* 96-F5 (R96-M01 P0): the mobile row needs ≈337–381px for an
          authed user (logo 123 + theme 44 + bell 44 + wallet chip ≥60 +
          cart 44 + gaps) but only 288px exists at 320px — the cart, as
          the last cluster item, was clipped off-screen (html has
          overflow-x: clip, so it could never scroll into view) and
          MobileNav has no cart tab → the whole cart funnel was
          unreachable on small phones for authed users. Fixes: the row
          gap drops to gap-2 below sm (≈271px worst case), the wallet
          chip hides below sm (balance stays reachable via MobileNav
          «المحفظة» + home hero + /wallet), and the bell is only mounted
          for authed users (guests' transient 32px Suspense fallback was
          enough to clip the cart at 320px — and guests never had a bell
          to begin with). */}
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-2 sm:gap-3">
        <Link href="/">
          <Logo size="sm" />
        </Link>

        {/* Desktop nav */}
        {/* AUD103-6-F4 (r103): distinguished landmark label — a page can
            render 3 <nav> elements (desktop, mobile, breadcrumb); the
            rotor needs them disambiguated. */}
        <nav aria-label="التنقل الرئيسي" className="hidden md:flex items-center gap-0.5">
          {navLink("/", "الكتالوج")}
          {/* R132 (L2-F4): the desktop categories disclosure — the 7 live
              category landing pages, previously reachable only via the
              hero brand chips / footer / mobile drawer. Non-modal popover:
              aria-expanded trigger + list of links, ESC/click-outside/
              route-change close, aria-current on the active category. */}
          <DesktopCategoriesMenu />
          {token && (
            <>
              {navLink("/wallet", "المحفظة")}
              {navLink("/orders", "طلباتي")}
              {navLink("/loyalty", "الولاء")}
              {navLink("/support", "الدعم")}
            </>
          )}
        </nav>

        <div className="flex items-center gap-1">
          {/* Theme toggle */}
          {/* 93-C8 (A11 §7): «الثيم» is borrowed jargon; the plain-Arabic
              label matches admin/layout's «وضع نهاري/ليلي» vocabulary. */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all duration-150 text-muted-foreground hover:text-foreground touch-target flex items-center justify-center"
            aria-label="تبديل المظهر (داكن/فاتح)"
            /* R161 (Lane F audit F#8): the icon-only tooltip-twin completion
               — the header trio (theme/menu/cart) was the R160 census's
               remaining gap; the pair is the contract (DESIGN.md). */
            title="تبديل المظهر (داكن/فاتح)"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* 94-C3 (A3 P3-4): bell fallback joins the app-wide skeleton
              pattern (skeleton-shimmer) instead of a silent gray block. */}
          {/* 96-F5 (R96-M01 P0): mounted only when authed — the bell
              renders null for guests anyway, and its lazy fallback used
              to consume 32px of the guest row (enough to transiently
              clip the cart at 320px). Guests now skip the chunk fetch
              entirely. */}
          {token && (
            <Suspense fallback={<div className="w-8 h-8 rounded-lg skeleton-shimmer" />}>
              <NotificationBell />
            </Suspense>
          )}

          {/* Desktop: user actions */}
          <DesktopUserActions token={token} user={user} logout={logout} />

          {/* Mobile menu button — guests always; authed wherever the row
              can afford it. R135 (FE-1) closes R124-A4 #5: an authed phone
              rotated to landscape (<480px height) loses the bottom nav to
              the max-height hide (the keyboard fallback pinned by
              mobile-nav-clearance.test.tsx — it STAYS) while the hamburger
              was guest-only, so «المحفظة/طلباتي/حسابي» had no entry point
              until rotation. The authed toggle therefore renders on every
              sub-md width the row fits: sm:flex covers the 640–768px band
              (theme+bell+toggle+chip+cart ≈ 379px ≤ 608px usable), and the
              short-viewport variant covers <640px landscape — the exact
              stranding condition, the complement of MobileNav's own hide
              query (the max-width guard keeps a short DESKTOP window from
              growing a mobile toggle at the 768px boundary). Below-sm
              PORTRAIT stays toggle-less on purpose: R96-M01's 320px row
              math (≈271px worst case vs 288px usable) has no 48px to spare
              — an unconditional toggle would re-clip the cart, the
              money-path P0 that round fixed — and MobileNav (wallet/
              orders/cart/profile) + /profile (loyalty/referrals) + the
              bell (notifications) already cover every authed destination
              there. */}
          <button
            ref={menuButtonRef}
            className={cn(
              "md:hidden p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all touch-target flex items-center justify-center",
              /* R135 (FE-1): the authed visibility overlay — tailwind-merge
                 resolves the display conflict in `hidden`'s favor (guests
                 keep the bare `flex` above), so the guest class list stays
                 exactly what it was. */
              token
                ? "hidden sm:flex [@media(max-height:480px)_and_(max-width:767.98px)]:flex"
                : undefined,
            )}
            onClick={() => setOpen((v) => !v)}
            aria-label="القائمة"
            title="القائمة" /* R161 (F#8): the icon-only tooltip twin */
            /* R120-B1 (A4-F5): disclosure state + target wiring. R135
               (FE-1): the target follows the token — guest and authed
               drawers are distinct ids, so the control never points at a
               dialog that isn't (or can't be) mounted. */
            aria-expanded={open}
            aria-controls={token ? "authed-menu" : "guest-menu"}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* Mobile wallet chip — logged-in, sm…md band only */}
          {token && (
            /* 96-F5 (R96-M01 P0): hidden below sm (640px). At 320px the
               chip's content floor (≈80–102px with a real balance) pushed
               the cart icon out of the clipped viewport; the balance
               remains reachable via MobileNav «المحفظة» + the home hero
               wallet card + /wallet. Visible again in the 640–768px band
               where the row has ≥608px of room. */
            <MobileWalletChip user={user} />
          )}

          {/* Cart icon — always visible */}
          <Link
            href="/cart"
            aria-label={`السلة، ${
              itemCount > 0
                ? formatCount(itemCount, {
                    one: "منتج",
                    two: "منتجان",
                    few: "منتجات",
                    many: "منتجاً",
                    other: "منتج",
                  })
                : "فارغة"
            }`}
            /* R161 (F#8): the tooltip twin mirrors the dynamic accessible
               name — the sighted hover hint stays in lockstep with the
               count the badge announces. */
            title={`السلة، ${
              itemCount > 0
                ? formatCount(itemCount, {
                    one: "منتج",
                    two: "منتجان",
                    few: "منتجات",
                    many: "منتجاً",
                    other: "منتج",
                  })
                : "فارغة"
            }`}
          >
            {/* R128-IMP-4 (A13-F4 / B1 item 9) + R-140-k layering: the
                badge's LIVE REGION is this STABLE wrapper div, not the
                badge span — a badge-span live region dies the day the
                badge becomes key-remounted for an emphasis animation
                (mount-time content is never announced; MobileNav's
                num-pop badge already carries that keying, and this
                keeps both cart badges on one contract). The wrapper
                persists across count changes. R-140-k: the badge SPAN
                itself is now aria-hidden visual chrome — its bare,
                contextless number (capped "9+") duplicated the R-140-k
                announcer's contextual sentence («أُضيف إلى السلة — 12
                منتجاً») as a second polite utterance on every change.
                The count keeps TWO honest AT exposures: this link's
                accessible name (the inline plural table above) for
                navigation/focus, and the sr-only announcer region below
                for change events. */}
            <div
              aria-live="polite"
              className="relative p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all text-muted-foreground hover:text-foreground cursor-pointer touch-target flex items-center justify-center h-9 w-9"
            >
              <ShoppingCart className="w-4 h-4" />
              {itemCount > 0 && (
                /* 96-F5 (R96-M20 + A6 #21): badge unified with the bell's —
                   inline-end physical corner (LEFT in RTL, like
                   NotificationBell's -left-0.5) and the same 9+ cap, so
                   the two unread indicators read as one system.
                   R-140-k: aria-hidden — see the wrapper comment above. */
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-3xs font-bold tabular-nums flex items-center justify-center shadow-sm shadow-primary/30"
                >
                  {itemCount > 9 ? "9+" : itemCount}
                </span>
              )}
            </div>
          </Link>

          {/* R-140-k (money-adjacent async state): the cart-change
              ANNOUNCER — sr-only, polite, the RouteAnnouncer idiom
              (app/routes.tsx F3-07). Fed by the effect up top: silent on
              load, announces every post-load count delta with the
              toast-family Arabic verbatim + the formatCount total. This
              is the region that covers the paths the add/remove toasts
              can never reach: the undo toast's «تراجع» re-add, the
              cross-tab storage re-sync, and a checkout completed in
              another tab. */}
          <div aria-live="polite" role="status" className="sr-only">
            {cartAnnouncement}
          </div>
        </div>
      </div>

      {/* Mobile guest menu — animated */}
      {/* R120-B1 (A3-F1): the drawer now carries the 7 category shortcuts
          + flash-sales + support (guests had NO category entry point on
          mobile — the desktop nav's «الكتالوج» is hidden below md) and
          the body scroll-locks while it's open (effect above).
          R126 (A13-F2): dialog semantics — the panel is a scroll-locked
          overlay over the page, so it declares role="dialog" aria-modal
          "true" and receives/returns focus like the admin drawer.
          R135 (FE-1): the panel is capped + internally scrollable now
          (DRAWER_SCROLL_CAP) — it rides the same body scroll-lock as the
          authed twin below and has the same latent geometry, so both
          drawers share one cap instead of one of them silently
          regressing on short viewports.
          R138 (visual — the nav glass refinement): the panel drops its
          bg-card/98 + backdrop-blur-3xl glass for solid bg-card — the
          R96 F-4 recipe the header + MobileNav ride since this round.
          At /98 the blur was literally invisible (2% of a scroll-LOCKED
          page shows through it), while DRAWER_SCROLL_CAP's internal
          scroller meant every row-wheel repaint re-rasterized a 64px
          backdrop-filter across the full panel width. The border-t /50
          edge + the float-in entrance are untouched. */}
      {!token && open && <GuestDrawer drawerRef={drawerRef} />}

      {/* Mobile authed menu — R135 (FE-1 / R124-A4 #5): the drawer that
          ends the authed-landscape stranding (token complement of the
          guest twin above). It reuses the guest drawer's ENTIRE machinery
          — drawerRef, the R126 A13-F2 Esc/Tab-trap + move-in/focus-return
          effects, the R120-B1 body scroll-lock, the route-change close —
          because only one of the two panels can ever be mounted at a
          time, one set of effects serves whichever is open. Rows: the
          AUTHED_DRAWER_LINKS account cluster (the guest drawer's
          min-h-[48px] primary-row idiom + the header's per-route icons),
          the shared category section, then تسجيل الخروج — destructive red
          on a /10 tint (the العروض warning-row idiom) because it is the
          one irreversible action in the panel. The whole panel rides
          DRAWER_SCROLL_CAP: at ≈700px of rows it ALWAYS outgrows a
          landscape viewport, and the body is scroll-locked while open.
          R138 (visual): solid bg-card — the same glass diet the guest
          twin + the header took this round (see the guest drawer's
          note above for the rationale). */}
      {token && open && <AuthedDrawer drawerRef={drawerRef} setOpen={setOpen} logout={logout} />}
    </header>
  );
}
