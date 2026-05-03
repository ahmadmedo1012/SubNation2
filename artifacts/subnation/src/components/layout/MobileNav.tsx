import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Home, Wallet, ShoppingBag, Star, User } from "lucide-react";

const TABS = [
  { href: "/",        icon: Home,       label: "الرئيسية" },
  { href: "/wallet",  icon: Wallet,     label: "المحفظة" },
  { href: "/orders",  icon: ShoppingBag,label: "طلباتي" },
  { href: "/loyalty", icon: Star,       label: "الولاء" },
  { href: "/profile", icon: User,       label: "حسابي" },
];

export function MobileNav() {
  const { token } = useAuth();
  const [location] = useLocation();

  if (!token) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/96 backdrop-blur-2xl border-t border-border/40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Premium top border line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border/80 to-transparent" />

      <div className="flex h-[58px]">
        {TABS.map(tab => {
          const active = location === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className="flex-1">
              <div
                className="relative flex flex-col items-center justify-center h-full gap-0.5 group"
                style={{ WebkitTapHighlightColor: "transparent" }}
              >
                {/* Active indicator bar */}
                {active && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
                )}

                {/* Icon container */}
                <div className={`
                  relative flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-xl
                  transition-all duration-180
                  ${active ? "bg-primary/10" : "group-active:bg-muted/40"}
                `}
                  style={{ WebkitTapHighlightColor: "transparent" }}>
                  <tab.icon
                    className={`transition-all duration-180 ${
                      active
                        ? "w-[21px] h-[21px] text-primary"
                        : "w-[20px] h-[20px] text-muted-foreground group-active:text-foreground"
                    }`}
                  />
                  <span className={`text-[9.5px] font-bold leading-none transition-colors duration-180 ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {tab.label}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
