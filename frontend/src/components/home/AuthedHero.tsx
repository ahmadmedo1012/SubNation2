import { formatCurrency } from "@/lib/utils";
import type { User } from "@workspace/api-client-react";
import { Star, Wallet } from "lucide-react";
import { Link } from "wouter";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the authenticated hero banner card (wallet + loyalty chips riding the
// page's useGetMe result). The page owns the query and the three-branch
// hero conditional; this extract renders the resolved-user branch and
// takes the user object as its only prop. DOM, classes and aria are
// byte-identical.

export function AuthedHero({ user }: { user: User }) {
  return (
    // Hero banner card
    <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-4 shadow-lg">
      {/* Background gradient layers */}
      {/* R138 (visual): ambient-wash + hairline-glow mirror the guest
          hero's atmosphere upgrade — the live-site audit (VLM critique
          on subnation.ly) read the hero surface as a flat void; both
          branches now share the same pinned depth vocabulary (the
          utilities live in index.css — one definition, no drift).
          The directional wash stays at /12: it was already at the
          value the guest hero was raised TO this round — one family,
          one value. */}
      <div className="absolute inset-0 ambient-wash pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-l from-primary/12 via-transparent to-transparent pointer-events-none" />
      <div className="hairline-glow" />
      {/* R125-I7 (A7 B-12 / R124-A3 #12): the hero accent stripe
          was w-[2px] — the craft-floor cap for colored side
          stripes is 1px. */}
      <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-primary/60 via-primary/20 to-transparent" />
      {/* R138 (visual): the static accent blob raised 8→14 — the same
          sub-perceptual alpha the audit flagged on the guest hero's
          blobs; this one is smaller (w-48) and animation-free, so the
          identical value keeps the two hero branches one family. */}
      <div className="absolute top-[-30px] right-[10%] w-48 h-48 bg-primary/14 rounded-full blur-3xl pointer-events-none" />

      <div className="relative px-4 py-4 sm:px-6 sm:py-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* R125-I7 (A7 B-12 / R124-A3 #13): the «مرحباً بك
              مجدداً» eyebrow above the h2 is deleted — the
              craft-floor bans kickers/eyebrows over headings
              ("let the h1 speak"); the greeting carried no
              information the h2 doesn't. */}
          {/* R140 central (140-l census): h2 → h1 — the R124-A5-F8
              demotion reasoned "the guest SEO hero owns the page's h1",
              but the branches are MUTUALLY EXCLUSIVE: when this branch
              renders, GuestHero is unmounted and the page carried ZERO
              h1 (an h2-only ladder — the most common storefront view).
              The family's per-view invariant (onboarding's step-2
              precedent, order-detail's error views) wins: exactly one
              h1 per rendered view; the greeting IS the authed home's
              topic. Pixel-neutral (h1/h2 share the fluid-2xl classes);
              catalog sections stay h2 beneath it. The gradient text is
              gone (craft-floor ban) — solid --primary-text (4.82:1 on
              the light card / 6.05:1 dark) + weight carry the
              emphasis. */}
          <h1 className="text-fluid-2xl font-bold text-primary-text">اشترِ اشتراكك المفضل اليوم</h1>
        </div>
        {/* R159: the wallet/loyalty chips' hover border+shadow rode an
            off-scale duration-250 (a pre-R158 value the R158-C duration
            census missed — it counted only 180/220/280 drift). Normalized
            to the DESIGN.md 200ms surfaces tier every sibling chip/card
            hover already rides (CategoryRail, ShelfRail, cart rows); the
            280ms exception stays scoped to the ProductCard/flash-sales
            card lift. */}
        <div className="flex gap-2">
          <Link href="/wallet">
            <div className="bg-background/50 border border-border/50 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 transition-all duration-200 card-spring cursor-pointer min-w-[122px]">
              <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Wallet className="w-3.5 h-3.5 text-primary-text" />
              </div>
              <div>
                <div className="text-3xs text-muted-foreground leading-none mb-0.5 font-semibold">
                  المحفظة
                </div>
                <div className="font-bold text-sm tabular-nums text-foreground">
                  {formatCurrency(user.wallet_balance ?? 0)}
                </div>
              </div>
            </div>
          </Link>
          <Link href="/loyalty">
            <div className="bg-background/50 border border-border/50 hover:border-status-warning/40 hover:shadow-lg hover:shadow-status-warning/12 rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 transition-all duration-200 card-spring cursor-pointer">
              <div className="w-8 h-8 rounded-xl bg-status-warning/10 border border-status-warning/20 flex items-center justify-center shrink-0">
                <Star className="w-3.5 h-3.5 text-status-warning" />
              </div>
              <div>
                <div className="text-3xs text-muted-foreground leading-none mb-0.5 font-semibold">
                  النقاط
                </div>
                <div className="font-bold text-sm tabular-nums">{user.loyalty_points ?? 0}</div>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
