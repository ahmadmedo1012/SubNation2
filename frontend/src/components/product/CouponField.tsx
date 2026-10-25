import { AlertCircle, CheckCircle, Loader2, Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the coupon input/chip row. It was already a self-contained component in
// the page file (stateless: all coupon state stays centralized in the
// page because validateCoupon's math keys off the SELECTED variant — the
// R98-01 generation guard lives there). The move only changes its
// address; DOM, classes, aria and event semantics are byte-identical.

/** The /api/coupons/validate response contract the chip renders. */
export interface CouponResult {
  code: string;
  discount_amount: number;
  final_amount: number;
  type: string;
  value: number;
  description: string | null;
}

export function CouponField({
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  token,
  onCouponChange,
  onCouponValidate,
  onCouponClear,
}: {
  couponInput: string;
  couponResult: CouponResult | null;
  couponError: string;
  couponValidating: boolean;
  token: string | null;
  onCouponChange: (v: string) => void;
  onCouponValidate: () => void;
  onCouponClear: () => void;
}) {
  if (!token) return null;
  return (
    <div className="space-y-1.5">
      {/* Input row */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Tag className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={couponInput}
            onChange={(e) => {
              onCouponChange(e.target.value.toUpperCase());
              if (couponResult) onCouponClear();
            }}
            onKeyDown={(e) => {
              // Gate on `couponValidating` too — a double-Enter during an
              // in-flight validate used to fire a second POST.
              if (e.key === "Enter" && !couponResult && !couponValidating) onCouponValidate();
            }}
            placeholder="رمز الكوبون"
            /* R182 (Lane-C D1): the checkout twin (CouponCard, R124-I4 A5
               #9) got aria-label + aria-invalid + aria-describedby; this
               PDP twin stayed placeholder-only-named with its error
               block never tied to the field — same money path, same fix. */
            aria-label="رمز الكوبون"
            aria-invalid={!!couponError && !couponResult}
            aria-describedby={couponError && !couponResult ? "pdp-coupon-error" : undefined}
            /* 96-F4 (R96 A1 M05 / A2 P3-1): the old text-sm override beat
               the shared Input's iOS-zoom-safe text-base → a 14px coupon
               field on the money path zoomed the whole page on focus.
               text-base under md restores 16px; autoComplete/enterKeyHint
               mirror checkout's coupon field (Enter already validates).
               R143 (L3-4): the md:text-sm half of that fix re-applied
               the A13-F7 bug it was fixing — a bare md: override beats
               the shared Input's pointer:fine guard on coarse-pointer
               ≥768px viewports (iPad-class Safari re-zooms on focus);
               the guard form below restores the input.tsx:43 contract. */
            autoComplete="off"
            enterKeyHint="send"
            className="ps-9 h-11 text-base [@media(min-width:48rem)_and_(pointer:fine)]:text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans"
            /* R187 (L-F3): the checkout twin's dir guard (CouponCard) —
               a Latin coupon code in an RTL block mis-places the caret
               and mirrors neutral punctuation; the mono code-entry run
               is LTR on every surface. */
            dir="ltr"
            disabled={!!couponResult}
          />
        </div>
        {couponResult ? (
          <button
            onClick={onCouponClear}
            aria-label="إزالة الكوبون"
            title="إزالة الكوبون"
            className="min-h-11 px-3 rounded-lg border border-border/60 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all press-spring"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={onCouponValidate}
            disabled={!couponInput.trim() || couponValidating}
            className="min-h-11 px-3 rounded-lg bg-muted/50 border border-border/60 text-xs font-bold hover:bg-muted hover:border-border transition-all press-spring disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {/* R177 (R160 checkout-twin parity): the spinner swap emptied the
                accessible name mid-request — the sr-only twin keeps it (the
                checkout CouponCard fixed this exact class in R160; the PDP
                twin never received it). */}
            {couponValidating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="sr-only">جارٍ التحقق…</span>
              </>
            ) : (
              "تحقق"
            )}
          </button>
        )}
      </div>

      {/* Error */}
      {couponError && (
        <div
          role="alert"
          id="pdp-coupon-error"
          className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          {couponError}
        </div>
      )}

      {/* Success */}
      {couponResult && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 text-xs bg-status-success/8 border border-status-success/20 rounded-lg px-3 py-2"
        >
          <div className="flex items-center gap-1.5 text-status-success">
            <CheckCircle className="w-3 h-3 shrink-0" />
            <span dir="ltr" className="font-mono font-bold">
              {couponResult.code}
            </span>
            <span>
              —{" "}
              {couponResult.type === "percentage"
                ? `${couponResult.value}%`
                : formatCurrency(couponResult.value)}{" "}
              خصم
            </span>
          </div>
          <span className="font-bold text-status-success">
            −{formatCurrency(couponResult.discount_amount)}
          </span>
        </div>
      )}
    </div>
  );
}
