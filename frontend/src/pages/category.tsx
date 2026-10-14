import { ProductCard } from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { ProductCardShell } from "@/components/ui/route-skeleton";
import { useSeo } from "@/hooks/useSeo";
import { CATEGORY_META, type CategoryMeta } from "@/lib/categories";
import { buildBreadcrumbLd, buildFaqLd, buildItemListLd } from "@/lib/seo-builders";
import { getListProductsQueryKey, useListProducts } from "@workspace/api-client-react";
import {
  AppWindow,
  ChevronLeft,
  GraduationCap,
  Music2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Tv2,
} from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo, type ComponentType } from "react";
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

  // available_only=false so the grid also shows out-of-stock items.
  // ProductCard's mute treatment + 'نفد المخزون' badge handle the
  // visual differentiation; an empty category page would be a soft-404.
  const params = { ...(meta ? { category: meta.slug } : {}), fields: "list" as const };
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

  // ── Structured data ──────────────────────────────────────────────
  // R-140-g (JSON-LD completeness audit): the mature full set for a
  // category landing — BreadcrumbList (الرئيسية → الفئة) + FAQPage
  // (meta.faqs, the static per-category canon) + ItemList (the page's
  // own products via home.tsx's buildItemListLd twin, ≤30 entries).
  const breadcrumb = useMemo(() => {
    if (!meta) return null;
    return buildBreadcrumbLd([
      { name: "الرئيسية", href: "/" },
      { name: meta.label, href: `/category/${meta.slug}` },
    ]);
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
  const displayProducts = useMemo(
    () => [...products].sort((a, b) => Number(b.is_available) - Number(a.is_available)),
    [products],
  );

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
          className="inline-flex items-center gap-1.5 text-primary-text font-bold hover:text-primary-text transition-colors press-spring"
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
                  (every label — البث المباشر، الموسيقى، … — appears
                  verbatim inside its own h1). The hero now reads icon
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
          منتجات {meta.label}
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
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
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
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {displayProducts.map((product, i) => (
              <ProductCard key={product.id} product={product} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* FAQ accordion — exact support-page pattern, with the category's
          accent on the heading border so it threads through visually. */}
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
        <div className="space-y-2">
          {meta.faqs.map((item, i) => (
            <details
              key={i}
              /* R139 (precision): border-border/55 → /60 — the resting
                 card-frame family value (the /55 scatter r139 retired
                 lane-wide). The support lane's FaqSection twin still rides
                 /55 — the support lane owns that convergence; the family
                 value wins here first. Summary hover:bg-muted/15 stays
                 byte-identical to that twin (a matched pair). */
              className="group bg-card border border-border/60 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none float-in"
            >
              <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-muted/15 transition-colors select-none">
                <span className="text-sm font-bold flex-1">{item.question}</span>
                <ChevronLeft className="w-4 h-4 text-muted-foreground transition-transform group-open:-rotate-90 shrink-0" />
              </summary>
              {/* R140 (r139 debt closure — the section-rule scatter): the
                  answer divider joins the ONE storefront hairline family
                  value /20 — the money-path receipt-grade precedent
                  (divide-border/20 on every statement row; terms.tsx's
                  two section rules already ride /20). /40 was the
                  pre-r140 scatter r139-k flagged. FLAGGED for the
                  orchestrator: the support lane's FaqSection twin
                  (components/support/FaqSection.tsx:37) still rides /40 —
                  both twins must land on /20 to stay a matched pair. */}
              <div className="px-4 pt-1 pb-4 border-t border-border/20 text-sm text-muted-foreground leading-relaxed">
                {item.answer}
              </div>
            </details>
          ))}
        </div>
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
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-180 press-spring min-h-11 border ${t.chipBg} ${t.chipText} ${t.chipBorder}`}
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-180 press-spring min-h-11 border bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
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
