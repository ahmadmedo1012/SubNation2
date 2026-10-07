import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useCartState } from "@/lib/cart";
import { formatCount } from "@/lib/utils";
import { useKeyboardVisibility } from "@/hooks/use-keyboard-visibility";
import { Home, LayoutGrid, LogIn, ShoppingBag, ShoppingCart, User, Wallet } from "lucide-react";

const AUTHED_TABS = [
  { href: "/", icon: Home, label: "الرئيسية" },
  { href: "/wallet", icon: Wallet, label: "المحفظة" },
  { href: "/orders", icon: ShoppingBag, label: "طلباتي" },
  // R120-B1 (A1-F8/A3-F5): السلة replaces الولاء — the cart (the money
  // funnel) had no bottom-nav entry while الولاء is reachable from both
  // الرئيسية (loyalty card) and حسابي. Same 5-tab layout contract.
  { href: "/cart", icon: ShoppingCart, label: "السلة" },
  { href: "/profile", icon: User, label: "حسابي" },
];

// R120-B1 (A3-F1): guests get the nav too — it previously returned null
// for them, so the ONLY guest navigation on mobile was the hamburger
// drawer. Safe tabs only: auth surfaces (المحفظة/الطلبات/الولاء/حسابي)
// are hidden. «الكتالوج» opens the flagship category (streaming — the
// category page carries the sibling-categories nav to every other
// section), and «تسجيل الدخول» completes the funnel entry.
const GUEST_TABS = [
  { href: "/", icon: Home, label: "الرئيسية" },
  { href: "/category/streaming", icon: LayoutGrid, label: "الكتالوج" },
  { href: "/cart", icon: ShoppingCart, label: "السلة" },
  { href: "/login", icon: LogIn, label: "تسجيل الدخول" },
];

/**
 * Fixed MobileNav height in px — the SINGLE source of truth for the nav's
 * own height AND every clearance that must reserve room for it.
 *
 * The CSS side of the same contract is `--mobile-nav-h` in index.css
 * (mirrors this value; a guard test asserts they stay equal). Consumers:
 *   • MobileNav grid height (below)
 *   • `mobile-nav-safe-pad` — main's content clearance (nav height +
 *     one 12px breathing unit), App.tsx main wrapper
 *   • `mobile-nav-footer-pad` — the Footer's clearance below its legal
 *     row (exactly nav height — the fixed nav sits on top of it)
 *   • `mobile-sticky-above-nav` — product sticky bar bottom offset
 *
 * Before B6-P1-7 three unrelated constants lived here: 60 (nav grid),
 * 60 (footer margin) and 72 (main pad) — with BOTH the footer margin and
 * the main pad reserving nav space (~132px of dead space, or a covered
 * footer when the margin collapsed through #root).
 */
export const MOBILE_NAV_HEIGHT = 60;

export function MobileNav() {
  const { token } = useAuth();
  const [location] = useLocation();

  // R120-B1 (A1-F8): live cart count for the السلة tab badge — the
  // state-only context split (R111-F4-F1) means this re-renders the nav
  // exactly when the cart data changes, never on command identities.
  const { itemCount } = useCartState();

  // 96-F5 (R96 P2-3): hide the nav while the virtual keyboard is open —
  // a fixed bottom bar riding above the keyboard eats the vertical
  // space next to the caret and, on some iOS versions, visually covers
  // the focused input's row. R118-B2 (A2 F-2): the detector now consumes
  // the SHARED useKeyboardVisibility hook (extracted R116-S2 for the
  // product sticky bar) instead of an inline copy — the inline copy
  // predated R117 F-7 and never received the orientationchange
  // re-anchor fix, so a portrait→landscape rotation could latch the nav
  // hidden forever. One detector, one fix, every consumer. The
  // [@media(max-height:480px)]:hidden class below stays as the no-JS
  // fallback for short viewports (landscape phones, keyboard-resized
  // layouts that don't fire visualViewport).
  const keyboardVisible = useKeyboardVisibility();

  // R120-B1 (A3-F1): hidden on the auth pages for everyone — mirrors
  // Footer's isAuth guard, and the guest tab set's «تسجيل الدخول»
  // would be a self-link there anyway.
  if (location === "/login" || location === "/register") return null;

  // R120-B1 (A3-F1): hidden for GUESTS on product pages only — the
  // product page's guest sticky buy bar is position:sticky bottom-0
  // (96-F4 / R96 A1 M11 geometry, product.tsx — owned by another agent),
  // so a fixed 60px nav here would cover the guest CTA. Authed users
  // keep the nav (their buy bar rides mobile-sticky-above-nav).
  // TODO(R120 follow-up, product-page owner): switch the guest bar to
  // mobile-sticky-above-nav + auth-style clearance and drop this guard.
  if (!token && location.startsWith("/product")) return null;

  const tabs = token ? AUTHED_TABS : GUEST_TABS;

  return (
    <nav
      aria-label="التنقل السفلي"
      className={`md:hidden fixed bottom-0 left-0 right-0 z-50 [@media(max-height:480px)]:hidden ${
        keyboardVisible ? "hidden" : ""
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* 96-F5 (R96 F-4): solid bg-card replaces bg-card/92 +
          backdrop-blur-3xl — a 64px backdrop-filter on an always-mounted
          fixed bar over constantly scrolling content forced per-frame GPU
          re-rasterization on low-end Android for a blur that was barely
          visible behind the 92%-opaque background anyway. The themed
          border (94-C3 A3 P2-7) stays, plus a subtle token shadow for
          the depth the blur used to fake (R116-S1: the raw
          rgba(0,0,0,.12) arbitrary is gone — shadow-sm re-tones per
          theme instead of forcing black on light mode). */}
      <div className="absolute inset-0 bg-card border-t border-border/35 shadow-sm" />

      {/* Gradient top rule */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

      {/* R120-B1 (A3-F1): the grid span adapts to the tab count (5
          authed / 4 guest) — the height contract below is unchanged. */}
      <div
        className={`relative grid ${tabs.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}
        style={{ height: MOBILE_NAV_HEIGHT }}
      >
        {tabs.map((tab) => {
          // Match "/" exactly (otherwise every route would highlight it).
          // For other tabs, match either the exact path or a deeper path
          // segment ("/profile" matches "/profile/edit" but not "/profile2").
          // The guest «الكتالوج» tab highlights on ANY /category/* page
          // (R120-B1 / A3-F1) — it is the catalog-browsing entry point.
          const active =
            tab.href === "/"
              ? location === "/"
              : tab.href === "/category/streaming"
                ? location.startsWith("/category/")
                : location === tab.href || location.startsWith(`${tab.href}/`);
          const isCartTab = tab.href === "/cart";
          const cartAriaLabel =
            isCartTab && itemCount > 0
              ? `السلة، ${formatCount(itemCount, {
                  one: "منتج",
                  two: "منتجان",
                  few: "منتجات",
                  many: "منتجاً",
                  other: "منتج",
                })}`
              : tab.label;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="min-w-0"
              aria-label={cartAriaLabel}
              aria-current={active ? "page" : undefined}
            >
              <div
                className="relative flex flex-col items-center justify-center h-full gap-[3px] select-none press-spring"
                style={{ WebkitTapHighlightColor: "transparent" }}
              >
                {/* Active pill background */}
                {active && (
                  <div className="absolute inset-x-2 inset-y-[6px] rounded-2xl bg-primary/12 tab-slide-in" />
                )}

                {/* Active top accent bar — 94-C3 (A3 P3-3): same
                    bg-primary/80 strength as the Navbar underline so the
                    active-route indicator reads identically in both navs. */}
                {active && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-7 h-[2.5px] rounded-full bg-primary/80 tab-slide-in" />
                )}

                {/* Icon — the السلة icon carries the live count badge
                    (R120-B1 / A1-F8): the same 9+ cap + inline-end
                    corner idiom as the Navbar cart/bell badges. */}
                <span className="relative">
                  <tab.icon
                    strokeWidth={active ? 2.5 : 1.8}
                    className={`
                      relative z-10 transition-all duration-200 ease-out
                      ${
                        active
                          ? "w-[22px] h-[22px] text-primary-text"
                          : "w-[20px] h-[20px] text-muted-foreground"
                      }
                    `}
                  />
                  {isCartTab && itemCount > 0 && (
                    <span className="absolute -top-1.5 -left-2 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-3xs font-bold leading-none tabular-nums flex items-center justify-center shadow-sm shadow-primary/30">
                      {itemCount > 9 ? "9+" : itemCount}
                    </span>
                  )}
                </span>

                {/* Label */}
                <span
                  className={`
                  relative z-10 text-3xs leading-none font-semibold transition-all duration-200
                  ${active ? "text-primary-text font-bold" : "text-muted-foreground"}
                `}
                >
                  {tab.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
