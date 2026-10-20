import { Link } from "wouter";
import { Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { User as SessionUser } from "@workspace/api-client-react";

// R167 (layout decomposition): extracted verbatim from
// components/layout/Navbar.tsx — the authed mobile wallet chip (the
// sm…md band twin of the desktop balance chip). The header keeps the
// {token && …} mount guard and the /me query; this extract takes the
// user row and renders. The move only changes the chip's address —
// zero behavior, zero markup change (the navbar-mobile-fit chip
// render pins follow this surface).

export function MobileWalletChip({ user }: { user: SessionUser | undefined }) {
  return (
    <div className="hidden sm:block md:hidden">
      <Link href="/wallet" aria-label="المحفظة">
        {/* 94-C3 (A3 P1-3): h-8 (32px) → min-h-11 (44px) hit box —
            wallet is a money path; the chip stays visually compact. */}
        <div className="flex min-h-11 items-center gap-1.5 bg-secondary/60 border border-border/40 px-2.5 py-1.5 rounded-xl text-xs font-bold press-spring transition-all min-w-[60px]">
          <Wallet className="w-3 h-3 text-primary-text" />
          {user ? (
            /* 96-F5 (R96-M01): capped + truncated so a long
               balance can never re-overflow the sm…md row. The
               span is a flex item (blockified) so max-w +
               truncate apply. */
            <span className="tabular-nums max-w-[96px] truncate">
              {/* R177: `?? 0` dropped — formatCurrency's «— د.ل» stays
                  honest if the contract ever loosens. */}
              {formatCurrency(user.wallet_balance)}
            </span>
          ) : (
            <div className="w-8 h-3 rounded skeleton-shimmer" />
          )}
        </div>
      </Link>
    </div>
  );
}
