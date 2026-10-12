import { AlertCircle, CheckCircle2, Lock, Wallet, X } from "lucide-react";
import { Link } from "wouter";
import { formatCurrency } from "@/lib/utils";
import { formatBalance } from "./checkout-errors";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the payment-method card (wallet-only by design — see the page docblock).
// The page keeps computing balance/balanceLoading/balanceError/insufficient
// and comparisonTotal from the live /me cache and the coupon-adjusted math
// (one source the CTA gate and this chip both key off) and passes them DOWN
// as values. DOM, classes and aria are byte-identical.

export function PaymentMethodCard({
  balanceLoading,
  balance,
  balanceError,
  insufficient,
  comparisonTotal,
}: {
  balanceLoading: boolean;
  /** null = probe absent/failed — renders the «—» unknown marker, never a
   * fabricated 0.00 (the page never fakes balance=0). */
  balance: number | null;
  balanceError: boolean;
  insufficient: boolean;
  /** R94-A1 #1: the CENT-ROUNDED (coupon-adjusted) total — the same number
   * the balance gate compares against. */
  comparisonTotal: number;
}) {
  return (
    // Payment method — wallet only (see component docblock)
    <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
      <div className="flex items-center gap-2 mb-4">
        <Lock className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-bold text-base">طريقة الدفع</h2>
      </div>
      <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/50 bg-primary/8 shadow-sm">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-primary/15 text-primary">
          <Wallet className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm flex items-center gap-2">
            خصم من المحفظة
            <CheckCircle2 className="w-4 h-4 text-primary" />
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {/* R134 (A2-F9): colon dropped — the cart's twin chip
                (cart.tsx) renders «رصيدك {amount}»; the checkout
                summary rows avoid colons, and this datum chip
                followed neither rule exactly. */}
            رصيدك{" "}
            <span className="font-bold text-foreground tabular-nums">
              {/* 93-C5 / F-15 (A4 #8): a failed probe used to render a
                  fabricated "0.00 د.ل" here (formatBalance(null) →
                  formatCurrency(0)) while the banner below honestly
                  said "تعذّر التحقق من رصيدك" — contradictory money
                  UI. Render an explicit unknown marker instead. */}
              {balanceLoading ? "…" : balance === null ? "—" : formatBalance(balance)}
            </span>
          </div>
        </div>
      </div>
      <p className="text-2xs text-muted-foreground mt-3 leading-relaxed">
        سيُخصم ثمن طلباتك من رصيد المحفظة فوراً، وتُسلَّم بيانات الحسابات مباشرة بعد الدفع.
      </p>

      {balanceError && (
        <div
          role="alert"
          className="mt-3 p-3 rounded-xl bg-status-warning/10 border border-status-warning/22 text-status-warning text-xs font-bold flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>
            تعذّر التحقق من رصيدك. يمكن المتابعة وسيتم التحقق من الرصيد عند إتمام الطلب.
          </span>
        </div>
      )}

      {insufficient && (
        <div
          role="alert"
          className="mt-3 p-3 rounded-xl bg-status-error/10 border border-status-error/22 text-status-error text-xs font-bold flex items-start gap-2"
        >
          <X className="w-4 h-4 shrink-0 mt-px" />
          <div className="flex-1">
            <p>
              رصيد المحفظة غير كافٍ (الناقص {formatCurrency(comparisonTotal - (balance ?? 0))}
              ).
            </p>
            <Link
              href="/wallet?return=/checkout"
              /* R124-I4 (A4 F1): the ONLY path from a failed
                 checkout to the topup flow measured ~20px tall.
                 44px floor via the FlashSaleBanner negative-margin
                 idiom (min-h-11 -my-2 py-2) — the hit area clears
                 the floor while the alert box barely grows. */
              className="inline-flex items-center gap-1 min-h-11 -my-2 py-2 text-status-error underline underline-offset-2 hover:opacity-80"
            >
              اشحن المحفظة ثم عُد لإتمام الطلب
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
