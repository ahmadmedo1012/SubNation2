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
  gradient: string; imgBg: string;
}> = {
  streaming:    { bg: "bg-violet-500/10",  text: "text-violet-300",  border: "border-violet-500/20", gradient: "from-violet-950/90 via-violet-900/50 to-violet-800/20",  imgBg: "bg-violet-950/60" },
  music:        { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/20", gradient: "from-emerald-950/90 via-emerald-900/50 to-emerald-800/20", imgBg: "bg-emerald-950/60" },
  gaming:       { bg: "bg-blue-500/10",    text: "text-blue-300",    border: "border-blue-500/20",   gradient: "from-blue-950/90 via-blue-900/50 to-blue-800/20",          imgBg: "bg-blue-950/60" },
  productivity: { bg: "bg-amber-500/10",   text: "text-amber-300",   border: "border-amber-500/20",  gradient: "from-amber-950/90 via-amber-900/50 to-amber-800/20",       imgBg: "bg-amber-950/60" },
};

const DEFAULT_ACCENT = {
  bg: "bg-primary/10", text: "text-primary", border: "border-primary/20",
  gradient: "from-primary/25 via-primary/10 to-transparent",
  imgBg: "bg-card",
};

const STAGGER = ["", "stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6", "stagger-7", "stagger-8"];

function PopularBadge({ count }: { count?: number }) {
  if (!count || count < 5) return null;
  if (count >= 20) return (
    <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-yellow-500/20 backdrop-blur-sm border border-yellow-500/25 text-yellow-300 text-[10px] font-black px-2 py-0.5 rounded-full">
      <Star className="w-2.5 h-2.5 fill-current" /> الأكثر مبيعاً
    </div>
  );
  return (
    <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-emerald-500/15 backdrop-blur-sm border border-emerald-500/20 text-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full">
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
        group relative bg-card border border-border/60 rounded-2xl overflow-hidden cursor-pointer
        float-in ${staggerClass}
        transition-all duration-220 ease-out
        hover:border-border hover:shadow-xl hover:shadow-black/20 hover:-translate-y-0.5
        active:scale-[0.985] active:shadow-md
        ${unavailable ? "opacity-55 saturate-50 pointer-events-none" : ""}
      `}>

        {/* Top badges */}
        {product.discount_percent && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-0.5 bg-primary text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-lg shadow-primary/30">
            <Tag className="w-2 h-2" />
            {product.discount_percent}%
          </div>
        )}

        {unavailable && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-black/65 backdrop-blur-sm text-white/65 text-[10px] font-bold px-2 py-0.5 rounded-full">
            <Lock className="w-2.5 h-2.5" /> نفذ
          </div>
        )}

        <PopularBadge count={product.order_count} />

        {/* Image area — fixed-height ratio */}
        <div className={`relative h-[120px] sm:h-[130px] bg-gradient-to-b ${accent.gradient} flex items-center justify-center overflow-hidden`}>
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              className="w-full h-full object-contain p-5 sm:p-6 transition-transform duration-300 ease-out group-hover:scale-105"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <span className="text-5xl font-black text-white/10 select-none group-hover:text-white/18 transition-colors duration-200">
              {product.name[0]}
            </span>
          )}
          {/* Fade into card body */}
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent" />
        </div>

        {/* Card body */}
        <div className="p-3.5 pt-3">
          {/* Name + category */}
          <div className="flex items-start gap-2 mb-1.5">
            <h3 className="font-bold text-sm leading-snug line-clamp-1 flex-1 text-foreground/90 group-hover:text-foreground transition-colors duration-150">
              {product.name}
            </h3>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 mt-0.5 ${accent.bg} ${accent.text} ${accent.border}`}>
              {categoryLabel(product.category)}
            </span>
          </div>

          {/* Description — 2 lines max */}
          {product.description && (
            <p className="text-muted-foreground/75 text-[11px] line-clamp-2 leading-relaxed mb-2.5">{product.description}</p>
          )}

          {/* Price row */}
          <div className="flex items-center justify-between pt-2.5 border-t border-border/30 mt-auto">
            <div>
              <span className="font-black text-primary text-base leading-none tabular-nums">{formatCurrency(displayPrice)}</span>
              {product.sale_price && (
                <span className="text-muted-foreground/35 text-[10px] line-through mr-1.5 tabular-nums">{formatCurrency(product.price)}</span>
              )}
            </div>

            {/* Availability indicator */}
            {product.is_available ? (
              isLowStock ? (
                <div className="flex items-center gap-0.5 text-[10px] font-bold text-orange-400">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  آخر {product.stock_count}
                </div>
              ) : (
                <div className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${accent.bg} ${accent.text} ${accent.border}`}>
                  {product.stock_count > 99 ? "+99" : product.stock_count}
                </div>
              )
            ) : (
              <span className="text-[10px] text-muted-foreground/40">غير متوفر</span>
            )}
          </div>
        </div>

        {/* Hover CTA — smooth opacity + translate reveal */}
        {product.is_available && (
          <div className="px-3.5 pb-3.5 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-180 ease-out" style={{ marginTop: "-4px" }}>
            <div className="w-full h-8 rounded-xl bg-primary flex items-center justify-center gap-1.5 text-white text-xs font-bold shadow-md shadow-primary/25">
              <ShoppingCart className="w-3 h-3" />
              اشترِ الآن
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
