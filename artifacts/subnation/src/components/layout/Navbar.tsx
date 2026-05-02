import { Link, useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { formatCurrency } from "@/lib/utils";
import { Wallet, LogOut, Menu, X, Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./NotificationBell";
import { Logo } from "./Logo";

export function Navbar() {
  const { token, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 6);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

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
    <header className={`sticky top-0 z-50 transition-all duration-200 ${
      scrolled
        ? "bg-card/97 backdrop-blur-2xl border-b border-border shadow-md shadow-black/20"
        : "bg-card/88 backdrop-blur-md border-b border-border/50"
    }`}>
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/">
          <Logo size="sm" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          <Link href="/" className={navCls("/")}>الكتالوج</Link>
          {token && (
            <>
              <Link href="/wallet"  className={navCls("/wallet")}>المحفظة</Link>
              <Link href="/orders"  className={navCls("/orders")}>طلباتي</Link>
              <Link href="/loyalty" className={navCls("/loyalty")}>الولاء</Link>
              <Link href="/support" className={navCls("/support")}>الدعم</Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-1">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-secondary/80 active:scale-90 transition-all duration-150 text-muted-foreground hover:text-foreground"
            aria-label="تبديل الثيم"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <NotificationBell />

          {token && user ? (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/wallet">
                <div className="flex items-center gap-1.5 bg-secondary/80 hover:bg-secondary border border-border/40 hover:border-primary/25 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-150 active:scale-95 cursor-pointer group">
                  <Wallet className="w-3.5 h-3.5 text-primary transition-transform group-hover:scale-110 duration-150" />
                  <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>
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

          {/* Mobile menu button — guests only */}
          {!token && (
            <button
              className="md:hidden p-2 rounded-lg hover:bg-secondary/80 active:scale-90 transition-all"
              onClick={() => setOpen(v => !v)}
              aria-label="القائمة"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {/* Mobile wallet chip — logged-in */}
          {token && user && (
            <div className="md:hidden flex items-center">
              <Link href="/wallet">
                <div className="flex items-center gap-1 bg-secondary/80 border border-border/40 px-2.5 py-1.5 rounded-lg text-xs font-bold active:scale-90 transition-transform">
                  <Wallet className="w-3 h-3 text-primary" />
                  <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile guest menu — slide in */}
      {!token && open && (
        <div className="md:hidden border-t border-border bg-card/98 backdrop-blur-xl px-4 py-3 space-y-1 animate-in slide-in-from-top-2 duration-150">
          <Link href="/"        onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-secondary/80 transition-colors min-h-[44px]">الكتالوج</Link>
          <Link href="/login"   onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-secondary/80 transition-colors min-h-[44px]">تسجيل الدخول</Link>
          <Link href="/register" onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-xl text-sm font-bold text-primary hover:bg-primary/10 transition-colors min-h-[44px]">إنشاء حساب مجاني</Link>
        </div>
      )}
    </header>
  );
}
