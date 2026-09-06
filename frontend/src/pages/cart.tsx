import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { useCart, type LocalCartItem } from "@/lib/cart";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import { Loader2, Minus, Plus, ShoppingCart, Trash2, X, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { formatCount } from "@/lib/utils";

interface ServerCartItem {
  id: number;
  product_id: number;
  product_name: string;
  product_slug: string | null;
  product_image_url: string | null;
  price: number;
  sale_price: number | null;
  discount_percent: number | null;
  quantity: number;
  subtotal: number;
}

interface ServerCart {
  items: ServerCartItem[];
  total: number;
}

function effectivePrice(item: {
  price?: number;
  priceLYD?: number;
  sale_price?: number | null;
  salePriceLYD?: number | null;
}): number {
  const base = item.price ?? item.priceLYD ?? 0;
  const sale = item.sale_price ?? item.salePriceLYD;
  return sale ?? base;
}

function localToServerItems(items: LocalCartItem[]): ServerCartItem[] {
  return items.map((i, idx) => ({
    id: idx + 1,
    product_id: i.productId,
    product_name: i.name,
    product_slug: i.slug,
    product_image_url: i.imageUrl,
    price: i.priceLYD,
    sale_price: i.salePriceLYD,
    discount_percent: i.discountPercent,
    quantity: i.quantity,
    subtotal: +(effectivePrice(i) * i.quantity).toFixed(2),
  }));
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
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { items: localItems, isLoaded, updateQuantity, removeItem, clear, totalLYD } = useCart();
  const [busy, setBusy] = useState(false);
  const [serverItems, setServerItems] = useState<ServerCartItem[] | null>(null);

  // When authed we display server cart; when guest we fall back to local cart.
  const items: ServerCartItem[] = useMemo(() => {
    if (token) {
      if (serverItems) return serverItems;
      return localToServerItems(localItems);
    }
    return localToServerItems(localItems);
  }, [token, serverItems, localItems]);

  const total = useMemo(() => {
    return +items.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
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

  async function handleClear() {
    if (token) {
      try {
        setBusy(true);
        const res = await fetch("/api/cart", { method: "DELETE", credentials: "include" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          // Backend error envelope is {error, code} — `.message` never
          // exists, so the old read always fell back to the generic text.
          throw new Error(getErrorMessage(err) || "فشل في إفراغ السلة");
        }
        setServerItems([]);
        clear();
        toast({ title: "تم إفراغ السلة" });
      } catch (e) {
        toast({ title: getErrorMessage(e), variant: "destructive" });
      } finally {
        setBusy(false);
      }
      return;
    }
    clear();
    toast({ title: "تم إفراغ السلة" });
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
            disabled={busy}
            className="text-status-error hover:text-status-error hover:bg-status-error/10 font-bold"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 ml-1.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 ml-1.5" />
            )}
            {busy ? "جارٍ الإفراغ..." : "إفراغ السلة"}
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
                  key={it.product_id}
                  className={`float-in ${staggerClass} bg-card border border-border/60 rounded-xl p-3.5 hover:border-border transition-all duration-200 group`}
                >
                  <div className="flex items-center gap-3.5">
                    <Link href={it.product_slug ? `/product/${it.product_slug}` : "/"}>
                      <div className="w-14 h-14 rounded-xl bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border/40 group-hover:border-border/70 transition-colors">
                        {it.product_image_url ? (
                          <img
                            src={it.product_image_url}
                            alt={it.product_name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-contain p-1.5"
                          />
                        ) : (
                          <span className="text-lg font-black text-primary/50 select-none">
                            {(it.product_name ?? "?")[0]}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link href={it.product_slug ? `/product/${it.product_slug}` : "/"}>
                        <div className="font-bold text-sm leading-snug truncate group-hover:text-primary transition-colors">
                          {it.product_name}
                        </div>
                      </Link>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="font-black text-sm tabular-nums text-primary-text">
                          {formatCurrency(price)}
                        </span>
                        {it.sale_price != null && it.sale_price < it.price && (
                          <span className="text-[11px] text-muted-foreground line-through tabular-nums">
                            {formatCurrency(it.price)}
                          </span>
                        )}
                        {it.discount_percent != null && it.discount_percent > 0 && (
                          <span className="text-[10px] font-bold text-status-success bg-status-success/10 border border-status-success/22 px-1.5 py-0.5 rounded-full">
                            خصم {it.discount_percent}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="flex items-center gap-0 bg-muted/50 border border-border/40 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleUpdate(it.product_id, it.quantity - 1)}
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
                          onClick={() => handleUpdate(it.product_id, it.quantity + 1)}
                          className="p-1.5 hover:bg-secondary/70 transition-colors text-muted-foreground hover:text-foreground"
                          aria-label="زيادة الكمية"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(it.product_id)}
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
            <p className="text-[11px] text-muted-foreground text-center mt-3">
              المجموع لا يشمل الضرائب إن وُجدت
            </p>
          </div>
        </>
      )}
    </div>
  );
}
