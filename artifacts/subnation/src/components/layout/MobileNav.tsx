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
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border safe-area-bottom">
      <div className="flex">
        {TABS.map(tab => {
          const active = location === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className="flex-1">
              <div className={`flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}>
                <tab.icon className={`w-5 h-5 transition-transform ${active ? "scale-110" : ""}`} />
                <span className="text-[10px] font-bold">{tab.label}</span>
                {active && <span className="w-1 h-1 rounded-full bg-primary" />}
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
