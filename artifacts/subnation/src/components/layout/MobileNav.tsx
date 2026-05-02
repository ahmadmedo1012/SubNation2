import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Home, Wallet, ShoppingBag, Star, MessageSquare } from "lucide-react";

const TABS = [
  { href: "/",        icon: Home,         label: "الرئيسية" },
  { href: "/wallet",  icon: Wallet,       label: "المحفظة" },
  { href: "/orders",  icon: ShoppingBag,  label: "طلباتي" },
  { href: "/loyalty", icon: Star,         label: "الولاء" },
  { href: "/support", icon: MessageSquare,label: "الدعم" },
];

export function MobileNav() {
  const { token } = useAuth();
  const [location] = useLocation();

  if (!token) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/96 backdrop-blur-xl border-t border-border/60"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-[58px]">
        {TABS.map(tab => {
          const active = location === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className="flex-1">
              <div className="relative flex flex-col items-center justify-center h-full gap-0.5 transition-all duration-200 active:scale-[0.88]">
                {/* Active top pill */}
                <span className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-b-full bg-primary transition-all duration-200 ${
                  active ? "w-7 opacity-100" : "w-0 opacity-0"
                }`} />

                <tab.icon
                  className={`transition-all duration-200 ${
                    active ? "w-[22px] h-[22px] text-primary" : "w-5 h-5 text-muted-foreground"
                  }`}
                />
                <span className={`text-[10px] font-bold leading-none transition-all duration-200 ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}>
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
