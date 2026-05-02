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
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const { data: user } = useGetMe({
    query: { enabled: !!token, retry: false, refetchInterval: 30_000 },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const navLink = (path: string, label: string) => {
    const active = location === path;
    return (
      <Link href={path}>
        <div className={`relative px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
          active
            ? "text-primary font-bold"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/70"
        }`}>
          {label}
          {/* Active underline */}
          {active && (
            <div className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary/70" />
          )}
        </div>
      </Link>
    );
  };

  return (
    <header className={`sticky top-0 z-50 transition-all duration-200 ${
      scrolled
        ? "bg-card/97 backdrop-blur-2xl border-b border-border shadow-lg shadow-black/15"
        : "bg-card/90 backdrop-blur-md border-b border-border/50"
    }`}>
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/">
          <Logo size="sm" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          {navLink("/", "الكتالوج")}
          {token && (
            <>
              {navLink("/wallet",  "المحفظة")}
              {navLink("/orders",  "طلباتي")}
              {navLink("/loyalty", "الولاء")}
              {navLink("/support", "الدعم")}
            </>
          )}
        </nav>

        <div className="flex items-center gap-1">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-secondary/70 active:scale-90 transition-all duration-150 text-muted-foreground hover:text-foreground"
            aria-label="تبديل الثيم"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <NotificationBell />

          {/* Desktop: user actions */}
          {token && user ? (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/wallet">
                <div className="flex items-center gap-1.5 bg-secondary/70 hover:bg-secondary border border-border/40 hover:border-primary/25 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-150 active:scale-95 cursor-pointer group">
                  <Wallet className="w-3.5 h-3.5 text-primary transition-transform group-hover:scale-110 duration-150" />
                  <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="text-muted-foreground hover:text-foreground active:scale-95 transition-all"
                title="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="active:scale-95 transition-all font-medium">دخول</Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-primary hover:bg-primary/90 active:scale-95 transition-all shadow-md shadow-primary/20 font-bold">
                  حساب مجاني
                </Button>
              </Link>
            </div>
          )}

          {/* Mobile menu button — guests only */}
          {!token && (
            <button
              className="md:hidden p-2 rounded-lg hover:bg-secondary/70 active:scale-90 transition-all"
              onClick={() => setOpen(v => !v)}
              aria-label="القائمة"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {/* Mobile wallet chip — logged-in */}
          {token && user && (
            <div className="md:hidden">
              <Link href="/wallet">
                <div className="flex items-center gap-1 bg-secondary/70 border border-border/40 px-2.5 py-1.5 rounded-lg text-xs font-bold active:scale-90 transition-all">
                  <Wallet className="w-3 h-3 text-primary" />
                  <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile guest menu */}
      {!token && open && (
        <div className="md:hidden border-t border-border bg-card/98 backdrop-blur-xl px-4 py-2 space-y-0.5 animate-in slide-in-from-top-2 duration-150">
          <Link href="/"         onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-secondary/70 transition-colors min-h-[44px]">الكتالوج</Link>
          <Link href="/login"    onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-secondary/70 transition-colors min-h-[44px]">تسجيل الدخول</Link>
          <Link href="/register" onClick={() => setOpen(false)} className="flex items-center px-3 py-2.5 rounded-xl text-sm font-bold text-primary hover:bg-primary/10 transition-colors min-h-[44px]">إنشاء حساب مجاني ←</Link>
        </div>
      )}
    </header>
  );
}
