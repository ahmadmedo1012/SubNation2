import { Link, useLocation } from "wouter";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { useTheme } from "@/lib/theme";
import { formatCount, formatCurrency } from "@/lib/utils";
import { Wallet, LogOut, Menu, X, Sun, Moon, User, ShoppingCart, ChevronLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { Logo } from "./Logo";

const NotificationBell = lazyWithRetry(() =>
  import("./NotificationBell").then((m) => ({ default: m.NotificationBell })),
);

export function Navbar() {
  const { token, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { itemCount } = useCart();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Close menu on route change
  useEffect(() => {
    setOpen(false);
  }, [location]);

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
      <Link href={path}>
        <div
          className={`
          relative px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150
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
      sticky top-0 z-50 transition-all duration-300
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
        <nav className="hidden md:flex items-center gap-0.5">
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
                className="text-muted-foreground hover:text-foreground press-spring transition-all rounded-xl h-9 w-9 p-0 flex items-center justify-center"
                title="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/login">
                <Button
                  variant="ghost"
                  size="sm"
                  className="press-spring transition-all font-medium rounded-xl h-9"
                >
                  دخول
                </Button>
              </Link>
              <Link href="/register">
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 press-spring transition-all shadow-md shadow-primary/25 font-bold rounded-xl h-9"
                >
                  حساب مجاني
                </Button>
              </Link>
            </div>
          )}

          {/* Mobile menu button — guests only */}
          {!token && (
            <button
              className="md:hidden p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all touch-target flex items-center justify-center"
              onClick={() => setOpen((v) => !v)}
              aria-label="القائمة"
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
            <div className="relative p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all text-muted-foreground hover:text-foreground cursor-pointer touch-target flex items-center justify-center h-9 w-9">
              <ShoppingCart className="w-4 h-4" />
              {itemCount > 0 && (
                /* 96-F5 (R96-M20 + A6 #21): badge unified with the bell's —
                   inline-end physical corner (LEFT in RTL, like
                   NotificationBell's -left-0.5) and the same 9+ cap, so
                   the two unread indicators read as one system. */
                <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black tabular-nums flex items-center justify-center shadow-sm shadow-primary/30">
                  {itemCount > 9 ? "9+" : itemCount}
                </span>
              )}
            </div>
          </Link>
        </div>
      </div>

      {/* Mobile guest menu — animated */}
      {!token && open && (
        <div className="md:hidden border-t border-border/50 bg-card/98 backdrop-blur-3xl px-4 py-3 space-y-1 float-in">
          <Link
            href="/"
            className="flex items-center px-4 py-3 rounded-2xl text-sm font-medium hover:bg-secondary/60 transition-colors min-h-[48px]"
          >
            الكتالوج
          </Link>
          <Link
            href="/login"
            className="flex items-center px-4 py-3 rounded-2xl text-sm font-medium hover:bg-secondary/60 transition-colors min-h-[48px]"
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
