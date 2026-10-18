import { Link } from "wouter";
import { LogOut, User, Wallet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import type { User as SessionUser } from "@workspace/api-client-react";

// R167 (layout decomposition): extracted verbatim from
// components/layout/Navbar.tsx — the desktop actions cluster's authed/
// guest ternary: the wallet-balance chip + profile + logout buttons vs
// the guest دخول / حساب مجاني CTA pair. The header owns the token, the
// /me query and the logout callback (single owner — the same values feed
// the mobile wallet chip and the drawers); this extract takes them as
// props and renders. The move only changes the cluster's address — zero
// behavior, zero markup change (the navbar-mobile-fit balance-chip
// render pins follow this surface).

export function DesktopUserActions({
  token,
  user,
  logout,
}: {
  token: string | null;
  user: SessionUser | undefined;
  logout: () => void;
}) {
  return token ? (
    <div className="hidden md:flex items-center gap-1.5">
      <Link
        href="/wallet"
        aria-label={
          user ? `المحفظة، الرصيد ${formatCurrency(user.wallet_balance ?? 0)}` : "المحفظة"
        }
      >
        <div className="flex items-center gap-1.5 bg-secondary/60 hover:bg-secondary/90 border border-border/40 hover:border-primary/30 px-3 py-1.5 rounded-xl text-sm font-bold transition-all duration-150 press-spring cursor-pointer group min-w-[80px] h-9">
          <Wallet className="w-3.5 h-3.5 text-primary-text transition-transform group-hover:scale-110 duration-200" />
          {user ? (
            <span className="tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</span>
          ) : (
            <div className="w-10 h-4 rounded skeleton-shimmer" />
          )}
        </div>
      </Link>
      <Link href="/profile" aria-label="حسابي" title="حسابي">
        <div className="p-2 rounded-xl hover:bg-secondary/70 press-spring transition-all text-muted-foreground hover:text-foreground cursor-pointer touch-target flex items-center justify-center h-9 w-9">
          <User className="w-4 h-4" />
        </div>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        onClick={logout}
        aria-label="تسجيل الخروج"
        className="text-muted-foreground hover:text-foreground press-spring transition-all rounded-xl h-9 w-9 p-0 flex items-center justify-center"
        title="تسجيل الخروج"
      >
        <LogOut className="w-4 h-4" />
      </Button>
    </div>
  ) : (
    <div className="hidden md:flex items-center gap-1.5">
      {/* R120-B1 (A4-F1): the Links wear buttonVariants directly
          (cn-merged so overrides win) instead of nesting a
          <Button> inside a <Link> — invalid interactive nesting
          + a doubled tab stop per CTA. R120-B1 (A1-F6): the
          register CTA is outline now — its pink gradient
          competed with the hero primary on every guest page. */}
      <Link
        href="/login"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "font-semibold rounded-xl h-9",
        )}
      >
        دخول
      </Link>
      <Link
        href="/register"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "font-bold rounded-xl h-9",
        )}
      >
        حساب مجاني
      </Link>
    </div>
  );
}
