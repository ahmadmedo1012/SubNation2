import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { useCart, type LocalCartItem } from "@/lib/cart";
import { formatCurrency } from "@/lib/utils";
import { Minus, Plus, ShoppingCart, Trash2, X, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { formatCount } from "@/lib/utils";

function effectivePrice(item: LocalCartItem): number {
  return item.salePriceLYD ?? item.priceLYD;
}

function CartSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="bg-card border border-border/60 rounded-xl p-4 flex items-center gap-3.5"
        >
          <div className="w-14 h-14 rounded-xl bg-muted skeleton-shimmer shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted skeleton-shimmer rounded w-2/5" />
            <div className="h-3 bg-muted skeleton-shimmer rounded w-1/3" />
          </div>
          <div className="h-5 bg-muted skeleton-shimmer rounded w-16" />
        </div>
      ))}
    </div>
  );
}

export default function CartPage() {
  // V3-A2: transactional funnel — never index (robots.txt also Disallows).
  const seoBlock = useSeo({
    title: "سلة المشتريات — SubNation",
    description: "راجع مشترياتك قبل إتمام الطلب.",
    path: "/cart",
    robots: "noindex,follow",
  });

  const { token } = useAuth();
  const { toast } = useToast();
  // Round-4 dead-code removal: the "server cart" simulation
  // (ServerCartItem/ServerCart/localToServerItems + a serverItems state
  // that was only ever set to []) never had a real server behind it —
  // the page renders the local cart directly. Verified unused in the
  // r4-1-c org audit (docs/ux-audit-storefront.md:73 documents the
  // remnant as known-dead since rounds ago).
  const { items, isLoaded, updateQuantity, removeItem, clear } = useCart();

  const total = useMemo(() => {
    return +items.reduce((s, i) => s + effectivePrice(i) * i.quantity, 0).toFixed(2);
  }, [items]);

  async function handleUpdate(productId: number, qty: number) {
    // qty 0 means "remove" — the previous code early-returned here, which
    // made the X-shown-at-qty-1 button a silent no-op with delete
    // affordance. Route it to removeItem instead.
    if (qty < 1) {
      removeItem(productId);
      return;
    }
    updateQuantity(productId, qty);
  }

  async function handleRemove(productId: number) {
    removeItem(productId);
  }

  function handleClear() {
    // 93-C5 / F-05 (A4 #10): "إفراغ السلة" for logged-in users was gated on
    // a server DELETE the rendered cart doesn't depend on (the page is
    // purely local — lib/cart.tsx, the server cart is documented dead
    // since round-4). Any API hiccup (5xx / transient network / expired
    // session) left the cart FULL after a destructive toast — on a page
    // whose data needs no API. Clear locally unconditionally; keep the
    // server DELETE as a best-effort fire-and-forget.
    clear();
    toast({ title: "تم إفراغ السلة" });
    if (token) {
      fetch("/api/cart", { method: "DELETE", credentials: "include" }).catch(() => {
        // Best-effort only — the UI renders the local cart; the server
        // copy (when the endpoint is alive) follows along eventually.
      });
    }
  }

  if (!isLoaded) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="h-7 w-40 bg-muted skeleton-shimmer rounded-lg mb-6" />
        <CartSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {seoBlock}
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-7 page-in flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
            <ShoppingCart className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black leading-tight">سلة المشتريات</h1>
            <p className="text-sm text-muted-foreground">
              {items.length === 0
                ? "سلتك فارغة حالياً"
                : formatCount(items.length, {
                    one: "منتج في السلة",
                    two: "منتجان في السلة",
                    few: "منتجات في السلة",
                    many: "منتجاً في السلة",
                    other: "منتج في السلة",
                  })}
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="text-status-error hover:text-status-error hover:bg-status-error/10 font-bold"
          >
            <Trash2 className="w-3.5 h-3.5 ml-1.5" />
            إفراغ السلة
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
          <div className="relative w-20 h-20 mx-auto mb-5">
            <div className="absolute inset-0 rounded-2xl bg-primary/6 blur-xl" />
            <div className="relative w-20 h-20 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center">
              <ShoppingCart className="w-9 h-9 opacity-25" />
            </div>
          </div>
          <p className="font-black text-lg mb-1.5 text-foreground/80">سلتك فارغة</p>
          <p className="text-sm text-muted-foreground mb-7 max-w-xs mx-auto leading-relaxed">
            ابدأ بتصفح الكتالوج وأضف منتجاتك المفضلة للسلة
          </p>
          <Link href="/">
            <Button className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold">
              <Sparkles className="w-4 h-4" />
              متابعة التسوق
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {/* Items */}
          <div className="space-y-2.5 mb-6">
            {items.map((it, i) => {
              const staggerClass = ["", "stagger-1", "stagger-2", "stagger-3", "stagger-4"][
                Math.min(i, 4)
              ];
              const price = effectivePrice(it);
              return (
                <div
                  key={it.productId}
                  className={`float-in ${staggerClass} bg-card border border-border/60 rounded-xl p-3.5 hover:border-border transition-all duration-200 group`}
                >
                  <div className="flex items-center gap-3.5">
                    <Link href={it.slug ? `/product/${it.slug}` : "/"}>
                      <div className="w-14 h-14 rounded-xl bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border/40 group-hover:border-border/70 transition-colors">
                        {it.imageUrl ? (
                          <img
                            src={it.imageUrl}
                            alt={it.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-contain p-1.5"
                          />
                        ) : (
                          <span className="text-lg font-black text-primary/50 select-none">
                            {(it.name ?? "?")[0]}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link href={it.slug ? `/product/${it.slug}` : "/"}>
                        <div className="font-bold text-sm leading-snug truncate group-hover:text-primary transition-colors">
                          {it.name}
                        </div>
                      </Link>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="font-black text-sm tabular-nums text-primary-text">
                          {formatCurrency(price)}
                        </span>
                        {it.salePriceLYD != null && it.salePriceLYD < it.priceLYD && (
                          <span className="text-[11px] text-muted-foreground line-through tabular-nums">
                            {formatCurrency(it.priceLYD)}
                          </span>
                        )}
                        {it.discountPercent != null && it.discountPercent > 0 && (
                          <span className="text-[10px] font-bold text-status-success bg-status-success/10 border border-status-success/22 px-1.5 py-0.5 rounded-full">
                            خصم {it.discountPercent}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="flex items-center gap-0 bg-muted/50 border border-border/40 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleUpdate(it.productId, it.quantity - 1)}
                          className="p-1.5 hover:bg-secondary/70 transition-colors text-muted-foreground hover:text-foreground"
                          aria-label={it.quantity === 1 ? "حذف المنتج" : "إنقاص الكمية"}
                        >
                          {it.quantity === 1 ? (
                            <X className="w-3.5 h-3.5 text-status-error" />
                          ) : (
                            <Minus className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <span className="font-black text-sm tabular-nums px-2 min-w-[28px] text-center">
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdate(it.productId, it.quantity + 1)}
                          className="p-1.5 hover:bg-secondary/70 transition-colors text-muted-foreground hover:text-foreground"
                          aria-label="زيادة الكمية"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(it.productId)}
                        className="p-1.5 rounded-lg hover:bg-status-error/10 text-muted-foreground hover:text-status-error transition-colors"
                        aria-label="حذف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 slide-up">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground font-bold">المجموع</span>
              <span className="font-black text-2xl tabular-nums">{formatCurrency(total)}</span>
            </div>
            {token ? (
              <Link href="/checkout">
                <Button className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 active:scale-[0.99] transition-all font-bold h-12">
                  متابعة الشراء
                </Button>
              </Link>
            ) : (
              <Link href="/login?redirect=/checkout">
                <Button className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 active:scale-[0.99] transition-all font-bold h-12">
                  سجل دخول للشراء
                </Button>
              </Link>
            )}
            <Link href="/">
              <Button
                variant="ghost"
                className="w-full mt-2 text-muted-foreground hover:text-foreground font-bold"
              >
                متابعة التسوق
              </Button>
            </Link>
            {/* R94-A1 #19 (P3): boilerplate-tax disclaimer removed — the
                pricing model is base − discount, no tax logic exists in
                the backend. The line now states the actual payment
                behavior (instant wallet debit) instead of seeding tax
                doubt at the payment-decision moment. */}
            <p className="text-[11px] text-muted-foreground text-center mt-3">
              الدفع يُخصم من رصيد محفظتك فوراً — تسليم فوري بعد التأكيد
            </p>
          </div>
        </>
      )}
    </div>
  );
}
