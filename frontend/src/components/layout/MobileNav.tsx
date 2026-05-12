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

      <div className="relative grid h-[60px] grid-cols-5">
        {TABS.map((tab) => {
          const active = location === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className="min-w-0" aria-label={tab.label}>
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
                  relative z-10 text-[9.5px] leading-none font-semibold transition-all duration-200
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
