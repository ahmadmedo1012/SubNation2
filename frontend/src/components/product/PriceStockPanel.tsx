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
  // R168-L3 (fix 6): multi-variant products drop the numeric count —
  // stock_count is the PRODUCT-level pool, which can over-claim what the
  // SELECTED variant can deliver (verified drift case: uneven scoped
  // pools → a mid-charge 409). Single-variant products keep the count
  // (accurate there, and the low-stock urgency signal stays).
  // shortcut: variant-scoped counts would need the DTO to expose them, upgrade when it does.
  // (ProductCard's defensive read — the grid projection omits variants.)
  const multiVariant = (product.variants?.length ?? 0) > 1;
  return (
    // Price + stock
    // R117 (F-1): max-lg:mx-5 restores the 20px side gutter the
    //   pre-split p-5 container gave this tinted box on mobile —
    //   mx (not px) so the gutter sits OUTSIDE the rounded border.
    <div className="order-6 max-lg:mx-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 bg-muted/20 border border-border/45 rounded-xl">
      <div className="flex-1">
        {/* R138 (visual) — hierarchy verified, values untouched: the page's
            #2 anchor after the h1 (now text-fluid-3xl, the GuestHero title
            step — the PDP h1 used to sit UNDER this price at mobile fluid-2xl
            ≈23.6px vs the fixed 30px here, inverting the anchor order on the
            mobile-majority surface). 30px/700/tabular-nums = large text, so
            the primary ink clears AA at the large-text 3:1 floor: 3.68:1
            dark / 5.13:1 light on the muted/20 wash. text-3xl is
            render-pinned by product-price-honesty (.text-3xl querySelector)
            and the strike below carries the pinned selected-variant base
            contract — money classes stay byte-identical this round. */}
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
          product.is_available
            ? // R168-L3 (fix 6): the SR twin mirrors the visible badge —
              // no count on multi-variant products (same honesty rule).
              multiVariant
              ? "المنتج متوفر"
              : `المنتج متوفر، الكمية ${product.stock_count}`
            : "نفد المخزون"
        }
        className={`flex items-center gap-1.5 self-start text-sm font-bold px-3 py-2 rounded-xl border ${
          product.is_available
            ? "bg-status-success/10 border-status-success/22 text-status-success"
            : "bg-muted/50 border-border/50 text-muted-foreground"
        }`}
      >
        {product.is_available ? (
          <>
            <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> متوفر
            {!multiVariant && ` (${product.stock_count})`}
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
