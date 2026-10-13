import { ProductCard } from "@/components/ProductCard";
import { ProductSkeleton } from "@/components/home/primitives";
import { CATEGORIES, SORTS } from "@/components/home/catalog-filters";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { categoryLabel, formatCount } from "@/lib/utils";
import type { ProductListItem } from "@workspace/api-client-react";
import { PackageSearch } from "lucide-react";
import { Link } from "wouter";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the catalog results section: the count header + مسح (n) affordance,
// the filter-aware h2 (A9-m2 dir="auto"), and the loading / error /
// empty / grid quad. The page owns the useListProducts query, the
// displayProducts/categoryHasStock memos and clearFilters; this extract
// takes their values + callbacks as props. DOM, classes and aria are
// byte-identical.

export function ProductsGrid({
  isLoading,
  productsError,
  products,
  displayProducts,
  activeFilterCount,
  searchInput,
  category,
  sort,
  availableOnly,
  clearFilters,
  refetchProducts,
}: {
  isLoading: boolean;
  productsError: boolean;
  products: ProductListItem[];
  displayProducts: ProductListItem[];
  activeFilterCount: number;
  searchInput: string;
  category: string;
  sort: string;
  availableOnly: boolean;
  clearFilters: () => void;
  refetchProducts: () => void;
}) {
  return (
    <>
      {/* Result header */}
      {!isLoading && (products.length > 0 || activeFilterCount > 0) && (
        <div className="flex items-center justify-between mb-2.5 sm:mb-3.5">
          <p className="text-sm text-muted-foreground">
            {/* 93-C8 (A11 §3): formatCount carries the Arabic plural
                paradigm — «منتجان / منتجات / منتجاً» — instead of a
                bare singular after any count. */}
            <span className="font-bold text-foreground">
              {formatCount(products.length, {
                two: "منتجان",
                few: "منتجات",
                many: "منتجاً",
                other: "منتج",
              })}
            </span>
            {category && <span className="text-muted-foreground"> في هذه الفئة</span>}
          </p>
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-primary-text transition-colors px-3 py-2.5 min-h-11 rounded-lg hover:bg-primary/8 press-spring font-semibold"
            >
              مسح ({activeFilterCount})
            </button>
          )}
        </div>
      )}

      {/* ── Products Grid ─────────────────────────────────── */}
      {/*
        h2 above the product grid. Text reflects the active filter
        so the heading is informative rather than decorative:
          - search active → "نتائج البحث"
          - category selected → category Arabic label
          - sort changed → sort label
          - default → "كل الاشتراكات"
        When idle (no filter active) the heading is sr-only to
        preserve the current visual; with a filter, it becomes
        visible as a small section title.
        R134 (A2-F6): the default no longer claims availability —
        the default grid lists ALL products (the R120-B1 re-order
        fronts the available ones but still renders the نفد cards
        below), so «الاشتراكات المتاحة» was a promise the grid
        doesn't keep for SR users and crawlers reading the h2.
      */}
      {(() => {
        const hasFilter = !!(searchInput || category || sort || availableOnly);
        let label = "كل الاشتراكات";
        if (searchInput) label = `نتائج البحث: ${searchInput}`;
        else if (category) label = categoryLabel(category);
        else if (sort) label = SORTS.find((s) => s.value === sort)?.label ?? label;
        else if (availableOnly) label = "المنتجات المتوفّرة فقط";
        // A9-m2 (R127-B13): dir="auto" on both variants — the label
        // interpolates the raw searchInput, and a Latin-digit or
        // bidi-confusable query garbled the heading's direction.
        return hasFilter ? (
          <h2
            dir="auto"
            className="text-sm font-bold text-muted-foreground mb-3 flex items-center gap-2"
          >
            <span className="w-1 h-4 bg-primary rounded-full" />
            {label}
          </h2>
        ) : (
          <h2 dir="auto" className="sr-only">
            {label}
          </h2>
        );
      })()}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductSkeleton key={i} />
          ))}
        </div>
      ) : productsError ? (
        /* Distinct from "no results": a failed products API previously
           rendered the empty-search state — an outage read as "no products
           match your search", which is actively misleading.
           R125-I7 (A7 B-4): converged on the shared FetchErrorCard (the
           orders/flash-sales page-family idiom) — deletes the hand-rolled
           card and lifts its ~37px native retry onto the 44px floor. */
        <FetchErrorCard
          size="page"
          className="py-16 float-in"
          title="تعذّر تحميل المنتجات"
          description="حدث خطأ في الاتصال بالخدمة — تحقّق من شبكتك ثم أعد المحاولة"
          retryClassName="min-h-11 gap-2"
          onRetry={() => refetchProducts()}
        />
      ) : products.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-card border border-border/40 rounded-2xl float-in shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 mx-auto mb-4 flex items-center justify-center">
            <PackageSearch className="w-6 h-6 opacity-35" />
          </div>
          {/* R123-E4b (P3-b): the empty grid used to assume a
              filter/search was active («تطابق بحثك» + «غيّر الفلتر»)
              even when activeFilterCount === 0 — i.e. when the CATALOG
              itself is momentarily empty (a sold-out catalog is a
              business state; the empty state must describe it honestly
              instead of telling the shopper to fix a search they never
              made). Also «جرّب» with shadda. */}
          {activeFilterCount > 0 ? (
            <>
              {/* I-5 (R142): an empty grid under «المتوفّر فقط» is NOT
                  «no match» — with 44/45 live products نفد, matches
                  exist but are sold out. The available-only variant says
                  so and names the one-click recovery (clearing the
                  filter); the mixed-filter case still gets the honest
                  maybe-sold-out hint alongside the generic retry line. */}
              <p className="font-bold text-base mb-1.5">
                {availableOnly && activeFilterCount === 1
                  ? "كل المنتجات المطابقة نفد المخزون حالياً"
                  : "لا توجد منتجات تطابق بحثك"}
              </p>
              <p className="text-sm text-muted-foreground mb-5">
                {availableOnly
                  ? "قد تكون هناك نتائج مطابقة لكنها نفدت — جرّب إلغاء فلتر «المتوفّر فقط» لعرضها"
                  : "جرّب تغيير الفلتر أو كلمة البحث"}
              </p>
            </>
          ) : (
            <>
              <p className="font-bold text-base mb-1.5">لا توجد منتجات معروضة حالياً</p>
              <p className="text-sm text-muted-foreground mb-5">
                يُحدَّث الكتالوج باستمرار — تفضّل بزيارتنا لاحقاً
              </p>
            </>
          )}
          {activeFilterCount > 0 && (
            /* B13 F-2 (R127): the filtered-empty recovery CTA measured
               ~38px (text-sm + py-2 + border) — same 44px-floor lift as
               its FetchErrorCard sibling (:1187 min-h-11); standalone
               CTA inside the py-16 empty state, so no negative-margin
               compensation is needed. */
            <button
              onClick={clearFilters}
              className="text-sm font-bold text-primary-text border border-primary/25 px-5 min-h-11 rounded-xl hover:bg-primary/8 transition-colors press-spring"
            >
              مسح جميع الفلاتر
            </button>
          )}
          {/* R132 (meaningful zero-results): a search dead-end now
              offers the real catalog's category landing pages as
              escape routes — the customer typed something we don't
              carry; the honest recovery is showing what we DO carry
              (the same 7 live categories the chips filter by, here as
              Links to their landing pages — the category.tsx idiom). */}
          {searchInput.trim() && (
            <div className="mt-6">
              <p className="text-xs text-muted-foreground mb-2.5">أو تصفّح الأقسام:</p>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {CATEGORIES.filter((c) => c.value).map((c) => (
                  <Link
                    key={c.value}
                    href={`/category/${c.value}`}
                    className="inline-flex items-center gap-1 px-3 min-h-11 text-xs font-bold rounded-full bg-muted/40 border border-border/40 text-muted-foreground hover:text-foreground hover:border-border/70 transition-colors press-spring"
                  >
                    <c.Icon className="w-3 h-3" aria-hidden="true" />
                    {c.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {displayProducts.map((product, i) => (
            <div key={product.id} className={i >= 4 ? "cv-card" : undefined}>
              <ProductCard
                product={
                  product as {
                    id: number;
                    slug?: string | null;
                    name: string;
                    description?: string | null;
                    image_url?: string | null;
                    price: number;
                    category?: string | null;
                    is_available: boolean;
                    stock_count: number;
                    sale_price?: number | null;
                  }
                }
                index={i}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
