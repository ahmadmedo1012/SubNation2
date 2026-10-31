import { ProductCard } from "@/components/ProductCard";
import { FaqAccordion } from "@/components/faq-accordion";
import { Select } from "@/components/ui/select";
import { SORTS, readInitialFiltersFromUrl } from "@/components/home/catalog-filters";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { ProductCardShell } from "@/components/ui/route-skeleton";
import { useSeo } from "@/hooks/useSeo";
import { productToItem, trackViewItemList } from "@/lib/analytics-events";
import { CATEGORY_META, type CategoryMeta } from "@/lib/categories";
import { buildBreadcrumbLd, buildFaqLd, buildItemListLd } from "@/lib/seo-builders";
import { getListProductsQueryKey, useListProducts } from "@workspace/api-client-react";
import {
  AppWindow,
  ChevronLeft,
  GraduationCap,
  Music2,
  Package,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Tv2,
} from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link, useParams, useLocation } from "wouter";

// ── Category accent system ────────────────────────────────────────────────
//
// Mirrors the per-category accent palette used by ProductCard so a
// product card painted violet on the homepage lives under a hero
// painted with the SAME violet on /category/streaming. The tinted
// hero + matching FAQ heading border is what makes each landing page
// feel like a coherent themed surface rather than a generic list.
//
// All seven live palettes ride the shared --cat-* CSS variables
// (exposed to Tailwind via @theme), so the landing pages re-tone
// themselves correctly on the light theme.
// Tailwind needs the full class strings present in source for its
// content scan, which is why these are static strings.

interface CategoryTheme {
  /** Hero background gradient layer (left edge tint). */
  heroGradient: string;
  /** Right-edge accent line gradient. */
  edgeAccent: string;
  /** Blur orb in the top-right corner of the hero. */
  blurOrb: string;
  /** Section heading border-right accent (h2 underline). */
  headingBorder: string;
  /** Chip background tint for the sibling-categories nav. */
  chipBg: string;
  /** Chip text colour. */
  chipText: string;
  /** Chip border. R139 (precision): /25 + hover /45 → /30 + hover /55 —
   *  the static-badge family value (/30 — the same step 139-f/139-i landed
   *  on every tinted chip edge) + the tinted-chip hover step the home hero's
   *  brand chips ride (border-success/30 → hover /55). Applies to the
   *  sibling-chip row AND the hero icon tile — one border value lane-wide.
   *  The /10 fill + /15 hover fill + text-cat-* ink stay: R124 (A3-F1)
   *  AA-audited exactly this trio on the chips' own tints. */
  chipBorder: string;
  /** Icon for the chip (lucide). */
  Icon: ComponentType<{ className?: string }>;
}

const CATEGORY_THEME: Record<CategoryMeta["slug"], CategoryTheme> = {
  streaming: {
    heroGradient: "from-cat-streaming/15",
    edgeAccent: "from-cat-streaming/70 via-cat-streaming/25 to-transparent",
    blurOrb: "bg-cat-streaming/15",
    headingBorder: "border-cat-streaming",
    chipBg: "bg-cat-streaming/10 hover:bg-cat-streaming/15",
    chipText: "text-cat-streaming",
    chipBorder: "border-cat-streaming/30 hover:border-cat-streaming/55",
    Icon: Tv2,
  },
  music: {
    heroGradient: "from-cat-music/15",
    edgeAccent: "from-cat-music/70 via-cat-music/25 to-transparent",
    blurOrb: "bg-cat-music/15",
    headingBorder: "border-cat-music",
    chipBg: "bg-cat-music/10 hover:bg-cat-music/15",
    chipText: "text-cat-music",
    chipBorder: "border-cat-music/30 hover:border-cat-music/55",
    Icon: Music2,
  },
  software: {
    heroGradient: "from-cat-software/15",
    edgeAccent: "from-cat-software/70 via-cat-software/25 to-transparent",
    blurOrb: "bg-cat-software/15",
    headingBorder: "border-cat-software",
    chipBg: "bg-cat-software/10 hover:bg-cat-software/15",
    chipText: "text-cat-software",
    chipBorder: "border-cat-software/30 hover:border-cat-software/55",
    Icon: AppWindow,
  },
  vpn: {
    heroGradient: "from-cat-vpn/15",
    edgeAccent: "from-cat-vpn/70 via-cat-vpn/25 to-transparent",
    blurOrb: "bg-cat-vpn/15",
    headingBorder: "border-cat-vpn",
    chipBg: "bg-cat-vpn/10 hover:bg-cat-vpn/15",
    chipText: "text-cat-vpn",
    chipBorder: "border-cat-vpn/30 hover:border-cat-vpn/55",
    Icon: ShieldCheck,
  },
  "ai-tools": {
    heroGradient: "from-cat-ai-tools/15",
    edgeAccent: "from-cat-ai-tools/70 via-cat-ai-tools/25 to-transparent",
    blurOrb: "bg-cat-ai-tools/15",
    headingBorder: "border-cat-ai-tools",
    chipBg: "bg-cat-ai-tools/10 hover:bg-cat-ai-tools/15",
    chipText: "text-cat-ai-tools",
    chipBorder: "border-cat-ai-tools/30 hover:border-cat-ai-tools/55",
    Icon: Sparkles,
  },
  "seo-tools": {
    heroGradient: "from-cat-seo-tools/15",
    edgeAccent: "from-cat-seo-tools/70 via-cat-seo-tools/25 to-transparent",
    blurOrb: "bg-cat-seo-tools/15",
    headingBorder: "border-cat-seo-tools",
    chipBg: "bg-cat-seo-tools/10 hover:bg-cat-seo-tools/15",
    chipText: "text-cat-seo-tools",
    chipBorder: "border-cat-seo-tools/30 hover:border-cat-seo-tools/55",
    Icon: TrendingUp,
  },
  education: {
    heroGradient: "from-cat-education/15",
    edgeAccent: "from-cat-education/70 via-cat-education/25 to-transparent",
    blurOrb: "bg-cat-education/15",
    headingBorder: "border-cat-education",
    chipBg: "bg-cat-education/10 hover:bg-cat-education/15",
    chipText: "text-cat-education",
    chipBorder: "border-cat-education/30 hover:border-cat-education/55",
    Icon: GraduationCap,
  },
};

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();

  const meta = isKnownSlug(slug) ? CATEGORY_META[slug] : null;
  const theme = meta ? CATEGORY_THEME[meta.slug] : null;

  // R192 (T2-2 — browse-quality parity with home's catalog bar): the
  // category landing now carries the sort select + the متوفر فقط chip
  // (home keeps the single search data-owner role — no search here).
  // Seed from the URL on mount (home's R98-04 reader, sort/availableOnly
  // legs — the whitelists live there) and mirror back below.
  const [initialFilters] = useState(readInitialFiltersFromUrl);
  const [sort, setSort] = useState(initialFilters.sort);
  const [availableOnly, setAvailableOnly] = useState(initialFilters.availableOnly);

  // available_only=false (the default) so the grid also shows out-of-stock
  // items — ProductCard's mute treatment + 'نفد المخزون' badge handle the
  // visual differentiation; an empty category page would be a soft-404.
  // R192: the explicit chip flips it to true server-side (the same param
  // home's toggle rides), and an explicit sort rides the backend's own
  // ordering.
  // Home's exact param shape (Record<string, string> — the generated
  // client's accepted form; available_only rides the string "true").
  const params: Record<string, string> = { fields: "list" };
  if (meta) params.category = meta.slug;
  if (sort) params.sort = sort;
  if (availableOnly) params.available_only = "true";
  const {
    data: products = [],
    isLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useListProducts(params, {
    query: {
      queryKey: getListProductsQueryKey(params),
      enabled: !!meta,
      // R115-I1 (A7 P3-3): keep the PREVIOUS category's grid as the
      // placeholder while a sibling category chip's query loads — the
      // same r97 F-16 fix home.tsx already has (its useListProducts at
      // home.tsx). Without it, every sibling-category navigation flashed
      // the 8-skeleton grid for one round-trip.
      placeholderData: keepPreviousData,
      staleTime: 3 * 60 * 1000,
    },
  });

  // R192 (T2-2): mirror the committed browse filters into the
  // querystring — home's R98-04 replaceState idiom (invisible to the
  // router; Back leaves the page, not the filter clicks).
  useEffect(() => {
    if (!meta) return;
    const qs = new URLSearchParams();
    if (sort) qs.set("sort", sort);
    if (availableOnly) qs.set("available_only", "true");
    const query = qs.toString();
    try {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    } catch {
      // Exotic embedding contexts — filters still work in-memory.
    }
  }, [meta, sort, availableOnly]);

  // ── Structured data ──────────────────────────────────────────────
  // R-140-g (JSON-LD completeness audit): the mature full set for a
  // category landing — BreadcrumbList (الرئيسية → الفئة) + FAQPage
  // (meta.faqs, the static per-category canon) + ItemList (the page's
  // own products via home.tsx's buildItemListLd twin, ≤30 entries).
  const breadcrumb = useMemo(() => {
    if (!meta) return null;
    return buildBreadcrumbLd(
      [
        { name: "الرئيسية", href: "/" },
        { name: meta.label, href: `/category/${meta.slug}` },
      ],
      `/category/${meta.slug}#breadcrumb`,
    );
  }, [meta]);

  const itemList = useMemo(() => {
    if (!meta || products.length === 0) return null;
    return buildItemListLd(
      products.slice(0, 30).map((p) => ({
        // Slug-based product URL. ProductListItem has carried slug
        // since the A2-F3 projection — no cast needed anymore.
        id: p.slug ?? p.id,
        name: p.name,
      })),
    );
  }, [meta, products]);

  const faq = useMemo(() => {
    if (!meta) return null;
    return buildFaqLd(meta.faqs);
  }, [meta]);

  // R122 (A11-F3): available products lead the default grid — home.tsx
  // got this re-order in R120-B1 (A3-F3/A4-F4) but the category landing
  // pages never did, so /category/streaming opened with a wall of نفد
  // cards (the live catalog ran 44/45 sold out at live-audit time —
  // the hero/filters funnel guests straight into these pages).
  // Presentation-only re-order of the already-loaded array; Array#sort
  // is stable, so within each group the backend's default order
  // (الأحدث) is preserved. The category page exposes no user-facing
  // sort, so there is no explicit ordering intent to respect here.
  // R192 (T2-2): home's exact rule — an explicit sort is the user's
  // ordering intent (the backend's own); the available-first re-sort
  // leads only the DEFAULT browse view (R122 A11-F3 keeps its contract:
  // /category/streaming opens with stock leading, نفد never walls the
  // page; Array#sort is stable so the backend order holds within groups).
  const displayProducts = useMemo(() => {
    if (sort) return products;
    return [...products].sort((a, b) => Number(b.is_available) - Number(a.is_available));
  }, [products, sort]);

  // R168: GA4 view_item_list — one impression per committed category
  // listing (the slug the landing page owns). Fires on the query's
  // data, so keepPreviousData's one-placeholder flash on sibling-chip
  // navigation is followed by the authoritative data-keyed fire.
  useEffect(() => {
    if (products.length === 0 || !meta) return;
    trackViewItemList(
      products.map((p) => productToItem(p)),
      meta.slug,
    );
  }, [products, meta]);

  // R147 (2-b): the availability truth line — the live catalog ran 44/45
  // sold out and a Google landing on /category/streaming met a wall of نفد
  // cards with zero orientation. Presentation-only count off the UNFILTERED
  // array (home.tsx's categoryHasStock truth rule) — the grid sorts, this
  // number must not.
  const inStockCount = useMemo(() => products.filter((p) => p.is_available).length, [products]);

  // R120-B3 (A7-F1 P1): CAPTURE the useSeo return — the block was called
  // without rendering it, so all 7 category landing pages shipped the
  // DEFAULT title/description and zero JSON-LD (Breadcrumb/FAQ/ItemList)
  // in the deployed bundle. Same pattern as home.tsx/product.tsx.
  const seoBlock = useSeo({
    title: meta ? meta.metaTitle : "صفحة غير موجودة — SubNation",
    description: meta ? meta.metaDescription : "الفئة المطلوبة غير موجودة.",
    type: "website",
    path: meta ? `/category/${meta.slug}` : "/category",
    locale: "ar",
    robots: meta ? "index,follow" : "noindex,follow",
    jsonLd:
      meta && breadcrumb && faq
        ? itemList
          ? [breadcrumb, faq, itemList]
          : [breadcrumb, faq]
        : undefined,
  });

  // ── Unknown-slug fallback (noindex, simple 404 surface) ─────────
  if (!meta || !theme) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-7 page-in text-center">
        {/* A7-F1: the noindex/not-found SEO block renders here too — the
            unknown-slug surface still needs its title + robots applied. */}
        {seoBlock}
        <h1 className="text-2xl font-bold mb-3">الفئة غير موجودة</h1>
        <p className="text-muted-foreground mb-6">
          الفئة المطلوبة غير معروفة. يمكنك تصفّح كل المنتجات من الصفحة الرئيسية.
        </p>
        <Link
          href="/"
          /* R177: the 44px recovery floor every sibling escape surface rides
             (not-found:121, ProductsGrid:200, ProductOutageCard:33 — each
             cites the tap-floor rule; this was the last bare text link). */
          className="inline-flex items-center gap-1.5 min-h-11 px-1 text-primary-text font-bold hover:text-primary-text transition-colors press-spring"
        >
          {/* RTL: "back" points right (unified icon-direction decision) —
              the chevron rotation is correct here; only the hover tint
              needed the text-safe token (R125-I7 / A7 B-2: raw
              hover:text-primary is 3.76:1 on the dark card). */}
          <ChevronLeft className="w-4 h-4 rotate-180" />
          العودة للرئيسية
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-5 sm:py-7 page-in">
      {seoBlock}
      {/* Breadcrumb (visible) */}
      <nav
        aria-label="مسار التنقّل"
        className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4"
      >
        {/* R126-L5 (A13-F10): the crumb link rides the 24px target floor
            (inline-flex min-h-6) — it measured 44×16 live, relying on the
            spacing exception; same idiom as the Footer's link band
            (R124-A4 #2). */}
        <Link
          href="/"
          className="inline-flex min-h-6 items-center hover:text-foreground transition-colors press-spring"
        >
          الرئيسية
        </Link>
        {/* R124 (A1-F6): the breadcrumb separator denotes traversal FORWARD
            (parent → current), so in RTL it points LEFT — the app's
            documented forward=left chevron rule. The stray rotate-180 made
            it the only backwards-pointing chevron on the page (the :238
            back-link rotation is the correct opposite case). */}
        <ChevronLeft className="w-3 h-3 opacity-50" />
        <span className="text-foreground font-bold">{meta.label}</span>
      </nav>

      {/* Hero — matches home page's hero-card pattern, tinted with the
          category's specific accent so /category/streaming feels violet,
          /category/music feels emerald, etc. */}
      {/* R139 (precision): the hero-card family's r138 atmosphere pair lands
          here — ambient-wash + hairline-glow (GuestHero/AuthedHero both ride
          the pair; this card's own "matches home page's hero-card pattern"
          contract). ONE atmosphere moment per page — this hero card is it;
          the cat-tinted gradient, 1px edge stripe and static blur orb stay
          the category's identity layers stacked on top. border-border/40 +
          shadow-lg STAY the hero-card family's own resting edge (both home
          heroes ride the exact pair) — deliberately NOT swept to the /60
          card-frame value, which would split this card from its twins. */}
      <header className="relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-6 shadow-lg float-in">
        <div className="absolute inset-0 ambient-wash pointer-events-none" />
        <div
          className={`absolute inset-0 bg-gradient-to-l ${theme.heroGradient} via-transparent to-transparent pointer-events-none`}
        />
        {/* R139 (precision): the pair's second half — the lit top edge
            (position/inset baked into the utility; rides under the cat-tint
            gradient, over the wash, exactly as AuthedHero stacks them). */}
        <div className="hairline-glow" />
        <div
          /* R125-I7 (A7 B-12 / R124-A3 #12): w-[2px] → w-px — the
              craft-floor cap for colored side stripes is 1px. */
          className={`absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b ${theme.edgeAccent}`}
        />
        <div
          className={`absolute top-[-30px] right-[10%] w-48 h-48 ${theme.blurOrb} rounded-full blur-3xl pointer-events-none`}
        />

        <div className="relative px-5 py-6 sm:px-7 sm:py-7">
          <div className="flex items-start gap-3 mb-3">
            <div
              className={`w-10 h-10 rounded-xl ${theme.chipBg} border ${theme.chipBorder} flex items-center justify-center shrink-0`}
            >
              <theme.Icon className={`w-5 h-5 ${theme.chipText}`} />
            </div>
            <div className="flex-1 min-w-0">
              {/* R140 (r139 debt closure — the eyebrow copy authorization
                  RESOLVED): the «فئة …» kicker that sat above this h1 is
                  DELETED. The r125 craft floor bans kickers/eyebrows over
                  headings ("let the h1 speak" — GuestHero deleted its
                  «ليبيا #1» pill row and AuthedHero its greeting eyebrow;
                  this was the family's last storefront remnant), and the
                  category was named THREE times inside ~200px: the
                  breadcrumb crumb, the eyebrow, and this keyword-rich h1
                  (every label — منصات المشاهدة، الموسيقى والصوتيات، …
                  — appears verbatim inside its own h1). The hero now reads icon
                  stage → h1 → intro, the flash-sales header family
                  shape. Zero SEO/aria impact: the h1 + metaTitle +
                  breadcrumb carry the page's identity contracts. */}
              {/* R139 (precision): text-fluid-2xl → text-fluid-3xl — the
                  storefront page-title scale (the PDP h1's r138-f move + the
                  home hero's h1). The landing's h1 is the page's anchor: it
                  must out-anchor everything below it (h2s ride text-base,
                  ProductCard titles text-sm) the same way the PDP title
                  out-anchors its own sections. */}
              <h1 className="text-fluid-3xl font-bold text-foreground">{meta.h1}</h1>
            </div>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
            {meta.intro}
          </p>
        </div>
      </header>

      {/* Products grid */}
      <section aria-labelledby="products-heading" className="mb-10">
        <h2
          id="products-heading"
          /* R125-I7 (A7 B-12 / R124-A3 #12): border-r-2 → border-r —
             1px is the craft-floor cap for colored heading stripes. */
          className={`text-base font-bold mb-3 flex items-center gap-2 border-r ${theme.headingBorder} pr-3`}
        >
          {/* R161-C: «اشتراكات {meta.label}» — reads naturally for every
              live category under the new vocabulary (اشتراكات منصات
              المشاهدة / اشتراكات الموسيقى والصوتيات / …) and matches the
              h1 family («اشتراكات … في ليبيا») better than the old
              «منتجات …» template. */}
          اشتراكات {meta.label}
          {!isLoading && products.length > 0 && (
            <span className="text-xs font-bold text-muted-foreground">({products.length})</span>
          )}
        </h2>
        {/* R147 (2-b): the honest availability line — success-dot idiom
            copied from CategoryRail; all-sold-out branch states the store's
            ongoing restock reality, never a dated promise. */}
        {!isLoading &&
          products.length > 0 &&
          (inStockCount > 0 ? (
            <p className="text-xs mb-3 flex items-center gap-1.5 text-status-success">
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-status-success" />
              متاح الآن للشراء الفوري: <span className="tabular-nums">{inStockCount}</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mb-3">
              كل منتجات هذه الفئة نفدت مؤقتاً — يتجدّد المخزون باستمرار
            </p>
          ))}
        {/* R192 (T2-2): the browse-quality controls — home's sort trio +
            its متوفر فقط chip, category-scoped (search stays home's). */}
        {!isLoading && products.length > 0 && (
          <BrowseControls
            sort={sort}
            onSortChange={setSort}
            availableOnly={availableOnly}
            onAvailableOnlyChange={setAvailableOnly}
          />
        )}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductCardShell key={i} />
            ))}
          </div>
        ) : productsError ? (
          /* Distinct from "no products": an outage previously rendered the
             empty-category state — misleading during API incidents.
             R125-I7 (A7 B-4): converged on the shared FetchErrorCard —
             this hand-rolled card was a 7th drifted site the component's
             own ledger never listed; the ~37px native retry rides the
             44px floor now (orders/flash-sales page-family idiom). */
          <FetchErrorCard
            size="page"
            className="py-12 float-in"
            title="تعذّر تحميل منتجات الفئة"
            description="حدث خطأ في الاتصال — أعد المحاولة"
            retryClassName="min-h-11 gap-2"
            onRetry={() => refetchProducts()}
          />
        ) : products.length === 0 ? (
          /* R139 (precision): border-border/55 → /60 — the resting card-frame
             family value (r138's ProductCard/FetchErrorCard/EmptyHero all
             rest at /60; /55 was the pre-r138 scatter every wave-mate
             retired). Icon-less minimal variant by DESIGN — EmptyState's own
             docblock lists category as a deliberate non-adoption, so this
             block stays hand-rolled; only the edge joins the family. */
          <div className="bg-card border border-border/60 rounded-2xl py-12 px-4 text-center float-in">
            <p className="font-bold mb-2 text-foreground/80">لا توجد منتجات في هذه الفئة حالياً.</p>
            {/* R116-S1 CTA recipe: the empty state's primary conversion
                action rides the canonical Button (was a bare text link). */}
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/">
                تصفّح كل المنتجات <ChevronLeft className="w-4 h-4 inline" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
            {displayProducts.map((product, i) => (
              <ProductCard key={product.id} product={product} index={i} itemListId={meta.slug} />
            ))}
          </div>
        )}
      </section>

      {/* FAQ accordion — the shared support-page pattern (R192 T2-3:
          one FaqAccordion component; this lane adds the float-in stagger),
          with the category's accent on the heading border so it threads
          through visually. */}
      <section aria-labelledby="faq-heading" className="max-w-3xl mb-8">
        <h2
          id="faq-heading"
          /* R125-I7 (A7 B-12 / R124-A3 #12): border-r-2 → border-r (same
             heading-stripe cap as the products heading above). */
          className={`text-base font-bold mb-3 flex items-center gap-2 border-r ${theme.headingBorder} pr-3`}
        >
          الأسئلة الشائعة
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          الأسئلة الأكثر شيوعاً عن اشتراكات {meta.label} — اضغط على أي سؤال لرؤية الإجابة.
        </p>
        <FaqAccordion items={meta.faqs} itemClassName="float-in" />
      </section>

      {/* Sibling-categories nav — each chip uses its OWN category accent
          so the user can see at a glance how the navigation maps to the
          themed surfaces. Mirrors the homepage chip styling. */}
      {/* R140 (r139 debt closure — the section-rule scatter): the page's
          top-level section boundary joins the ONE storefront hairline
          family /20. /20 over keeping /25: /20 is the
          FINAL_UX_SYSTEM-documented hairline (the receipt rhythm —
          divide-border/20), so no second value is invented; terms.tsx
          already rides it on non-money section rules; and hairline weight
          must not encode money-ness — the money register is weight +
          size + tabular-nums, never line weight. The app-chrome seams
          (Footer/Navbar /35 family) are a different register and stay. */}
      <section className="pt-6 border-t border-border/20">
        {/* 93-C8 (A11 §8 top-20 #8): letter-spacing disconnects
            Arabic letter joins (بـ/تـ/ثـ…) and `uppercase` is a no-op on
            Arabic — removed; font-bold at a small size keeps the label
            rhythm. */}
        <h2 className="text-2xs font-bold text-muted-foreground mb-3">تصفّح فئات أخرى</h2>
        <div className="flex flex-wrap gap-2">
          {Object.values(CATEGORY_META)
            .filter((c) => c.slug !== meta.slug)
            .map((c) => {
              const t = CATEGORY_THEME[c.slug];
              return (
                <Link
                  key={c.slug}
                  href={`/category/${c.slug}`}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-150 press-spring min-h-11 border ${t.chipBg} ${t.chipText} ${t.chipBorder}`}
                >
                  <t.Icon className="w-3.5 h-3.5" />
                  {c.label}
                </Link>
              );
            })}
          <button
            onClick={() => navigate("/")}
            /* R139 (precision): the neutral escape chip joins the calm-pill
               dialect's resting arm — bg-muted/30 + border-border/30 + the
               /70 border + /60 fill hover steps (the CatalogFiltersBar
               category-chip inactive state, byte-for-byte; was bg-card +
               border-border/50 + hover /80 + hover:bg-secondary/40 — the
               pre-dialect chip register). aria/handler byte-identical. */
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-150 press-spring min-h-11 border bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
          >
            كل المنتجات
          </button>
        </div>
      </section>
    </div>
  );
}

const KNOWN_SLUGS = new Set<string>(Object.keys(CATEGORY_META));

function isKnownSlug(s: string | undefined): s is CategoryMeta["slug"] {
  // Derived from CATEGORY_META so a new category entry in
  // lib/categories.ts lights up its landing page here automatically —
  // a hand-maintained literal list here once shadowed five live
  // categories behind a 404 surface (r100).
  return typeof s === "string" && KNOWN_SLUGS.has(s);
}

/**
 * R192 (T2-2): the category browse controls — home's CatalogFiltersBar
 * vocabulary scoped to this page: the shared ui/select sort control
 * (SlidersHorizontal affordance, the R138 quiet-nav overrides) + the
 * متوفر فقط chip (the exact calm-tint vocabulary both bars speak).
 * Search deliberately does NOT appear — home owns the single search
 * data source; the category's escape hatch is the sibling-chips row.
 */
function BrowseControls({
  sort,
  onSortChange,
  availableOnly,
  onAvailableOnlyChange,
}: {
  sort: string;
  onSortChange: (next: string) => void;
  availableOnly: boolean;
  onAvailableOnlyChange: (next: boolean) => void;
}) {
  // T1-3: the search affordance — a compact field that hands the query
  // to home's catalog (?search= is a first-class deep-link surface,
  // advertised by the WebSite SearchAction JSON-LD). Home stays the
  // single search data owner; this is navigation, not a second search.
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const submitSearch = () => {
    const q = query.trim();
    if (!q) return;
    navigate(`/?search=${encodeURIComponent(q)}`);
  };
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <div className="relative flex-1 min-w-[140px]">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch();
          }}
          aria-label="ابحث في كل المتجر"
          placeholder="ابحث في كل المتجر…"
          enterKeyHint="search"
          className="w-full h-11 ps-9 pe-3 rounded-xl bg-card border border-border/50 hover:border-border/70 focus:border-border/75 text-sm"
        />
      </div>
      <div className="relative shrink-0">
        <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Select
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          aria-label="ترتيب منتجات الفئة"
          title="ترتيب منتجات الفئة"
          className="ps-9 h-11 font-semibold border-border/50 hover:border-border/70"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <button
        onClick={() => onAvailableOnlyChange(!availableOnly)}
        aria-pressed={availableOnly}
        className={`flex items-center gap-1.5 px-3.5 py-1.5 min-h-11 shrink-0 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-150 press-spring ${
          availableOnly
            ? "bg-status-success/15 text-status-success border border-status-success/30 font-bold"
            : "bg-muted/30 border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
        }`}
      >
        <Package className="w-3.5 h-3.5" />
        متوفر فقط
      </button>
    </div>
  );
}
