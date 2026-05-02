import { Link } from "wouter";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { Zap, Lock, Tag, Star, CheckCircle } from "lucide-react";

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

const CATEGORY_ACCENT: Record<string, { bg: string; text: string; border: string; glow: string; gradient: string }> = {
  streaming:    { bg: "bg-violet-500/12",  text: "text-violet-300",  border: "border-violet-500/20", glow: "hover:shadow-violet-500/8",  gradient: "from-violet-950/80 via-violet-900/40 to-violet-800/20" },
  music:        { bg: "bg-emerald-500/12", text: "text-emerald-300", border: "border-emerald-500/20", glow: "hover:shadow-emerald-500/8", gradient: "from-emerald-950/80 via-emerald-900/40 to-emerald-800/20" },
  gaming:       { bg: "bg-blue-500/12",    text: "text-blue-300",    border: "border-blue-500/20",   glow: "hover:shadow-blue-500/8",   gradient: "from-blue-950/80 via-blue-900/40 to-blue-800/20" },
  productivity: { bg: "bg-amber-500/12",   text: "text-amber-300",   border: "border-amber-500/20",  glow: "hover:shadow-amber-500/8",  gradient: "from-amber-950/80 via-amber-900/40 to-amber-800/20" },
};

const DEFAULT_ACCENT = { bg: "bg-primary/12", text: "text-primary", border: "border-primary/20", glow: "hover:shadow-primary/8", gradient: "from-primary/20 via-primary/8 to-transparent" };

function PopularBadge({ count }: { count?: number }) {
  if (!count || count < 5) return null;
  if (count >= 20) return (
    <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-yellow-500/20 backdrop-blur-sm border border-yellow-500/30 text-yellow-300 text-[10px] font-black px-2 py-0.5 rounded-full">
      <Star className="w-2.5 h-2.5 fill-current" />
      الأكثر مبيعاً
    </div>
  );
  if (count >= 5) return (
    <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-emerald-500/15 backdrop-blur-sm border border-emerald-500/20 text-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full">
      <Zap className="w-2.5 h-2.5" />
      شائع
    </div>
  );
  return null;
}

export function ProductCard({ product }: { product: Product }) {
  const displayPrice = product.sale_price ?? product.price;
  const cat = product.category ?? "streaming";
  const accent = CATEGORY_ACCENT[cat] ?? DEFAULT_ACCENT;
  const unavailable = !product.is_available;

  return (
    <Link href={`/product/${product.id}`}>
      <div className={`
        group relative bg-card border border-border rounded-2xl overflow-hidden cursor-pointer
        transition-all duration-200 ease-out will-change-transform
        hover:-translate-y-1 hover:border-border/70 hover:shadow-2xl ${accent.glow}
        ${unavailable ? "opacity-55 saturate-50" : ""}
      `}>

        {/* Discount badge */}
        {product.discount_percent ? (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-primary text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg shadow-primary/40">
            <Tag className="w-2.5 h-2.5" />
            {product.discount_percent}%
          </div>
        ) : null}

        {/* Popular / bestseller badge */}
        <PopularBadge count={product.order_count} />

        {/* Out of stock overlay */}
        {unavailable && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-black/70 backdrop-blur-sm text-white/70 text-[10px] font-bold px-2 py-0.5 rounded-full">
            <Lock className="w-2.5 h-2.5" />
            نفذ
          </div>
        )}

        {/* Image area */}
        <div className={`aspect-[4/3] bg-gradient-to-b ${accent.gradient} flex items-center justify-center overflow-hidden relative`}>
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain p-7 transition-transform duration-300 group-hover:scale-[1.04]"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <span className="text-6xl font-black text-white/15 select-none group-hover:text-white/22 transition-colors duration-200">
              {product.name[0]}
            </span>
          )}
          {/* Gradient fade into body */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
        </div>

        {/* Card body */}
        <div className="p-4 pt-3.5">
          {/* Name + category */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h3 className="font-bold text-sm leading-snug line-clamp-1 flex-1 group-hover:text-foreground transition-colors">
              {product.name}
            </h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 mt-0.5 ${accent.bg} ${accent.text} ${accent.border}`}>
              {categoryLabel(product.category)}
            </span>
          </div>

          {/* Description */}
          {product.description && (
            <p className="text-muted-foreground text-xs line-clamp-2 leading-relaxed mb-3">{product.description}</p>
          )}

          {/* Price + availability row */}
          <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/40">
            <div className="flex flex-col">
              <span className="font-black text-primary text-[17px] leading-none tabular-nums">{formatCurrency(displayPrice)}</span>
              {product.sale_price && (
                <span className="text-muted-foreground/45 text-[11px] line-through mt-0.5 tabular-nums">{formatCurrency(product.price)}</span>
              )}
            </div>

            {product.is_available ? (
              <div className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-xl border ${accent.bg} ${accent.text} ${accent.border}`}>
                <CheckCircle className="w-2.5 h-2.5" />
                <span>{product.stock_count > 99 ? "+99" : product.stock_count}</span>
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground/60">غير متوفر</span>
            )}
          </div>
        </div>

        {/* Hover CTA strip */}
        <div className="overflow-hidden h-0 group-hover:h-11 transition-all duration-200 ease-out">
          <div className="px-4 pb-3.5">
            <div className="w-full h-9 rounded-xl bg-primary flex items-center justify-center text-white text-sm font-bold shadow-md shadow-primary/25 transition-all duration-150">
              اشترِ الآن
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
