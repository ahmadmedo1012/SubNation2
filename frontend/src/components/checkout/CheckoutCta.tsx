import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { AppliedCoupon } from "./CouponCard";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the confirm CTA with its label state machine (submitting → pricing
// re-quote → stock-blocked → coupon total → plain total). The canSubmit
// memo (spanning five state clusters) and the submitProgress counter are
// computed in the page (they gate the CHARGE, not just the label) and
// flow down as values; onConfirm carries handleConfirm. DOM, classes,
// aria-busy and the label inflections are byte-identical.

export function CheckoutCta({
  canSubmit,
  submitting,
  submitProgress,
  pricingRecheckInFlight,
  stockBlocked,
  appliedCoupon,
  totalLYD,
  comparisonTotal,
  onConfirm,
}: {
  canSubmit: boolean;
  submitting: boolean;
  /** R115-I1: the per-unit loop counter ({current}/{total}) or null. */
  submitProgress: { current: number; total: number } | null;
  pricingRecheckInFlight: boolean;
  stockBlocked: boolean;
  appliedCoupon: AppliedCoupon | null;
  totalLYD: number;
  /** R94-A1 #1: the cent-rounded (coupon-adjusted) total — the same
   * number the balance gate compares against. */
  comparisonTotal: number;
  /** handleConfirm — the money path stays in the page. */
  onConfirm: () => void;
}) {
  return (
    <Button
      onClick={onConfirm}
      disabled={!canSubmit}
      /* R135 (FE-4): aria-busy rides `submitting` — the
         create-order loop was invisible to screen readers
         until a toast fired (repo audit: aria-busy lived
         on only 7 async regions). The product page's
         balance-check CTA idiom (disabled + aria-busy on the
         CTA itself) copied: no aria-label override — the
         visible «جارٍ المعالجة… N/M» label (R115-I1) already
         IS the accessible name. A page-level aria-live region
         for the outcome is deliberately NOT added: every
         terminal branch below already toasts, and the sonner
         Toaster is itself a polite live region (section
         aria-live="polite", sonner 2.x) — a twin here would
         double-announce. aria-busy alone covers the in-flight
         window; React stringifies the idle false. */
      aria-busy={submitting}
      /* 96-F4 (R96 A1 M06): the coupon-state label («إتمام الطلب —
         الإجمالي بعد الكوبون (…)» ≈ 300–330px of Arabic + tabular
         digits) overflowed the button's inner width at ≤390px because
         buttonVariants' base ships whitespace-nowrap — the label bled
         symmetrically outside the rounded CTA on the money screen.
         whitespace-normal + text-balance override the base (twMerge)
         so the honest full label wraps gracefully instead, and
         min-h-12 (was fixed h-12) lets the button grow for 2 lines.
         R116-S2 CTA recipe: size=lg owns the height/text/weight
         base; the remaining overrides are the functional wrap
         guards above + the w-full summary-card layout. */
      /* R138 (visual audit): recipe verified canonical — nothing
         hand-rolled to remove. size="lg" + the default variant own
         every visual token (h-12, text-base, the to-primary/95
         gradient + primary border + shadow-md→hover:shadow-lg,
         press-spring); the className below carries ONLY the
         documented functional guards above (whitespace-normal +
         text-balance + min-h-12, the wrap pins
         checkout-idempotency-keys reads) + the w-full
         summary-column layout (the aside is never narrow-then-wide,
         so sm:w-auto would mis-shrink it inside the 360px card). */
      size="lg"
      className="w-full min-h-12 whitespace-normal text-balance leading-snug"
    >
      {submitting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {/* R115-I1 (A7 P3-5): unit progress «جارٍ المعالجة…
              2/3» for multi-unit baskets (single-unit baskets
              keep the plain label — 1/1 is noise). */}
          {submitProgress && submitProgress.total > 1
            ? `جارٍ المعالجة… ${submitProgress.current}/${submitProgress.total} (${formatCurrency(comparisonTotal)})`
            : `جارٍ المعالجة… (${formatCurrency(comparisonTotal)})`}
        </>
      ) : pricingRecheckInFlight ? (
        /* 98-F2 (R98-A3 F5): the CTA is disabled while the live
           re-quote runs — say WHY instead of a dead button. */
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          جارٍ تحديث الأسعار…
        </>
      ) : stockBlocked ? (
        // R129-A1 (F1 wiring — B-11): the honest disabled
        // state — the label says WHY, matching the cart
        // page's per-line verdicts («نفد المخزون» /
        // «متبقٍ N فقط — عدّل الكمية»).
        <>بعض العناصر نفد مخزونها — راجع السلة</>
      ) : appliedCoupon ? (
        // R111-F2 N1: unified CTA verb — the page title, the
        // error banner and this button all say «إتمام الطلب»
        // now (was «تأكيد الطلب», a second verb family on the
        // money screen).
        <>إتمام الطلب — الإجمالي بعد الكوبون ({formatCurrency(comparisonTotal)})</>
      ) : (
        <>إتمام الطلب ({formatCurrency(totalLYD)})</>
      )}
    </Button>
  );
}
