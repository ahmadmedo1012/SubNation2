import { memo } from "react";
import { Link } from "wouter";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { Zap, Lock, Tag, Star, ShoppingCart, AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

interface Product {
  id: number;
  slug?: string | null;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price: number;
  category?: string | null;
  is_available: boolean;
  stock_count: number;
  sale_price?: number | null;
  discount_percent?: number | null;
  order_count?: number;
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
  const unavailable = !product.is_available;
  const staggerClass = STAGGER[Math.min(index, 8)] ?? "";
  const isLowStock = product.is_available && product.stock_count > 0 && product.stock_count <= 3;

  // ── Accessibility ─────────────────────────────────────────────────
  // Compose a single descriptive aria-label for the whole card so
  // screen readers announce the full state on a single focus event.
  // Visually, the same information lives in scattered badges + the
  // muted opacity treatment; aria collapses it into one phrase.
  const ariaLabelParts = [
    product.name,
    categoryLabel(product.category),
    `السعر ${formatCurrency(displayPrice)}`,
    unavailable ? "نفد المخزون" : null,
    isLowStock ? `آخر ${product.stock_count} متوفرة` : null,
  ].filter(Boolean);
  const ariaLabel = ariaLabelParts.join("، ");

  return (
    <Link
      href={`/product/${product.slug ?? product.id}`}
      aria-label={ariaLabel}
      aria-disabled={unavailable || undefined}
    >
      <div
        className={`
        group relative h-full bg-card border border-border/50 rounded-2xl overflow-hidden cursor-pointer flex flex-col
        float-in ${staggerClass}
        transition-all duration-280 ease-out
        card-spring hover:border-border/80 hover:shadow-2xl hover:shadow-black/40
        ${unavailable ? "opacity-45 saturate-[0.3] pointer-events-none" : ""}
      `}
      >
        {product.discount_percent && !unavailable && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-0.5 bg-primary text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-md shadow-primary/40">
            <Tag className="w-2 h-2" />
            {product.discount_percent}%
          </div>
        )}

        {unavailable && (
          <div
            className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-black/75 backdrop-blur-sm text-white/55 text-[10px] font-bold px-2 py-0.5 rounded-full"
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
              <span
                className={`text-4xl sm:text-5xl font-black select-none drop-shadow-sm ${accent.text}`}
              >
                {product.name[0]}
              </span>
            </div>
          </div>
        </div>

        <div className="p-3.5 pt-3 flex flex-1 flex-col">
          <div className="flex items-start gap-2 mb-1.5">
            <h2 className="font-bold text-sm leading-snug line-clamp-1 flex-1 text-foreground/85 group-hover:text-foreground transition-colors duration-200">
              {product.name}
            </h2>
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 mt-0.5 ${accent.bg} ${accent.text} ${accent.border}`}
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
            <div className="flex items-baseline gap-1.5">
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
              isLowStock ? (
                <StatusBadge
                  variant="low-stock"
                  size="xs"
                  icon={AlertTriangle}
                  aria-label={`مخزون منخفض، آخر ${product.stock_count} متوفرة`}
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
              <span className="text-[10px] font-bold text-muted-foreground/80">نفد</span>
            )}
          </div>

          {product.is_available ? (
            <div className="mt-3 md:hidden h-9 rounded-xl bg-primary flex items-center justify-center gap-1.5 text-white text-xs font-black shadow-lg shadow-primary/25">
              <ShoppingCart className="w-3.5 h-3.5" />
              اشترِ الآن
            </div>
          ) : (
            // Mobile: keep card height stable when unavailable by
            // rendering a static muted bar in place of the buy CTA.
            // Same h-9 as the active button so the card visual rhythm
            // is identical across states. Desktop uses a hover-reveal
            // CTA that's already absent for unavailable products.
            <div
              className="mt-3 md:hidden h-9 rounded-xl bg-muted/40 border border-border/40 flex items-center justify-center gap-1.5 text-muted-foreground text-xs font-bold"
              aria-hidden="true"
            >
              <Lock className="w-3.5 h-3.5" />
              نفد المخزون
            </div>
          )}
        </div>

        {product.is_available && (
          <div className="hidden md:block absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-220 ease-out">
            <div className="mx-3 mb-3 h-9 rounded-xl bg-primary flex items-center justify-center gap-1.5 text-white text-xs font-black shadow-lg shadow-primary/35">
              <ShoppingCart className="w-3.5 h-3.5" />
              اشترِ الآن
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

export const ProductCard = memo(
  ProductCardInner,
  (prev, next) =>
    prev.product.id === next.product.id &&
    prev.product.price === next.product.price &&
    prev.product.sale_price === next.product.sale_price &&
    prev.product.stock_count === next.product.stock_count &&
    prev.product.is_available === next.product.is_available &&
    prev.index === next.index,
);
