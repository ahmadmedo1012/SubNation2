import { CheckCircle, Lock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Product, ProductVariant } from "@workspace/api-client-react";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the price + stock box (the order-6 block of the buy panel). The page
// keeps computing `displayPrice` and the effective selection (one source
// the CTA, coupon math and buy-intent all key off) and passes them DOWN
// as values; the variant-aware strike mirrors the duration pills
// (render-pinned by product-price-honesty R115-I1 A7 P2-1). DOM,
// classes and aria are byte-identical.
export function PriceStockPanel({
  product,
  selectedVariant,
  displayPrice,
}: {
  product: Product;
  selectedVariant: ProductVariant | null;
  displayPrice: number;
}) {
  return (
    // Price + stock
    // R117 (F-1): max-lg:mx-5 restores the 20px side gutter the
    //   pre-split p-5 container gave this tinted box on mobile —
    //   mx (not px) so the gutter sits OUTSIDE the rounded border.
    <div className="order-6 max-lg:mx-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 bg-muted/20 border border-border/45 rounded-xl">
      <div className="flex-1">
        <div className="text-3xl font-bold text-primary leading-none tabular-nums">
          {formatCurrency(displayPrice)}
        </div>
        {/* R115-I1 (A7 P2-1): the strike follows the EFFECTIVE
            selection exactly like the duration pills below — the
            SELECTED variant's base price when a variant is picked.
            product.price is the MIN variant price (backend
            contract), so the old strike showed «كان 25 د.ل → الآن
            80 د.ل» nonsense during flash sales on any
            non-cheapest option. */}
        {(selectedVariant ? selectedVariant.sale_price : product.sale_price) != null && (
          <div className="text-muted-foreground text-sm line-through mt-1.5 tabular-nums">
            {formatCurrency(selectedVariant ? selectedVariant.price : product.price)}
          </div>
        )}
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-label={
          product.is_available ? `المنتج متوفر، الكمية ${product.stock_count}` : "نفد المخزون"
        }
        className={`flex items-center gap-1.5 self-start text-sm font-bold px-3 py-2 rounded-xl border ${
          product.is_available
            ? "bg-status-success/10 border-status-success/22 text-status-success"
            : "bg-muted/50 border-border/50 text-muted-foreground"
        }`}
      >
        {product.is_available ? (
          <>
            <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> متوفر ({product.stock_count})
          </>
        ) : (
          <>
            <Lock className="w-3.5 h-3.5" aria-hidden="true" /> نفد المخزون
          </>
        )}
      </div>
    </div>
  );
}
