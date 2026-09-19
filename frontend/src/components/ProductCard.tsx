import { memo, useRef } from "react";
import { Link } from "wouter";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/lib/cart";
import {
  AlertTriangle,
  Briefcase,
  Gamepad2,
  Lock,
  Music2,
  Package,
  ShoppingCart,
  Star,
  Tag,
  Tv2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

interface Product {
  id: number;
  slug?: string | null;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price: number;
  price_from?: boolean;
  category?: string | null;
  is_available: boolean;
  stock_count: number;
  sale_price?: number | null;
  discount_percent?: number | null;
  order_count?: number;
  variants?: CatalogVariant[];
}

/** Public catalog variant (mirrors the /api/products DTO — price only,
 * never internal cost/sku fields). */
export interface CatalogVariant {
  id: number;
  plan_label?: string | null;
  duration_label?: string | null;
  label: string;
  price: number;
  sale_price?: number | null;
  discount_percent?: number | null;
  is_available: boolean;
}

// Category accent palette. Each entry rides the shared --cat-*
// CSS variables (defined in index.css and exposed to Tailwind via
// @theme as `cat-streaming`, `cat-music`, etc.). The variables
// re-tone themselves on the light theme — no hard-coded hex/Tailwind
// shade references here, so a Netflix card on the light theme uses a
// darker, AA-readable violet automatically.
//
// Tailwind needs the full class strings present in source for its
// content scan to keep them in the bundle, which is why each variant
// is spelled out instead of computed.
const CATEGORY_ACCENT: Record<
  string,
  { bg: string; text: string; border: string; gradient: string; accentLine: string }
> = {
  streaming: {
    bg: "bg-cat-streaming/10",
    text: "text-cat-streaming",
    border: "border-cat-streaming/22",
    gradient: "from-cat-streaming/12 via-cat-streaming/4 to-transparent",
    accentLine: "bg-cat-streaming/55",
  },
  music: {
    bg: "bg-cat-music/10",
    text: "text-cat-music",
    border: "border-cat-music/22",
    gradient: "from-cat-music/12 via-cat-music/4 to-transparent",
    accentLine: "bg-cat-music/55",
  },
  gaming: {
    bg: "bg-cat-gaming/10",
    text: "text-cat-gaming",
    border: "border-cat-gaming/22",
    gradient: "from-cat-gaming/12 via-cat-gaming/4 to-transparent",
    accentLine: "bg-cat-gaming/55",
  },
  productivity: {
    bg: "bg-cat-productivity/10",
    text: "text-cat-productivity",
    border: "border-cat-productivity/22",
    gradient: "from-cat-productivity/12 via-cat-productivity/4 to-transparent",
    accentLine: "bg-cat-productivity/55",
  },
};

const DEFAULT_ACCENT = {
  bg: "bg-primary/10",
  text: "text-primary-text",
  border: "border-primary/20",
  gradient: "from-primary/12 via-primary/4 to-transparent",
  accentLine: "bg-primary/55",
};

// Category → Lucide icon. Used as the image-area fallback when a
// product has no image_url, so the empty-image card reads as a
// category placeholder rather than a giant first-letter glyph that
// doesn't carry visual identity.
const CATEGORY_ICON: Record<string, LucideIcon> = {
  streaming: Tv2,
  music: Music2,
  gaming: Gamepad2,
  productivity: Briefcase,
};

const STAGGER = [
  "",
  "stagger-1",
  "stagger-2",
  "stagger-3",
  "stagger-4",
  "stagger-5",
  "stagger-6",
  "stagger-7",
  "stagger-8",
];

function PopularBadge({ count }: { count?: number }) {
  if (!count || count < 5) return null;
  // Top sellers (≥20) get a warning-tinted badge so they read as
  // featured/notable; the lighter "popular" tier (5-19) lands on
  // success-tinted to feel like a positive momentum signal.
  // Both ride the shared --status-* tokens so they re-tint on
  // light theme automatically.
  if (count >= 20)
    return (
      <StatusBadge
        variant="warning"
        size="xs"
        icon={Star}
        className="absolute top-2.5 left-2.5 z-10 backdrop-blur-md"
      >
        الأكثر مبيعاً
      </StatusBadge>
    );
  return (
    <StatusBadge
      variant="success"
      size="xs"
      icon={Zap}
      className="absolute top-2.5 left-2.5 z-10 backdrop-blur-md"
    >
      شائع
    </StatusBadge>
  );
}

function ProductCardInner({ product, index = 0 }: { product: Product; index?: number }) {
  const displayPrice = product.sale_price ?? product.price;
  const cat = product.category ?? "streaming";
  const accent = CATEGORY_ACCENT[cat] ?? DEFAULT_ACCENT;
  const FallbackIcon = CATEGORY_ICON[cat] ?? Package;
  const unavailable = !product.is_available;
  const staggerClass = STAGGER[Math.min(index, 8)] ?? "";
  const isLowStock = product.is_available && product.stock_count > 0 && product.stock_count <= 3;
  const { addItem } = useCart();
  const { toast } = useToast();

  // ── Add to cart ─────────────────────────────────────────────
  // The card CTA is a real <button> (sibling of the details <Link>,
  // not nested inside it) — the previous markup was a visual-only
  // div that navigated to the product page while labeled "اشترِ
  // الآن", so the cart page and the Navbar badge were permanently
  // empty: the whole cart → checkout funnel was unreachable.
  // 96-F4 (R96 A2 P1-7): 500ms re-entry lock via a ref timestamp — a
  // double-tap on a laggy phone added qty 2 in one gesture (and the
  // funnel charged twice at checkout). The toast already confirms the
  // first add, so the second tap inside the lock window is swallowed.
  // null (not 0) so the FIRST tap always passes regardless of the clock
  // (a 0-init ref would swallow taps at epoch-0 test clocks and is
  // semantically "never tapped" — model it explicitly).
  const lastAddTapRef = useRef<number | null>(null);
  // Catalog-2026-09-20: quick-add uses the cheapest ACTIVE variant when the
  // product has options (matches the card's displayed "تبدأ من" price and
  // the checkout's default-variant rule — no price mismatch is possible).
  const cheapestVariant =
    product.variants && product.variants.length > 0
      ? product.variants.reduce((a, b) => (a.price <= b.price ? a : b))
      : null;
  const handleAddToCart = () => {
    if (unavailable) return;
    const now = Date.now();
    if (lastAddTapRef.current !== null && now - lastAddTapRef.current < 500) return;
    lastAddTapRef.current = now;
    addItem({
      productId: product.id,
      variantId: cheapestVariant ? cheapestVariant.id : null,
      variantLabel: cheapestVariant ? cheapestVariant.label : null,
      slug: product.slug ?? null,
      name: product.name ?? "",
      imageUrl: product.image_url ?? null,
      priceLYD: cheapestVariant ? cheapestVariant.price : product.price,
      salePriceLYD: cheapestVariant
        ? (cheapestVariant.sale_price ?? null)
        : (product.sale_price ?? null),
      discountPercent: cheapestVariant
        ? (cheapestVariant.discount_percent ?? null)
        : (product.discount_percent ?? null),
    });
    toast({
      title: "أُضيف إلى السلة",
      description: cheapestVariant
        ? `${product.name} — ${cheapestVariant.label}`
        : (product.name ?? undefined),
    });
  };

  // ── Accessibility ─────────────────────────────────────────────────
  // Compose a single descriptive aria-label for the whole card so
  // screen readers announce the full state on a single focus event.
  // Visually, the same information lives in scattered badges + the
  // muted opacity treatment; aria collapses it into one phrase.
  const ariaLabelParts = [
    product.name,
    categoryLabel(product.category),
    `${product.price_from ? "تبدأ من " : ""}${formatCurrency(displayPrice)}`,
    product.variants && product.variants.length > 1 ? `${product.variants.length} باقات` : null,
    unavailable ? "نفد المخزون" : null,
    // 93-C8 (A11 §1): «آخر 2 متوفرة» is a broken dual; «متبقٍ N
    // فقط» is agreement-safe for every count 1..3.
    isLowStock ? `متبقٍ ${product.stock_count} فقط` : null,
  ].filter(Boolean);
  const ariaLabel = ariaLabelParts.join("، ");

  return (
    <div
      className={`
        group relative h-full bg-card border border-border/50 rounded-2xl overflow-hidden cursor-pointer flex flex-col
        float-in ${staggerClass}
        transition-all duration-280 ease-out
        card-spring hover:border-border/80 hover:shadow-2xl hover:shadow-black/40
        ${unavailable ? "opacity-45 saturate-[0.3] pointer-events-none" : ""}
      `}
    >
      <Link
        href={`/product/${product.slug ?? product.id}`}
        aria-label={ariaLabel}
        aria-disabled={unavailable || undefined}
        className="flex flex-col flex-1"
      >
        {product.discount_percent && !unavailable && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-0.5 bg-primary text-primary-foreground text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-md shadow-primary/40">
            <Tag className="w-2 h-2" />
            {product.discount_percent}%
          </div>
        )}

        {unavailable && (
          <div
            className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-black/75 backdrop-blur-sm text-white/70 text-[10px] font-bold px-2 py-0.5 rounded-full"
            aria-hidden="true"
          >
            <Lock className="w-2.5 h-2.5" /> نفد
          </div>
        )}

        <PopularBadge count={product.order_count} />

        <div className="relative aspect-square bg-card overflow-hidden">
          <div
            className={`absolute top-0 inset-x-0 h-[2px] ${accent.accentLine} opacity-65 z-[1]`}
          />
          <div className="shine-trigger absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full skew-x-[-14deg] pointer-events-none z-[3]" />

          {product.image_url ? (
            <img
              src={product.image_url}
              alt={(() => {
                // Build descriptive alt text:
                //   "<product name> — <category label> اشتراك"
                // Falls back gracefully when name is missing. The
                // category context helps Google Image search ranking
                // for queries like "اشتراك بث مباشر ليبيا".
                const name = (product.name ?? "").trim();
                const cat = categoryLabel(product.category);
                if (!name) return cat ? `اشتراك ${cat}` : "اشتراك رقمي";
                // Avoid duplicating "اشتراك" when the name already includes it.
                const hasSub = /اشتراك/.test(name);
                return cat && cat !== "عام"
                  ? `${name} — ${hasSub ? "" : "اشتراك "}${cat}`.trim()
                  : name;
              })()}
              width={400}
              height={400}
              // ── LCP optimization ─────────────────────────────────────
              // The homepage product grid is 2-cols on mobile, 2-3-4 on
              // tablet/desktop. The visible above-fold rows fit ~4 cards
              // on every breakpoint, so the FIRST 4 images must load
              // eagerly — `loading="lazy"` on the LCP image is a known
              // ~400-800 ms regression on mobile Lighthouse runs.
              //
              // The very first card (index 0) gets fetchpriority="high"
              // so the browser prioritizes its bytes over the rest of
              // the resource graph (CSS, JS, other images). This is
              // the single biggest LCP lever on the storefront.
              loading={index < 4 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : index < 4 ? "auto" : "low"}
              decoding="async"
              className="absolute inset-0 z-[2] m-auto max-w-[74%] max-h-[74%] w-auto h-auto object-contain transition-transform duration-300 ease-out group-hover:scale-[1.06] drop-shadow-lg"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = "none";
                const fallback = el.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
          ) : null}

          <div
            style={{ display: product.image_url ? "none" : "flex" }}
            className={`absolute inset-0 z-[2] items-center justify-center pointer-events-none bg-gradient-to-br ${accent.gradient}`}
          >
            <div
              className={`flex items-center justify-center w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-2xl border ${accent.bg} ${accent.border} shadow-sm transition-transform duration-300 ease-out group-hover:scale-105`}
            >
              {/* Category icon as the empty-image fallback. The icon
                  inherits the category accent's foreground color so a
                  Netflix card without an image reads as a violet TV
                  glyph, a Spotify card without an image reads as an
                  emerald music glyph, etc. — replaces the previous
                  first-letter glyph that was identical for "Netflix"
                  and "Notion" and carried no category cue. */}
              <FallbackIcon
                className={`w-9 h-9 sm:w-10 sm:h-10 ${accent.text}`}
                strokeWidth={1.6}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        <div className="p-3.5 pt-3 flex flex-1 flex-col">
          <div className="flex items-start gap-2 mb-1.5">
            <h2 className="font-bold text-sm leading-snug line-clamp-1 flex-1 text-foreground/85 group-hover:text-foreground transition-colors duration-200">
              {product.name}
            </h2>
            <span
              /* 96-F4 (R96 A6 #11): 9px Arabic was unreadable in the
                 2-up mobile grid (connected glyphs lose ح/ج/خ distinction
                 above ~40yo) — 10px + semibold keeps the badge compact
                 while staying legible. */
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 mt-0.5 ${accent.bg} ${accent.text} ${accent.border}`}
            >
              {categoryLabel(product.category)}
            </span>
          </div>

          {product.description && (
            <p className="text-muted-foreground text-[11px] line-clamp-2 leading-relaxed mb-2.5">
              {product.description}
            </p>
          )}

          <div className="flex items-center justify-between pt-2.5 border-t border-border/20 mt-auto">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              {product.price_from && (
                <span className="text-[10px] font-semibold text-muted-foreground">تبدأ من</span>
              )}
              <span className="font-black text-foreground text-[17px] leading-none tabular-nums">
                {formatCurrency(displayPrice)}
              </span>
              {product.sale_price && (
                <span className="text-muted-foreground text-[10px] line-through tabular-nums">
                  {formatCurrency(product.price)}
                </span>
              )}
            </div>

            {product.is_available ? (
              product.variants && product.variants.length > 1 ? (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${accent.bg} ${accent.text} ${accent.border}`}
                >
                  {product.variants.length} باقات
                </span>
              ) : isLowStock ? (
                <StatusBadge
                  variant="low-stock"
                  size="xs"
                  icon={AlertTriangle}
                  aria-label={`مخزون منخفض، متبقٍ ${product.stock_count} فقط`}
                >
                  آخر {product.stock_count}
                </StatusBadge>
              ) : (
                <div
                  className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${accent.bg} ${accent.text} ${accent.border}`}
                >
                  {product.stock_count > 99 ? "+99" : product.stock_count}
                </div>
              )
            ) : (
              /* 96-F4 (R96 A6 #12): full-opacity muted token — the /80
                 variant measured ≈4.14:1 on the light card, failing AA
                 for a 10px status text. */
              <span className="text-[10px] font-bold text-muted-foreground">نفد</span>
            )}
          </div>
        </div>
      </Link>

      {/* ── Add-to-cart CTA ────────────────────────────────────────────
          Real buttons (siblings of the details Link — valid HTML,
          keyboard-focusable, no nested interactive elements). The old
          markup was a <div> that looked like a button but the whole
          card navigated to the product page instead. */}
      {product.is_available ? (
        <button
          type="button"
          onClick={handleAddToCart}
          className="mx-3.5 mb-3.5 mt-0 md:hidden min-h-11 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.98] flex items-center justify-center gap-1.5 text-primary-foreground text-xs font-black shadow-lg shadow-primary/25 transition-all cursor-pointer"
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          أضف للسلة
        </button>
      ) : (
        // Mobile: keep card height stable when unavailable by
        // rendering a static muted bar in place of the buy CTA.
        // Same min-h-11 as the active button so the card visual rhythm
        // is identical across states. Desktop uses a hover-reveal
        // CTA that's already absent for unavailable products.
        <div
          className="mx-3.5 mb-3.5 mt-0 md:hidden min-h-11 rounded-xl bg-muted/40 border border-border/40 flex items-center justify-center gap-1.5 text-muted-foreground text-xs font-bold"
          aria-hidden="true"
        >
          <Lock className="w-3.5 h-3.5" />
          نفد المخزون
        </div>
      )}

      {product.is_available && (
        <div className="hidden md:block absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 group-focus-within:translate-y-0 transition-transform duration-220 ease-out">
          <button
            type="button"
            onClick={handleAddToCart}
            className="mx-3 mb-3 min-h-11 w-[calc(100%-1.5rem)] rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.98] flex items-center justify-center gap-1.5 text-primary-foreground text-xs font-black shadow-lg shadow-primary/35 transition-all cursor-pointer"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            أضف للسلة
          </button>
        </div>
      )}
    </div>
  );
}

export const ProductCard = memo(
  ProductCardInner,
  (prev, next) =>
    prev.product.id === next.product.id &&
    prev.product.slug === next.product.slug &&
    prev.product.name === next.product.name &&
    prev.product.description === next.product.description &&
    prev.product.image_url === next.product.image_url &&
    prev.product.price === next.product.price &&
    prev.product.sale_price === next.product.sale_price &&
    prev.product.category === next.product.category &&
    prev.product.discount_percent === next.product.discount_percent &&
    prev.product.order_count === next.product.order_count &&
    prev.product.stock_count === next.product.stock_count &&
    prev.product.is_available === next.product.is_available &&
    prev.index === next.index,
);
