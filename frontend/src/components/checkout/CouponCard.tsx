import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2, Tag, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the coupon card (input + apply/clear pair + notices). Stateless: the
// coupon quartet stays centralized in the page because applyCoupon's math
// keys off the CURRENT cart lines (the R98-01 generation guard lives
// there — see the page's onCouponChange). The move only changes its
// address; DOM, classes, aria and event semantics are byte-identical.

/**
 * The page's pre-validated coupon result atom (R94-A1 #9 + 98-F2): the
 * per-line finals + the Σ math validateCouponForLines computed for THIS
 * basket — the same numbers the per-unit loop charges. Exported as one
 * source for the page state and the summary/CTA props.
 */
export interface AppliedCoupon {
  code: string;
  /** Per-unit post-coupon final, keyed by lineKey (productId:variantId). */
  lineUnitFinals: Record<string, number>;
  final_amount: number;
  discount_amount: number;
}

export function CouponCard({
  coupon,
  appliedCoupon,
  couponChecking,
  couponNotice,
  isEmpty,
  onCouponChange,
  onApplyCoupon,
  onClearCoupon,
}: {
  coupon: string;
  appliedCoupon: AppliedCoupon | null;
  couponChecking: boolean;
  couponNotice: string | null;
  isEmpty: boolean;
  onCouponChange: (value: string) => void;
  onApplyCoupon: () => void;
  onClearCoupon: () => void;
}) {
  return (
    // Coupon
    // R138 (visual): the family resting elevation (ProductCard's
    //   two-layer calm recipe, this round) — the money path's three
    //   cards (this, the payment panel, the summary receipt) rest as
    //   one family: bg-card + border/60 + the calm contact line +
    //   contained ambient. The input + apply/clear pair below were
    //   audited and left untouched: the field rides the shared
    //   Input's own bg-card/60 quiet fill and /75 resting edge, and
    //   the h-11 pair is the R116-S2 44px floor.
    <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]">
      <div className="flex items-center gap-2 mb-3">
        <Tag className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-bold text-base">كوبون خصم</h2>
        <span className="text-3xs text-muted-foreground font-bold">(اختياري)</span>
      </div>
      <div className="flex gap-2">
        <Input
          value={coupon}
          onChange={(e) => {
            onCouponChange(e.target.value.toUpperCase());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !appliedCoupon) {
              e.preventDefault();
              onApplyCoupon();
            }
          }}
          placeholder="أدخل رمز الكوبون"
          aria-label="رمز الكوبون"
          /* R124-I4 (A5 #9): the coupon error is a role=alert block
             but was never tied to the field — mirror the wallet
             sender-phone pattern (wallet.tsx aria-invalid +
             aria-describedby → the id'd error <p> below). */
          aria-invalid={!!couponNotice && !appliedCoupon}
          aria-describedby={couponNotice && !appliedCoupon ? "checkout-coupon-error" : undefined}
          /* 96-F4 (R96 A2 P3-1 / A1 M05): Safari/iOS happily autofills
             coupon inputs from saved emails, and the shared Input's
             text-base (16px < md) already prevents the iOS focus-zoom —
             keep the default size, just opt out of autofill and label
             the mobile Enter key with its real action (apply). */
          autoComplete="off"
          enterKeyHint="send"
          className="flex-1 font-mono uppercase"
          dir="ltr"
        />
        {appliedCoupon ? (
          <Button
            type="button"
            variant="outline"
            onClick={onClearCoupon}
            aria-label="إزالة الكوبون"
            /* R116-S2 (P2/P3): 44px touch floor on the coupon
               apply/clear pair — the money path's most-tapped
               secondary controls (was min-h-9). */
            className="h-11 shrink-0 font-bold"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={onApplyCoupon}
            disabled={!coupon.trim() || couponChecking || isEmpty}
            className="h-11 shrink-0 font-bold"
          >
            {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : "تحقق"}
          </Button>
        )}
      </div>
      {couponNotice && !appliedCoupon && (
        <p
          id="checkout-coupon-error"
          role="alert"
          className="text-xs font-bold text-status-error mt-2 leading-relaxed"
        >
          {couponNotice}
        </p>
      )}
      {appliedCoupon && (
        <p
          role="status"
          className="text-xs font-bold text-status-success mt-2 flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span dir="ltr" className="font-mono">
            {appliedCoupon.code}
          </span>
          — خصم {formatCurrency(appliedCoupon.discount_amount)}
        </p>
      )}
      <p className="text-2xs text-muted-foreground mt-2 leading-relaxed">
        يُتحقَّق من الكوبون ويُطبَّق على المنتجات المؤهلة عند إتمام الطلب.
      </p>
    </div>
  );
}
