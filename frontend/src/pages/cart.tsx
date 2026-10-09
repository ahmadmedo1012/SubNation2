import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { useCart, type LocalCartItem } from "@/lib/cart";
import { formatCurrency } from "@/lib/utils";
import { Minus, Plus, ShoppingCart, Trash2, X, Sparkles, Wallet } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { useMemo } from "react";
import { Link } from "wouter";
import { formatCount } from "@/lib/utils";
import { getGetWalletQueryKey, useGetWallet, type WalletInfo } from "@workspace/api-client-react";

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
  // 96-F4 (R96 A2 P1-2): «إفراغ السلة» is the storefront's most destructive
  // tap — now behind the house-standard confirm dialog (destructive tone)
  // instead of firing instantly on a 32px ghost button.
  const { confirm, ConfirmDialog } = useConfirm();
  // Round-4 dead-code removal: the "server cart" simulation
  // (ServerCartItem/ServerCart/localToServerItems + a serverItems state
  // that was only ever set to []) never had a real server behind it —
  // the page renders the local cart directly. Verified unused in the
  // r4-1-c org audit (docs/ux-audit-storefront.md:73 documents the
  // remnant as known-dead since rounds ago).
  const { items, isLoaded, updateQuantity, removeItem, clear, addItem } = useCart();

  // R115-I1 (A7 P3-4): the wallet balance chip next to the total — the
  // same data point checkout's summary shows («رصيدك: …»). Decorative
  // context for the total, not a gate (checkout owns the balance gate);
  // a failed probe just omits the chip (never fabricates 0.00).
  const { data: wallet } = useGetWallet({
    query: { enabled: !!token, queryKey: getGetWalletQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });
  const walletBalance = (wallet as WalletInfo | undefined)?.balance;

  const total = useMemo(() => {
    return +items.reduce((s, i) => s + effectivePrice(i) * i.quantity, 0).toFixed(2);
  }, [items]);

  // 96-F4 (R96 A2 P1-1): every line removal (minus-at-qty-1 AND the trash
  // button) now carries a 6s undo toast that re-adds the item WITH ITS
  // QUANTITY — the snapshot is taken before removeItem fires. The toast
  // rides sonner directly because the shared use-toast shim doesn't expose
  // sonner's action API, and an undo affordance needs a real button — the
  // same mounted <Toaster/> renders it either way.
  const removeWithUndo = (item: LocalCartItem) => {
    removeItem(item.productId, item.variantId);
    sonnerToast("تمت إزالة المنتج", {
      description: item.variantLabel ? `${item.name} — ${item.variantLabel}` : item.name,
      action: {
        label: "تراجع",
        onClick: () => addItem({ ...item }),
      },
      duration: 6000,
    });
  };

  const handleUpdate = (item: LocalCartItem, qty: number) => {
    // qty 0 means "remove" — the previous code early-returned here, which
    // made the X-shown-at-qty-1 button a silent no-op with delete
    // affordance. Route it to removeWithUndo instead (destructive, but
    // now with feedback + undo).
    if (qty < 1) {
      removeWithUndo(item);
      return;
    }
    updateQuantity(item.productId, qty, item.variantId);
  };

  const handleClear = async () => {
    // 96-F4 (R96 A2 P1-2): confirm before the wipe.
    const ok = await confirm({
      title: "إفراغ السلة؟",
      description: "ستُزال جميع المنتجات من سلتك نهائياً.",
      confirmLabel: "إفراغ السلة",
      cancelLabel: "إلغاء",
      destructive: true,
    });
    if (!ok) return;
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
  };

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
            <h1 className="text-2xl font-bold leading-tight">سلة المشتريات</h1>
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
            onClick={handleClear}
            /* 96-F4 (R96 A2 P1-2): 44px target (size="sm" shipped 32px on the
               most destructive control in the storefront). */
            className="min-h-11 text-status-error hover:text-status-error hover:bg-status-error/10 font-bold"
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
          <p className="font-bold text-lg mb-1.5 text-foreground/80">سلتك فارغة</p>
          <p className="text-sm text-muted-foreground mb-7 max-w-xs mx-auto leading-relaxed">
            ابدأ بتصفح الكتالوج وأضف منتجاتك المفضلة للسلة
          </p>
          {/* A3-F4 + A3-F13 (R120-B2): asChild composition — the previous
              Link>Button nesting rendered TWO same-named «متابعة التسوق»
              elements (anchor 152×20 + button 152×38 measured live), and
              the button shipped 38px. One anchor styled as the 44px
              primary CTA: one tab stop, one target. */}
          <Button
            asChild
            className="min-h-11 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
          >
            <Link href="/">
              <Sparkles className="w-4 h-4" />
              متابعة التسوق
            </Link>
          </Button>
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
                  key={`${it.productId}:${it.variantId ?? 0}`}
                  className={`float-in ${staggerClass} bg-card border border-border/60 rounded-xl p-3.5 hover:border-border transition-all duration-200 group`}
                >
                  {/* 96-F4 (R96 A1 M13 + A2 P1-1): flex-wrap row — on wide
                      viewports it reads exactly like before (thumb |
                      title+price | controls). Below ~480px the 44px controls
                      cluster wraps onto its own row, which frees the middle
                      column so the price cluster sits on ONE clean line — at
                      320px it used to ragged-wrap into 2–3 lines inside a
                      ~92px column, degrading the money info exactly where
                      users verify totals. min-w-[10rem] forces the wrap
                      before the title column gets that narrow. */}
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
                    {/* A1-F9 (R120-B2): slug ?? productId — a null-slug line
                        used to link HOME (silent dead end); the product route
                        resolves numeric ids (by-id fetch + replaceState to the
                        canonical slug), mirroring ProductCard's link idiom. */}
                    <Link href={`/product/${it.slug ?? it.productId}`}>
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
                          <span className="text-lg font-bold text-primary/50 select-none">
                            {(it.name ?? "?")[0]}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-[10rem]">
                      <Link href={`/product/${it.slug ?? it.productId}`}>
                        {/* R124-I4 (A5 #1): hover tint rides the text-safe
                            token — raw text-primary is 3.76:1 on the dark
                            card (AA fail on the hover state of small text). */}
                        <div className="font-bold text-sm leading-snug truncate group-hover:text-primary-text transition-colors">
                          {it.name}
                        </div>
                      </Link>
                      {/* Catalog-2026-09-20: the chosen option ("فردي — 3 أشهر")
                          under the product name — the shopper's mental model of
                          WHAT is in the line, not just which brand. */}
                      {it.variantLabel && (
                        <div className="text-2xs font-semibold text-muted-foreground bg-muted/40 border border-border/35 rounded-full px-2 py-0.5 mt-0.5 inline-block leading-tight">
                          {it.variantLabel}
                        </div>
                      )}
                      {/* 96-F4 (M13): price cluster on its own line — flex-wrap
                          keeps the trio (price / strikethrough / discount) on
                          one clean row now that the column is wide enough. */}
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-0.5">
                        <span className="font-bold text-sm tabular-nums text-primary-text">
                          {formatCurrency(price)}
                        </span>
                        {it.salePriceLYD != null && it.salePriceLYD < it.priceLYD && (
                          <span className="text-2xs text-muted-foreground line-through tabular-nums">
                            {formatCurrency(it.priceLYD)}
                          </span>
                        )}
                        {it.discountPercent != null && it.discountPercent > 0 && (
                          <span className="text-3xs font-bold text-status-success bg-status-success/10 border border-status-success/22 px-1.5 py-0.5 rounded-full">
                            خصم {it.discountPercent}%
                          </span>
                        )}
                      </div>
                      {/* R115-I1 (A7 P3-4): per-line total (qty × unit) for
                          multi-quantity lines — checkout shows this
                          (checkout.tsx's «N × unit» + line total); the
                          cart used to show only the unit price and the
                          grand total, leaving the shopper to do the
                          multiplication at the decision moment. qty-1
                          lines need no arithmetic row (unit == line). */}
                      {it.quantity > 1 && (
                        <div className="text-2xs text-muted-foreground mt-0.5 tabular-nums">
                          {it.quantity} × {formatCurrency(price)} ={" "}
                          <span className="font-bold text-foreground/85">
                            {formatCurrency(+(price * it.quantity).toFixed(2))}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 96-F4 (R96 A2 P1-1): 44px stepper/trash targets with
                        ≥8px separation (gap-2) between the stepper cluster
                        and the trash — the old 26px buttons sat 4px apart, so
                        a rapid "+" double-tap landed on the trash and
                        silently deleted the line. */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-0 bg-muted/50 border border-border/40 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleUpdate(it, it.quantity - 1)}
                          className="min-h-11 min-w-11 px-2 hover:bg-secondary/70 transition-colors text-muted-foreground hover:text-foreground flex items-center justify-center"
                          aria-label={
                            it.quantity === 1 ? `حذف المنتج ${it.name}` : `إنقاص كمية ${it.name}`
                          }
                        >
                          {it.quantity === 1 ? (
                            <X className="w-4 h-4 text-status-error" />
                          ) : (
                            <Minus className="w-4 h-4" />
                          )}
                        </button>
                        <span
                          className="font-bold text-sm tabular-nums px-2 min-w-[28px] text-center"
                          aria-label={`الكمية ${it.quantity}`}
                        >
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdate(it, it.quantity + 1)}
                          className="min-h-11 min-w-11 px-2 hover:bg-secondary/70 transition-colors text-muted-foreground hover:text-foreground flex items-center justify-center"
                          aria-label={`زيادة كمية ${it.name}`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeWithUndo(it)}
                        className="min-h-11 min-w-11 px-2 rounded-lg hover:bg-status-error/10 text-muted-foreground hover:text-status-error transition-colors flex items-center justify-center"
                        aria-label={`حذف المنتج ${it.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 slide-up">
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground font-bold">المجموع</span>
              <div className="flex items-center gap-2">
                {/* R115-I1 (A7 P3-4): wallet balance chip — context for the
                    total (can I cover it?) without duplicating checkout's
                    insufficient-balance gate. Hidden when the probe hasn't
                    answered — never a fabricated number. */}
                {token && walletBalance != null && (
                  <span className="flex items-center gap-1 text-2xs font-bold text-muted-foreground bg-muted/40 border border-border/50 px-2.5 py-1 rounded-full tabular-nums">
                    <Wallet className="w-3 h-3" />
                    رصيدك {formatCurrency(walletBalance)}
                  </span>
                )}
                <span className="font-bold text-2xl tabular-nums">{formatCurrency(total)}</span>
              </div>
            </div>
            {/* A3-F4 + A3-F13 (R120-B2): the populated summary rides the
                same asChild composition as the empty-state CTA above —
                Link>Button nesting rendered TWO same-named elements per
                CTA (anchor + invalid interactive-in-interactive button),
                and the ghost «متابعة التسوق» shipped at the Button
                default min-h-9 (36px), under the 44px floor its
                empty-state twin was fixed for. One anchor per CTA, one
                tab stop; the primaries keep their h-12 (48px). */}
            {token ? (
              <Button
                asChild
                className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 active:scale-[0.99] transition-all font-bold h-12"
              >
                <Link href="/checkout">
                  {/* R111-F2 N1: «إتمام الطلب» — the destination page's own
                      name (checkout.tsx h1), replacing «متابعة الشراء» which
                      sat right above the ghost «متابعة التسوق» as a
                      near-duplicate label pair on one screen. */}
                  إتمام الطلب
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 active:scale-[0.99] transition-all font-bold h-12"
              >
                <Link href="/login?redirect=/checkout">
                  {/* R111-F2 N6: shadda + pronoun — matches the app-standard
                      «سجّل» family (login.tsx, errors.ts). */}
                  سجّل دخولك للشراء
                </Link>
              </Button>
            )}
            <Button
              asChild
              variant="ghost"
              className="w-full mt-2 min-h-11 text-muted-foreground hover:text-foreground font-bold"
            >
              <Link href="/">متابعة التسوق</Link>
            </Button>
            {/* R94-A1 #19 (P3): boilerplate-tax disclaimer removed — the
                pricing model is base − discount, no tax logic exists in
                the backend. The line now states the actual payment
                behavior (instant wallet debit) instead of seeding tax
                doubt at the payment-decision moment. */}
            <p className="text-2xs text-muted-foreground text-center mt-3">
              الدفع يُخصم من رصيد محفظتك فوراً — تسليم فوري بعد التأكيد
            </p>
          </div>
        </>
      )}

      {/* 96-F4 (R96 A2 P1-2): the destructive-clear confirm dialog. */}
      <ConfirmDialog />
    </div>
  );
}
