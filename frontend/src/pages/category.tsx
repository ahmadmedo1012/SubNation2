import { ProductCard } from "@/components/ProductCard";
import { useSeo } from "@/hooks/useSeo";
import { CATEGORY_META, type CategoryMeta } from "@/lib/categories";
import { buildBreadcrumbLd, buildFaqLd, buildItemListLd } from "@/lib/seo-builders";
import {
  getListProductsQueryKey,
  useListProducts,
  type Product,
} from "@workspace/api-client-react";
import { Briefcase, ChevronLeft, Gamepad2, Loader2, Music2, Tv2 } from "lucide-react";
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
// Tailwind needs the full class strings to be present in the source
// for its content scan to keep them in the bundle — that's why these
// are spelled out as static strings instead of computed.

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
    heroGradient: "from-violet-500/15",
    edgeAccent: "from-violet-400/70 via-violet-400/25 to-transparent",
    blurOrb: "bg-violet-500/15",
    headingBorder: "border-violet-400",
    chipBg: "bg-violet-500/10 hover:bg-violet-500/15",
    chipText: "text-violet-300",
    chipBorder: "border-violet-500/25 hover:border-violet-400/45",
    Icon: Tv2,
  },
  music: {
    heroGradient: "from-emerald-500/15",
    edgeAccent: "from-emerald-400/70 via-emerald-400/25 to-transparent",
    blurOrb: "bg-emerald-500/15",
    headingBorder: "border-emerald-400",
    chipBg: "bg-emerald-500/10 hover:bg-emerald-500/15",
    chipText: "text-emerald-300",
    chipBorder: "border-emerald-500/25 hover:border-emerald-400/45",
    Icon: Music2,
  },
  gaming: {
    heroGradient: "from-blue-500/15",
    edgeAccent: "from-blue-400/70 via-blue-400/25 to-transparent",
    blurOrb: "bg-blue-500/15",
    headingBorder: "border-blue-400",
    chipBg: "bg-blue-500/10 hover:bg-blue-500/15",
    chipText: "text-blue-300",
    chipBorder: "border-blue-500/25 hover:border-blue-400/45",
    Icon: Gamepad2,
  },
  productivity: {
    heroGradient: "from-amber-500/15",
    edgeAccent: "from-amber-400/70 via-amber-400/25 to-transparent",
    blurOrb: "bg-amber-500/15",
    headingBorder: "border-amber-400",
    chipBg: "bg-amber-500/10 hover:bg-amber-500/15",
    chipText: "text-amber-300",
    chipBorder: "border-amber-500/25 hover:border-amber-400/45",
    Icon: Briefcase,
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
  const params = meta ? { category: meta.slug } : {};
  const { data: products = [], isLoading } = useListProducts(params, {
    query: {
      queryKey: getListProductsQueryKey(params),
      enabled: !!meta,
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
        // Slug-based product URL. The orval Product type doesn't yet
        // include slug; widen the cast to read it safely.
        id:
          (p as Product & { slug?: string | null }).slug ?? p.id,
        name: p.name,
      })),
    );
  }, [meta, products]);

  const faq = useMemo(() => {
    if (!meta) return null;
    return buildFaqLd(meta.faqs);
  }, [meta]);

  useSeo({
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
        <h1 className="text-2xl font-black mb-3">الفئة غير موجودة</h1>
        <p className="text-muted-foreground mb-6">
          الفئة المطلوبة غير معروفة. يمكنك تصفّح كل المنتجات من الصفحة الرئيسية.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-primary-text font-bold hover:text-primary transition-colors press-spring"
        >
          <ChevronLeft className="w-4 h-4" />
          العودة للرئيسية
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-5 sm:py-7 page-in">
      {/* Breadcrumb (visible) */}
      <nav
        aria-label="مسار التنقّل"
        className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4"
      >
        <Link href="/" className="hover:text-foreground transition-colors press-spring">
          الرئيسية
        </Link>
        <ChevronLeft className="w-3 h-3 rotate-180 opacity-50" />
        <span className="text-foreground font-bold">{meta.label}</span>
      </nav>

      {/* Hero — matches home page's hero-card pattern, tinted with the
          category's specific accent so /category/streaming feels violet,
          /category/music feels emerald, etc. */}
      <header className="relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-6 shadow-lg shadow-black/15 float-in">
        <div
          className={`absolute inset-0 bg-gradient-to-l ${theme.heroGradient} via-transparent to-transparent pointer-events-none`}
        />
        <div
          className={`absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b ${theme.edgeAccent}`}
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
              <p className="text-xs text-muted-foreground font-medium mb-1">
                فئة {meta.label}
              </p>
              <h1 className="text-fluid-2xl font-black leading-tight text-foreground">
                {meta.h1}
              </h1>
            </div>
          </div>
          <p className="text-sm sm:text-[15px] text-muted-foreground leading-relaxed max-w-3xl">
            {meta.intro}
          </p>
        </div>
      </header>

      {/* Products grid */}
      <section aria-labelledby="products-heading" className="mb-10">
        <h2
          id="products-heading"
          className={`text-base font-black mb-3 flex items-center gap-2 border-r-2 ${theme.headingBorder} pr-3`}
        >
          منتجات {meta.label}
          {!isLoading && products.length > 0 && (
            <span className="text-xs font-bold text-muted-foreground">
              ({products.length})
            </span>
          )}
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">جاري التحميل…</span>
          </div>
        ) : products.length === 0 ? (
          <div className="bg-card border border-border/55 rounded-2xl py-12 text-center float-in">
            <p className="font-bold mb-2 text-foreground/80">
              لا توجد منتجات في هذه الفئة حالياً.
            </p>
            <Link
              href="/"
              className="text-primary-text text-sm font-bold hover:text-primary transition-colors press-spring"
            >
              تصفّح كل المنتجات →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {products.map((product, i) => (
              <ProductCard
                key={product.id}
                product={product as Product}
                index={i}
              />
            ))}
          </div>
        )}
      </section>

      {/* FAQ accordion — exact support-page pattern, with the category's
          accent on the heading border so it threads through visually. */}
      <section aria-labelledby="faq-heading" className="max-w-3xl mb-8">
        <h2
          id="faq-heading"
          className={`text-base font-black mb-3 flex items-center gap-2 border-r-2 ${theme.headingBorder} pr-3`}
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
        <h2 className="text-[11px] font-black text-muted-foreground uppercase tracking-widest mb-3">
          تصفّح فئات أخرى
        </h2>
        <div className="flex flex-wrap gap-2">
          {Object.values(CATEGORY_META)
            .filter((c) => c.slug !== meta.slug)
            .map((c) => {
              const t = CATEGORY_THEME[c.slug];
              return (
                <Link
                  key={c.slug}
                  href={`/category/${c.slug}`}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-180 press-spring min-h-[38px] border ${t.chipBg} ${t.chipText} ${t.chipBorder}`}
                >
                  <t.Icon className="w-3.5 h-3.5" />
                  {c.label}
                </Link>
              );
            })}
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-180 press-spring min-h-[38px] border bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-secondary/40"
          >
            كل المنتجات
          </button>
        </div>
      </section>
    </div>
  );
}

function isKnownSlug(s: string | undefined): s is CategoryMeta["slug"] {
  return s === "streaming" || s === "music" || s === "gaming" || s === "productivity";
}
