import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useKeyboardVisibility } from "@/hooks/use-keyboard-visibility";
import { Home, Wallet, ShoppingBag, Star, User } from "lucide-react";

const TABS = [
  { href: "/", icon: Home, label: "الرئيسية" },
  { href: "/wallet", icon: Wallet, label: "المحفظة" },
  { href: "/orders", icon: ShoppingBag, label: "طلباتي" },
  { href: "/loyalty", icon: Star, label: "الولاء" },
  { href: "/profile", icon: User, label: "حسابي" },
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

  if (!token) return null;

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

      <div className="relative grid grid-cols-5" style={{ height: MOBILE_NAV_HEIGHT }}>
        {TABS.map((tab) => {
          // Match "/" exactly (otherwise every route would highlight it).
          // For other tabs, match either the exact path or a deeper path
          // segment ("/profile" matches "/profile/edit" but not "/profile2").
          const active =
            tab.href === "/"
              ? location === "/"
              : location === tab.href || location.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="min-w-0"
              aria-label={tab.label}
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

                {/* Icon */}
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
