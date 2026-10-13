import { Star, Wallet } from "lucide-react";
import type { RefObject } from "react";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { arabicCountWord, formatCurrency, tierColor, tierLabel } from "@/lib/utils";
import { TIER_BADGE_BORDER, TIER_DOT_BG } from "@/components/wallet/topup-meta";
import type { WalletInfo } from "@workspace/api-client-react";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the left column's balance card (loading skeleton / honest error /
// the tier-accented balance hero). The wallet probe (useGetWallet) and
// the R115-A10 viewport-pause hook (useOnScreen) stay centralized in
// the page — loading/error/refetch flow down as values + one retry
// callback, and the drift-blob's ref/style ride down with them so the
// observer never re-mounts inside the extract. The move only changes
// its address; DOM, classes and aria are byte-identical.

export function BalanceCard({
  wallet,
  loading,
  error,
  onRetry,
  glowRef,
  glowStyle,
}: {
  wallet: WalletInfo | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** R115-A10: the page-owned useOnScreen observer's target ref. */
  glowRef: RefObject<HTMLDivElement | null>;
  /** R115-A10: the pause-when-offscreen animation-play-state style. */
  glowStyle: { animationPlayState: "running" | "paused" };
}) {
  const tier = wallet?.loyalty_tier ?? "bronze";

  return loading ? (
    <div className="rounded-2xl h-36 skeleton-shimmer border border-border/60" />
  ) : error ? (
    /* 93-C5 / F-05 (A4 #7): the card used to silently vanish on a
       failed /api/wallet probe — the money page's primary datum
       cannot just disappear. Honest error card + retry (same
       idiom as orders/loyalty error states). */
    <FetchErrorCard
      size="section"
      title="تعذّر تحميل رصيد المحفظة"
      description="حدث خطأ في الاتصال — تحقّق من شبكتك ثم حاول مجدداً"
      onRetry={onRetry}
    />
  ) : wallet ? (
    <div
      ref={glowRef}
      /* R139 (precision): the balance hero joins the r138 family — the
         pre-r138 surface (brand gradient fill + border-primary/22 +
         shadow-xl shadow-primary/8 brand glow) is retired for the solid
         bg-card on the /60 resting edge + the two-layer calm elevation
         (the page's ONE prominent-card register — the long statement
         below stays flat). The atmosphere moves to the sanctioned
         static pair: .ambient-wash (two-point radial) + .hairline-glow
         (lit top edge) — the mission's explicit "wallet balance hero
         is a legitimate candidate", the login/admin-login card lift.
         The R115-A10 blob-drift layer + its page-owned glowStyle stay
         byte-identical (the viewport-pause machinery is logic, not
         chrome); only its alpha joins the r138 hero-blob family value. */
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 sm:p-5 shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]"
    >
      <div className="absolute inset-0 ambient-wash pointer-events-none" />
      <div className="hairline-glow" />
      <div className="absolute inset-0 dot-grid opacity-35 pointer-events-none" />
      <div
        className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/14 blur-3xl pointer-events-none blob-drift"
        style={glowStyle}
      />
      <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full bg-primary/9 blur-2xl pointer-events-none" />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-bold mb-2">
            {/* R139 (precision): the eyebrow whisper joins the muted label
                register (the amount's weight+size carry the hierarchy —
                receipt emphasis, never a tinted label); the glyph keeps
                the AA-safe brand accent explicitly. */}
            <Wallet className="w-3.5 h-3.5 text-primary-text" />
            الرصيد المتاح
          </div>
          <div className="text-3xl sm:text-4xl font-bold tabular-nums mb-3 leading-none text-foreground num-pop break-words">
            {formatCurrency(wallet.balance ?? 0)}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div
                className={`w-1.5 h-1.5 rounded-full ${TIER_DOT_BG[tier] ?? "bg-muted-foreground"}`}
              />
              <span className="text-muted-foreground text-xs">المستوى:</span>
              <span className={`font-bold text-xs ${tierColor(tier)}`}>{tierLabel(tier)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <Star className="w-3 h-3 text-status-warning" />
              <span className="font-bold tabular-nums text-status-warning">
                {wallet.loyalty_points ?? 0}
              </span>
              {/* R134 (A2-F2): the noun AGREES with the count now —
                  a frozen «نقطة» read «7 نقطة» for the 2–10
                  balances the 1-point-per-LYD earn rate makes
                  common (2 → نقطتان، 3–10 → نقاط، 11+ → نقطة).
                  Same plural engine as formatCount, word-only so
                  the two-tone styling (bold number, muted noun)
                  survives. */}
              <span className="text-muted-foreground">
                {arabicCountWord(wallet.loyalty_points ?? 0, {
                  one: "نقطة",
                  two: "نقطتان",
                  few: "نقاط",
                  many: "نقطة",
                  other: "نقطة",
                })}
              </span>
            </div>
          </div>
        </div>
        <div
          /* R123-E4a (P3-d): border from the shared tier map, text
              tone from tierColor() — was a second inline ladder
              duplicating the helper's palette. */
          className={`shrink-0 px-3 py-2 rounded-xl border text-2xs font-bold bg-card ${TIER_BADGE_BORDER[tier] ?? "border-border/40"} ${tierColor(tier)}`}
        >
          {tierLabel(tier)}
        </div>
      </div>
    </div>
  ) : null;
}
