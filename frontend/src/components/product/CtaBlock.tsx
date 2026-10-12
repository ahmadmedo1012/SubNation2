import { useLocation } from "wouter";
import { Check, Loader2, Lock, PlusCircle, ShoppingCart, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KNOWN_CATEGORIES } from "@/components/product/category-presentation";
import { CouponField, type CouponResult } from "@/components/product/CouponField";
import { formatCurrency } from "@/lib/utils";
import type { Product, User } from "@workspace/api-client-react";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the money CTA block (desktop buy panel + compact mobile sticky-bar twin,
// two render surfaces of ONE branch ladder: sold-out → guest →
// balance-loading → insufficient → buy). It was already a self-contained
// component inside the page file; the move only changes its address.
// State stays centralized in the page (canAfford/shortfall are computed
// there from the live user + coupon state and passed down as values —
// the branch ladder must never diverge between the two surfaces).

export function CtaBlock({
  token,
  product,
  user,
  userLoading,
  displayPrice,
  canAfford,
  shortfall,
  isPending,
  onBuy,
  onAddToCart,
  onLogin,
  onWallet,
  compact,
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  onCouponChange,
  onCouponValidate,
  onCouponClear,
}: {
  token: string | null;
  product: Product;
  user?: User;
  /** R94-A1 #2 (P2): true while /api/auth/me is still resolving. Without
   * it, `user === undefined` made canAfford=false and the FIRST thing a
   * solvent buyer saw on a direct SEO landing was «تحتاج إضافة X د.ل /
   * رصيدك الحالي 0.00 د.ل» — a false money statement during the first
   * 200–800ms on 3G. */
  userLoading?: boolean;
  displayPrice: number;
  canAfford: boolean;
  shortfall: number;
  isPending: boolean;
  onBuy: () => void;
  onAddToCart?: () => void;
  onLogin: () => void;
  onWallet: () => void;
  compact?: boolean;
  couponInput?: string;
  couponResult?: CouponResult | null;
  couponError?: string;
  couponValidating?: boolean;
  onCouponChange?: (v: string) => void;
  onCouponValidate?: () => void;
  onCouponClear?: () => void;
}) {
  // Local navigate for the out-of-stock alternates link below. The
  // parent already passes onLogin/onWallet because both routes carry
  // intent context (?intent=, ?return=); the alternates link is a
  // pure browse jump with no payload, so wiring through one more
  // callback would just be ceremony.
  const [, navigate] = useLocation();

  // A9-5 (R126-L6): availability outranks auth. The sold-out branch
  // used to sit AFTER the !token branch, so a guest on a sold-out
  // product saw «تسجيل الدخول للشراء» promising a purchase the page's
  // own «نفد المخزون» chip denied — and post-login the CTA flipped to
  // the disabled state anyway. Sold-out now shows the honest disabled
  // state (compact: strike price + «بدائل» recovery link — a better
  // answer for guests too) for EVERYONE; the login gate only renders
  // for products that can actually be bought.
  if (!product.is_available) {
    // Recovery hint: instead of a dead-end disabled CTA, give the user
    // a clear alternate path. On desktop the body retains a calm
    // "check back later" line; on mobile the sticky bar swaps the
    // disabled button for an active "browse alternatives" link
    // routed to the same category — same intent, different stock.
    const altHref =
      product.category && KNOWN_CATEGORIES.has(product.category)
        ? `/category/${product.category}`
        : "/";

    if (compact) {
      return (
        <div className="flex items-center gap-3">
          <div className="flex-1 text-right">
            <div className="font-bold text-muted-foreground text-xl tabular-nums line-through">
              {formatCurrency(displayPrice)}
            </div>
            <div className="text-2xs text-muted-foreground/90 flex items-center gap-1 mt-0.5">
              <Lock className="w-3 h-3" aria-hidden="true" /> نفد المخزون
            </div>
          </div>
          <Button
            onClick={() => navigate(altHref)}
            variant="outline"
            className="shrink-0 h-12 min-w-[7.5rem] px-5 press-spring"
          >
            بدائل
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <Button
          disabled
          aria-label="نفد المخزون — غير متاح للشراء حالياً"
          className="w-full h-12 text-base"
        >
          <Lock className="w-4 h-4 ms-2" /> نفد المخزون
        </Button>
        <Button
          onClick={() => navigate(altHref)}
          variant="outline"
          className="w-full h-11 text-sm press-spring"
        >
          تصفّح بدائل في نفس الفئة
        </Button>
        <p className="text-center text-xs text-muted-foreground">تحقّق لاحقاً، قد يعود قريباً</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className={`${compact ? "flex items-center gap-3" : "space-y-2"}`}>
        {compact && (
          /* R127-B13 §7.1 (via the R128 sweep): min-w-0 + truncate on the
             compact price stack — the price is the bar's widest
             unbreakable token, and a flex child's automatic minimum
             width grows the bar past the viewport at 320px once a
             4+-digit price ships (the CTA is the shrink-0 twin). The
             full price stays visible in the buy panel above. */
          <div className="flex-1 min-w-0 text-right">
            <div className="font-bold text-primary text-xl tabular-nums truncate">
              {formatCurrency(displayPrice)}
            </div>
            <div className="text-xs text-muted-foreground">سجّل دخولك للشراء</div>
          </div>
        )}
        <Button
          onClick={onLogin}
          className={`${compact ? "shrink-0 h-12 min-w-[8rem] px-5" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 press-spring`}
        >
          {/* R115-I1 (A7 P3-12): the app-standard «سجّل دخولك» form
              (cart.tsx:333 + login.tsx family) — the shadda-less
              «سجل الدخول للشراء / سجل للشراء» were the only outliers. */}
          {compact ? "سجّل دخولك للشراء" : "تسجيل الدخول للشراء"}
        </Button>
        {/* R124 (A1-F4) → A9-4 (R126-L6): guests get the same
            add-to-cart affordance the grid cards give them — the cart is
            local (ProductCard's CTA has no auth gate; addItem is a
            localStorage write, never a server POST), and the cart page
            already funnels guests through /login?redirect=/checkout, so
            the label says WHEN sign-in actually happens. A9-4 closed the
            desktop-only gap: the fix used to live exclusively in the
            hidden sm:block block, so the <640px majority never saw it —
            the compact sticky bar now carries the same guarded path
            (outline icon-button beside the login CTA, same
            `onAddToCart && product.is_available` gate as the desktop
            twin). */}
        {!compact && onAddToCart && product.is_available && (
          <Button
            onClick={onAddToCart}
            variant="outline"
            className="w-full h-11 border-border/60 text-muted-foreground hover:text-foreground hover:border-border font-bold rounded-xl gap-2"
          >
            <PlusCircle className="w-4 h-4" />
            أضف للسلة — سجّل الدخول عند إتمام الطلب
          </Button>
        )}
        {compact && onAddToCart && product.is_available && (
          <Button
            onClick={onAddToCart}
            variant="outline"
            aria-label="أضف للسلة — سجّل الدخول عند إتمام الطلب"
            className="shrink-0 h-12 w-12 border-border/60 text-muted-foreground hover:text-foreground hover:border-border press-spring"
          >
            <PlusCircle className="w-5 h-5" />
          </Button>
        )}
      </div>
    );
  }

  const couponField =
    !compact && onCouponChange && onCouponValidate && onCouponClear ? (
      <CouponField
        token={token}
        couponInput={couponInput ?? ""}
        couponResult={couponResult ?? null}
        couponError={couponError ?? ""}
        couponValidating={couponValidating ?? false}
        onCouponChange={onCouponChange}
        onCouponValidate={onCouponValidate}
        onCouponClear={onCouponClear}
      />
    ) : null;

  // R94-A1 #2 (P2): balance still loading — show a neutral verifying
  // state instead of flashing the «رصيد غير كافٍ» branch at a solvent
  // user. Disabled button + spinner; lands on the real branch once /me
  // resolves (the boot probe usually pre-seeds the cache, so this is
  // mostly a cold-direct-landing state).
  if (userLoading) {
    return (
      <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
        {!compact && couponField}
        {compact && (
          <div className="flex-1 text-right">
            <div className="font-bold text-primary text-xl tabular-nums">
              {formatCurrency(displayPrice)}
            </div>
            <div className="text-xs text-muted-foreground">جارٍ التحقق من رصيدك…</div>
          </div>
        )}
        <Button
          disabled
          aria-busy="true"
          aria-label="جارٍ التحقق من رصيد المحفظة"
          className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-5" : "w-full h-12 text-base"} bg-primary/70 font-bold`}
        >
          <Loader2 className={`${compact ? "w-4 h-4" : "w-5 h-5"} ml-2 animate-spin`} />
          {compact ? "جارٍ التحقق…" : "جارٍ التحقق من رصيدك…"}
        </Button>
      </div>
    );
  }

  if (!canAfford) {
    return (
      <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
        {compact ? (
          <>
            {/* B13 §7.1 twin: min-w-0 + truncate (see the guest branch
                above). */}
            <div className="flex-1 min-w-0 text-right">
              <div className="font-bold text-primary text-xl tabular-nums truncate">
                {formatCurrency(displayPrice)}
              </div>
              <div className="text-xs text-destructive/75">
                تحتاج {formatCurrency(shortfall)} إضافية
              </div>
            </div>
            <Button
              onClick={onWallet}
              variant="outline"
              className="shrink-0 h-12 min-w-[7.5rem] px-5 press-spring"
            >
              <Wallet className="w-4 h-4 ms-1.5" /> شحن
            </Button>
          </>
        ) : (
          <>
            {couponField}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-muted/25 border border-border/50 rounded-xl col-span-2">
                <span className="text-muted-foreground">رصيدك الحالي</span>
                <span className="font-bold tabular-nums">
                  {formatCurrency(user?.wallet_balance ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-primary/8 border border-primary/20 rounded-xl col-span-2">
                <span className="text-muted-foreground">تحتاج إضافة</span>
                <span className="font-bold text-primary-text tabular-nums">
                  {formatCurrency(shortfall)}
                </span>
              </div>
            </div>
            <Button
              onClick={onWallet}
              variant="outline"
              className="w-full h-12 text-base press-spring"
            >
              <Wallet className="w-5 h-5 ms-2" /> شحن المحفظة
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
      {!compact && couponField}
      {compact && (
        /* B13 §7.1 twin: min-w-0 + truncate (see the guest branch above). */
        <div className="flex-1 min-w-0 text-right">
          <div className="font-bold text-primary text-xl tabular-nums truncate">
            {formatCurrency(displayPrice)}
          </div>
          {/* R128-A6 (P4-4): the ✓ TEXT glyph is gone — lucide Check in
              its place (emoji/text-glyph-as-icon is off the icon
              contract). inline-flex keeps the icon on the reading line
              (RTL: text first, glyph to its left). */}
          <div className="text-xs text-status-success">
            <span className="inline-flex items-center gap-1">
              رصيد كافٍ
              <Check className="w-3 h-3" aria-hidden="true" />
            </span>
          </div>
        </div>
      )}
      <Button
        onClick={onBuy}
        disabled={isPending}
        className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-6" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 press-spring`}
      >
        <ShoppingCart className={`${compact ? "w-4 h-4" : "w-5 h-5"} ms-2`} />
        {isPending
          ? "جارٍ المعالجة…"
          : compact
            ? "اشترِ"
            : `اشترِ الآن — ${formatCurrency(displayPrice)}`}
      </Button>
      {/* Secondary path: multi-item funnel. A9-4 (R126-L6): the compact
          sticky bar carries it too (outline icon-button) — it used to be
          desktop-only, leaving the mobile majority with buy-only, no
          way to park the selection in the cart and keep shopping. */}
      {!compact && onAddToCart && product.is_available && (
        <Button
          onClick={onAddToCart}
          variant="outline"
          className="w-full h-11 border-border/60 text-muted-foreground hover:text-foreground hover:border-border font-bold rounded-xl gap-2"
        >
          <PlusCircle className="w-4 h-4" />
          أضف للسلة — أكمل الشراء مع منتجات أخرى
        </Button>
      )}
      {compact && onAddToCart && product.is_available && (
        <Button
          onClick={onAddToCart}
          variant="outline"
          aria-label="أضف للسلة"
          className="shrink-0 h-12 w-12 border-border/60 text-muted-foreground hover:text-foreground hover:border-border press-spring"
        >
          <PlusCircle className="w-5 h-5" />
        </Button>
      )}
      {/* Reassurance: tells the user exactly what will be deducted and
          what's left after — eliminates a hesitation moment where users
          tap and pause to mentally calculate "wait, will I still have
          something for next time?". Desktop-only; the mobile sticky bar
          already shows the balance via the «رصيد كافٍ» line in compact
          mode. */}
      {!compact && user && (
        <p className="text-center text-xs text-muted-foreground -mt-1">
          سيُخصم من رصيدك ({formatCurrency(user.wallet_balance ?? 0)} متاح)
        </p>
      )}
    </div>
  );
}
