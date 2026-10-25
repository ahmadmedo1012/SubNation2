import { AlertCircle } from "lucide-react";
import { formatCount } from "@/lib/utils";
import {
  REFERRALS_SERVER_CAP,
  type ReferralRow,
} from "@/components/admin/referrals/referrals-meta";
import { ReferralRowItem } from "@/components/admin/referrals/ReferralRowItem";

// R137 (FE decomposition): extracted verbatim from pages/admin/referrals.tsx —
// the referral table: the md header row, the memoized rows (ReferralRowItem,
// nested consumer) and the honest server-cap footer. The credit POST
// (confirm-gated, idempotency-keyed) stays in the page — this shell takes
// the list + the busy id + the finance scope down and reports taps
// through onCredit (the page's credit handler, useCallback-stable so the
// memoized rows bail out on keystrokes). The move only changes its
// address; DOM, classes and Arabic copy are byte-identical.

/** Arabic plural forms for إحالة — R187L-F1: the footer's count noun
 *  (the storefront StatsRow's family, bare — its own objects carry the
 *  «قيد الانتظار» suffix). */
const REFERRAL_COUNT_FORMS = {
  zero: "إحالات",
  one: "إحالة",
  two: "إحالتان",
  few: "إحالات",
  many: "إحالةً",
  other: "إحالة",
};

export function ReferralsTable({
  list,
  crediting,
  canCredit,
  onCredit,
}: {
  list: ReferralRow[];
  crediting: number | null;
  canCredit: boolean;
  onCredit: (row: ReferralRow) => void;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      {/* Table header */}
      {/* R-140-l (semantics): VERIFIED — responsive DIV-GRID, not a
          <table> (the CouponsTable twin: md header row + flex-col
          stacked rows with in-cell labels below md; see that file's
          register note for the full no-role=table rationale). The
          REAL-table register owns scope+aria-label; the per-row credit
          CTA carries its own accessible name in ReferralRowItem. */}
      {/* R139 (precision): the register — header band border-b
          border-border (full) → /60 and th font-bold → font-semibold
          (bg-muted/30 + 600, the OrdersTable header idiom; 700 stays on
          row data). */}
      <div className="hidden md:grid grid-cols-[1fr_1fr_100px_130px_90px] gap-4 px-4 py-2.5 border-b border-border/60 bg-muted/30 text-xs font-semibold text-muted-foreground">
        <span>المُحيل</span>
        <span>المُحال</span>
        <span>الحالة</span>
        <span>التاريخ</span>
        <span>إجراء</span>
      </div>

      {/* R139 (precision): row seams divide/30 → /60 — one seam value
          with the orders grid (the ReferralRowItem hover wash follows). */}
      <div className="divide-y divide-border/60">
        {/* R124-I5 (A6 F4 — R118-B2): the memoized row component —
                  props are stable across keystrokes so only the search
                  box re-renders while typing. */}
        {list.map((row, i) => (
          <ReferralRowItem
            key={row.id}
            row={row}
            idx={i}
            crediting={crediting === row.id}
            canCredit={canCredit}
            onCredit={onCredit}
          />
        ))}
      </div>

      {/* Footer count — R125-I3 (A2-5): the backend list is
                server-capped at LIMIT 200 (routes/admin/referrals.ts)
                with no page param, while the stat cards count the FULL
                table — a 200-row window used to render as a bare
                «200 إحالة» next to «إجمالي الإحالات: 340», contradicting
                itself. The products/coupons honest-cap convention: a
                full cap page reads «عرض N (الأحدث أولاً)». */}
      {/* R139 (precision): receipt hairline on the footer band —
          border-t /40 → /20 (the OrdersTable footer register) +
          tabular-nums on the count. */}
      <div className="px-4 py-2.5 border-t border-border/20 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          {/* R187L-F1: the count rides formatCount — the storefront
              StatsRow's إحالة family (one/two/few/many/other) as a
              local object (the ALERT_COUNT_FORMS idiom); was the frozen
              «N إحالة» (3 → «3 إحالات», 11 → «11 إحالةً»). */}
          {list.length >= REFERRALS_SERVER_CAP
            ? `عرض ${list.length} (الأحدث أولاً)`
            : formatCount(list.length, REFERRAL_COUNT_FORMS)}
        </span>
        <span className="flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          الإحالات المعلقة بانتظار أول شحن من المُحال
        </span>
      </div>
    </div>
  );
}
