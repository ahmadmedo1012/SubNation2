import { AlertCircle } from "lucide-react";
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
      <div className="hidden md:grid grid-cols-[1fr_1fr_100px_130px_90px] gap-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-bold text-muted-foreground">
        <span>المُحيل</span>
        <span>المُحال</span>
        <span>الحالة</span>
        <span>التاريخ</span>
        <span>إجراء</span>
      </div>

      <div className="divide-y divide-border/30">
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
      <div className="px-4 py-2.5 border-t border-border/40 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {list.length >= REFERRALS_SERVER_CAP
            ? `عرض ${list.length} (الأحدث أولاً)`
            : `${list.length} إحالة`}
        </span>
        <span className="flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          الإحالات المعلقة بانتظار أول شحن من المُحال
        </span>
      </div>
    </div>
  );
}
