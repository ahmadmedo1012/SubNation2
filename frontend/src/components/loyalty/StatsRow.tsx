import { Crown, Star, TrendingUp, Users } from "lucide-react";
import { formatCount, formatCurrency, tierColor, tierLabel } from "@/lib/utils";
import type { LoyaltyData } from "./loyalty-meta";

// R-140-k: the points plural forms — the SAME table BalanceCard's points
// cluster inlines (نقطة/نقطتان/نقاط/نقطة), kept local so the announcer
// below can never disagree with the wallet card's count-word family.
const POINTS_COUNT_FORMS = {
  one: "نقطة",
  two: "نقطتان",
  few: "نقاط",
  many: "نقطة",
  other: "نقطة",
} as const;

// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx — the three stat tiles (points / tier + progress
// bar / referrals). Presentational only: the overview query, the
// error/loading branches around this grid and the tier math all stay
// in the page — `data` and the precomputed `tierProgressPercent` flow
// down as values (the loyalty-history suite pins the 60%-width bar and
// the Latin-digit points tile at the rendered level). The move only
// changes its address; DOM, classes and Arabic copy are byte-identical.

export function StatsRow({
  data,
  tierProgressPercent,
}: {
  data: LoyaltyData;
  tierProgressPercent: number;
}) {
  /* R139 (precision): VERIFIED, no chrome change — the three tiles
     already speak the family: solid bg-card on the /60 resting edge,
     float-in stagger, tabular-nums on every numeral, and the mission's
     sanctioned "weight+size emphasis WITH token tints" (points =
     warning-gold identity, tier = tierColor, referrals = info; the
     icon stages + token tints carry the identity). The tier progress
     bar's gradient fill is pinned BY SELECTOR in
     loyalty-history.test.tsx (div.bg-gradient-to-l) — deliberate,
     not drift. */
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* Points */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 float-in">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
          <Star className="w-3.5 h-3.5 text-status-warning" />
          نقاطي
        </div>
        <div className="text-3xl font-bold text-status-warning mb-1 tabular-nums">
          {/* Round-3 (8-e §2): bare toLocaleString() follows the
              DEVICE locale — Arabic-locale devices rendered Arabic-Indic
              numerals (١٢٣٤) on this tile while the wallet balance one
              screen over shows Latin digits. Pin the same Latin-digit
              grouping as the rest of the money UI. */}
          {data.points.toLocaleString("en-US")}
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-1">
          {/* R147 (2-d): the caption's LYD figure rides formatCurrency —
              the raw backend toFixed(2) string lost the 8-e §1.1
              thousands grouping ("1250.00" for a 125,000-point balance)
              the points tile above and the tier remainder beside it both
              carry; «د.ل» rides the formatter's own suffix now. */}
          <span className="font-bold text-foreground tabular-nums">
            {formatCurrency(Number(data.points_value_lyd))}
          </span>
        </div>
        {/* R-140-k (money-adjacent async state — the points announcer):
            the visible points total is a plain text swap — after a
            conversion the toast announces the DELTA («تم التحويل» + the
            server's «تم تحويل N نقطة إلى X د.ل»), but the NEW points
            TOTAL (this tile's datum) was silent until re-navigation.
            sr-only polite region, same contract as BalanceCard's
            balance announcer: mount-silent by construction (region +
            first value appear together), announces only post-mount
            changes, through formatCount so the digits and plural word
            match the wallet family. Polite, never assertive. */}
        <div aria-live="polite" role="status" className="sr-only">
          {`نقاطي الآن ${formatCount(data.points, POINTS_COUNT_FORMS)}`}
        </div>
      </div>

      {/* Tier */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-1">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
          <TrendingUp className="w-3.5 h-3.5" />
          مستواي
        </div>
        <div className={`text-2xl font-bold mb-2.5 ${tierColor(data.tier)}`}>
          {tierLabel(data.tier)}
        </div>
        {data.next_tier ? (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                التالي: <span className="font-bold text-foreground">{data.next_tier.label}</span>
              </span>
              <span className="tabular-nums">{formatCurrency(data.next_tier.remaining)}</span>
            </div>
            {/* Enhanced tier progress */}
            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 bg-gradient-to-l from-primary via-primary/70 to-primary/40"
                style={{ width: `${tierProgressPercent}%` }}
              />
            </div>
            <p className="text-3xs text-muted-foreground">
              متبقٍ {formatCurrency(data.next_tier.remaining)} للترقية
            </p>
          </div>
        ) : (
          /* R128 (A1-F3): platinum = the top tier ink, theme-aware */
          <div className="flex items-center gap-1.5 text-xs text-tier-platinum font-bold">
            <Crown className="w-3.5 h-3.5" />
            أعلى مستوى
          </div>
        )}
      </div>

      {/* Referrals */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-2">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
          <Users className="w-3.5 h-3.5 text-status-info" />
          إحالاتي
        </div>
        <div className="text-3xl font-bold text-status-info mb-1 tabular-nums">
          {data.referrals_credited}
        </div>
        <div className="text-sm text-muted-foreground">
          {data.referrals_pending > 0 && (
            <span className="text-status-warning font-bold ml-1">
              {/* R123-E4a (P2): pending-terminology canon — a
                  pending referral is «قيد الانتظار» (waiting on the
                  friend's first topup), matching referrals.tsx's
                  stat tile + row chip; was the «معلق/معلقان/معلقة»
                  family, a third word for one concept. Noun set
                  rides formatCount (إحالة/إحالتان/إحالات). */}
              {formatCount(data.referrals_pending, {
                one: "إحالة قيد الانتظار",
                two: "إحالتان قيد الانتظار",
                few: "إحالات قيد الانتظار",
                many: "إحالة قيد الانتظار",
                other: "إحالة قيد الانتظار",
              })}{" "}
              ·
            </span>
          )}
          إحالة ناجحة
        </div>
      </div>
    </div>
  );
}
