import { Link } from "wouter";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { ShoppingCart, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
      <div className={`group relative bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 cursor-pointer ${!product.is_available ? "opacity-60" : ""}`}>
        {product.discount_percent && (
          <div className="absolute top-2 right-2 z-10 bg-primary text-white text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
            <Tag className="w-3 h-3" />
            <span>خصم {product.discount_percent}%</span>
          </div>
        )}
        {!product.is_available && (
          <div className="absolute top-2 left-2 z-10 bg-black/80 text-white text-xs font-medium px-2 py-0.5 rounded-full">نفذ المخزون</div>
        )}

        <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain p-6 group-hover:scale-105 transition-transform duration-300"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="text-4xl font-black text-muted-foreground/30">{product.name[0]}</div>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-bold text-sm leading-tight line-clamp-1">{product.name}</h3>
            <Badge variant="secondary" className="text-xs shrink-0">{categoryLabel(product.category)}</Badge>
          </div>
          {product.description && (
            <p className="text-muted-foreground text-xs line-clamp-2 mb-3">{product.description}</p>
          )}
          <div className="flex items-center justify-between mt-3">
            <div>
              <div className="font-black text-primary text-base">{formatCurrency(displayPrice)}</div>
              {product.sale_price && (
                <div className="text-muted-foreground text-xs line-through">{formatCurrency(product.price)}</div>
              )}
            </div>
            <div className={`text-xs font-medium px-2 py-1 rounded-md ${product.is_available ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {product.is_available ? `متوفر (${product.stock_count})` : "غير متوفر"}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
