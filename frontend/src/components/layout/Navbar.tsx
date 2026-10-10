import { Link, useLocation } from "wouter";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { useTheme } from "@/lib/theme";
import { cn, formatCount, formatCurrency } from "@/lib/utils";
import { Wallet, LogOut, Menu, X, Sun, Moon, User, ShoppingCart, ChevronLeft } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { Logo } from "./Logo";

const NotificationBell = lazyWithRetry(() =>
  import("./NotificationBell").then((m) => ({ default: m.NotificationBell })),
);

// R120-B1 (A3-F1): the guest drawer's category shortcuts. Mirrors the
// live slugs in lib/categories.ts (verified against the catalog) with
// home.tsx's short chip labels — kept local (not imported from
// lib/categories.ts) because CATEGORY_META carries ~9KB of landing-page
// prose/FAQs and Navbar is in the EAGER bundle.
const DRAWER_CATEGORIES = [
  { slug: "streaming", label: "بث مباشر" },
  { slug: "music", label: "موسيقى" },
  { slug: "software", label: "برامج" },
  { slug: "vpn", label: "VPN وشبكات" },
  { slug: "ai-tools", label: "ذكاء اصطناعي" },
  { slug: "seo-tools", label: "أدوات SEO" },
  { slug: "education", label: "تعليم" },
] as const;

/**
 * R126 (A13-F2): minimal Tab-cycle focus trap for the guest drawer —
 * the exact helper (and comment) the admin console's drawer + ⌘K
 * palette share (layout.tsx trapTabKey, R125 A6 B-9/B-15), kept local
 * because importing the admin layout into the storefront bundle would
 * drag the whole admin shell into the eager chunk. The drawer claims
 * role="dialog" aria-modal="true", so Tab must cycle inside it instead
 * of walking into the page behind (WCAG 2.1.2). Only Tab/Shift+Tab are
 * intercepted; every other key is left to the drawer's own handlers.
 */
function trapTabKey(
  container: HTMLElement,
  e: { key: string; shiftKey: boolean; preventDefault(): void },
): void {
  if (e.key !== "Tab") return;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusables.length === 0) return;
  const current = document.activeElement as HTMLElement | null;
  const idx = current ? focusables.indexOf(current) : -1;
  e.preventDefault();
  const next = e.shiftKey
    ? idx <= 0
      ? focusables.length - 1
      : idx - 1
    : idx === -1 || idx === focusables.length - 1
      ? 0
      : idx + 1;
  focusables[next].focus();
}

export function Navbar() {
  const { token, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { itemCount } = useCart();
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
    return () => {
      menuButtonRef.current?.focus();
    };
  }, [open]);

  // R120-B1 (A3-F1): body scroll-lock while the guest drawer is open —
  // the manual equivalent of the Radix scroll-lock app-dialog rides
  // (save/restore the previous inline styles; compensate the scrollbar
  // width so the lock itself doesn't shift the sticky header). Route
  // changes close the drawer via the effect above, which also restores.
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
        scrolled
          ? "bg-card/95 backdrop-blur-3xl border-b border-border/70 shadow-md shadow-black/20"
          : "bg-card/80 backdrop-blur-xl border-b border-border/35"
      }
    `}
    >
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
          {token ? (
            <div className="hidden md:flex items-center gap-1.5">
              <Link
                href="/wallet"
                aria-label={
                  user ? `المحفظة، الرصيد ${formatCurrency(user.wallet_balance ?? 0)}` : "المحفظة"
                }
              >
                <div className="flex items-center gap-1.5 bg-secondary/60 hover:bg-secondary/90 border border-border/40 hover:border-primary/30 px-3 py-1.5 rounded-xl text-sm font-bold transition-all duration-150 press-spring cursor-pointer group min-w-[80px] h-9">
                  <Wallet className="w-3.5 h-3.5 text-primary-text transition-transform group-hover:scale-110 duration-200" />
                  {user ? (
                    <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>
                  ) : (
                    <div className="w-10 h-4 rounded skeleton-shimmer" />
                  )}
                </div>
              </Link>
              <Link href="/profile" aria-label="حسابي">
                <div className="p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all text-muted-foreground hover:text-foreground cursor-pointer touch-target flex items-center justify-center h-9 w-9">
                  <User className="w-4 h-4" />
                </div>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                aria-label="تسجيل الخروج"
                className="text-muted-foreground hover:text-foreground press-spring transition-all rounded-xl h-9 w-9 p-0 flex items-center justify-center"
                title="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-1.5">
              {/* R120-B1 (A4-F1): the Links wear buttonVariants directly
                  (cn-merged so overrides win) instead of nesting a
                  <Button> inside a <Link> — invalid interactive nesting
                  + a doubled tab stop per CTA. R120-B1 (A1-F6): the
                  register CTA is outline now — its pink gradient
                  competed with the hero primary on every guest page. */}
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "font-semibold rounded-xl h-9",
                )}
              >
                دخول
              </Link>
              <Link
                href="/register"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "font-bold rounded-xl h-9",
                )}
              >
                حساب مجاني
              </Link>
            </div>
          )}

          {/* Mobile menu button — guests only.
              R124-A4 #5 (documented, not fixed): authed phones in landscape
              (<480px height) lose the bottom nav to the max-height hide and
              have no hamburger either — «المحفظة/طلباتي/حسابي» become
              unreachable. Clean fix = an authed drawer variant (wallet/
              orders/loyalty/profile/support) + internal scroll (the drawer
              is taller than a landscape viewport while body-scroll-locked);
              tracked as follow-up — the hide itself is pinned by
              mobile-nav-clearance.test.tsx as the keyboard fallback. */}
          {!token && (
            <button
              ref={menuButtonRef}
              className="md:hidden p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all touch-target flex items-center justify-center"
              onClick={() => setOpen((v) => !v)}
              aria-label="القائمة"
              /* R120-B1 (A4-F5): disclosure state + target wiring. */
              aria-expanded={open}
              aria-controls="guest-menu"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {/* Mobile wallet chip — logged-in, sm…md band only */}
          {token && (
            /* 96-F5 (R96-M01 P0): hidden below sm (640px). At 320px the
               chip's content floor (≈80–102px with a real balance) pushed
               the cart icon out of the clipped viewport; the balance
               remains reachable via MobileNav «المحفظة» + the home hero
               wallet card + /wallet. Visible again in the 640–768px band
               where the row has ≥608px of room. */
            <div className="hidden sm:block md:hidden">
              <Link href="/wallet" aria-label="المحفظة">
                {/* 94-C3 (A3 P1-3): h-8 (32px) → min-h-11 (44px) hit box —
                    wallet is a money path; the chip stays visually compact. */}
                <div className="flex min-h-11 items-center gap-1.5 bg-secondary/60 border border-border/40 px-2.5 py-1.5 rounded-xl text-xs font-bold press-spring transition-all min-w-[60px]">
                  <Wallet className="w-3 h-3 text-primary-text" />
                  {user ? (
                    /* 96-F5 (R96-M01): capped + truncated so a long
                       balance can never re-overflow the sm…md row. The
                       span is a flex item (blockified) so max-w +
                       truncate apply. */
                    <span className="tabular-nums max-w-[96px] truncate">
                      {formatCurrency(user.wallet_balance ?? 0)}
                    </span>
                  ) : (
                    <div className="w-8 h-3 rounded skeleton-shimmer" />
                  )}
                </div>
              </Link>
            </div>
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
          >
            {/* R128-IMP-4 (A13-F4 / B1 item 9): the cart badge's LIVE
                REGION is this STABLE wrapper div, not the badge span —
                a badge-span live region dies the day the badge becomes
                key-remounted for an emphasis animation (mount-time
                content is never announced; MobileNav's num-pop badge
                already carries that keying, and this keeps both cart
                badges on one contract). The wrapper persists across
                count changes; its text (the badge number) announces
                politely on N→M while both are >0. The 0→1 mount + 1→0
                unmount can't announce — the add/remove toast covers
                those (A13's own note: the toast remains the primary
                signal). */}
            <div
              aria-live="polite"
              className="relative p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all text-muted-foreground hover:text-foreground cursor-pointer touch-target flex items-center justify-center h-9 w-9"
            >
              <ShoppingCart className="w-4 h-4" />
              {itemCount > 0 && (
                /* 96-F5 (R96-M20 + A6 #21): badge unified with the bell's —
                   inline-end physical corner (LEFT in RTL, like
                   NotificationBell's -left-0.5) and the same 9+ cap, so
                   the two unread indicators read as one system. */
                <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-3xs font-bold tabular-nums flex items-center justify-center shadow-sm shadow-primary/30">
                  {itemCount > 9 ? "9+" : itemCount}
                </span>
              )}
            </div>
          </Link>
        </div>
      </div>

      {/* Mobile guest menu — animated */}
      {/* R120-B1 (A3-F1): the drawer now carries the 7 category shortcuts
          + flash-sales + support (guests had NO category entry point on
          mobile — the desktop nav's «الكتالوج» is hidden below md) and
          the body scroll-locks while it's open (effect above).
          R126 (A13-F2): dialog semantics — the panel is a scroll-locked
          overlay over the page, so it declares role="dialog" aria-modal
          "true" and receives/returns focus like the admin drawer. */}
      {!token && open && (
        <div
          id="guest-menu"
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="القائمة"
          tabIndex={-1}
          className="md:hidden border-t border-border/50 bg-card/98 backdrop-blur-3xl px-4 py-3 space-y-1 float-in"
        >
          {/* R124-A3 #3: full token — the /80 alpha measured 4.14:1 in
              light mode (sub-AA for the 11px bold label); full
              --muted-foreground measures 6.67:1 (light) / 8.03:1 (dark). */}
          <div className="px-4 pt-1 pb-0.5 text-3xs font-bold text-muted-foreground">الفئات</div>
          <div className="grid grid-cols-2 gap-x-2">
            {DRAWER_CATEGORIES.map((c) => (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className="flex items-center px-4 py-2.5 min-h-11 rounded-2xl text-sm font-semibold hover:bg-secondary/60 transition-colors"
              >
                {c.label}
              </Link>
            ))}
            <Link
              href="/flash-sales"
              className="flex items-center px-4 py-2.5 min-h-11 rounded-2xl text-sm font-semibold text-status-warning hover:bg-status-warning/10 transition-colors"
            >
              العروض
            </Link>
          </div>
          <div className="h-px bg-border/25 my-1" aria-hidden="true" />
          <Link
            href="/support"
            className="flex items-center px-4 py-3 rounded-2xl text-sm font-semibold hover:bg-secondary/60 transition-colors min-h-[48px]"
          >
            الدعم الفني
          </Link>
          <Link
            href="/login"
            className="flex items-center px-4 py-3 rounded-2xl text-sm font-semibold hover:bg-secondary/60 transition-colors min-h-[48px]"
          >
            تسجيل الدخول
          </Link>
          <Link
            href="/register"
            className="flex items-center px-4 py-3 rounded-2xl text-sm font-bold text-primary-text bg-primary/8 hover:bg-primary/14 transition-colors min-h-[48px]"
          >
            {/* B6-P2-1: the last remaining text-glyph arrow — replaced with
                the same inline ChevronLeft idiom the icon-audit rows
                (#14/#19, category.tsx) standardized on. Forward = LEFT in
                RTL, and a glyph can bidi-reposition inside mixed runs. */}
            إنشاء حساب مجاني <ChevronLeft className="w-3 h-3 inline" />
          </Link>
        </div>
      )}
    </header>
  );
}
