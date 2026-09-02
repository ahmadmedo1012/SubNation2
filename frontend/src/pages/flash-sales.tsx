import { Button } from "@/components/ui/button";
import { useSeo } from "@/hooks/useSeo";
import { formatCurrency } from "@/lib/utils";
import { useListProducts, type Product } from "@workspace/api-client-react";
import { Flame, Loader2, Clock, Sparkles, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

const STAGGER = ["", "stagger-1", "stagger-2", "stagger-3", "stagger-4"];

function useCountdown(target: Date | null) {
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!target) return;
    const endTime = target.getTime();
    function tick() {
      const ms = endTime - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return { h: 0, m: 0, s: 0, expired: true };
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return { h, m, s, expired: remaining === 0 };
}

function FlashCard({
  product,
  endsAt,
  stagger,
}: {
  product: Product;
  endsAt: Date | null;
  stagger: string;
}) {
  const { h, m, s, expired } = useCountdown(endsAt);

  const salePrice = product.sale_price ?? product.price;
  const discount = product.discount_percent ?? 0;
  const isDeal = discount > 0;

  const timeLabel =
    h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  return (
    <Link href={product.slug ? `/product/${product.slug}` : "/"}>
      <div
        className={`float-in ${stagger}
          bg-card border border-border/60 rounded-2xl overflow-hidden
          hover:border-primary/30 hover:shadow-xl hover:shadow-black/20 hover:-translate-y-1
          transition-all duration-250 cursor-pointer group active:scale-[0.99]`}
      >
        <div className="relative">
          <div className="aspect-[4/3] bg-muted/60 flex items-center justify-center overflow-hidden">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <span className="text-5xl font-black text-primary/20 select-none">
                {(product.name ?? "?")[0]}
              </span>
            )}
          </div>

          {isDeal && (
            <div className="absolute top-3 right-3 bg-status-error text-white text-[11px] font-black px-2.5 py-1 rounded-full shadow-lg shadow-status-error/40 flex items-center gap-1">
              <Tag className="w-3 h-3" />
              -{discount}%
            </div>
          )}

          {endsAt && !expired && (
            <div className="absolute top-3 left-3 bg-background/90 backdrop-blur-sm border border-border/60 text-foreground text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-status-warning" />
              {timeLabel}
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="text-xs text-muted-foreground font-bold mb-1.5 truncate">{product.category ?? "عروض"}</div>
          <div className="font-black text-sm leading-snug mb-2.5 truncate group-hover:text-primary transition-colors">
            {product.name}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-black text-lg text-primary tabular-nums">{formatCurrency(salePrice)}</span>
            {isDeal && (
              <span className="text-xs text-muted-foreground line-through tabular-nums">
                {formatCurrency(product.price)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function FlashSalesPage() {
  useSeo({
    title: "عروض فلاش — SubNation",
    description: "خصومات حصرية لفترة محدودة على أفضل الاشتراكات الرقمية",
    type: "website",
    path: "/flash-sales",
    locale: "ar",
    robots: "index,follow",
  });

  const { data: products = [], isLoading } = useListProducts({});

  // Products with a flash-sale price are considered "on sale"
  const onSale = useMemo(() => {
    return products
      .filter(
        (p) =>
          p.is_active &&
          p.is_available &&
          p.sale_price != null &&
          p.sale_price < p.price &&
          p.discount_percent != null &&
          p.discount_percent > 0,
      )
      .sort((a, b) => (b.discount_percent ?? 0) - (a.discount_percent ?? 0));
  }, [products]);

  // Use a dummy endsAt — in production the backend flashSales table
  // would be queried and its `endsAt` used. This client-side version
  // uses a fixed window so we always show a countdown.
  const endsAt = useMemo(() => {
    if (onSale.length === 0) return null;
    const end = new Date();
    end.setHours(end.getHours() + 6);
    return end;
  }, [onSale.length]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-9 page-in">
        <div className="relative w-16 h-16 mx-auto mb-5">
          <div className="absolute inset-0 rounded-2xl bg-status-error/15 blur-2xl" />
          <div className="relative w-16 h-16 rounded-2xl bg-status-error/15 border border-status-error/30 flex items-center justify-center shadow-lg shadow-status-error/20">
            <Flame className="w-8 h-8 text-status-error" />
          </div>
        </div>
        <h1 className="text-3xl font-black mb-2">عروض فلاش 🔥</h1>
        <p className="text-muted-foreground font-bold text-sm">لفترة محدودة!</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="aspect-[4/3] bg-muted skeleton-shimmer" />
              <div className="p-4 space-y-2">
                <div className="h-3 bg-muted skeleton-shimmer rounded w-1/3" />
                <div className="h-4 bg-muted skeleton-shimmer rounded w-2/3" />
                <div className="h-5 bg-muted skeleton-shimmer rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : onSale.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center">
            <Sparkles className="w-8 h-8 opacity-25" />
          </div>
          <p className="font-black text-lg mb-1.5 text-foreground/80">لا توجد عروض حالياً</p>
          <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
            تابعنا أو راجع الكتالوج — العروض تعود قريباً!
          </p>
          <Link href="/">
            <Button className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold">
              <Sparkles className="w-4 h-4" />
              تصفح الكتالوج
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm font-bold text-muted-foreground">
              {onSale.length} عرض متاح
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {onSale.map((p, i) => (
              <FlashCard
                key={p.id}
                product={p}
                endsAt={endsAt}
                stagger={STAGGER[i % STAGGER.length]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
