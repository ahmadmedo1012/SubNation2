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
    `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${location === path
      ? "bg-primary/10 text-primary font-bold"
      : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`;

  return (
    <header className="sticky top-0 z-50 bg-card/90 backdrop-blur-md border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/">
          <Logo size="sm" />
        </Link>

        {/* Desktop nav — hidden on mobile (bottom nav handles it) */}
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
            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <NotificationBell />

          {token && user ? (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/wallet">
                <div className="flex items-center gap-1.5 bg-secondary hover:bg-muted px-3 py-1.5 rounded-lg text-sm font-bold transition-colors cursor-pointer">
                  <Wallet className="w-3.5 h-3.5 text-primary" />
                  <span>{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
              <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground hover:text-foreground">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/login"><Button variant="ghost" size="sm">دخول</Button></Link>
              <Link href="/register"><Button size="sm" className="bg-primary hover:bg-primary/90 text-sm">حساب مجاني</Button></Link>
            </div>
          )}

          {/* Mobile menu button — only shown when not logged in (logged-in users use bottom nav) */}
          {!token && (
            <button className="md:hidden p-2 rounded-lg hover:bg-secondary transition-colors" onClick={() => setOpen(v => !v)}>
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {token && user && (
            <div className="md:hidden flex items-center">
              <Link href="/wallet">
                <div className="flex items-center gap-1 bg-secondary px-2.5 py-1.5 rounded-lg text-xs font-bold">
                  <Wallet className="w-3 h-3 text-primary" />
                  <span>{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile guest menu */}
      {!token && open && (
        <div className="md:hidden border-t border-border bg-card px-4 py-3 space-y-1">
          <Link href="/" onClick={() => setOpen(false)} className="block px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-secondary">الكتالوج</Link>
          <Link href="/login" onClick={() => setOpen(false)} className="block px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-secondary">تسجيل الدخول</Link>
          <Link href="/register" onClick={() => setOpen(false)} className="block px-3 py-2.5 rounded-lg text-sm font-medium text-primary hover:bg-secondary">إنشاء حساب مجاني</Link>
        </div>
      )}
    </header>
  );
}
