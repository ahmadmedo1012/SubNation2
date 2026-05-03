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

const CATEGORY_ACCENT: Record<string, {
  bg: string; text: string; border: string;
  gradient: string; imgBg: string; shadow: string; accentLine: string;
}> = {
  streaming:    { bg: "bg-violet-500/10",  text: "text-violet-300",  border: "border-violet-500/20", gradient: "from-violet-950/95 via-violet-900/55 to-violet-800/25",  imgBg: "bg-violet-950/60", shadow: "hover:shadow-violet-950/40",  accentLine: "bg-violet-500/50" },
  music:        { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/20", gradient: "from-emerald-950/95 via-emerald-900/55 to-emerald-800/25", imgBg: "bg-emerald-950/60", shadow: "hover:shadow-emerald-950/30", accentLine: "bg-emerald-500/50" },
  gaming:       { bg: "bg-blue-500/10",    text: "text-blue-300",    border: "border-blue-500/20",   gradient: "from-blue-950/95 via-blue-900/55 to-blue-800/25",          imgBg: "bg-blue-950/60",    shadow: "hover:shadow-blue-950/35",    accentLine: "bg-blue-500/50"   },
  productivity: { bg: "bg-amber-500/10",   text: "text-amber-300",   border: "border-amber-500/20",  gradient: "from-amber-950/95 via-amber-900/55 to-amber-800/25",       imgBg: "bg-amber-950/60",   shadow: "hover:shadow-amber-950/30",   accentLine: "bg-amber-500/50"  },
};

const DEFAULT_ACCENT = {
  bg: "bg-primary/10", text: "text-primary", border: "border-primary/20",
  gradient: "from-primary/28 via-primary/12 to-transparent",
  imgBg: "bg-card", shadow: "hover:shadow-primary/15", accentLine: "bg-primary/50",
};

const STAGGER = ["", "stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6", "stagger-7", "stagger-8"];

function PopularBadge({ count }: { count?: number }) {
  if (!count || count < 5) return null;
  if (count >= 20) return (
    <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-yellow-500/25 backdrop-blur-sm border border-yellow-500/30 text-yellow-300 text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm shadow-yellow-900/30">
      <Star className="w-2.5 h-2.5 fill-current" /> الأكثر مبيعاً
    </div>
  );
  return (
    <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/25 text-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm">
      <Zap className="w-2.5 h-2.5" /> شائع
    </div>
  );
}

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const displayPrice = product.sale_price ?? product.price;
  const cat = product.category ?? "streaming";
  const accent = CATEGORY_ACCENT[cat] ?? DEFAULT_ACCENT;
  const unavailable = !product.is_available;
  const staggerClass = STAGGER[Math.min(index, 8)] ?? "";
  const isLowStock = product.is_available && product.stock_count > 0 && product.stock_count <= 3;

  return (
    <Link href={`/product/${product.id}`}>
      <div className={`
        group relative bg-card border border-border/55 rounded-2xl overflow-hidden cursor-pointer
        float-in ${staggerClass}
        transition-all duration-250 ease-out
        hover:border-border hover:shadow-2xl hover:shadow-black/35 hover:-translate-y-1.5
        active:scale-[0.982] active:shadow-sm active:translate-y-0
        ${unavailable ? "opacity-50 saturate-[0.35] pointer-events-none" : ""}
      `}>

        {/* Discount badge */}
        {product.discount_percent && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-0.5 bg-primary text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-md shadow-primary/35">
            <Tag className="w-2 h-2" />
            {product.discount_percent}%
          </div>
        )}

        {unavailable && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-black/70 backdrop-blur-sm text-white/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
            <Lock className="w-2.5 h-2.5" /> نفذ
          </div>
        )}

        <PopularBadge count={product.order_count} />

        {/* Image area */}
        <div className={`relative h-[128px] sm:h-[142px] bg-gradient-to-b ${accent.gradient} flex items-center justify-center overflow-hidden`}>
          {/* Subtle top accent line */}
          <div className={`absolute top-0 inset-x-0 h-[2px] ${accent.accentLine} opacity-60`} />

          {/* Shine sweep on hover */}
          <div className="shine-trigger absolute inset-0 bg-gradient-to-r from-transparent via-white/8 to-transparent -translate-x-full skew-x-[-12deg] pointer-events-none z-10" />

          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              className="w-full h-full object-contain p-5 sm:p-6 transition-transform duration-350 ease-out group-hover:scale-[1.07] drop-shadow-lg"
              onError={e => {
                const el = e.target as HTMLImageElement;
                el.style.display = "none";
                const fallback = el.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
          ) : null}
          <div
            style={{ display: product.image_url ? "none" : "flex" }}
            className="absolute inset-0 items-center justify-center"
          >
            <span className={`text-6xl font-black select-none opacity-30 group-hover:opacity-45 transition-opacity duration-250 drop-shadow-lg ${accent.text}`}>
              {product.name[0]}
            </span>
          </div>
          {/* Fade into card body */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
        </div>

        {/* Card body */}
        <div className="p-3.5 pt-3">
          {/* Name + category */}
          <div className="flex items-start gap-2 mb-1.5">
            <h3 className="font-bold text-sm leading-snug line-clamp-1 flex-1 text-foreground/88 group-hover:text-foreground transition-colors duration-150">
              {product.name}
            </h3>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 mt-0.5 ${accent.bg} ${accent.text} ${accent.border}`}>
              {categoryLabel(product.category)}
            </span>
          </div>

          {/* Description */}
          {product.description && (
            <p className="text-muted-foreground/70 text-[11px] line-clamp-2 leading-relaxed mb-2.5">{product.description}</p>
          )}

          {/* Price row */}
          <div className="flex items-center justify-between pt-2.5 border-t border-border/25 mt-auto">
            <div className="flex items-baseline gap-1.5">
              <span className="font-black text-primary text-[17px] leading-none tabular-nums">{formatCurrency(displayPrice)}</span>
              {product.sale_price && (
                <span className="text-muted-foreground/30 text-[10px] line-through tabular-nums">{formatCurrency(product.price)}</span>
              )}
            </div>

            {/* Availability indicator */}
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
              <span className="text-[10px] text-muted-foreground/35">غير متوفر</span>
            )}
          </div>
        </div>

        {/* Hover CTA — slides up from bottom */}
        {product.is_available && (
          <div className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-200 ease-out">
            <div className="mx-3 mb-3 h-9 rounded-xl bg-primary flex items-center justify-center gap-1.5 text-white text-xs font-black shadow-lg shadow-primary/30">
              <ShoppingCart className="w-3.5 h-3.5" />
              اشترِ الآن
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
