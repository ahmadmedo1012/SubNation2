import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Home, Wallet, ShoppingBag, Star, MessageSquare } from "lucide-react";

const TABS = [
  { href: "/",        icon: Home,          label: "الرئيسية" },
  { href: "/wallet",  icon: Wallet,        label: "المحفظة" },
  { href: "/orders",  icon: ShoppingBag,   label: "طلباتي" },
  { href: "/loyalty", icon: Star,          label: "الولاء" },
  { href: "/support", icon: MessageSquare, label: "الدعم" },
];

export function MobileNav() {
  const { token } = useAuth();
  const [location] = useLocation();

  if (!token) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border/50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Subtle top shimmer */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />

      <div className="flex h-[60px]">
        {TABS.map(tab => {
          const active = location === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className="flex-1">
              <div
                className="flex flex-col items-center justify-center h-full gap-0.5 group"
                style={{ WebkitTapHighlightColor: "transparent" }}
              >
                {/* Icon + label wrapped in pill */}
                <div className={`
                  flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl
                  transition-all duration-200
                  active:scale-[0.82]
                  ${active
                    ? "bg-primary/14"
                    : "group-active:bg-muted/40"
                  }
                `}>
                  <tab.icon
                    className={`transition-all duration-200 ${
                      active
                        ? "w-[22px] h-[22px] text-primary"
                        : "w-[20px] h-[20px] text-muted-foreground group-active:text-foreground"
                    }`}
                  />
                  <span className={`text-[10px] font-bold leading-none transition-colors duration-200 ${
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
