import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { EmptyHero } from "@/components/EmptyState";
import { useSeo } from "@/hooks/useSeo";
import { productToItem, trackSelectItem, trackViewItemList } from "@/lib/analytics-events";
import { NETWORK_ERROR_DESCRIPTION } from "@/lib/errors";
import { buildItemListLd } from "@/lib/seo-builders";
import { formatCount, categoryLabel, formatCurrency } from "@/lib/utils";
import { CATEGORY_ACCENT, CATEGORY_ICON, DEFAULT_ACCENT } from "@/components/ProductCard";
import { productArtUrl } from "@/lib/product-art";
import {
  useGetFlashSale,
  useListProducts,
  type ProductListItem,
} from "@workspace/api-client-react";
import { Flame, Clock, Package, Sparkles, Tag } from "lucide-react";
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
  product: ProductListItem;
  countdown: Countdown;
  stagger: string;
}) {
  const { expired } = countdown;
  const { h, m, s } = countdown;

  const salePrice = product.sale_price ?? product.price;
  const discount = product.discount_percent ?? 0;
  const isDeal = discount > 0;

  // R116-S1 card convergence: the SAME accent + category-icon fallback
  // idiom ProductCard uses (exported from it), so a Netflix flash card
  // without an image reads identically on both surfaces.
  const cat = product.category ?? "streaming";
  const accent = CATEGORY_ACCENT[cat] ?? DEFAULT_ACCENT;
  const FallbackIcon = CATEGORY_ICON[cat] ?? Package;

  const timeLabel =
    h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  return (
    <Link
      href={product.slug ? `/product/${product.slug}` : `/product/${product.id}`}
      /* R168: GA4 select_item — the flash card's click into the PDP
         (this page's own card markup, not ProductCard). */
      onClick={() => trackSelectItem(productToItem(product), "flash-sales")}
    >
      {/* R116-S1 card convergence: ProductCard's hover physics
          (card-spring + token shadow) and aspect-square ratio replace
          the ad-hoc -translate-y-1 / raw black shadow / active-scale stack. */}
      {/* R139 (precision): the card shell joins the r138-b ProductCard
          register byte-for-byte — resting border /50 → /60, hover
          border/80 → full border (the 60→100 step), and the two-layer
          calm elevation at rest (1px contact line + contained ambient,
          neutral black) + the bare themed hover:shadow-xl (R157-C
          retired the raw-black hover color override; the ladder's
          .light step stays inside the 6–14% ceiling) +
          transition duration-280. Same grid, same datum, same card
          language on / and /flash-sales. */}
      <div
        className={`float-in ${stagger}
          bg-card border border-border/60 rounded-2xl overflow-hidden
          transition-all duration-280 ease-out
          shadow-calm
          card-spring hover:border-border hover:shadow-xl
          cursor-pointer group`}
      >
        <div className="relative">
          {/* R139 (precision): bg-card → bg-muted/60 — the r138-b image
              shelf (ProductCard's well rides the exact class; the empty
              fallback's tinted gradient + tile already ride the shared
              CATEGORY_ACCENT idiom). */}
          <div className="relative aspect-square bg-muted/60 overflow-hidden">
            {product.image_url ? (
              /* R140 (r139 debt closure — verified, no change):
                 loading="lazy" + decoding="async" + alt={product.name}
                 (the product's own name — descriptive, not "صورة") are
                 all present. NO width/height attrs BY DESIGN: the img is
                 absolutely positioned (inset-0 + m-auto) inside the
                 fixed-ratio aspect-square shelf, which reserves the full
                 layout box — CLS is structurally zero, and intrinsic
                 width/height numbers would fight the max-w-[74%]
                 max-h-[74%] object-contain containment (the ProductCard
                 shelf's own twin idiom). */
              <img
                src={productArtUrl(product.image_url)}
                alt={product.name}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 z-[2] m-auto max-w-[74%] max-h-[74%] w-auto h-auto object-contain transition-transform duration-300 ease-out group-hover:scale-[1.06] drop-shadow-lg"
              />
            ) : (
              <div
                className={`absolute inset-0 z-[2] flex items-center justify-center pointer-events-none bg-gradient-to-br ${accent.gradient}`}
              >
                <div
                  className={`flex items-center justify-center w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-2xl border ${accent.bg} ${accent.border} shadow-sm transition-transform duration-300 ease-out group-hover:scale-105`}
                >
                  <FallbackIcon
                    className={`w-9 h-9 sm:w-10 sm:h-10 ${accent.text}`}
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                </div>
              </div>
            )}
          </div>

          {isDeal && (
            /* R139 (precision): the discount chip converges on ProductCard's
               r138-b badge byte-for-byte — bg-primary + text-primary-foreground
               + text-3xs + px-1.5 py-0.5 + shadow-md shadow-primary/30 (ONE
               primary-chip elevation value; was bg-status-error +
               shadow-lg shadow-status-error/40 — the colored-shadow drift
               r138 retired, and an error-channel reading of a DISCOUNT). The
               FlashSaleBanner (the sanctioned flash urgency vocabulary) is
               primary-branded end-to-end; the same product's discount chip
               must not switch channel between / and /flash-sales. Urgency
               stays carried by the countdown chip + the hero flame stage.
               The −{discount}% U+2212 glyph (93-C8) is byte-identical. */
            <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 bg-primary text-primary-foreground text-3xs font-bold px-1.5 py-0.5 rounded-full shadow-md shadow-primary/30">
              {/* 93-C8 (A11 §5): U+2212 minus to match product.tsx's
                  discount rendering (was an ASCII hyphen). */}
              <Tag className="w-2 h-2" />−{discount}%
            </div>
          )}

          {!expired && (
            /* R139 (precision): glass retired — bg-background/90 +
               backdrop-blur-sm → solid bg-card (the round's recipe; at 90%
               alpha the blur was sub-perceptual anyway, so the swap is
               register-level). dir="ltr" isolation added on the label span —
               the WhatsApp OTP-countdown vocabulary (tabular-nums + LTR run
               stays coherent if the label ever grows a unit suffix); pure
               digits render identically either way, so this is correctness
               hardening, not a visual change. R140 (r139 debt closure):
               the one-wrap-container form is the STRUCTURAL isolation —
               the whole "HH:MM:SS" string is a single LTR run — and the
               layout banner's digit spans now ride the same span-level
               isolation (FlashSaleBanner.tsx), so the countdown family
               is bidi-safe end-to-end. */
            <div className="absolute top-3 left-3 z-10 bg-card border border-border/60 text-foreground text-2xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 tabular-nums">
              <Clock className="w-3 h-3 text-status-warning" />
              <span dir="ltr">{timeLabel}</span>
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
          <div
            dir="auto"
            className="font-bold text-sm leading-snug mb-2.5 truncate text-right group-hover:text-primary-text transition-colors"
          >
            {/* R143 (L3-2): dir="auto" + text-right — the ProductCard F-1
                recipe; product names are English by design, and a pure-Latin
                name truncates from the wrong end in an RTL block (the
                ellipsis eats the brand head — the uniquely identifying
                token). Arabic names resolve rtl and render identically. */}
            {product.name}
          </div>
          <div className="flex items-baseline gap-2">
            {/* R139 (precision): text-primary-text → text-foreground +
                leading-none — the r138 money register (ProductCard's price
                rides the exact pair): emphasis by weight + size +
                tabular-nums, NOT brand ink. The PDP keeps its text-primary
                large-text price moment; grid cards read colorless. Strike
                keeps its muted line-through + tabular-nums (page-owned
                text-xs geometry). */}
            <span className="font-bold text-foreground text-lg leading-none tabular-nums">
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
  const { data: products = [], isLoading, isError, refetch } = useListProducts({ fields: "list" });

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

  // R168: GA4 view_item_list — one impression of the filtered sale
  // list (the page's actual rendered set, "flash-sales").
  useEffect(() => {
    if (onSale.length === 0) return;
    trackViewItemList(
      onSale.map((p) => productToItem(p)),
      "flash-sales",
    );
  }, [onSale]);

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

  // R120-B3 (A7-F1 P1): CAPTURE the useSeo return — the block was called
  // without rendering it, so /flash-sales shipped the DEFAULT
  // title/description and zero JSON-LD. The ItemList LD names the
  // on-sale products (home.tsx pattern: emitted only once the list is
  // loaded — an empty ItemList reads as thin structured data).
  //
  // L12-1 (R143): the description is now data-aware exactly like
  // product-seo's J-3 gate — the R124 copy promised «خصومات حقيقية…»
  // unconditionally while the page honestly rendered «لا عرض نشط حالياً»
  // whenever the singleton is null (live: flash_sale=null since
  // 2026-10-14), the exact J-3/F1 truthfulness class on a
  // sitemap-advertised money page (priority 0.8, changefreq daily).
  // Neutral hub copy when no sale is live (or the window just closed —
  // the page shows «انتهى هذا العرض» there); the discount copy only
  // while a real sale runs. The backend SHELL twin
  // (spa-shell.ts SHELL_STATIC_ROUTE_META) is a static route family and
  // cannot be data-aware — backend lane owns that mirror; the
  // recommendation on record is neutral hub copy there too.
  const seoDescription =
    activeSale && !saleEnded
      ? "عروض فلاش بخصومات حقيقية لفترة محدودة على اشتراكات نتفلكس وسبوتيفاي و ChatGPT و VPN — بالدينار الليبي مع تسليم فوري بعد الدفع في كامل ليبيا."
      : "صفحة عروض SubNation — تابع العروض الموسمية على الاشتراكات الرقمية بالدينار الليبي مع تسليم فوري في كامل ليبيا.";
  const seoBlock = useSeo({
    title: "عروض فلاش — SubNation",
    // R124 (A10-F3): 53 → 140 chars — /flash-sales is an indexable money
    // page (sitemap priority 0.8, changefreq daily); the old half-length
    // description wasted the SERP snippet. Same register as home/category:
    // names what's discounted, the currency, the delivery promise, the
    // locale. (The L12-1 gate above owns WHICH register renders.)
    description: seoDescription,
    type: "website",
    path: "/flash-sales",
    locale: "ar",
    robots: "index,follow",
    jsonLd:
      onSale.length > 0
        ? [buildItemListLd(onSale.slice(0, 30).map((p) => ({ id: p.slug ?? p.id, name: p.name })))]
        : undefined,
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {seoBlock}
      {/* Header */}
      <div className="text-center mb-9 page-in">
        <div className="relative w-16 h-16 mx-auto mb-5">
          {/* R139 (precision): the halo joins the sanctioned hero-tile glow
              family values — bg/6 + blur-xl (EmptyHero's own atmosphere
              vocabulary; was /15 + blur-2xl — a VISIBLE glow halo, the §1
              banned register). The urgency stays loud on the tile itself
              (tint + token border + full-ink flame); atmosphere reads
              sub-perceptual beneath it. */}
          <div className="absolute inset-0 rounded-2xl bg-status-error/6 blur-xl" />
          {/* R139 (precision): shadow-lg shadow-status-error/20 dropped —
              the colored-shadow drift r138 retired (139-f's exact cut on
              ProductsHeader). Icon stages carry no elevation: the tint +
              border-status-error/30 + full-ink glyph carry the urgency
              (the 139-d ChartErrorBanner / r138-h EmptyState stage
              register — token tints, never a colored glow edge). */}
          <div className="relative w-16 h-16 rounded-2xl bg-status-error/15 border border-status-error/30 flex items-center justify-center">
            <Flame className="w-8 h-8 text-status-error" />
          </div>
        </div>
        {/* R139 (precision): text-3xl → text-fluid-3xl — the storefront
            page-title scale (home hero + PDP + the category landings' h1s
            all ride it; text-3xl was this page's lone static outlier — at
            390px the two render ~identically, ≥sm the marketing page gets
            the marketing scale). */}
        {/* R-140-l (semantics): VERIFIED — exactly one h1, always
            mounted above the state swap (loading/error/empty/grid all
            keep it); no section headings exist (a card grid — the
            count line is a p, the sale banner is chrome), so the
            heading ladder is h1-only and sequential. */}
        <h1 className="text-fluid-3xl font-bold mb-2">عروض فلاش</h1>
        {/* R145 (D6, the L12-1 visible twin): the no-sale arm used to read
            «خصومات على أفضل الاشتراكات الرقمية» — a discount promise
            sitting directly above a body that honestly says no sale is
            live. The exact J-3/F1 truthfulness class L12-1 (R143)
            adjudicated for THIS page's meta description (the neutral hub
            copy only when no sale runs); the visible sub-line is the
            last surface still out-promising the body. The neutral arm
            reuses the meta's own register («تابع العروض الموسمية…») —
            one voice, zero new invention. A live sale still names its
            real title; the ended window keeps the title under the honest
            «انتهى هذا العرض» notice below. */}
        <p className="text-muted-foreground font-bold text-sm">
          {activeSale ? activeSale.title : "تابع العروض الموسمية على الاشتراكات الرقمية"}
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-5">
          {/* R139 (precision): the skeleton grid mirrors the page's own grid
              byte-for-byte (GridShell — the route-level "grid" shape built
              for this page — rides the same classes; 139-a verified the
              pair). aspect-[4/3] → aspect-square: §3's "skeletons shaped
              like the content" — the FlashCard media is square, and the
              4:3→1:1 swap shifted every card's fold position at the
              shimmer→content transition. bg-muted/60 rides along as the
              register marker (render-neutral — .skeleton-shimmer wins the
              background-color cascade; the 139-a ProductCardShell idiom).
              No resting elevation on placeholders (the skeleton family's
              flatter step). */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="aspect-square bg-muted/60 skeleton-shimmer" />
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
        <FetchErrorCard
          size="page"
          className="py-20 px-4 reveal-up"
          title="تعذّر تحميل العروض"
          description={NETWORK_ERROR_DESCRIPTION}
          /* R116-S1 CTA recipe: size="lg" + w-full sm:w-auto — no
             per-page bg/shadow/press overrides on the gradient variant. */
          retrySize="lg"
          retryClassName="w-full sm:w-auto"
          onRetry={() => refetch()}
        />
      ) : onSale.length === 0 ? (
        /* R139 (precision): EmptyHero adoption — this page's hand-rolled
           empty block WAS one of the four byte-identical first-run sites
           the component canonized (R136 UX-1; orders/cart/notifications
           all adopted — flash-sales was the lone fork left, and drifted:
           w-16/w-8 tile, /50 edge, silent swap). Pure swap per the
           component's own contract: the canonical Button rides the bare
           action slot, className="px-4" preserves the page's horizontal
           breathing room under the w-full mobile CTA. Adoption nets
           role="status" + the decorative aria-hidden icon — the documented
           a11y win every EmptyHero adoption ships.
           R145 (D6 recompose): the live VLM audit read this state as "a
           system error or broken feed, not an honest business state" —
           three compounding causes, all fixed in place:
           (1) the ICON was Sparkles — the generic no-results glyph; the
           page's own language is Flame (the header stage above), so the
           dimmed w-9 flame at opacity-25 in the muted well is the honest
           metaphor (the fire rests between sales) and kills the
           "two-different-icons-for-one-concept" dissonance the audit
           called out;
           (2) the TITLE gains the temporal frame «حالياً» — the R145-
           pre-approved line says there are no sales RIGHT NOW, not that
           the feed is empty;
           (3) the DESCRIPTION was «تابعنا أو راجع الكتالوج — العروض تعود
           قريباً!» — «تابعنا» pointed at an affordance this page doesn't
           own and «قريباً» is an unbacked time promise. The honest
           replacement states the one verifiable mechanism: new sales
           APPEAR HERE the moment they start (the page really does render
           an active sale's cards live — useCountdown keys off the real
           ends_at). NO fake countdown, NO fabricated urgency (B4 P1-1's
           pinned contract); the CTA stays the primary next-action
           (browse the catalog) — the mission's recomposition. */
        <EmptyHero
          icon={Flame}
          title="لا توجد عروض فلاش نشطة حالياً"
          description="العروض الجديدة تظهر هنا فور بدئها"
          className="px-4"
          action={
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/">
                <Sparkles className="w-4 h-4" />
                تصفح الكتالوج
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Honest expired notice — replaces every countdown chip once
              the (real) sale window has closed. */}
          {saleEnded && (
            /* R139 (precision): border-border/50 → /60 — the resting
               card-frame family value (the /50 scatter this round retired
               on every storefront frame). The warning Clock ink stays —
               «انتهى» is a literal expiry reading, the semantic-ink rule. */
            <div className="flex items-center justify-center gap-2 mb-5 p-3.5 bg-muted/30 border border-border/60 rounded-xl text-sm font-bold text-muted-foreground reveal-up">
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-5">
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
