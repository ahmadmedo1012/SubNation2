import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { fmt } from "@/components/admin/pricing/pricing-format";

// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// one margin tier row (gross / net / referral-adjusted) of the calculator's
// outputs card. The numbers it renders flow down from the page as plain
// values (the calculate loop + every state atom stay centralized there);
// the move only changes its address — DOM, classes, the tone ladder and the
// icon ladder are byte-identical.

export function MarginRow({
  label,
  lyd,
  pct,
  hint,
}: {
  label: string;
  lyd: number | null;
  pct: number | null;
  hint?: string;
}) {
  const tone =
    lyd == null
      ? "text-muted-foreground"
      : lyd < 0
        ? "text-status-error"
        : pct != null && pct < 5
          ? "text-status-warning"
          : "text-status-success";
  const Icon = lyd == null ? Info : lyd < 0 ? TrendingDown : TrendingUp;
  return (
    /* R139 (precision): receipt register — the tier rows leave the boxed
       bg-muted/20 + border/40 chip for the hairline-ruled slip shape
       (border-b border-border/20 between tiers, none after the last —
       the CartSummaryAside sums register; the 139-f VariantFormPanel
       preview-row conversion). The semantic tone ladder stays (§6: risk
       states ride token tints — LOSS-tier negative now rides
       --status-error, not the raw destructive channel); emphasis was
       always weight (700 value / bold label), never the box. */
    <div className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone}`} />
        <div>
          <div className="text-xs font-bold">{label}</div>
          {hint && <div className="text-3xs text-muted-foreground">{hint}</div>}
        </div>
      </div>
      <div className={`tabular-nums text-sm font-bold ${tone}`}>
        {lyd == null ? "—" : `${lyd >= 0 ? "+" : ""}${fmt(lyd)} د.ل`}
        {pct != null && (
          <span className="text-3xs font-normal opacity-75 me-1">({fmt(pct, 1)}%)</span>
        )}
      </div>
    </div>
  );
}
