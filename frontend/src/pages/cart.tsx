import { EmptyHero } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import {
  useCart,
  lineStockNotice,
  lineStockBlocksCheckout,
  cartHasBlockingStock,
  stockAwareCeiling,
  type LocalCartItem,
} from "@/lib/cart";
import { formatCurrency } from "@/lib/utils";
import { Minus, Plus, ShoppingCart, Trash2, X, Sparkles, Wallet } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { useMemo } from "react";
import { Link } from "wouter";
import { formatCount } from "@/lib/utils";
import {
  customFetch,
  getGetWalletQueryKey,
  useGetWallet,
  type WalletInfo,
} from "@workspace/api-client-react";

function effectivePrice(item: LocalCartItem): number {
  return item.salePriceLYD ?? item.priceLYD;
}

function CartSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          /* R138 (visual): the family resting elevation mirrors onto the
             skeleton row — ProductCard moved to border-border/60 + this
             two-layer calm shadow this round, and the cart's line rows
             are that family; the hydration fill must not pop a shadow
             in one frame, so the shell carries it too. */
          className="bg-card border border-border/60 rounded-xl p-4 flex items-center gap-3.5 shadow-calm"
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
      // R144-C1 (L16-3): rides customFetch — still best-effort
      // fire-and-forget (the .catch swallows everything), but the
      // previously UNBOUNDED DELETE now carries the 20 s budget.
      void customFetch("/api/cart", {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {
        // Best-effort only — the UI renders the local cart; the server
        // copy (when the endpoint is alive) follows along eventually.
      });
    }
  };

  if (!isLoaded) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* R136 (UX-1): Skeleton — the heading block's geometry rides
           className verbatim; the pair is net-new (the pre-hydration
           flash was silent). CartSkeleton stays hand-rolled: its rows
           are a composite flex layout (icon + two lines + trailing
           price), the family ui/Skeleton's docblock lists as a
           deliberate non-adoption. */}
        <Skeleton className="h-7 w-40 bg-muted rounded-lg mb-6" />
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
            {/* R128-A4 (F-3): leading-tight removed — the base layer's
                h1–h4 1.3 Arabic-safe floor (index.css, R96 A6 #5) owns
                the leading; the 1.25 utility clipped Readex Pro's tall
                ascenders/harakat. */}
            <h1 className="text-2xl font-bold">سلة المشتريات</h1>
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
            /* R138 (visual): quiet danger at rest — the trigger rode full
               status-error ink at REST, shouting red at the top of the
               page while its per-line twin (the trash below) correctly
               rests muted and tints error only on hover. One register for
               the destructive family: muted ink + error hover; the 96-F4
               confirm dialog (destructive tone) carries the severity. */
            className="min-h-11 text-muted-foreground hover:text-status-error hover:bg-status-error/10 font-bold"
          >
            <Trash2 className="w-3.5 h-3.5 ms-1.5" />
            إفراغ السلة
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        /* R136 (UX-1): EmptyHero — this page's hand-rolled hero was one
           of the four byte-identical first-run sites the component
           canonized; the asChild CTA rides the bare action slot
           verbatim (one anchor, one tab stop — the A3-F4/A3-F13 fix
           stays exactly as it was). */
        <EmptyHero
          icon={ShoppingCart}
          title="سلتك فارغة"
          description="ابدأ بتصفح الكتالوج وأضف منتجاتك المفضلة للسلة"
          action={
            /* R139 (precision): the empty-state browse CTA de-hand-rolled
               onto the canonical recipe (139-c's pin-suite flagged it as
               the last pre-r138 hero chrome on a money page's CTA —
               size="lg" + w-full sm:w-auto carries the affordance; the
               hand-rolled bg/shadow/scale stack retires). */
            <Button asChild size="lg" className="w-full sm:w-auto gap-2 font-bold">
              <Link href="/">
                <Sparkles className="w-4 h-4" />
                متابعة التسوق
              </Link>
            </Button>
          }
        />
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
                  /* R138 (visual): line-item resting chrome rhymes with the
                     new card family (ProductCard this round: border/60 + a
                     two-layer calm elevation — tight 1px/2px @30% contact
                     line + contained 10px/28px/−14px @40% ambient). The
                     ambient is fully contained horizontally (28px blur −
                     14px spread) and reaches ~10px down — exactly the
                     space-y-2.5 seam — so stacked rows shade each other's
                     top edge like paper on paper instead of floating as
                     bordered boxes. Hover stays border-only (60→100): a
                     row is line data, not a clickable tile — no hover
                     elevation invented. */
                  className={`float-in ${staggerClass} bg-card border border-border/60 rounded-xl p-3.5 shadow-calm hover:border-border transition-all duration-200 group`}
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
                            /* R-140-a (image discipline): width/height
                               mirror the catalog art's measured 450×450
                               intrinsic (all 45 /products/*.webp, the
                               R132 L4-F9 census re-probed this round) —
                               the fixed w-14 h-14 well already pins CLS
                               at zero; the attrs keep the aspect-ratio
                               reserve honest pre-CSS. */
                            width={450}
                            height={450}
                            className="w-full h-full object-contain p-1.5"
                          />
                        ) : (
                          /* R125-I7 (A7 B-6, computed): the first-letter
                             fallback rode text-primary/50 — 1.65:1 dark /
                             2.35:1 light on the bg-muted/60 tile (A7
                             measured the dark figure). Full
                             --muted-foreground measures 7.44:1 dark /
                             6.09:1 light — the honest letter. (The full
                             CATEGORY_ICON idiom needs `category` on
                             LocalCartItem — deliberately deferred with
                             the stock-snapshot work, A7 B-11.) */
                          <span className="text-lg font-bold text-muted-foreground select-none">
                            {(it.name ?? "?")[0]}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-[10rem]">
                      <Link
                        href={`/product/${it.slug ?? it.productId}`}
                        /* R126-L5 (A13-F10): the item-title anchor rides the
                           24px target floor — the text-only link measured
                           258×19 live, relying on the spacing exception.
                           Same inline-flex min-h-6 idiom as the Footer's
                           link band (R124-A4 #2). */
                        className="inline-flex min-h-6 items-center"
                      >
                        {/* R124-I4 (A5 #1): hover tint rides the text-safe
                            token — raw text-primary is 3.76:1 on the dark
                            card (AA fail on the hover state of small text).
                            R128-A4 (F-1): dir="auto" — the catalog is
                            Latin-named, and in an RTL block the ellipsis
                            eats the inline-end = the Latin string's
                            BEGINNING («Lifetime Cloud Storage» rendered
                            «…oud Storage»). Same isolation idiom as
                            ProductCard's h3 / the PDP h1. */}
                        <div
                          dir="auto"
                          /* R138 (visual): title 700→600 — the money line's
                             weight hierarchy (title 600 / price 700): the
                             price is the loudest element on the line, the
                             title the identifier; the checkout summary's
                             it.name twin takes the same demotion so both
                             pages of the funnel speak one ladder. */
                          className="font-semibold text-sm leading-snug truncate group-hover:text-primary-text transition-colors"
                        >
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
                      {/* R129-A1 (F1 wiring — B-11): the line's stock
                          verdict — the SAME strings + threshold as
                          ProductCard's badges («متبقٍ N فقط» warning /
                          «نفد المخزون» error), captured at add and
                          refreshed by checkout's re-quote. role="status"
                          (R129-A2): AT hears the verdict when it flips;
                          blocked lines tint error, low-stock warns. */}
                      {(() => {
                        const notice = lineStockNotice(it);
                        if (!notice) return null;
                        const blocked = lineStockBlocksCheckout(it);
                        return (
                          <div
                            role="status"
                            className={`text-2xs font-bold rounded-full px-2 py-0.5 mt-1 inline-flex items-center gap-1 leading-tight border ${
                              blocked
                                ? "text-status-error bg-status-error/10 border-status-error/25"
                                : "text-status-warning bg-status-warning/10 border-status-warning/25"
                            }`}
                          >
                            {notice}
                          </div>
                        );
                      })()}
                      {/* 96-F4 (M13): price cluster on its own line — flex-wrap
                          keeps the trio (price / strikethrough / discount) on
                          one clean row now that the column is wide enough. */}
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-0.5">
                        {/* R138 (visual): ink for money — the unit price
                            drops the brand tint for plain foreground:
                            ProductCard's price and this page's own summary
                            total already ride plain ink at full weight, so
                            the tinted unit price was the money path's lone
                            colored amount; on a 5-line cart that is brand
                            color shouting, and hierarchy now rides weight
                            (600 title / 700 price). */}
                        <span className="font-bold text-sm tabular-nums text-foreground">
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
                        silently deleted the line.
                        R128-A5 (A5-3): press-spring on the money path's
                        most-touched controls — they carried only the
                        hover tint while every other stepper-shaped
                        control in the app (variant pills, quick-add,
                        retry rows) rides the press vocabulary. */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* R138 (visual): bg-muted/50 → /60 — the stepper is a
                          WELL (a container of buttons) like the 56px thumb
                          tile beside it, and the wells ride one value: the
                          thumb was already bg-muted/60 and ProductCard's
                          image well joined it at /60 this round. /50 was
                          neither the chip fill (/40) nor the well (/60).
                          Resting border stays /40 — the thumb tile's twin
                          — and the min-h-11 tap floor is test-pinned
                          (cart-undo-clear). */}
                      <div className="flex items-center gap-0 bg-muted/60 border border-border/40 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleUpdate(it, it.quantity - 1)}
                          className="min-h-11 min-w-11 px-2 hover:bg-secondary/70 transition-colors press-spring text-muted-foreground hover:text-foreground flex items-center justify-center"
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
                          /* R130 (A1-F2): the raise cap silently refused
                             the bump at the stock-aware ceiling — the «+»
                             now says so by being disabled at the ceiling
                             instead of no-oping on tap. */
                          disabled={it.quantity >= stockAwareCeiling(it.stockCount ?? null)}
                          className="min-h-11 min-w-11 px-2 hover:bg-secondary/70 transition-colors press-spring text-muted-foreground hover:text-foreground flex items-center justify-center disabled:opacity-35 disabled:pointer-events-none"
                          aria-label={
                            it.quantity >= stockAwareCeiling(it.stockCount ?? null)
                              ? `الحد الأقصى المتاح ${it.quantity} — ${it.name}`
                              : `زيادة كمية ${it.name}`
                          }
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeWithUndo(it)}
                        className="min-h-11 min-w-11 px-2 rounded-lg hover:bg-status-error/10 text-muted-foreground hover:text-status-error transition-colors press-spring flex items-center justify-center"
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
          {/* R138 (visual): the family resting elevation (ProductCard's
              two-layer calm recipe, this round) — the totals card reads as
              the receipt slip lying over the line rows; border/60 stays
              the family edge and the terminal text-2xl total already
              rides weight+size (not color) — verified, untouched. */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 slide-up shadow-calm">
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
            {/* R129-A1 (F1 wiring — B-11): a proven-unchargeable line
                (stock 0 / quantity > snapshot) blocks the CTA — the
                failure surfaces HERE, at the cart, not as a 409
                mid-charge. Unknown-snapshot lines never block (the
                server re-check answers at charge time). */}
            {/* R138 (visual): the three money CTAs below (blocked /
                authed / guest) drop the hand-rolled flat bg-primary +
                shadow-lg + active:scale-[0.99] chrome for the canonical
                recipe — size="lg" + the Button default variant own every
                visual token (h-12, the text-base weight rhythm, the
                to-primary/95 gradient + primary border + shadow-md→
                hover:shadow-lg, press-spring). Quiet authority via
                size/weight, not a loud flat shadow — the wallet submit
                CTAs' R116-S2/R124-I1 precedent, one funnel one recipe.
                w-full stays: the summary column owns the layout (the
                checkout CTA's documented summary-card idiom). */}
            {cartHasBlockingStock(items) && (
              <p
                id="cart-stock-block-reason"
                className="text-2xs font-semibold text-status-error bg-status-error/8 border border-status-error/20 rounded-xl px-3 py-2 text-center"
              >
                بعض العناصر نفد مخزونها — أزلها أو عدّل كميتها للمتابعة
              </p>
            )}
            {token ? (
              cartHasBlockingStock(items) ? (
                <Button
                  disabled
                  /* R130 (A1-F4): the block reason was a visual sibling
                     only — an SR user tabbing to the dimmed CTA heard no
                     cause. Linked now (checkout's label-in-button idiom
                     doesn't fit the summary column's banner shape). */
                  aria-describedby="cart-stock-block-reason"
                  size="lg"
                  className="w-full"
                >
                  إتمام الطلب
                </Button>
              ) : (
                <Button asChild size="lg" className="w-full">
                  <Link href="/checkout">
                    {/* R111-F2 N1: «إتمام الطلب» — the destination page's own
                        name (checkout.tsx h1), replacing «متابعة الشراء» which
                        sat right above the ghost «متابعة التسوق» as a
                        near-duplicate label pair on one screen. */}
                    إتمام الطلب
                  </Link>
                </Button>
              )
            ) : (
              <Button asChild size="lg" className="w-full">
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
