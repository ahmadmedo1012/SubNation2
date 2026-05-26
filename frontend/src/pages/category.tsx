import { ProductCard } from "@/components/ProductCard";
import { useSeo } from "@/hooks/useSeo";
import { CATEGORY_META, type CategoryMeta } from "@/lib/categories";
import { buildBreadcrumbLd, buildFaqLd, buildItemListLd } from "@/lib/seo-builders";
import {
  getListProductsQueryKey,
  useListProducts,
  type Product,
} from "@workspace/api-client-react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams, useLocation } from "wouter";

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();

  // Validate slug against the known catalog. Unknown slugs render a 404
  // surface that's also marked noindex via the useSeo robots directive.
  const meta = isKnownSlug(slug) ? CATEGORY_META[slug] : null;

  // Fetch products in this category. available_only=false so the grid
  // also shows out-of-stock items (the ProductCard mute treatment + the
  // "نفد المخزون" badge handle the visual differentiation, and an empty
  // category page would be a soft-404).
  const params = meta ? { category: meta.slug } : {};
  const { data: products = [], isLoading } = useListProducts(params, {
    query: {
      queryKey: getListProductsQueryKey(params),
      enabled: !!meta,
      staleTime: 3 * 60 * 1000,
    },
  });

  // ── Breadcrumb + structured data ───────────────────────────────────
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
        // Pass slug as the id so buildItemListLd produces /product/<slug>
        // URLs (the canonical form). The orval-generated Product type
        // doesn't include `slug` yet — cast to widen.
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

  if (!meta) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-black mb-3">الفئة غير موجودة</h1>
        <p className="text-muted-foreground mb-6">
          الفئة المطلوبة غير معروفة. يمكنك تصفح كل المنتجات من الصفحة الرئيسية.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-primary font-bold"
        >
          <ChevronLeft className="w-4 h-4" />
          العودة للرئيسية
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 pb-12 pt-4 sm:pt-8">
      {/* Breadcrumb (visible) */}
      <nav
        aria-label="مسار التنقّل"
        className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4"
      >
        <Link href="/" className="hover:text-foreground transition-colors">
          الرئيسية
        </Link>
        <ChevronLeft className="w-3 h-3 rotate-180 opacity-50" />
        <span className="text-foreground font-bold">{meta.label}</span>
      </nav>

      {/* Hero — unique per-category h1 + intro */}
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-black mb-3 text-foreground leading-tight">
          {meta.h1}
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
          {meta.intro}
        </p>
      </header>

      {/* Products grid */}
      <section aria-labelledby="products-heading" className="mb-10">
        <h2 id="products-heading" className="sr-only">
          منتجات {meta.label}
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            جاري التحميل…
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="font-bold mb-2">لا توجد منتجات في هذه الفئة حالياً.</p>
            <Link href="/" className="text-primary text-sm font-bold">
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

      {/* FAQ accordion — unique per-category, surfaces same content as JSON-LD */}
      <section aria-labelledby="faq-heading" className="max-w-3xl">
        <h2 id="faq-heading" className="text-xl font-black mb-4">
          الأسئلة الشائعة
        </h2>
        <div className="space-y-2">
          {meta.faqs.map((faq, idx) => (
            <details
              key={idx}
              className="group bg-card border border-border/50 rounded-xl px-4 py-3 hover:border-border transition-colors"
            >
              <summary className="cursor-pointer font-bold text-sm text-foreground flex items-center justify-between gap-2 list-none">
                <span className="flex-1">{faq.question}</span>
                <ChevronLeft className="w-4 h-4 text-muted-foreground -rotate-90 group-open:rotate-90 transition-transform shrink-0" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* Internal linking back to home + sibling categories */}
      <section className="mt-10 pt-6 border-t border-border/40">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
          تصفّح فئات أخرى
        </h2>
        <div className="flex flex-wrap gap-2">
          {Object.values(CATEGORY_META)
            .filter((c) => c.slug !== meta.slug)
            .map((c) => (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 border border-border/50 rounded-full text-xs font-bold hover:bg-muted/60 hover:border-border transition-colors"
              >
                {c.label}
              </Link>
            ))}
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/25 text-primary rounded-full text-xs font-bold hover:bg-primary/15 transition-colors"
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
