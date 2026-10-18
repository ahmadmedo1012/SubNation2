import { AlertCircle, X } from "lucide-react";
import { Link } from "wouter";
import { ORDER_COUNT_FORMS_OBJECT, formatCount } from "@/lib/utils";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the persistent money-failure banner (the partial-success bookkeeping
// twin included). State stays centralized in the page (orderError /
// partialCount are set by handleConfirm's terminal branches); the banner
// takes them as values + the dismiss callback. DOM, classes, aria and
// the count inflection are byte-identical.

export function OrderErrorBanner({
  orderError,
  partialCount,
  walletStateUnknown,
  onDismiss,
}: {
  orderError: string | null;
  partialCount: number;
  /** R161-G (audit E#1, money honesty): true when another tab may have
   *  charged/removed units during the flight (skippedByOtherTab > 0) —
   *  the wallet state is unknown from this tab, so the no-deduction
   *  subline below must not render (the wallet view can contradict
   *  it). */
  walletStateUnknown: boolean;
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
                {/* R166-A (F16): post-verb object («تم إنشاء … بنجاح
                   قبل توقف العملية») — the shared OBJECT registry form
                   («طلبين»); rendered bytes unchanged. */}
                {formatCount(partialCount, ORDER_COUNT_FORMS_OBJECT)} بنجاح قبل توقف العملية.
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
              {/* R161-G (audit E#1): the claim is only honest when this
                  tab knows no charge landed — a skip means another tab
                  owned some units' wallet math (render the bare error). */}
              {!walletStateUnknown && (
                <p className="mt-1 font-normal text-muted-foreground">
                  لم يتم خصم أي مبلغ. راجع الرصيد والمخزون ثم أعد المحاولة.
                </p>
              )}
              {/* R168-L3 (fix 4): support recourse — the complete-failure
                  dead end had no escape hatch. The order-detail support
                  idiom («…؟ تواصل مع الدعم» → /support, no ?ref= — there
                  is no order code to reference yet), styled by THIS
                  banner's own R151 link recipe (44px floor, error ink)
                  so the two links in this box stay one family. Renders
                  in both wallet-state branches — the unknown-wallet case
                  needs the escape hatch MORE. */}
              <Link
                href="/support"
                className="inline-flex items-center gap-1 mt-1.5 min-h-11 -my-2 py-2 px-1 text-status-error underline underline-offset-2 hover:opacity-80"
              >
                مشكلة في الطلب؟ تواصل مع الدعم
              </Link>
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
