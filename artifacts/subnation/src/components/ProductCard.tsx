import { Link } from "wouter";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { ShoppingCart, Tag, CheckCircle, Lock } from "lucide-react";

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

const CATEGORY_COLORS: Record<string, string> = {
  streaming: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  music:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  gaming:    "bg-blue-500/15 text-blue-400 border-blue-500/20",
  productivity: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

const CATEGORY_GLOW: Record<string, string> = {
  streaming: "hover:shadow-violet-500/10",
  music:     "hover:shadow-emerald-500/10",
  gaming:    "hover:shadow-blue-500/10",
  productivity: "hover:shadow-amber-500/10",
};

const PLACEHOLDER_GRADIENTS: Record<string, string> = {
  streaming:    "from-violet-900/60 to-violet-800/30",
  music:        "from-emerald-900/60 to-emerald-800/30",
  gaming:       "from-blue-900/60 to-blue-800/30",
  productivity: "from-amber-900/60 to-amber-800/30",
};

export function ProductCard({ product }: { product: Product }) {
  const displayPrice = product.sale_price ?? product.price;
  const cat = product.category ?? "streaming";
  const categoryColor = CATEGORY_COLORS[cat] ?? "bg-secondary text-muted-foreground border-border";
  const glowClass = CATEGORY_GLOW[cat] ?? "hover:shadow-primary/10";
  const gradientClass = PLACEHOLDER_GRADIENTS[cat] ?? "from-primary/20 to-primary/5";

  return (
    <Link href={`/product/${product.id}`}>
      <div className={`
        group relative bg-card border border-border rounded-2xl overflow-hidden cursor-pointer
        transition-all duration-200 ease-out
        hover:-translate-y-1 hover:border-border/60 hover:shadow-xl ${glowClass}
        ${!product.is_available ? "opacity-60" : ""}
      `}>

        {/* Discount badge */}
        {product.discount_percent && (
          <div className="absolute top-2.5 right-2.5 z-10 bg-primary text-white text-[11px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 shadow-lg shadow-primary/40">
            <Tag className="w-2.5 h-2.5" />
            {product.discount_percent}%
          </div>
        )}

        {/* Out of stock overlay */}
        {!product.is_available && (
          <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-black/75 backdrop-blur-sm text-white/80 text-[11px] font-bold px-2 py-1 rounded-full">
            <Lock className="w-2.5 h-2.5" />
            نفذ المخزون
          </div>
        )}

        {/* Product image */}
        <div className={`aspect-video bg-gradient-to-br ${gradientClass} flex items-center justify-center overflow-hidden relative`}>
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain p-6 transition-transform duration-300 group-hover:scale-105"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="flex flex-col items-center gap-1 select-none">
              <span className="text-5xl font-black text-white/25 group-hover:text-white/35 transition-colors duration-200">
                {product.name[0]}
              </span>
            </div>
          )}
          {/* Bottom gradient overlay */}
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card/80 to-transparent" />
        </div>

        {/* Card body */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-bold text-sm leading-snug line-clamp-1 flex-1">{product.name}</h3>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${categoryColor}`}>
              {categoryLabel(product.category)}
            </span>
          </div>

          {product.description && (
            <p className="text-muted-foreground text-xs line-clamp-2 mb-3 leading-relaxed">{product.description}</p>
          )}

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
            <div>
              <div className="font-black text-primary text-base leading-none">{formatCurrency(displayPrice)}</div>
              {product.sale_price && (
                <div className="text-muted-foreground/50 text-xs line-through mt-0.5">{formatCurrency(product.price)}</div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {product.is_available ? (
                <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-bold px-2 py-0.5 rounded-full">
                  <CheckCircle className="w-2.5 h-2.5" />
                  {product.stock_count}
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground">غير متوفر</span>
              )}
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center transition-all duration-200 group-hover:bg-primary group-hover:scale-110">
                <ShoppingCart className="w-3.5 h-3.5 text-primary group-hover:text-white transition-colors" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
