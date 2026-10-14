import { ArrowRight, ChevronLeft } from "lucide-react";
import { categoryMetaFor } from "@/components/product/category-presentation";
import { Link } from "wouter";
import type { Product } from "@workspace/api-client-react";

// R137 (closing decomposition): extracted verbatim from pages/product.tsx —
// the visible breadcrumb row (R124 / A1-F5) plus the catalog back link that
// follows it. The categoryMetaFor lookups ride inside (pure presentation
// over the product value); the page owns navigation and passes it down as
// one onNavigate callback (the only substitution: navigate → onNavigate).
// DOM, classes, Arabic copy and the RTL chevron comments are byte-identical.
export function ProductBreadcrumbNav({
  product,
  onNavigate,
}: {
  product: Product;
  onNavigate: (to: string) => void;
}) {
  return (
    <>
      {/* ── Visible breadcrumb (R124 / A1-F5) ─────────────────────────────
          Mirrors category.tsx's breadcrumb row (same nav label, classes,
          chevron idiom). Before this, the breadcrumb existed only as
          JSON-LD — invisible to shoppers — and the product's category
          badge on the hero was not a link, so a shopper who arrived via
          Home → /category/<x> → product had no way back to the category
          they were browsing. The middle segment links to the category
          landing page only when one exists (KNOWN_CATEGORIES). */}
      <nav
        aria-label="مسار التنقّل"
        /* R145 (D9): text-muted-foreground → text-foreground/70 — one
           contrast step up for the breadcrumb row. The live VLM audit
           read the parent segments («الرئيسية / الفئة») as too light at
           the old 68%-lightness muted ink; /70 composites ≈8:1 dark /
           ≈6:1 light over the page surface — both clear the 4.5:1 AA
           bar at 12px with margin. The links inherit the row color at
           rest and keep their hover:text-foreground lift; the current
           crumb stays text-foreground + font-bold — the hierarchy
           (current > parents > separators) reads one step louder
           without shouting. */
        className="flex items-center gap-1.5 text-xs text-foreground/70 mb-2 min-w-0"
      >
        <Link href="/" className="hover:text-foreground transition-colors press-spring shrink-0">
          الرئيسية
        </Link>
        {categoryMetaFor(product.category) && (
          <>
            {/* R124 (A1-F6): the separator denotes traversal FORWARD
                (parent → current), so in RTL it points LEFT — the app's
                unified forward=left chevron rule. (category.tsx's own
                separator had a stray rotate-180 making it the lone
                backwards exception — fixed in the same round.) */}
            <ChevronLeft className="w-3 h-3 opacity-50 shrink-0" aria-hidden="true" />
            <Link
              href={`/category/${product.category}`}
              className="hover:text-foreground transition-colors press-spring shrink-0"
            >
              {categoryMetaFor(product.category)!.label}
            </Link>
          </>
        )}
        <ChevronLeft className="w-3 h-3 opacity-50 shrink-0" aria-hidden="true" />
        {/* R143 (L3-2): dir="auto" + text-right — the ProductCard F-1
            recipe on the "you are here" segment: pure-Latin product
            names truncate from the wrong end in an RTL block (the
            ellipsis eats the brand head); text-right re-anchors the
            visual edge. Arabic names resolve rtl — zero change. */}
        <span
          dir="auto"
          className="text-foreground font-bold truncate text-right"
          aria-current="page"
        >
          {product.name}
        </span>
      </nav>

      {/* Back link */}
      {/* A3-F4 (R120-B2): min-h-11 — the 20px-tall text link measured
          112×20 live; the catalog escape hatch now clears the 44px touch
          floor (flex items-center centers the label inside the taller
          box).

          R124 (A1-F5): the escape hatch returns to the product's own
          CATEGORY when one exists (where the shopper most likely came
          from — previously it always dumped them on home); home stays one
          breadcrumb hop away, and unknown/retired categories keep the
          home fallback. The label names its destination honestly. */}
      <button
        onClick={() =>
          onNavigate(categoryMetaFor(product.category) ? `/category/${product.category}` : "/")
        }
        className="min-h-11 flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-4 transition-colors press-spring group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
        {categoryMetaFor(product.category)
          ? `العودة إلى ${categoryMetaFor(product.category)!.label}`
          : "العودة للكتالوج"}
      </button>
    </>
  );
}
