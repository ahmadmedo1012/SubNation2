import { Button } from "@/components/ui/button";
import { useSeo } from "@/hooks/useSeo";
import { formatCount, categoryLabel, formatCurrency } from "@/lib/utils";
import { useGetFlashSale, useListProducts, type Product } from "@workspace/api-client-react";
import { Flame, Clock, Sparkles, Tag, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

const STAGGER = ["", "stagger-1", "stagger-2", "stagger-3", "stagger-4"];

interface Countdown {
  h: number;
  m: number;
  s: number;
  expired: boolean;
}

/**
 * Single page-level countdown. The previous design called useCountdown
 * once PER CARD (N timers for N cards, all ticking on the same end time)
 * and kept firing setInterval forever after expiry (perpetual re-render
 * loop). One timer + a hard stop at zero.
 */
function useCountdown(target: Date | null): Countdown {
  const [remaining, setRemaining] = useState<number>(() =>
    target ? Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (!target) return;
    const endTime = target.getTime();
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      id = setInterval(() => {
        const ms = endTime - Date.now();
        if (ms <= 0) {
          // Expired: stop the timer instead of re-setting 0 every second.
          setRemaining(0);
          if (id) clearInterval(id);
          return;
        }
        setRemaining(Math.floor(ms / 1000));
      }, 1000);
    };
    const ms = endTime - Date.now();
    setRemaining(Math.max(0, Math.floor(ms / 1000)));
    if (ms > 0) start();
    return () => {
      if (id) clearInterval(id);
    };
  }, [target]);

  if (!target) return { h: 0, m: 0, s: 0, expired: true };
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return { h, m, s, expired: remaining === 0 };
}

function FlashCard({
  product,
  countdown,
  stagger,
}: {
  product: Product;
  countdown: Countdown;
  stagger: string;
}) {
  const { expired } = countdown;
  const { h, m, s } = countdown;

  const salePrice = product.sale_price ?? product.price;
  const discount = product.discount_percent ?? 0;
  const isDeal = discount > 0;

  const timeLabel =
    h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  return (
    <Link href={product.slug ? `/product/${product.slug}` : `/product/${product.id}`}>
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
              {/* 93-C8 (A11 §5): U+2212 minus to match product.tsx's
                  discount rendering (was an ASCII hyphen). */}
              <Tag className="w-3 h-3" />−{discount}%
            </div>
          )}

          {!expired && (
            <div className="absolute top-3 left-3 bg-background/90 backdrop-blur-sm border border-border/60 text-foreground text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1.5 tabular-nums">
              <Clock className="w-3 h-3 text-status-warning" />
              {timeLabel}
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="text-xs text-muted-foreground font-bold mb-1.5 truncate">
            {/* Round-3 (8-e §3): raw English category enum ("streaming",
                "gaming") leaked onto flash-sale cards — every other surface
                maps it through categoryLabel(). */}
            {product.category ? categoryLabel(product.category) : "عروض"}
          </div>
          <div className="font-black text-sm leading-snug mb-2.5 truncate group-hover:text-primary transition-colors">
            {product.name}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-black text-lg text-primary tabular-nums">
              {formatCurrency(salePrice)}
            </span>
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

  const { data: products = [], isLoading, isError, refetch } = useListProducts({});

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

  // Real flash-sale window — the SAME /api/flash-sale endpoint
  // FlashSaleBanner consumes. `flash_sale` is null when no sale is
  // active; its `ends_at` is the ONLY legitimate countdown source.
  // (B4 P1-1: the previous "now + 6h" dummy manufactured fake urgency —
  // every visitor saw 6:00:00 remaining, a dark-pattern trust killer
  // that also contradicted the banner's real timer one screen over.)
  const { data: flashSaleResponse } = useGetFlashSale();
  const activeSale = flashSaleResponse?.flash_sale ?? null;

  const endsAt = useMemo(() => {
    const raw = activeSale?.ends_at;
    if (!raw) return null;
    const end = new Date(raw);
    return Number.isNaN(end.getTime()) ? null : end;
  }, [activeSale]);

  // ONE countdown for the whole page — driven by the real end time.
  // No active sale ⇒ no timer at all (the hook starts none for a null
  // target, and every card chip is suppressed while `expired`).
  const countdown = useCountdown(endsAt);

  // A sale whose window closed while the response was cached or in
  // flight: the cards drop their countdown chips and one honest
  // notice replaces the stale urgency.
  const saleEnded = endsAt !== null && countdown.expired;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-9 page-in">
        <div className="relative w-16 h-16 mx-auto mb-5">
          <div className="absolute inset-0 rounded-2xl bg-status-error/15 blur-2xl" />
          <div className="relative w-16 h-16 rounded-2xl bg-status-error/15 border border-status-error/30 flex items-center justify-center shadow-lg shadow-status-error/20">
            <Flame className="w-8 h-8 text-status-error" />
          </div>
        </div>
        <h1 className="text-3xl font-black mb-2">عروض فلاش 🔥</h1>
        <p className="text-muted-foreground font-bold text-sm">
          {activeSale ? activeSale.title : "خصومات على أفضل الاشتراكات الرقمية"}
        </p>
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
      ) : isError ? (
        /* Distinct from "no offers": an API outage previously rendered the
           empty state — misleading during incidents. */
        <div className="text-center py-20 text-muted-foreground bg-card border border-status-error/22 rounded-2xl reveal-up">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
            <WifiOff className="w-8 h-8 text-status-error/70" />
          </div>
          <p className="font-black text-lg mb-1.5 text-foreground/80">تعذّر تحميل العروض</p>
          <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
            حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة
          </p>
          <Button
            onClick={() => refetch()}
            className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
          >
            إعادة المحاولة
          </Button>
        </div>
      ) : onSale.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center">
            <Sparkles className="w-8 h-8 opacity-25" />
          </div>
          <p className="font-black text-lg mb-1.5 text-foreground/80">لا عرض نشط حالياً</p>
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
          {/* Honest expired notice — replaces every countdown chip once
              the (real) sale window has closed. */}
          {saleEnded && (
            <div className="flex items-center justify-center gap-2 mb-5 p-3.5 bg-muted/30 border border-border/50 rounded-xl text-sm font-bold text-muted-foreground reveal-up">
              <Clock className="w-4 h-4 text-status-warning" />
              انتهى هذا العرض
            </div>
          )}
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm font-bold text-muted-foreground">
              {formatCount(onSale.length, {
                one: "عرض متاح",
                two: "عرضان متاحان",
                few: "عروض متاحة",
                many: "عرضاً متاحاً",
                other: "عرض متاح",
              })}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {onSale.map((p, i) => (
              <FlashCard
                key={p.id}
                product={p}
                countdown={countdown}
                stagger={STAGGER[i % STAGGER.length]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
