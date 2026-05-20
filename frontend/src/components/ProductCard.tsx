import { memo } from "react";
import { Link } from "wouter";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { Zap, Lock, Tag, Star, ShoppingCart, AlertTriangle } from "lucide-react";

interface Product {
  id: number;
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

const CATEGORY_ACCENT: Record<
  string,
  { bg: string; text: string; border: string; gradient: string; accentLine: string }
> = {
  streaming: {
    bg: "bg-violet-500/10",
    text: "text-violet-300",
    border: "border-violet-500/20",
    gradient: "from-violet-500/12 via-violet-500/4 to-transparent",
    accentLine: "bg-violet-500/55",
  },
  music: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-300",
    border: "border-emerald-500/20",
    gradient: "from-emerald-500/12 via-emerald-500/4 to-transparent",
    accentLine: "bg-emerald-500/55",
  },
  gaming: {
    bg: "bg-blue-500/10",
    text: "text-blue-300",
    border: "border-blue-500/20",
    gradient: "from-blue-500/12 via-blue-500/4 to-transparent",
    accentLine: "bg-blue-500/55",
  },
  productivity: {
    bg: "bg-amber-500/10",
    text: "text-amber-300",
    border: "border-amber-500/20",
    gradient: "from-amber-500/12 via-amber-500/4 to-transparent",
    accentLine: "bg-amber-500/55",
  },
};

const DEFAULT_ACCENT = {
  bg: "bg-primary/10",
  text: "text-primary-text",
  border: "border-primary/20",
  gradient: "from-primary/12 via-primary/4 to-transparent",
  accentLine: "bg-primary/55",
};

const STAGGER = ["", "stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6", "stagger-7", "stagger-8"];

function PopularBadge({ count }: { count?: number }) {
  if (!count || count < 5) return null;
  if (count >= 20)
    return (
      <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-yellow-500/25 backdrop-blur-md border border-yellow-500/35 text-yellow-200 text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm shadow-yellow-900/30">
        <Star className="w-2.5 h-2.5 fill-current" /> الأكثر مبيعاً
      </div>
    );
  return (
    <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-emerald-500/20 backdrop-blur-md border border-emerald-500/30 text-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm">
      <Zap className="w-2.5 h-2.5" /> شائع
    </div>
  );
}

function ProductCardInner({ product, index = 0 }: { product: Product; index?: number }) {
  const displayPrice = product.sale_price ?? product.price;
  const cat = product.category ?? "streaming";
  const accent = CATEGORY_ACCENT[cat] ?? DEFAULT_ACCENT;
  const unavailable = !product.is_available;
  const staggerClass = STAGGER[Math.min(index, 8)] ?? "";
  const isLowStock = product.is_available && product.stock_count > 0 && product.stock_count <= 3;

  return (
    <Link href={`/product/${product.id}`}>
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
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-black/75 backdrop-blur-sm text-white/55 text-[10px] font-bold px-2 py-0.5 rounded-full">
            <Lock className="w-2.5 h-2.5" /> نفذ
          </div>
        )}

        <PopularBadge count={product.order_count} />

        <div className="relative aspect-square bg-card overflow-hidden">
          <div className={`absolute top-0 inset-x-0 h-[2px] ${accent.accentLine} opacity-65 z-[1]`} />
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
              loading="lazy"
              decoding="async"
              className="relative z-[2] w-full h-full object-contain p-4 sm:p-5 transition-transform duration-300 ease-out group-hover:scale-[1.06] drop-shadow-lg"
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
            className="absolute inset-0 z-[2] items-center justify-center pointer-events-none"
          >
            <span className={`text-8xl font-black select-none opacity-40 group-hover:opacity-55 transition-opacity duration-300 drop-shadow-md ${accent.text}`}>
              {product.name[0]}
            </span>
          </div>
        </div>

        <div className="p-3.5 pt-3 flex flex-1 flex-col">
          <div className="flex items-start gap-2 mb-1.5">
            <h2 className="font-bold text-sm leading-snug line-clamp-1 flex-1 text-foreground/85 group-hover:text-foreground transition-colors duration-200">
              {product.name}
            </h2>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 mt-0.5 ${accent.bg} ${accent.text} ${accent.border}`}>
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
                <div className="flex items-center gap-0.5 text-[10px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded-full">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  آخر {product.stock_count}
                </div>
              ) : (
                <div className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${accent.bg} ${accent.text} ${accent.border}`}>
                  {product.stock_count > 99 ? "+99" : product.stock_count}
                </div>
              )
            ) : (
              <span className="text-[10px] text-muted-foreground">غير متوفر</span>
            )}
          </div>

          {product.is_available && (
            <div className="mt-3 md:hidden h-9 rounded-xl bg-primary flex items-center justify-center gap-1.5 text-white text-xs font-black shadow-lg shadow-primary/25">
              <ShoppingCart className="w-3.5 h-3.5" />
              اشترِ الآن
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
