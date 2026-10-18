import { Lock } from "lucide-react";
import { ORDER_COUNT_FORMS_SUBJECT, formatCount, formatRelativeTime } from "@/lib/utils";
import { MAX_PENDING } from "@/components/wallet/topup-preferences";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the MAX_PENDING review-queue warning banner. The pending-count
// derivation (useListTopups + the pendingBlocked gate) stays
// centralized in the page; the counts flow down as values. The move
// only changes its address; DOM, classes and aria are byte-identical.

export function PendingLimitBanner({
  pendingCount,
  oldestPending,
}: {
  pendingCount: number;
  oldestPending: string | undefined;
}) {
  return (
    // R-140-j (keyboard/a11y): role=status — the banner mounts AFTER the
    // topups list resolves (not on first paint), so the MAX_PENDING
    // freeze it explains + the form card's inert below it were silent
    // for screen-reader users until they happened to read down the page.
    // A polite live region announces the queue state the moment it is
    // derived — the states contract: PENDING shows WHAT is happening.
    <div
      role="status"
      className="flex items-start gap-3 p-4 bg-status-warning/8 border border-status-warning/22 rounded-2xl float-in"
    >
      <Lock className="w-4.5 h-4.5 text-status-warning shrink-0 mt-0.5" />
      <div>
        <p className="font-bold text-sm text-status-warning">
          {/* R123-E4a (P3-a): «طلبات الشحن موقوفة مؤقتاً» read as a
              platform outage — the user is only queued behind their
              own earlier review requests. */}
          وصلت للحد الأقصى من طلبات المراجعة
        </p>
        {/* 96-F6 (R96 A6 #4 P1): /75 → full token — the translucent
            warning text measured ≈2.07:1 on white in light mode
            (AA fail). Background tints stay as-is. */}
        <p className="text-xs text-status-warning mt-0.5">
          {/* R166-A (F16): «لديك …» — the counted noun is the delayed
             SUBJECT of the nominal sentence → the shared SUBJECT registry
             form («طلبان»); rendered bytes unchanged. */}
          لديك {formatCount(pendingCount, ORDER_COUNT_FORMS_SUBJECT)} قيد المراجعة (الحد الأقصى{" "}
          {MAX_PENDING})
        </p>
        {oldestPending && (
          <p className="text-2xs text-status-warning mt-1">
            {/* R115 (A8 #5): ONE approval SLA across every surface
                (this line, TopupWaitingModal, support FAQ) — the
                old «30 دقيقة» here vs «ثوانٍ» in the waiting modal
                contradicted each other on the same money flow. */}
            أقدم طلب: {formatRelativeTime(oldestPending)} — عادةً خلال دقائق، وبحد أقصى 30 دقيقة
            خلال ساعات العمل.
          </p>
        )}
      </div>
    </div>
  );
}
