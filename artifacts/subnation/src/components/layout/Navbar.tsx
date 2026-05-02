import { Link, useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { formatCurrency } from "@/lib/utils";
import { Wallet, LogOut, Menu, X, Sun, Moon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./NotificationBell";
import { Logo } from "./Logo";

export function Navbar() {
  const { token, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: user } = useGetMe({
    query: { enabled: !!token, retry: false, refetchInterval: 30_000 },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const navCls = (path: string) =>
    `relative px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
      location === path
        ? "bg-primary/12 text-primary font-bold"
        : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
    }`;

  return (
    <header className="sticky top-0 z-50 bg-card/90 backdrop-blur-md border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/">
          <Logo size="sm" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          <Link href="/" className={navCls("/")}>الكتالوج</Link>
          {token && (
            <>
              <Link href="/wallet" className={navCls("/wallet")}>المحفظة</Link>
              <Link href="/orders" className={navCls("/orders")}>طلباتي</Link>
              <Link href="/loyalty" className={navCls("/loyalty")}>الولاء</Link>
              <Link href="/support" className={navCls("/support")}>الدعم</Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-1">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-secondary/80 active:scale-95 transition-all duration-150 text-muted-foreground hover:text-foreground"
            aria-label="تبديل الثيم"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <NotificationBell />

          {token && user ? (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/wallet">
                <div className="flex items-center gap-1.5 bg-secondary/80 hover:bg-secondary px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-150 active:scale-95 cursor-pointer">
                  <Wallet className="w-3.5 h-3.5 text-primary" />
                  <span>{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="active:scale-95 transition-transform">دخول</Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-primary hover:bg-primary/90 active:scale-95 transition-transform shadow-md shadow-primary/20">حساب مجاني</Button>
              </Link>
            </div>
          )}

          {/* Mobile menu button — only for guests */}
          {!token && (
            <button
              className="md:hidden p-2 rounded-lg hover:bg-secondary/80 active:scale-95 transition-all"
              onClick={() => setOpen(v => !v)}
              aria-label="القائمة"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {token && user && (
            <div className="md:hidden flex items-center">
              <Link href="/wallet">
                <div className="flex items-center gap-1 bg-secondary/80 px-2.5 py-1.5 rounded-lg text-xs font-bold active:scale-95 transition-transform">
                  <Wallet className="w-3 h-3 text-primary" />
                  <span>{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile guest menu — slide in */}
      {!token && open && (
        <div className="md:hidden border-t border-border bg-card px-4 py-3 space-y-1 animate-in slide-in-from-top-2 duration-150">
          <Link href="/" onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors min-h-[44px]">الكتالوج</Link>
          <Link href="/login" onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors min-h-[44px]">تسجيل الدخول</Link>
          <Link href="/register" onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-lg text-sm font-bold text-primary hover:bg-primary/10 transition-colors min-h-[44px]">إنشاء حساب مجاني</Link>
        </div>
      )}
    </header>
  );
}
