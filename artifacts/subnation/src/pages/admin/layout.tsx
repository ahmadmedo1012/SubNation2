import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { LayoutDashboard, ShoppingBag, Wallet, Package, Users, LogOut, Shield } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin", label: "الرئيسية", icon: LayoutDashboard },
  { href: "/admin/topups", label: "طلبات الشحن", icon: Wallet },
  { href: "/admin/orders", label: "الطلبات", icon: ShoppingBag },
  { href: "/admin/products", label: "المنتجات", icon: Package },
  { href: "/admin/users", label: "المستخدمون", icon: Users },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { adminLogout } = useAuth();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-card border-l border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-black">لوحة الإدارة</span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(item => (
            <Link key={item.href} href={item.href}>
              <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${location === item.href ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                <item.icon className="w-4 h-4" />
                {item.label}
              </div>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <button
            onClick={adminLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
