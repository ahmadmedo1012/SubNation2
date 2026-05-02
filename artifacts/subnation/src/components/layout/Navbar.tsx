import { Link, useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { formatCurrency } from "@/lib/utils";
import { Wallet, LogOut, Menu, X, Sun, Moon, Star, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./NotificationBell";

export function Navbar() {
  const { token, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: user } = useGetMe({
    query: { enabled: !!token, retry: false, refetchInterval: 30_000 },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const isActive = (path: string) => location === path;
  const navCls = (path: string) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${isActive(path) ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`;

  return (
    <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-black text-sm">SN</span>
          </div>
          <span className="font-black text-lg tracking-tight">سبنيشن</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <Link href="/" className={navCls("/")}>الكتالوج</Link>
          {token && (
            <>
              <Link href="/wallet" className={navCls("/wallet")}>المحفظة</Link>
              <Link href="/orders" className={navCls("/orders")}>طلباتي</Link>
              <Link href="/loyalty" className={navCls("/loyalty")}>
                <span className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5" />
                  الولاء
                </span>
              </Link>
              <Link href="/support" className={navCls("/support")}>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  الدعم
                </span>
              </Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            aria-label={theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <NotificationBell />

          {token && user ? (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/wallet" className="flex items-center gap-1.5 bg-secondary px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-muted transition-colors">
                <Wallet className="w-3.5 h-3.5 text-primary" />
                <span>{formatCurrency(user.wallet_balance ?? 0)}</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground hover:text-foreground">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/login">
                <Button variant="ghost" size="sm">تسجيل الدخول</Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-primary hover:bg-primary/90">إنشاء حساب</Button>
              </Link>
            </div>
          )}

          <button className="md:hidden p-2 rounded-md hover:bg-secondary transition-colors" onClick={() => setOpen(v => !v)}>
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-card px-4 py-3 space-y-1">
          <Link href="/" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary">الكتالوج</Link>
          {token && (
            <>
              <Link href="/wallet" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary">المحفظة</Link>
              <Link href="/orders" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary">طلباتي</Link>
              <Link href="/loyalty" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary">الولاء والإحالة</Link>
              <Link href="/support" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary">الدعم الفني</Link>
              <button onClick={() => { logout(); setOpen(false); }} className="w-full text-right px-3 py-2 rounded-md text-sm font-medium text-destructive hover:bg-secondary">تسجيل الخروج</button>
            </>
          )}
          {!token && (
            <>
              <Link href="/login" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary">تسجيل الدخول</Link>
              <Link href="/register" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-sm font-medium hover:bg-secondary">إنشاء حساب</Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
