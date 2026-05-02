import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Home, Wallet, ShoppingBag, Star, MessageSquare } from "lucide-react";

const TABS = [
  { href: "/", icon: Home, label: "الرئيسية" },
  { href: "/wallet", icon: Wallet, label: "المحفظة" },
  { href: "/orders", icon: ShoppingBag, label: "طلباتي" },
  { href: "/loyalty", icon: Star, label: "الولاء" },
  { href: "/support", icon: MessageSquare, label: "الدعم" },
];

export function MobileNav() {
  const { token } = useAuth();
  const [location] = useLocation();

  if (!token) return null;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex h-14">
        {TABS.map(tab => {
          const active = location === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className="flex-1">
              <div className="relative flex flex-col items-center justify-center h-full gap-0.5 transition-all duration-200">
                {/* Active indicator pill */}
                {active && (
                  <span className="absolute top-1.5 w-8 h-0.5 rounded-full bg-primary shadow-sm shadow-primary/60" />
                )}
                <tab.icon
                  className={`w-5 h-5 transition-all duration-200 ${
                    active ? "text-primary scale-110" : "text-muted-foreground"
                  }`}
                />
                <span className={`text-[10px] font-bold transition-colors duration-200 ${
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
