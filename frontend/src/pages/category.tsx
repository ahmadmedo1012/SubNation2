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
  /** Chip border. */
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
    chipBorder: "border-cat-streaming/25 hover:border-cat-streaming/45",
    Icon: Tv2,
  },
  music: {
    heroGradient: "from-cat-music/15",
    edgeAccent: "from-cat-music/70 via-cat-music/25 to-transparent",
    blurOrb: "bg-cat-music/15",
    headingBorder: "border-cat-music",
    chipBg: "bg-cat-music/10 hover:bg-cat-music/15",
    chipText: "text-cat-music",
    chipBorder: "border-cat-music/25 hover:border-cat-music/45",
    Icon: Music2,
  },
  software: {
    heroGradient: "from-cat-software/15",
    edgeAccent: "from-cat-software/70 via-cat-software/25 to-transparent",
    blurOrb: "bg-cat-software/15",
    headingBorder: "border-cat-software",
    chipBg: "bg-cat-software/10 hover:bg-cat-software/15",
    chipText: "text-cat-software",
    chipBorder: "border-cat-software/25 hover:border-cat-software/45",
    Icon: AppWindow,
  },
  vpn: {
    heroGradient: "from-cat-vpn/15",
    edgeAccent: "from-cat-vpn/70 via-cat-vpn/25 to-transparent",
    blurOrb: "bg-cat-vpn/15",
    headingBorder: "border-cat-vpn",
    chipBg: "bg-cat-vpn/10 hover:bg-cat-vpn/15",
    chipText: "text-cat-vpn",
    chipBorder: "border-cat-vpn/25 hover:border-cat-vpn/45",
    Icon: ShieldCheck,
  },
  "ai-tools": {
    heroGradient: "from-cat-ai-tools/15",
    edgeAccent: "from-cat-ai-tools/70 via-cat-ai-tools/25 to-transparent",
    blurOrb: "bg-cat-ai-tools/15",
    headingBorder: "border-cat-ai-tools",
    chipBg: "bg-cat-ai-tools/10 hover:bg-cat-ai-tools/15",
    chipText: "text-cat-ai-tools",
    chipBorder: "border-cat-ai-tools/25 hover:border-cat-ai-tools/45",
    Icon: Sparkles,
  },
  "seo-tools": {
    heroGradient: "from-cat-seo-tools/15",
    edgeAccent: "from-cat-seo-tools/70 via-cat-seo-tools/25 to-transparent",
    blurOrb: "bg-cat-seo-tools/15",
    headingBorder: "border-cat-seo-tools",
    chipBg: "bg-cat-seo-tools/10 hover:bg-cat-seo-tools/15",
    chipText: "text-cat-seo-tools",
    chipBorder: "border-cat-seo-tools/25 hover:border-cat-seo-tools/45",
    Icon: TrendingUp,
  },
  education: {
    heroGradient: "from-cat-education/15",
    edgeAccent: "from-cat-education/70 via-cat-education/25 to-transparent",
    blurOrb: "bg-cat-education/15",
    headingBorder: "border-cat-education",
    chipBg: "bg-cat-education/10 hover:bg-cat-education/15",
    chipText: "text-cat-education",
    chipBorder: "border-cat-education/25 hover:border-cat-education/45",
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
      <header className="relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-6 shadow-lg float-in">
        <div
          className={`absolute inset-0 bg-gradient-to-l ${theme.heroGradient} via-transparent to-transparent pointer-events-none`}
        />
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
              <p className="text-xs text-muted-foreground font-semibold mb-1">فئة {meta.label}</p>
              <h1 className="text-fluid-2xl font-bold text-foreground">{meta.h1}</h1>
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
          <div className="bg-card border border-border/55 rounded-2xl py-12 px-4 text-center float-in">
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
              className="group bg-card border border-border/55 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none float-in"
            >
              <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-muted/15 transition-colors select-none">
                <span className="text-sm font-bold flex-1">{item.question}</span>
                <ChevronLeft className="w-4 h-4 text-muted-foreground transition-transform group-open:-rotate-90 shrink-0" />
              </summary>
              <div className="px-4 pt-1 pb-4 border-t border-border/40 text-sm text-muted-foreground leading-relaxed">
                {item.answer}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* Sibling-categories nav — each chip uses its OWN category accent
          so the user can see at a glance how the navigation maps to the
          themed surfaces. Mirrors the homepage chip styling. */}
      <section className="pt-6 border-t border-border/40">
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-180 press-spring min-h-11 border bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-secondary/40"
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
