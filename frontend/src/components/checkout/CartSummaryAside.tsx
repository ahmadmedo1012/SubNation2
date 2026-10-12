import type { ReactNode } from "react";
import { AlertCircle, ShoppingBag, Tag } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { LocalCartItem } from "@/lib/cart";
import type { AppliedCoupon } from "./CouponCard";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the sticky order-summary aside (re-quote notices, the empty state, the
// per-line items list, the totals). State stays centralized in the page;
// the banner + CTA ride in as children (the page composes OrderErrorBanner
// + CheckoutCta between the totals and the terms line — their exact
// original DOM positions). The empty-state asChild CTA and the
// dir="auto" it.name rows are byte-identical (the a4-f1/r128 pins read
// this surface).

export function CartSummaryAside({
  droppedLineNotices,
  pricesUpdatedNotice,
  isEmpty,
  items,
  totalLYD,
  appliedCoupon,
  comparisonTotal,
  children,
}: {
  droppedLineNotices: string[];
  pricesUpdatedNotice: string | null;
  isEmpty: boolean;
  items: LocalCartItem[];
  totalLYD: number;
  appliedCoupon: AppliedCoupon | null;
  /** R94-A1 #1: the cent-rounded (coupon-adjusted) total — the same
   * number the balance gate compares against. */
  comparisonTotal: number;
  /** The order-error banner + the confirm CTA — rendered inside the
   * non-empty branch, between the totals and the terms line. */
  children: ReactNode;
}) {
  return (
    <aside className="md:sticky md:top-20 md:self-start">
      <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
        <h2 className="font-bold text-base mb-4">ملخص الطلب</h2>

        {/* 98-F2 (R98-A3 F5 / P2): live-price reconciliation
            notices — shown ONCE after the mount re-quote. Dropped
            lines (product/variant no longer sellable) are a
            warning-level alert; a price update is a subtle status
            line (the totals right below already carry the new
            numbers, so this explains WHY they moved).
            Hoisted ABOVE the isEmpty branch on purpose: a drop that
            empties the WHOLE cart (the single-line case) must still
            explain why — inside the old non-empty-only branch the
            notice unmounted the moment the last line left, and the
            shopper just watched their cart silently vanish. */}
        {droppedLineNotices.length > 0 && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-xl bg-status-warning/10 border border-status-warning/22 text-status-warning text-xs font-bold flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <div className="flex-1 leading-relaxed space-y-1">
              {droppedLineNotices.map((notice) => (
                <p key={notice}>{notice}</p>
              ))}
            </div>
          </div>
        )}
        {pricesUpdatedNotice && (
          <div
            role="status"
            className="mb-4 p-3 rounded-xl bg-status-info/10 border border-status-info/22 text-status-info text-xs font-bold flex items-start gap-2"
          >
            <Tag className="w-4 h-4 shrink-0 mt-px" />
            <span>{pricesUpdatedNotice}</span>
          </div>
        )}

        {isEmpty ? (
          <div className="text-center py-8 text-muted-foreground">
            <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-bold mb-3">سلتك فارغة</p>
            {/* R120-B7 (reviewer finding — A4-F1 sweep completion):
                asChild composition (cart.tsx ghost-CTA idiom) instead
                of Link>Button nesting — one anchor, one tab stop, no
                invalid interactive-in-interactive button. */}
            <Button asChild variant="outline" size="sm" className="font-bold">
              <Link href="/">تصفح المنتجات</Link>
            </Button>
          </div>
        ) : (
          <>
            <ul className="space-y-2 mb-4 max-h-72 overflow-y-auto">
              {items.map((it) => {
                const price = it.salePriceLYD ?? it.priceLYD;
                // 98-F2 (F1): with a coupon applied the backend charges
                // each unit its POST-coupon final — show that number per
                // line, not the pre-coupon price (the Σ row below then
                // reads as the sum of exactly these lines).
                const lineKey = `${it.productId}:${it.variantId ?? 0}`;
                const unitFinal = appliedCoupon
                  ? appliedCoupon.lineUnitFinals[lineKey]
                  : undefined;
                const displayUnit = unitFinal ?? price;
                const displayTotal =
                  unitFinal != null ? unitFinal * it.quantity : price * it.quantity;
                return (
                  <li
                    key={`${it.productId}:${it.variantId ?? 0}`}
                    className="flex items-center gap-2.5 text-sm"
                  >
                    <div className="w-9 h-9 rounded-lg bg-muted/60 border border-border/40 shrink-0 overflow-hidden flex items-center justify-center">
                      {it.imageUrl ? (
                        <img
                          src={it.imageUrl}
                          alt={it.name}
                          loading="lazy"
                          className="w-full h-full object-contain p-1"
                        />
                      ) : (
                        /* R126-L5 (A13, R125-A7 B-6 twin): the
                           first-letter fallback rode text-primary/50
                           — 1.65:1 dark / 2.35:1 light on the
                           bg-muted/60 tile (the measured figures from
                           the cart/orders twins R125-I7 fixed). Full
                           --muted-foreground: 7.44:1 dark / 6.09:1
                           light — the same both-theme-safe ink. */
                        <span className="text-xs font-bold text-muted-foreground select-none">
                          {(it.name ?? "?")[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* R128-A4 (F-1): dir="auto" — Latin item names
                          truncate from the wrong end in an RTL block
                          (the ellipsis eats the name's beginning).
                          Same isolation idiom as cart.tsx's it.name
                          twin + ProductCard's h3. */}
                      <div dir="auto" className="font-bold truncate">
                        {it.name}
                      </div>
                      {it.variantLabel && (
                        <div className="text-3xs font-semibold text-muted-foreground/85 truncate">
                          {it.variantLabel}
                        </div>
                      )}
                      <div className="text-2xs text-muted-foreground">
                        {it.quantity} × {formatCurrency(displayUnit)}
                      </div>
                    </div>
                    <div className="font-bold tabular-nums text-sm shrink-0">
                      {formatCurrency(displayTotal)}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border/50 pt-3 space-y-1.5 mb-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">المجموع الفرعي</span>
                <span className="font-bold tabular-nums">{formatCurrency(totalLYD)}</span>
              </div>
              {appliedCoupon && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">خصم الكوبون</span>
                  <span className="font-bold tabular-nums text-status-success">
                    −{formatCurrency(appliedCoupon.discount_amount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-base font-bold pt-1">
                <span>{appliedCoupon ? "الإجمالي بعد الكوبون" : "الإجمالي"}</span>
                <span className="tabular-nums text-primary-text">
                  {formatCurrency(comparisonTotal)}
                </span>
              </div>
            </div>

            {/* The order-error banner + the confirm CTA ride here as
                children (page-composed) — their exact pre-split DOM
                positions, between the totals and the terms line. */}
            {children}

            <p className="text-2xs text-muted-foreground text-center mt-3">
              {/* R123-E4a (P3-e): the legal surface + nav call it
                  «الشروط والأحكام» — this consent line said «شروط
                  الاستخدام» (a different term for the same document)
                  and wasn't linked. Hyperlinked to /terms so the
                  buyer can read what they're agreeing to. */}
              بالنقر على «إتمام الطلب» فإنك توافق على{" "}
              <Link
                href="/terms"
                /* R124-I4 (A5 #1/#10): consent link rode the raw
                   surface token at 11px (3.93:1 dark — AA fail at
                   this size). text-primary-text + the resting
                   underline idiom (color-alone is not enough). */
                className="text-primary-text font-bold underline underline-offset-2 hover:opacity-80 transition-opacity"
              >
                الشروط والأحكام
              </Link>
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
