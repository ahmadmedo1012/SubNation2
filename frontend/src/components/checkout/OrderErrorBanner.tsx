import { AlertCircle, X } from "lucide-react";
import { Link } from "wouter";
import { formatCount } from "@/lib/utils";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the persistent money-failure banner (the partial-success bookkeeping
// twin included). State stays centralized in the page (orderError /
// partialCount are set by handleConfirm's terminal branches); the banner
// takes them as values + the dismiss callback. DOM, classes, aria and
// the count inflection are byte-identical.

export function OrderErrorBanner({
  orderError,
  partialCount,
  onDismiss,
}: {
  orderError: string | null;
  partialCount: number;
  onDismiss: () => void;
}) {
  return (
    // Persistent money-failure banner: an error here must be
    // actionable, not a 4-second toast.
    /* R138 (visual audit): NO change — the status-error wash + /25
       edge + role=alert is the sanctioned inline money-error chrome;
       restyling an error surface away from its semantics (the
       money-path contract forbids it) is not this round's business,
       and its /25 edge already sits one step firmer than the
       receipt's /20 informational rules — exactly the right
       distinction between "the math" and "the failure". */
    orderError && (
      <div
        role="alert"
        className="mb-4 p-3.5 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-xs font-bold flex items-start gap-2"
      >
        <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
        <div className="flex-1 leading-relaxed">
          {partialCount > 0 ? (
            <>
              <p>
                تم إنشاء{" "}
                {formatCount(partialCount, {
                  one: "طلب",
                  two: "طلبين",
                  few: "طلبات",
                  many: "طلباً",
                  other: "طلب",
                })}{" "}
                بنجاح قبل توقف العملية.
              </p>
              <p className="mt-1 font-normal">{orderError}</p>
              <Link
                href="/orders"
                /* R151: 44px touch target + the negative-margin trick the
                   banner's dismiss button uses (same row, different floors
                   — the recovery link was ~20px at text-xs before). */
                className="inline-flex items-center gap-1 mt-1.5 min-h-11 -my-2 py-2 px-1 text-status-error underline underline-offset-2 hover:opacity-80"
              >
                راجع طلباتك المنشأة
              </Link>
            </>
          ) : (
            <>
              <p>تعذّر إتمام الطلب: {orderError}</p>
              <p className="mt-1 font-normal text-muted-foreground">
                لم يتم خصم أي مبلغ. راجع الرصيد والمخزون ثم أعد المحاولة.
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="إغلاق رسالة الخطأ"
          title="إغلاق رسالة الخطأ"
          /* R160 (audit F4): the tooltip-twin contract (DESIGN.md — an
             icon-only control carries BOTH aria-label and title). */
          /* 96-F4 (R96 A2 P2-12): 44×44 touch target with the
             negative-margin trick preserved (the banner keeps its
             tight padding while the hit area grows to the floor). */
          className="shrink-0 h-11 w-11 -m-2 p-2 rounded-md hover:bg-status-error/10"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  );
}
