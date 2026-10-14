import { AlertCircle, ChevronDown, Info } from "lucide-react";
import { CouponField, type CouponResult } from "@/components/product/CouponField";
import { CtaBlock } from "@/components/product/CtaBlock";
import { FaqAccordion } from "@/components/product/FaqAccordion";
import { PriceStockPanel } from "@/components/product/PriceStockPanel";
import { TrustSignals } from "@/components/product/TrustSignals";
import { VariantSelector, type SelectableVariant } from "@/components/product/VariantSelector";
import type { Product, ProductFaqItem, ProductVariant, User } from "@workspace/api-client-react";

// R137 (closing decomposition): extracted verbatim from pages/product.tsx —
// the buy panel (the R116-S2 END column: at lg the sticky desktop panel,
// below lg it dissolves via max-lg:contents so the blocks keep their exact
// pre-split mobile order). EVERY prop is a value or callback owned by the
// page (the coupon quartet, the selection, the buy-pending flag, the CTA
// handlers) — the props keep their page-side names so the moved JSX is
// byte-identical; zero hooks live here. The desktop CtaBlock rides inside;
// its compact sticky-bar twin stays in the page (guest/authed geometry is
// page state — the R135 pin).
// R145 (D3, P0 — conversion path): the usage-terms block moved BELOW the
// CTA area + de-energized (see its comment); the column now reads
// selector → price → error → trust → FAQ → coupon → CTA → terms.
export function BuyPanelColumn({
  product,
  sortedVariants,
  selectedVariant,
  setSelectedVariantId,
  displayPrice,
  token,
  user,
  userLoading,
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  setCouponInput,
  validateCoupon,
  clearCoupon,
  error,
  buyPending,
  handleBuyIntent,
  handleAddToCart,
  loginWithIntent,
  walletWithReturn,
  productFaqs,
}: {
  product: Product;
  sortedVariants: SelectableVariant[];
  selectedVariant: ProductVariant | null;
  setSelectedVariantId: (variantId: number) => void;
  displayPrice: number;
  token: string | null;
  user: User | undefined;
  userLoading: boolean;
  couponInput: string;
  couponResult: CouponResult | null;
  couponError: string;
  couponValidating: boolean;
  setCouponInput: (v: string) => void;
  validateCoupon: () => void;
  clearCoupon: () => void;
  error: string;
  buyPending: boolean;
  handleBuyIntent: () => void;
  handleAddToCart: () => void;
  loginWithIntent: () => void;
  walletWithReturn: () => void;
  productFaqs: ProductFaqItem[] | null;
}) {
  return (
    // R116-S2: END column — at lg this is the sticky buy panel
    //   (selector → price → error → trust → FAQ → coupon → CTA → terms
    //   after the R145/D3 move; the FAQ joined this column in R117 F-3 so
    //   mobile DOM order matches the visual order); below lg it dissolves
    //   (max-lg:contents) so the blocks keep their exact pre-split mobile
    //   order via flex order-5..order-13.
    // R143 (L2-2): lg:border-border/55 → /60 — the resting card-frame
    //   value the r139 sweep landed everywhere else; the PDP trio (this,
    //   ProductMediaSection, route-skeleton's mirror) were the stragglers.
    <section className="max-lg:contents lg:self-start lg:sticky lg:top-24 lg:bg-card lg:border lg:border-border/60 lg:rounded-2xl lg:overflow-hidden lg:shadow-xl">
      <div className="max-lg:contents lg:p-5 lg:space-y-4">
        {/* ── Variant selector (catalog 2026-09-20) ─────────────────────
          Plan × Duration matrix rendered as grouped pills. Shown only
          when the product carries >1 active option — single-option
          products skip the selector entirely (their price block IS the
          variant). Touch targets ≥ 44px, high-contrast selected state. */}
        {sortedVariants.length > 1 && (
          <div className="order-5 max-lg:px-5">
            <VariantSelector
              variants={sortedVariants}
              selectedId={selectedVariant?.id ?? null}
              onSelect={setSelectedVariantId}
            />
          </div>
        )}

        {/* Price + stock — R135 (FE-3): the box moved verbatim to
            PriceStockPanel (its R117 F-1 gutter + R115-I1 strike
            comments moved with it). displayPrice and the effective
            selection stay owned by the page — one source. */}
        <PriceStockPanel
          product={product}
          selectedVariant={selectedVariant}
          displayPrice={displayPrice}
        />

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="order-8 max-lg:mx-5 flex items-center gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-4 py-3 rounded-xl shake"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Trust signals — R135 (FE-3): the static grid moved verbatim to
            TrustSignals (the order-9 wrapper rides its root, preserving
            the R117 F-1 gutter contract). */}
        <TrustSignals />

        {/* FAQ — R135 (FE-3): the accordion moved verbatim to FaqAccordion;
            the R117 (F-3) DOM-order comment moved with it. Rendered only
            when the curated list is non-empty (the same page-level guard
            gates the FAQPage JSON-LD against thin structured data). */}
        {productFaqs && <FaqAccordion faqs={productFaqs} />}

        {/* Mobile coupon entry stays in the scrollable content; the sticky bar remains thumb-sized. */}
        {token && (
          <div className="order-11 max-lg:mx-5 sm:hidden rounded-xl border border-border/45 bg-muted/10 p-3">
            <CouponField
              token={token}
              couponInput={couponInput}
              couponResult={couponResult}
              couponError={couponError}
              couponValidating={couponValidating}
              onCouponChange={setCouponInput}
              onCouponValidate={validateCoupon}
              onCouponClear={clearCoupon}
            />
          </div>
        )}

        {/* CTA — desktop only (mobile uses sticky bar) */}
        <div className="order-12 max-lg:px-5 hidden sm:block">
          <CtaBlock
            token={token}
            product={product}
            user={user}
            userLoading={userLoading}
            displayPrice={couponResult ? couponResult.final_amount : displayPrice}
            canAfford={
              !!(
                user &&
                (user.wallet_balance ?? 0) >=
                  (couponResult ? couponResult.final_amount : displayPrice)
              )
            }
            shortfall={
              (couponResult ? couponResult.final_amount : displayPrice) -
              (user?.wallet_balance ?? 0)
            }
            isPending={buyPending}
            onBuy={handleBuyIntent}
            onAddToCart={handleAddToCart}
            onLogin={loginWithIntent}
            onWallet={walletWithReturn}
            couponInput={couponInput}
            couponResult={couponResult}
            couponError={couponError}
            couponValidating={couponValidating}
            onCouponChange={setCouponInput}
            onCouponValidate={validateCoupon}
            onCouponClear={clearCoupon}
          />
        </div>

        {/* Usage terms — R145 (D3, P0): moved BELOW the CTA area +
            de-energized. The live-site VLM audit caught this block as a
            yellow warning-tinted wall of legalistic text sitting BETWEEN
            the price and the buy CTA — a pattern interrupt exactly where
            intent peaks (after the price the eye must land on the CTA);
            on the audited products it pushed the CTA below the first
            desktop viewport entirely. It now closes the panel as a quiet
            native-<details> disclosure (the FaqSection/DetailsSection
            family — zero JS state, browser open/close semantics):
            resting border-border/20 hairline + text-muted-foreground, NO
            warning tint at rest (severity vocabulary stays reserved for
            the alert/confirm families). The full operator text rides
            inside byte-identical — the honesty contract is
            REPOSITION/DE-EMPHASIZE, never delete (pre-purchase
            disclosure one tap away + still in the DOM for crawlers).
            order-13 keeps the mobile DOM/reading order matching the
            visual order (the R117 F-3 discipline: FAQ 10 → coupon 11 →
            CTA 12 → terms 13); max-lg:mx-5 keeps the R117 F-1 mobile
            gutter OUTSIDE the hairline border. */}
        {product.usage_terms && (
          <details className="order-13 max-lg:mx-5 group rounded-xl border border-border/20 overflow-hidden [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none">
            <summary className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-muted-foreground cursor-pointer select-none hover:text-foreground hover:bg-muted/15 transition-colors">
              <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="font-semibold">شروط الاستخدام</span>
              {/* R145: ChevronDown rotator (the accordion contract — never
                  a sideways arrow); group-open:rotate-180, the
                  DetailsSection idiom. */}
              <ChevronDown
                className="w-4 h-4 ms-auto shrink-0 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="px-3.5 pt-1 pb-3.5 border-t border-border/20 text-sm text-muted-foreground leading-relaxed">
              {product.usage_terms}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
