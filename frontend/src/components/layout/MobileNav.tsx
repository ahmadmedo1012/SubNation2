import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
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

  if (!token) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Blur + glass background */}
      <div className="absolute inset-0 bg-card/92 backdrop-blur-3xl border-t border-white/[0.06]" />

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

                {/* Active top accent bar */}
                {active && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-7 h-[2.5px] rounded-full bg-primary tab-slide-in" />
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
                  relative z-10 text-[10px] leading-none font-semibold transition-all duration-200
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
