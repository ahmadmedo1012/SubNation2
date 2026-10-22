import { memo, useRef } from "react";
import { Link } from "wouter";
import { categoryLabel, formatCount, formatCurrency } from "@/lib/utils";
import { productArtUrl } from "@/lib/product-art";
import { useToast } from "@/hooks/useToast";
import { useCartCommands, LOW_STOCK_THRESHOLD } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Lock,
  Package,
  ShoppingCart,
  Star,
  Tag,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { categoryLookup } from "@/lib/category-registry";
import { productToItem, trackAddToCart, trackSelectItem } from "@/lib/analytics-events";
import { StatusBadge } from "@/components/ui/status-badge";

interface Product {
  id: number;
  slug?: string | null;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price: number;
  price_from?: boolean;
  category?: string | null;
  is_available: boolean;
  stock_count: number;
  sale_price?: number | null;
  discount_percent?: number | null;
  order_count?: number;
  variants?: CatalogVariant[];
  /* A2-F3 (R124): the ?fields=list projection drops the variant tree —
     the count badge reads this instead. Present on every list response
     (both projections); absent only on hand-built fixtures. */
  variant_count?: number;
}

/** Public catalog variant (mirrors the /api/products DTO — price only,
 * never internal cost/sku fields). */
export interface CatalogVariant {
  id: number;
  plan_label?: string | null;
  duration_label?: string | null;
  label: string;
  price: number;
  sale_price?: number | null;
  discount_percent?: number | null;
  is_available: boolean;
}

// R146 (components audit F2): CATEGORY_ACCENT + CATEGORY_ICON derive from
// lib/category-registry — the ONE category table (labels/icons/accent
// atoms live there, spelled out literally for Tailwind's content scan;
// retired gaming/productivity rows included). R116-S1: both stay exported
// so the flash-sales page renders the SAME accent + category-icon
// fallback idiom on its cards (single source of truth).
export const CATEGORY_ACCENT: Record<
  string,
  { bg: string; text: string; border: string; gradient: string; accentLine: string }
> = categoryLookup((row) => row.accent);

export const DEFAULT_ACCENT = {
  bg: "bg-primary/10",
  text: "text-primary-text",
  border: "border-primary/20",
  gradient: "from-primary/12 via-primary/4 to-transparent",
  accentLine: "bg-primary/55",
};

// Category → Lucide icon. Used as the image-area fallback when a
// product has no image_url, so the empty-image card reads as a
// category placeholder rather than a giant first-letter glyph that
// doesn't carry visual identity. Exported alongside CATEGORY_ACCENT
// (R116-S1 flash-sales convergence).
export const CATEGORY_ICON: Record<string, LucideIcon> = categoryLookup((row) => row.Icon);

const STAGGER = [
  "",
  "stagger-1",
  "stagger-2",
  "stagger-3",
  "stagger-4",
  "stagger-5",
  "stagger-6",
  "stagger-7",
  "stagger-8",
];

function PopularBadge({ count }: { count?: number }) {
  if (!count || count < 5) return null;
  // Top sellers (≥20) get a warning-tinted badge so they read as
  // featured/notable; the lighter "popular" tier (5-19) lands on
  // success-tinted to feel like a positive momentum signal.
  // Both ride the shared --status-* tokens so they re-tint on
  // light theme automatically.
  if (count >= 20)
    return (
      <StatusBadge
        variant="warning"
        size="xs"
        icon={Star}
        className="absolute top-2.5 left-2.5 z-10 backdrop-blur-md"
      >
        الأكثر مبيعاً
      </StatusBadge>
    );
  return (
    <StatusBadge
      variant="success"
      size="xs"
      icon={Zap}
      className="absolute top-2.5 left-2.5 z-10 backdrop-blur-md"
    >
      {/* R123-E4b (P3-a): «رائج» — the commerce-natural term (Netflix
          AR UI and regional storefronts use it); «شائع» reads as
          "widespread/common" (questions, issues), not "trending". */}
      رائج
    </StatusBadge>
  );
}

function ProductCardInner({
  product,
  index = 0,
  itemListId,
}: {
  product: Product;
  index?: number;
  /* R168: the GA4 list context this card renders in ("search" /
   * category slug / "catalog" / "pdp-recommendations") — rides
   * select_item. Absent = no list id sent. */
  itemListId?: string;
}) {
  const displayPrice = product.sale_price ?? product.price;
  const cat = product.category ?? "streaming";
  const accent = CATEGORY_ACCENT[cat] ?? DEFAULT_ACCENT;
  const FallbackIcon = CATEGORY_ICON[cat] ?? Package;
  const unavailable = !product.is_available;
  const staggerClass = STAGGER[Math.min(index, 8)] ?? "";
  // C-2 (R142): the whisper threshold rides cart.tsx's single exported
  // definition (its own comment promises "the storefront's single
  // definition of «متبقٍ N فقط»") — the inline 3 drifted silently if an
  // operator ever raised the constant.
  const isLowStock =
    product.is_available && product.stock_count > 0 && product.stock_count <= LOW_STOCK_THRESHOLD;
  // R111-F4-F1 (P2): commands-only cart subscription. The card reads NO
  // live cart state (no is-in-cart flag — the CTA label never changes),
  // so it rides CartCommandsContext, whose value identity is stable for
  // the provider's lifetime. An add-to-cart tap on ANY card therefore
  // re-renders ZERO of the 45 mounted cards (the old wide useCart()
  // subscription re-rendered the whole grid on every tap — 80-200ms
  // INP on the money tap). The toast is the live feedback instead.
  const { addItem } = useCartCommands();
  const { toast } = useToast();

  // ── Add to cart ─────────────────────────────────────────────
  // The card CTA is a real <button> (sibling of the details <Link>,
  // not nested inside it) — the previous markup was a visual-only
  // div that navigated to the product page while labeled "اشترِ
  // الآن", so the cart page and the Navbar badge were permanently
  // empty: the whole cart → checkout funnel was unreachable.
  // 96-F4 (R96 A2 P1-7): 500ms re-entry lock via a ref timestamp — a
  // double-tap on a laggy phone added qty 2 in one gesture (and the
  // funnel charged twice at checkout). The toast already confirms the
  // first add, so the second tap inside the lock window is swallowed.
  // null (not 0) so the FIRST tap always passes regardless of the clock
  // (a 0-init ref would swallow taps at epoch-0 test clocks and is
  // semantically "never tapped" — model it explicitly).
  const lastAddTapRef = useRef<number | null>(null);
  // Catalog-2026-09-20: quick-add uses the cheapest ACTIVE variant when the
  // product has options (matches the card's displayed "تبدأ من" price and
  // the checkout's default-variant rule — no price mismatch is possible).
  // R130 (A7-F1/A2-F1): ACTIVE and AVAILABLE are not the same — the
  // availability-blind min surfaced «تبدأ من» prices whose variant had
  // already drained while pricier variants held stock, and quick-add then
  // built a line the server can only 409 at charge time. The reduce now
  // prefers the cheapest AVAILABLE variant and only falls back to the
  // availability-blind min when every variant is drained (the card is
  // sold-out/non-interactive in that state — same behavior as before).
  const cheapestVariant =
    product.variants && product.variants.length > 0
      ? product.variants.some((v) => v.is_available)
        ? product.variants
            .filter((v) => v.is_available)
            .reduce((a, b) => (a.price <= b.price ? a : b))
        : product.variants.reduce((a, b) => (a.price <= b.price ? a : b))
      : null;
  /* A2-F3 (R124): variant count works with or without the projected
     variant tree — the live list payloads carry variant_count only. */
  const variantCount = product.variants?.length ?? product.variant_count ?? 0;
  const handleAddToCart = () => {
    if (unavailable) return;
    const now = Date.now();
    if (lastAddTapRef.current !== null && now - lastAddTapRef.current < 500) return;
    lastAddTapRef.current = now;
    // R130 (A1-F2): the B-11 raise cap can refuse the bump at the line's
    // stock-aware ceiling — a success toast on a refused add promised a
    // badge change that never happened (the second quick-add of any
    // low-stock product). Honest toast now keys on the applied result.
    const applied = addItem({
      productId: product.id,
      variantId: cheapestVariant ? cheapestVariant.id : null,
      variantLabel: cheapestVariant ? cheapestVariant.label : null,
      slug: product.slug ?? null,
      name: product.name ?? "",
      imageUrl: product.image_url ?? null,
      priceLYD: cheapestVariant ? cheapestVariant.price : product.price,
      salePriceLYD: cheapestVariant
        ? (cheapestVariant.sale_price ?? null)
        : (product.sale_price ?? null),
      discountPercent: cheapestVariant
        ? (cheapestVariant.discount_percent ?? null)
        : (product.discount_percent ?? null),
      // R129-A1 (F1 wiring — B-11): the add captures the catalog row's
      // stock snapshot — the SAME number this card's own badge renders
      // («متبقٍ N فقط» / «نفد المخزون») — so the cart line's verdict
      // agrees with what the buyer already saw here. Variants carry no
      // stock of their own (CatalogVariant), product.stock_count is the
      // storefront's single availability signal.
      stockCount: product.stock_count,
    });
    if (applied) {
      // R168: GA4 add_to_cart — ONLY the applied success path, the
      // added variant's effective price (productToItem picks
      // sale ?? price), quantity 1.
      trackAddToCart(productToItem(product, cheapestVariant));
      toast({
        title: "أُضيف إلى السلة",
        description: cheapestVariant
          ? `${product.name} — ${cheapestVariant.label}`
          : (product.name ?? undefined),
      });
    } else {
      toast({
        title: "بلغت الحد الأقصى المتاح",
        description:
          product.stock_count != null
            ? `${product.name} — متبقٍ ${product.stock_count} فقط`
            : (product.name ?? undefined),
      });
    }
  };

  // ── Accessibility ─────────────────────────────────────────────────
  // Compose a single descriptive aria-label for the whole card so
  // screen readers announce the full state on a single focus event.
  // Visually, the same information lives in scattered badges + the
  // muted opacity treatment; aria collapses it into one phrase.
  const ariaLabelParts = [
    product.name,
    categoryLabel(product.category),
    `${product.price_from ? "تبدأ من " : ""}${formatCurrency(displayPrice)}`,
    /* R122 (A1 P2-1): the frozen «N باقات» plural broke the Arabic
       paradigm for every count (2 → «باقتان», 3–10 → «باقات», 11+ →
       «باقة»); formatCount is the app standard used at 20+ count
       sites (utils.ts:49). */
    /* R122 (A1 P2-1): same formatCount swap as the aria-label
       above — «2 باقتان» instead of the frozen «2 باقات». */
    variantCount > 1
      ? formatCount(variantCount, {
          one: "باقة",
          two: "باقتان",
          few: "باقات",
          many: "باقة",
          other: "باقة",
        })
      : null,
    unavailable ? "نفد المخزون" : null,
    // 93-C8 (A11 §1): «آخر 2 متوفرة» is a broken dual; «متبقٍ N
    // فقط» is agreement-safe for every count 1..3.
    isLowStock ? `متبقٍ ${product.stock_count} فقط` : null,
    /* R134 (A2-F4): the mid-range pill (4–99, single-variant) is a
       bare numeral beside the price — sighted users see an unlabeled
       count while the SR name was silent on it (the label only spoke
       stock on the نفد/low-stock branches). «الكمية N» gives the
       visible pill its accessible meaning. */
    !unavailable && !isLowStock && variantCount <= 1 && product.stock_count != null
      ? `الكمية ${product.stock_count}`
      : null,
  ].filter(Boolean);
  const ariaLabel = ariaLabelParts.join("، ");

  return (
    <div
      className={`
        group relative h-full bg-card border border-border/60 rounded-2xl overflow-hidden cursor-pointer flex flex-col
        float-in ${staggerClass}
        transition-all duration-280 ease-out
        shadow-calm
        card-spring hover:border-border hover:shadow-xl
        ${unavailable ? "opacity-45 saturate-[0.3]" : ""}
      `}
    >
      {/* R120-B1 (A1-F1): card surface is hsl(220 20% 8%) ≈ rgb(16,19,24)
          vs the body's rgb(10,12,16) — a ~1.05:1 luminance ratio, so the
          surface alone can never delineate the container, and the old
          border-border/50 (≈rgb(36,41,50) at half alpha) measured
          ~invisible. The chrome carries the container read instead (the
          --card token is deliberately untouched — another agent owns
          input borders and the surface ladder).
          R138 (visual — supersedes the /70 + shadow-sm resting choice):
          the live-site audit read RESTING cards as "raw HTML containers"
          — flat next to their own (good) hover state. Resting re-tune:
          (1) border 70→60 — the container read now leans on elevation +
          the muted image well below, and the wider 60→100% border gap
          makes the hover affordance legible in a static screenshot
          (hover:border-border unchanged). (2) the flat shadow-sm
          stack → ONE two-layer calm elevation, the
          premium-toast recipe at resting scale: a tight contact line
          (1px 2px @30%) + a contained ambient wash (10px 28px −14px
          @40%) that reads as mass on a shelf — resting < hover-xl <
          toast-ambient (14px 36px @55%) keeps the elevation ladder
          ordered. Deliberately NEUTRAL black, not the primary-tinted
          hair this round considered: a primary tint at 4–6% reads as
          COLOR on .light and skirts the banned glow-halo language,
          while black reads as pure depth on both themes. (3)
          R157-C: the hover scope's black/25 shadow-color override
          retired for the bare themed `hover:shadow-xl` — a bare
          shadow utility resolves through the theme's own shadow
          ladder (index.css), so .light rendered the literal 25%
          black (~2× the documented 6–14% ceiling) while the
          ladder's xl step sits inside it; dark is byte-identical
          (55% ladder).
          R143 (L2-1): the resting recipe is now the theme-aware
          `shadow-calm` token in index.css — dark byte-identical
          (1px 2px @30% + 10px 28px −14px @40%), .light re-tuned inside
          the documented 6–14% ceiling (the literal rendered 30/40%
          black under .light, ~3× over). */}
      <Link
        href={`/product/${product.slug ?? product.id}`}
        aria-label={ariaLabel}
        /* R168: GA4 select_item — the card's product link click (the
           funnel's list→PDP hop; no-op without the GA loader). */
        onClick={() => trackSelectItem(productToItem(product, cheapestVariant), itemListId)}
        className="flex flex-col flex-1"
      >
        {/* R138 (visual): shadow-primary/40 → /30 — the badge joins the
            desktop quick-add on ONE primary-chip elevation value
            (shadow-md shadow-primary/30); a same-family 10% alpha
            spread is vocabulary drift. AA re-verified this round: white
            on bg-primary ≈4.9:1 dark / ≈5.3:1 light at 11px bold
            (text-3xs floor) — ink untouched. px-1.5/py-0.5 +
            rounded-full + font-bold match every pill sibling. */}
        {product.discount_percent && !unavailable && (
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-0.5 bg-primary text-primary-foreground text-3xs font-bold px-1.5 py-0.5 rounded-full shadow-md shadow-primary/30">
            <Tag className="w-2 h-2" />
            {product.discount_percent}%
          </div>
        )}

        {unavailable && (
          <div
            className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-black/75 backdrop-blur-sm text-white/70 text-3xs font-bold px-2 py-0.5 rounded-full"
            aria-hidden="true"
          >
            <Lock className="w-2.5 h-2.5" /> نفد
          </div>
        )}

        <PopularBadge count={product.order_count} />

        {/* R120-B1 (A3-F10/A4-F4): sold-out cards keep the dimmed
            opacity/saturate treatment but are no longer dead taps —
            pointer-events-none + aria-disabled made the whole card
            unfocusable and un-navigable on Enter while still LOOKING
            clickable. The card now navigates to the product page (which
            states نفد honestly); the aria-label above already announces
            «نفد المخزون» and the CTAs below stay gated off. */}

        {/* R138 (visual): bg-card → bg-muted/60 — the media plane was the
            SAME tone as the card body (composite ≈1.3:1 on dark,
            sub-perceptual), so catalog imagery read as raw file previews
            floating on a bare background (live-site audit). A /60 muted
            wash — the empty-state icon-tile vocabulary — gives the well
            its own shelf surface: a STATIC token wash (theme-aware via
            color-mix), not decoration. R178: the art is TRANSPARENT now,
            so this well IS the product-art ground — it follows the theme,
            and the img's drop-shadow-lg grounds the asset on the plane. */}
        <div className="relative aspect-square bg-muted/60 overflow-hidden">
          <div
            className={`absolute top-0 inset-x-0 h-[2px] ${accent.accentLine} opacity-65 z-[1]`}
          />
          {/* R120-B1 (A1-F4): the shine-trigger sweep (group-hover) — kept
              for its own sake; the white/[0.06] top-sheen unification
              layer it used to ride with was RETIRED in R178 (it existed
              to reconcile white-plate assets with transparent ones — the
              whole catalog is transparent art now, so there is nothing
              left to unify). */}
          <div className="shine-trigger absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full skew-x-[-14deg] pointer-events-none z-[3]" />

          {product.image_url ? (
            <img
              src={productArtUrl(product.image_url)}
              alt={(() => {
                // Build descriptive alt text:
                //   "<product name> — <category label> اشتراك"
                // Falls back gracefully when name is missing. The
                // category context helps Google Image search ranking
                // for queries like "اشتراك منصات المشاهدة ليبيا"
                // (R161-C — the streaming family's honest label; the
                // «اشتراك {categoryLabel}» template reads naturally
                // for every category, genitive construct).
                const name = (product.name ?? "").trim();
                const cat = categoryLabel(product.category);
                if (!name) return cat ? `اشتراك ${cat}` : "اشتراك رقمي";
                // Avoid duplicating "اشتراك" when the name already includes it.
                const hasSub = /اشتراك/.test(name);
                return cat && cat !== "عام"
                  ? `${name} — ${hasSub ? "" : "اشتراك "}${cat}`.trim()
                  : name;
              })()}
              // L4-F9 (R132): honest intrinsic size — R174 regenerated
              // every /products/*.webp at 1024×1024 (was 450×450).
              width={1024}
              height={1024}
              // R-140-a (image discipline): NO srcset/sizes by
              // measurement — the catalog ships exactly ONE
              // rendition per asset (all 45 /products/*.webp
              // re-probed 1024×1024 this round), so a srcset would
              // fabricate /products*@2x URLs that 404. Revisit
              // only when a second size actually exists in
              // public/products/.
              // ── LCP optimization ─────────────────────────────────────
              // The homepage product grid is 2-cols on mobile, 2-3-4 on
              // tablet/desktop. The visible above-fold rows fit ~4 cards
              // on every breakpoint, so the FIRST 4 images must load
              // eagerly — `loading="lazy"` on the LCP image is a known
              // ~400-800 ms regression on mobile Lighthouse runs.
              //
              // The first TWO cards (index < 2) get fetchpriority="high":
              // on the 2-col mobile grid that is the whole first row,
              // and R127-B4's live LCP trace caught the winning mobile
              // LCP element at index 1 with fetchpriority="auto" — the
              // old "single biggest LCP lever" claim was only half-live
              // (B4 D5 FE half; the App.tsx boot-catalog image warming
              // is the other half).
              loading={index < 4 ? "eager" : "lazy"}
              fetchPriority={index < 2 ? "high" : index < 4 ? "auto" : "low"}
              decoding="async"
              className="absolute inset-0 z-[2] m-auto max-w-[74%] max-h-[74%] w-auto h-auto object-contain transition-transform duration-300 ease-out group-hover:scale-[1.06] drop-shadow-lg"
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
            className={`absolute inset-0 z-[2] items-center justify-center pointer-events-none bg-gradient-to-br ${accent.gradient}`}
          >
            <div
              className={`flex items-center justify-center w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-2xl border ${accent.bg} ${accent.border} shadow-sm transition-transform duration-300 ease-out group-hover:scale-105`}
            >
              {/* Category icon as the empty-image fallback. The icon
                  inherits the category accent's foreground color so a
                  Netflix card without an image reads as a violet TV
                  glyph, a Spotify card without an image reads as an
                  emerald music glyph, etc. — replaces the previous
                  first-letter glyph that was identical for "Netflix"
                  and "Notion" and carried no category cue. */}
              <FallbackIcon
                className={`w-9 h-9 sm:w-10 sm:h-10 ${accent.text}`}
                strokeWidth={1.6}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        <div className="p-3.5 pt-3 flex flex-1 flex-col">
          {/* R127 (B3-K1, P2): on <sm the 2-col grid leaves ~143px of
              row and the shrink-0 Arabic category badge runs 82–112px,
              so A4-F7's min-w-0 (kept below) left the title 20–50px and
              long unbreakable Latin tokens ("Grammarly" 78px) clipped
              mid-glyph — impeccable's 390px census: 16/45 titles
              overflowed. Per the B3 prescription the badge moves to its
              own row under the title on <sm — but ONLY where the row is
              actually tight: the row wraps (flex-wrap) and the title's
              flex basis is its content width (flex-auto, was
              flex-1/basis-0), so title + badge stay side-by-side when
              they fit and the badge reflows under the title when they
              don't. A fitting row keeps the exact pre-fix distribution
              (title = row − badge − gap either way), so the cards that
              never overflowed render byte-identically. ≥sm keeps the
              single row (sm:flex-nowrap — 0/45 desktop overflow in the
              same census) and with the badge shrink-0 the ≥sm title
              width is basis-independent, so flex-auto is a no-op there.
              The badge also caps at max-w-full + truncate: at ≤320px
              the widest badge (112px) exceeds its own wrapped line
              (~110px of content) — ellipsis instead of a hard clip;
              no-op at ≥360px where every badge fits its line. */}
          <div className="flex flex-wrap items-start gap-2 mb-1.5 sm:flex-nowrap">
            {/* R120-B1 (A7-F13): h3 (was h2) so the section h2s own the
                document outline; R120-B1 (A1-F10): 2 name lines below sm
                (8/12 names clipped at 390px), 1 line from sm up. The
                description row is hidden below sm (A1-F15) to fund the
                second name line in the 2-col mobile grid.
                R124 (A4-F7): min-w-0 — a flex item's automatic minimum
                size is its longest unbreakable token, so a catalog name
                with one long Latin token pushed the shrink-0 category
                badge out of the row (every other flex text chain in the
                app already carries it; the card's overflow-hidden kept
                the squeeze latent until such a name ships). Still live:
                a wrapped-alone title wider than the row must shrink
                under min-w-0, never push the badge out of the card. */}
            <h3
              dir="auto"
              /* R128-A2 (F-1): text-right keeps dir="auto"'s bidi
                 isolation but re-anchors the visual edge — pure-Latin
                 names resolve dir=auto to ltr, so text-align:start
                 computed LEFT and the name hugged the card's left side
                 (measured 21–97px dead zone on the RTL reading edge
                 where every Arabic title begins). dir=auto stays for
                 the scrambling fix (R116-S2); only the ALIGNMENT is
                 pinned to the page's RTL anchor.
                 R145 (D4): text-foreground at full ink (was /85) — the
                 name is the card's scannable anchor; with the price
                 stepping down to text-base below, the name now leads
                 the hierarchy by weight AND color. */
              className="font-bold text-sm leading-snug line-clamp-2 sm:line-clamp-1 flex-auto min-w-0 text-right text-foreground group-hover:text-foreground transition-colors duration-200"
            >
              {product.name}
            </h3>
            <span
              /* 96-F4 (R96 A6 #11): 9px Arabic was unreadable in the
                 2-up mobile grid (connected glyphs lose ح/ج/خ distinction
                 above ~40yo) — 10px + semibold keeps the badge compact
                 while staying legible. */
              className={`text-3xs font-semibold px-1.5 py-0.5 rounded-full border shrink-0 mt-0.5 max-w-full truncate ${accent.bg} ${accent.text} ${accent.border}`}
            >
              {categoryLabel(product.category)}
            </span>
          </div>

          {product.description && (
            /* B3-K2 (R127): 11px/400 muted text measured 3.2–3.6:1
               pixel-median on card backgrounds (anti-alias edge ink at
               hairline stroke weights) despite 8:1 token math — A13's
               computed-style pass was correct per WCAG methodology, but
               the rendering density on the smallest text is real.
               text-xs (12px) + font-semibold per the B3 fix directive
               — the report's weight-500 suggestion is not implementable
               here: the repo loads Readex Pro 400/600/700 only (the
               design-system-css gate bans the 500 utility in .tsx; a
               missing 500 snaps back to 400, a no-op). semibold is the
               nearest loaded weight. The register/support fine-print cousins
               are another lane's files. Still ≥sm-only. */
            <p className="hidden sm:block text-muted-foreground text-xs font-semibold line-clamp-2 leading-relaxed mb-2.5">
              {product.description}
            </p>
          )}

          {/* md:pe-12 (R120-B1 / A1-F2): reserves the inline-end corner
              of the price row for the persistent desktop quick-add button
              below (48px = 12px inset + 32px button + 4px gap) so the
              stock/variants badge never sits under it. Mobile keeps the
              full-width row — the always-on CTA there lives below.
              R124 (A4-F4): on touch viewports ≥md the quick-add grows to
              the 44px floor (see the button below), so the reservation
              grows with it — pe-15 = 60px = 12px inset + 44px button +
              4px gap (the stacked variant sorts after md:pe-12 in the
              utilities layer, so the override is cascade-safe). */}
          <div className="flex items-center justify-between pt-2.5 border-t border-border/20 mt-auto md:pe-12 md:[@media(hover:none)]:pe-15">
            {/* R138 (visual audit): price block verified — no drift.
                text-lg font-bold + tabular-nums leads the title's
                text-sm by a full step (money is the card's loudest
                element); the strike carries the muted + line-through +
                tabular-nums family; «تبدأ من» stays the muted 3xs
                qualifier. Values untouched.
                R145 (D4): text-lg → text-base — the live-site critique
                read the old ratio as inverted hierarchy (price bolder
                and larger than the product name); the name (bold,
                full-ink, above) now leads, the price follows at one
                step under it. */}
            <div className="flex items-baseline gap-1.5 flex-wrap">
              {product.price_from && (
                <span className="text-3xs font-semibold text-muted-foreground">تبدأ من</span>
              )}
              <span className="font-bold text-foreground text-base leading-none tabular-nums">
                {formatCurrency(displayPrice)}
              </span>
              {product.sale_price && (
                <span className="text-muted-foreground text-3xs line-through tabular-nums">
                  {formatCurrency(product.price)}
                </span>
              )}
            </div>

            {product.is_available ? (
              variantCount > 1 ? (
                <span
                  className={`text-3xs font-bold px-1.5 py-0.5 rounded-full border ${accent.bg} ${accent.text} ${accent.border}`}
                >
                  {/* R122 (A1 P2-1): same formatCount swap as the aria-label
                      above — «2 باقتان» instead of the frozen «2 باقات». */}
                  {formatCount(variantCount, {
                    one: "باقة",
                    two: "باقتان",
                    few: "باقات",
                    many: "باقة",
                    other: "باقة",
                  })}
                </span>
              ) : isLowStock ? (
                <StatusBadge
                  variant="low-stock"
                  size="xs"
                  icon={AlertTriangle}
                  aria-label={`مخزون منخفض، متبقٍ ${product.stock_count} فقط`}
                >
                  {/* R123-E4b (P3-a): «متبقٍ {n}» — matches this badge's own
                      aria-label; the old «آخر {n}» was a noun-less fragment
                      ("last 2") that read as a truncated sentence.
                      R134 (A2-F5): «فقط» appended — this badge was the lone
                      shortened member of the «متبقٍ N فقط» family (its own
                      aria-label, the quick-add ceiling toast, and the
                      cart's lineStockNotice all carry it). */}
                  متبقٍ {product.stock_count} فقط
                </StatusBadge>
              ) : (
                <div
                  className={`flex items-center gap-0.5 text-3xs font-bold px-1.5 py-0.5 rounded-full border ${accent.bg} ${accent.text} ${accent.border}`}
                >
                  {/* R123-E4b (P3-a): "99+" — unified with the Navbar /
                      MobileNav / NotificationBell badge convention. In the
                      RTL base direction a logical "99+" renders with the
                      plus on the LEFT of the digits ("+99" visually) —
                      digits first in Arabic reading order, then the
                      "or more" qualifier. The old source "+99" rendered
                      with the plus on the RIGHT — the English visual order
                      (verified by char-position measurement in Chromium,
                      dir=rtl).
                      R134 (A2-F4): «كمية» prefix — the bare numeral sat
                      beside the price where it could be mistaken for
                      quantifying it; every sibling pill is self-describing
                      («N باقات», «متبقٍ N فقط»). */}
                  كمية {product.stock_count > 99 ? "99+" : product.stock_count}
                </div>
              )
            ) : (
              /* 96-F4 (R96 A6 #12): full-opacity muted token — the /80
                 variant measured ≈4.14:1 on the light card, failing AA
                 for a 10px status text. */
              <span className="text-3xs font-bold text-muted-foreground">نفد</span>
            )}
          </div>
        </div>
      </Link>

      {/* ── Add-to-cart CTA ────────────────────────────────────────────
          Real buttons (siblings of the details Link — valid HTML,
          keyboard-focusable, no nested interactive elements). The old
          markup was a <div> that looked like a button but the whole
          card navigated to the product page instead.
          R116-S1: both CTAs ride the shared <Button> (gradient variant
          + global press-spring) instead of a hand-rolled flat
          bg-primary — same look as every system CTA, one source of
          truth. min-h-11 keeps the 44px tap-target floor. */}
      {product.is_available ? (
        <Button
          type="button"
          onClick={handleAddToCart}
          className="mx-3.5 mb-3.5 mt-0 md:hidden min-h-11 text-xs font-bold"
        >
          <ShoppingCart aria-hidden="true" />
          أضف للسلة
        </Button>
      ) : (
        // Mobile: keep card height stable when unavailable by
        // rendering a static muted bar in place of the buy CTA.
        // Same min-h-11 as the active button so the card visual rhythm
        // is identical across states. Desktop uses a hover-reveal
        // CTA that's already absent for unavailable products.
        <div
          className="mx-3.5 mb-3.5 mt-0 md:hidden min-h-11 rounded-xl bg-muted/40 border border-border/40 flex items-center justify-center gap-1.5 text-muted-foreground text-xs font-bold"
          aria-hidden="true"
        >
          <Lock className="w-3.5 h-3.5" />
          نفد المخزون
        </div>
      )}

      {/* ── Desktop persistent quick-add (R120-B1 / A1-F2) ───────────────
          The desktop CTA used to be hover-reveal only — a keyboard or
          touch-laptop user had no visible buy affordance at rest. A
          compact 32px icon button now sits persistently in the price
          row's inline-end corner (real <button>, sibling of the Link —
          no nesting, keyboard-focusable) and shares handleAddToCart
          with the mobile CTA (same 500ms double-tap lock). Sold-out
          keeps a dimmed DISABLED affordance mirroring mobile's muted
          bar. The hover slide-up panel below stays for delight; this
          button layers ABOVE it (z-10 vs the panel's z-auto) so a
          focused quick-add is never visually obscured by the panel.
          R124 (A4-F4): tablets sit at ≥md with a coarse pointer — the
          mobile CTA (md:hidden) is gone and the hover slide-up below can
          never reveal there, so this button is the card's ONLY add
          affordance, and at 32px it sat under the app's own 44px touch
          floor. Under @media(hover:none) it grows to 44px and becomes
          the visible touch fallback (adapt.md: detect input method, not
          just screen size — same idiom as index.css's sonner close
          button); pointer users keep the compact 32px icon. The disabled
          sold-out twin below is sized identically so the grid's corner
          geometry stays uniform across cards (disabled controls are
          exempt from the floor — that one is visual rhythm, not a
          target). */}
      {product.is_available ? (
        <button
          type="button"
          onClick={handleAddToCart}
          aria-label={`أضف ${product.name} إلى السلة`}
          title="أضف للسلة"
          className="hidden md:flex absolute bottom-3 left-3 z-10 h-8 w-8 [@media(hover:none)]:h-11 [@media(hover:none)]:w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:bg-primary/90 active:scale-90 transition-all duration-150 press-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          disabled
          aria-label="نفد المخزون"
          /* R182 (Lane-C D4): the icon-only title twin — its enabled
             sibling above carries both; disabled controls still expose
             their hover hint to sighted pointer users. */
          title="نفد المخزون"
          className="hidden md:flex absolute bottom-3 left-3 h-8 w-8 [@media(hover:none)]:h-11 [@media(hover:none)]:w-11 items-center justify-center rounded-xl bg-muted/40 border border-border/40 text-muted-foreground/70 cursor-not-allowed"
        >
          <Lock className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}

      {product.is_available && (
        <div className="hidden md:block absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 group-focus-within:translate-y-0 transition-transform duration-200 ease-out">
          <Button
            type="button"
            onClick={handleAddToCart}
            className="mx-3 mb-3 min-h-11 w-[calc(100%-1.5rem)] text-xs font-bold"
          >
            <ShoppingCart aria-hidden="true" />
            أضف للسلة
          </Button>
        </div>
      )}
    </div>
  );
}

export const ProductCard = memo(
  ProductCardInner,
  (prev, next) =>
    prev.product.id === next.product.id &&
    prev.product.slug === next.product.slug &&
    prev.product.name === next.product.name &&
    prev.product.description === next.product.description &&
    prev.product.image_url === next.product.image_url &&
    prev.product.price === next.product.price &&
    prev.product.sale_price === next.product.sale_price &&
    prev.product.category === next.product.category &&
    prev.product.discount_percent === next.product.discount_percent &&
    prev.product.order_count === next.product.order_count &&
    prev.product.stock_count === next.product.stock_count &&
    prev.product.is_available === next.product.is_available &&
    /* R124 (A2-F8): variants — the card derives its «تبدأ من» min-price,
       quick-add target and count badge from product.variants, but the
       perf comparator never compared them, so a background refetch
       (staleTime 3 min) that only changed a variant's price or
       availability re-rendered nothing and the card kept showing the
       stale price on a money display. Identity is exact AND
       perf-neutral: both storefront consumers (home, category) ride
       TanStack Query's default structural sharing, which preserves the
       variants array reference across refetches unless the data deeply
       changed — and a deep change re-renders, exactly as it must. */
    prev.product.variants === next.product.variants &&
    prev.index === next.index &&
    /* R168: the list context threads through the memo — a grid whose
       filter context changed must not keep firing the old
       item_list_id. */
    prev.itemListId === next.itemListId,
);
