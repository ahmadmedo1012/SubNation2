import { useLocation } from "wouter";
import {
  AlertCircle,
  CheckCircle,
  Headphones,
  Info,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
import { CopyField } from "@/components/product/CopyField";
import { formatCurrency } from "@/lib/utils";
import { Link } from "wouter";
import type { Order } from "@workspace/api-client-react";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the buy-success receipt (its own full-page early return in the page).
// The order + the money receipt VALUES stay owned by the page
// (handleBuyIntent seeds them); this component renders them. The two
// exit CTAs are pure browse jumps with no payload, so they ride the
// component's own wouter navigate (the CtaBlock idiom — one more
// callback prop would just be ceremony). DOM, classes and aria are
// byte-identical to the inline early return it replaces.

/** R115-I1 (A7 P3-8): the buy-success money receipt — the charged amount
 * + the post-charge wallet balance. balanceAfter stays null until the
 * cache:"no-store" /me refresh lands: a STALE pre-purchase balance must
 * never be presented as "remaining" on the success screen. */
export interface PurchaseSummary {
  charged: number;
  balanceAfter: number | null;
}

export function OrderSuccessScreen({
  order,
  purchaseSummary,
}: {
  order: Order;
  purchaseSummary: PurchaseSummary | null;
}) {
  const [, navigate] = useLocation();

  return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
      <div
        role="status"
        aria-live="polite"
        className="bg-card border border-status-success/22 rounded-2xl overflow-hidden float-in"
      >
        {/* Success header */}
        <div className="p-6 text-center border-b border-border/40 bg-gradient-to-b from-status-success/8 to-transparent">
          {/* Animated ring */}
          <div className="relative w-20 h-20 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full bg-status-success/15 success-ring" />
            <div className="absolute inset-0 rounded-full bg-status-success/8" />
            <div className="w-full h-full bg-status-success/15 rounded-full flex items-center justify-center ring-4 ring-status-success/12">
              <CheckCircle className="w-9 h-9 text-status-success" />
            </div>
          </div>
          <h1 className="text-xl font-bold mb-1.5">تم الشراء بنجاح!</h1>
          <p className="text-muted-foreground text-sm flex items-center justify-center gap-1.5 flex-wrap">
            رقم الطلب:
            {/* R116-S2 (P3): the shared CopyButton owns the
                idle → copied → failed lifecycle (the old local
                copyField helper + bare button announced nothing when
                the clipboard denied the call). */}
            <span
              dir="ltr"
              className="font-mono font-bold text-foreground inline-flex items-center gap-1"
            >
              {order.order_code}
            </span>
            <CopyButton text={order.order_code} label="نسخ" />
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* R115-I1 (A7 P3-8): money receipt — what was charged and
              what's left in the wallet. The charged amount comes from
              the order itself; the remaining balance appears the
              moment the post-charge /me refresh lands (never a stale
              pre-purchase number). */}
          <div className="bg-muted/20 border border-border/50 rounded-xl divide-y divide-border/30">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-xs font-bold text-muted-foreground">المبلغ المخصوم</span>
              <span className="font-bold text-sm tabular-nums text-foreground">
                {/* R177: no trailing `?? 0` — absent amount reads «— د.ل"
                    (the R157 honesty contract), never «0.00 د.ل». */}
                {formatCurrency(purchaseSummary?.charged ?? order.amount)}
              </span>
            </div>
            {purchaseSummary?.balanceAfter != null && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs font-bold text-muted-foreground">رصيدك المتبقي</span>
                <span className="font-bold text-sm tabular-nums text-status-success">
                  {formatCurrency(purchaseSummary.balanceAfter)}
                </span>
              </div>
            )}
          </div>

          {/* Credentials box */}
          {(order.delivered_email || order.delivered_password) && (
            <div className="bg-muted/20 border border-border/50 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/30 bg-muted/20 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-status-success" />
                {/* 96-F4 (R96 A6 #1): uppercase/tracking-wider removed —
                    no-op on Arabic but tears the letter joins visually.
                    R116-S2 (P3): h3 → h2 — the receipt jumps h1 → h3
                    (a skipped level); «بيانات الحساب» is the receipt's
                    section heading directly under the h1. */}
                <h2 className="text-xs font-bold text-muted-foreground">بيانات الحساب</h2>
              </div>
              <div className="divide-y divide-border/25">
                {order.delivered_email && (
                  <CopyField label="البريد الإلكتروني" value={order.delivered_email} />
                )}
                {order.delivered_password && (
                  <CopyField label="كلمة المرور" value={order.delivered_password} secret />
                )}
              </div>
            </div>
          )}

          {/* R118-B2 (A2 fix, buyer side): the purchase succeeded and the
              order completed, but the credential payload could not be
              decrypted (backend decrypt_failed:true — delivered_* null).
              Previously the receipt just omitted the credentials box
              entirely, implying the product ships without account data.
              The honest notice rides the usage-terms warning idiom
              (status-warning card + icon) and hands the buyer the
              support link — support can re-deliver the credentials. */}
          {order.decrypt_failed && !order.delivered_email && !order.delivered_password && (
            <div
              role="alert"
              className="bg-status-warning/8 border border-status-warning/22 rounded-xl p-3.5 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-status-warning leading-relaxed">
                  تعذّر فك تشفير بيانات التسليم
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5 mb-2.5">
                  طلبك مكتمل ومحفوظ، لكن بيانات الحساب تعذّر فك تشفيرها حالياً. تواصل مع الدعم
                  وستصلك بياناتك فوراً.
                </p>
                {/* A3-F13 (R120-B2): asChild — the old Link>Button
                    nesting rendered TWO same-named «تواصل مع الدعم»
                    elements (the anchor + an invalid
                    interactive-in-interactive button). One anchor,
                    one tab stop; order-decrypt-failed.test.tsx pins
                    the link role + label. */}
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-9 px-4 gap-1.5 rounded-xl font-bold"
                >
                  <Link href="/support">
                    <Headphones className="w-3.5 h-3.5" />
                    تواصل مع الدعم
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {order.delivered_extra_details && (
            /* 96-F4 (R96 A6 #7): free-text delivery details carry mixed-
               direction runs (activation links / PIN codes inside Arabic
               sentences) — dir="auto" + start alignment let the bidi
               algorithm pick the base direction from the first strong
               character instead of scrambling the visual order. */
            <div
              dir="auto"
              className="bg-muted/15 border border-border/40 rounded-xl px-4 py-3 text-sm text-muted-foreground leading-relaxed text-start"
            >
              {order.delivered_extra_details}
            </div>
          )}

          {order.delivered_usage_terms && (
            <div className="flex gap-2.5 text-sm bg-status-warning/8 border border-status-warning/22 rounded-xl p-3.5">
              <Info className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
              <span className="text-status-warning leading-relaxed">
                {order.delivered_usage_terms}
              </span>
            </div>
          )}

          <div className="flex gap-2.5 pt-1">
            <Button
              onClick={() => navigate("/orders")}
              /* R116-S2 CTA recipe: size=lg owns the primary surface. */
              size="lg"
              className="flex-1"
            >
              <ShoppingCart className="w-4 h-4 ms-1.5" />
              عرض طلباتي
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate("/")} className="flex-1">
              تصفّح المزيد
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
