import React from "react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import { CheckCircle, Clock, Phone, RefreshCw, Star, Users, Zap } from "lucide-react";
import { type ReferralRow } from "@/components/admin/referrals/referrals-meta";

/* ── R124-I5 (A6 F4 — the R118-B2 orders.tsx pattern) ──────────────────
 * The search box is a CONTROLLED input — every keystroke re-rendered
 * the full referral list with fresh inline closures (the debounced
 * network refetch is separate). The row is now a module-level
 * React.memo component whose props are stable across a keystroke (row
 * refs come from `data`; onCredit is useCallback-stable; the busy/
 * scope flags are primitives), so typing re-renders the search box and
 * nothing else. */
interface ReferralRowItemProps {
  row: ReferralRow;
  /** Zebra striping (i % 2). */
  idx: number;
  /** Whether THIS row's credit POST is in flight. */
  crediting: boolean;
  /** R122 (A2-P1): finance scope for the credit action. */
  canCredit: boolean;
  onCredit: (row: ReferralRow) => void;
}

// R137 (FE decomposition): extracted verbatim from pages/admin/referrals.tsx —
// the memoized table row (referrer / referee / status pill / dates /
// the credit action). The R118-B2 memoization rides along: the component
// stays a module-level React.memo so a keystroke re-renders the search
// box and NOTHING else. Every input is a prop (row / idx / crediting /
// canCredit + the page-owned useCallback onCredit) — no state of its
// own, no duplicated truth. The move only changes its address; DOM,
// classes and Arabic copy are byte-identical.

export const ReferralRowItem = React.memo(function ReferralRowItem({
  row,
  idx,
  crediting,
  canCredit,
  onCredit,
}: ReferralRowItemProps) {
  const credited = row.status === "credited";
  return (
    <div
      className={`flex flex-col md:grid md:grid-cols-[1fr_1fr_100px_130px_90px] gap-2 md:gap-4 items-start md:items-center px-4 py-3 hover:bg-muted/15 transition-colors ${idx % 2 !== 0 ? "bg-muted/5" : ""}`}
    >
      {/* Referrer */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-status-info/10 border border-status-info/15 flex items-center justify-center shrink-0">
          <Phone className="w-2.5 h-2.5 text-status-info" />
        </div>
        <span className="font-mono text-sm font-bold truncate">{row.referrer_phone}</span>
      </div>

      {/* Referee */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-muted/50 border border-border/40 flex items-center justify-center shrink-0">
          <Users className="w-2.5 h-2.5 text-muted-foreground" />
        </div>
        <span className="font-mono text-sm text-muted-foreground truncate">
          {row.referee_phone}
        </span>
      </div>

      {/* Status */}
      <div>
        {credited ? (
          <span className="inline-flex items-center gap-1 text-3xs font-bold px-2 py-1 rounded-full bg-status-success/10 text-status-success border border-status-success/20">
            <CheckCircle className="w-2.5 h-2.5" /> ناجحة
          </span>
        ) : (
          /* R126-L5 (A3 item-10): the pending pill rides the
             --status-warning ink+tint pair (yellow-400 fails the light
             theme at 1.43-1.53:1 — A3's measured figures). */
          <span className="inline-flex items-center gap-1 text-3xs font-bold px-2 py-1 rounded-full bg-status-warning/10 text-status-warning border border-status-warning/20">
            <Clock className="w-2.5 h-2.5" /> معلقة
          </span>
        )}
      </div>

      {/* Date */}
      <div className="text-xs text-muted-foreground">
        <div>{formatRelativeTime(row.created_at)}</div>
        {credited && row.credited_at && (
          <div className="text-status-success/70 text-3xs mt-0.5">
            قُيِِّد: {formatRelativeTime(row.credited_at)}
          </div>
        )}
      </div>

      {/* Action */}
      <div>
        {credited ? (
          /* R126-L5 (A3 item-10): pending-count text joins the warning
             sweep (yellow-400 fails the light theme at ~1.5:1). */
          <div className="flex items-center gap-1 text-xs text-status-warning font-bold">
            <Star className="w-3 h-3" />+{row.points_earned}
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCredit(row)}
            // R122 (A2-P1): finance scope required — see
            // canCredit (users.tsx canEditMoney idiom).
            disabled={crediting || !canCredit}
            title={canCredit ? undefined : "يتطلب صلاحية المالية"}
            className="h-7 px-2.5 text-xs gap-1 border-primary/25 text-primary hover:bg-primary/8 hover:border-primary/40"
          >
            {crediting ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <Zap className="w-3 h-3" />
                منح نقاط
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
});
