import { Link } from "wouter";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { ShoppingCart, Tag, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

export function ProductCard({ product }: { product: Product }) {
  const displayPrice = product.sale_price ?? product.price;

  return (
    <Link href={`/product/${product.id}`}>
      <div className={`group relative bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/40 transition-all duration-200 hover:shadow-xl hover:shadow-primary/8 hover:-translate-y-0.5 cursor-pointer ${!product.is_available ? "opacity-55" : ""}`}>
        {/* Discount badge */}
        {product.discount_percent && (
          <div className="absolute top-2.5 right-2.5 z-10 bg-primary text-white text-[11px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 shadow-lg shadow-primary/30">
            <Tag className="w-2.5 h-2.5" />
            {product.discount_percent}%
          </div>
        )}
        {/* Out of stock overlay */}
        {!product.is_available && (
          <div className="absolute top-2.5 left-2.5 z-10 bg-black/70 backdrop-blur-sm text-white/80 text-[11px] font-bold px-2.5 py-1 rounded-full">نفذ المخزون</div>
        )}

        {/* Product image */}
        <div className="aspect-video bg-muted/50 flex items-center justify-center overflow-hidden relative">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain p-6 group-hover:scale-105 transition-transform duration-300"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <span className="text-5xl font-black text-muted-foreground/20 select-none">
              {product.name[0]}
            </span>
          )}
        </div>

        {/* Card body */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h3 className="font-bold text-sm leading-snug line-clamp-1">{product.name}</h3>
            <Badge variant="secondary" className="text-[11px] shrink-0 font-medium">
              {categoryLabel(product.category)}
            </Badge>
          </div>
          {product.description && (
            <p className="text-muted-foreground text-xs line-clamp-2 mb-3 leading-relaxed">{product.description}</p>
          )}

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
            <div>
              <div className="font-black text-primary text-base leading-none">{formatCurrency(displayPrice)}</div>
              {product.sale_price && (
                <div className="text-muted-foreground/60 text-xs line-through mt-0.5">{formatCurrency(product.price)}</div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {product.is_available ? (
                <>
                  <CheckCircle className="w-3 h-3 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400">{product.stock_count}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">غير متوفر</span>
              )}
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center mr-1 group-hover:bg-primary group-hover:text-white transition-all">
                <ShoppingCart className="w-3.5 h-3.5 text-primary group-hover:text-white transition-colors" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
