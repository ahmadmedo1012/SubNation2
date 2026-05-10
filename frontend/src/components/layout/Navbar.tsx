import { Link, useLocation } from "wouter";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { formatCurrency } from "@/lib/utils";
import { Wallet, LogOut, Menu, X, Sun, Moon, User } from "lucide-react";
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
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Close menu on route change
  useEffect(() => {
    setOpen(false);
  }, [location]);

  const { data: user } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: false,
      refetchInterval: 30_000,
    },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const navLink = (path: string, label: string) => {
    const active = location === path;
    return (
      <Link href={path}>
        <div
          className={`
          relative px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150
          ${
            active
              ? "text-primary font-bold"
              : "text-muted-foreground/80 hover:text-foreground hover:bg-secondary/60"
          }
        `}
        >
          {label}
          {active && (
            <div className="absolute inset-x-2.5 -bottom-px h-[2px] rounded-full bg-primary/65 tab-slide-in" />
          )}
        </div>
      </Link>
    );
  };

  return (
    <header
      className={`
      sticky top-0 z-50 transition-all duration-300
      ${
        scrolled
          ? "bg-card/95 backdrop-blur-3xl border-b border-border/70 shadow-md shadow-black/20"
          : "bg-card/80 backdrop-blur-xl border-b border-border/35"
      }
    `}
    >
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/">
          <Logo size="sm" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          {navLink("/", "الكتالوج")}
          {token && (
            <>
              {navLink("/wallet", "المحفظة")}
              {navLink("/orders", "طلباتي")}
              {navLink("/loyalty", "الولاء")}
              {navLink("/support", "الدعم")}
            </>
          )}
        </nav>

        <div className="flex items-center gap-1">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all duration-150 text-muted-foreground/70 hover:text-foreground touch-target flex items-center justify-center"
            aria-label="تبديل الثيم"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <NotificationBell />

          {/* Desktop: user actions */}
          {token && user ? (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/wallet">
                <div className="flex items-center gap-1.5 bg-secondary/60 hover:bg-secondary/90 border border-border/40 hover:border-primary/30 px-3 py-1.5 rounded-xl text-sm font-bold transition-all duration-150 press-spring cursor-pointer group">
                  <Wallet className="w-3.5 h-3.5 text-primary transition-transform group-hover:scale-110 duration-200" />
                  <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
              <Link href="/profile">
                <div
                  className="p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all text-muted-foreground/70 hover:text-foreground cursor-pointer touch-target flex items-center justify-center"
                  title="حسابي"
                >
                  <User className="w-4 h-4" />
                </div>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="text-muted-foreground/70 hover:text-foreground press-spring transition-all rounded-xl"
                title="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-1.5">
              <Link href="/login">
                <Button
                  variant="ghost"
                  size="sm"
                  className="press-spring transition-all font-medium rounded-xl"
                >
                  دخول
                </Button>
              </Link>
              <Link href="/register">
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 press-spring transition-all shadow-md shadow-primary/25 font-bold rounded-xl"
                >
                  حساب مجاني
                </Button>
              </Link>
            </div>
          )}

          {/* Mobile menu button — guests only */}
          {!token && (
            <button
              className="md:hidden p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all touch-target flex items-center justify-center"
              onClick={() => setOpen((v) => !v)}
              aria-label="القائمة"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {/* Mobile wallet chip — logged-in */}
          {token && user && (
            <div className="md:hidden">
              <Link href="/wallet">
                <div className="flex items-center gap-1.5 bg-secondary/60 border border-border/40 px-2.5 py-1.5 rounded-xl text-xs font-bold press-spring transition-all">
                  <Wallet className="w-3 h-3 text-primary" />
                  <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile guest menu — animated */}
      {!token && open && (
        <div className="md:hidden border-t border-border/50 bg-card/98 backdrop-blur-3xl px-4 py-3 space-y-1 float-in">
          <Link
            href="/"
            className="flex items-center px-4 py-3 rounded-2xl text-sm font-medium hover:bg-secondary/60 transition-colors min-h-[48px]"
          >
            الكتالوج
          </Link>
          <Link
            href="/login"
            className="flex items-center px-4 py-3 rounded-2xl text-sm font-medium hover:bg-secondary/60 transition-colors min-h-[48px]"
          >
            تسجيل الدخول
          </Link>
          <Link
            href="/register"
            className="flex items-center px-4 py-3 rounded-2xl text-sm font-bold text-primary bg-primary/8 hover:bg-primary/14 transition-colors min-h-[48px]"
          >
            إنشاء حساب مجاني ←
          </Link>
        </div>
      )}
    </header>
  );
}
