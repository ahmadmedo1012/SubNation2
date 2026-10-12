import { Button } from "@/components/ui/button";
import { PRODUCT_COUNT_FORMS } from "@/components/admin/products/products-meta";
import { formatCount } from "@/lib/utils";
import { AlertTriangle, Plus } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the page header (the R120-B4 honest catalog counter — cap / search /
// true-total branches — the low-stock alert and the «منتج جديد» CTA).
// Presentational by contract: the counter inputs (catalogCapped, the
// loaded count, the settled search, lowStockCount) arrive as values and
// the CTA calls the page-owned openCreate handler. The move only changes
// its address; DOM, classes, aria and event semantics are byte-identical.

export function ProductsHeader({
  catalogCapped,
  productsCount,
  searchTerm,
  lowStockCount,
  onCreate,
}: {
  /** R120-B4: a full cap page = the total is NOT provably known. */
  catalogCapped: boolean;
  /** The loaded row count (products.length) — the counter's numeral. */
  productsCount: number;
  /** The settled (debounced) server-side search — truthy = results mode. */
  searchTerm: string;
  lowStockCount: number;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold mb-0.5">المنتجات</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {/* R120-B4 (A2-F2): honest count (the orders idiom). The old
              «{products.length} منتج في الكتالوج» presented the capped
              200-row window as the whole catalog. A full cap page →
              «عرض N (الأحدث أولاً)»; a search → «نتائج البحث: N» (the
              result set IS complete when shorter than the cap);
              otherwise the catalog genuinely fits and the total is
              true. */}
          <span>
            {catalogCapped
              ? `عرض ${formatCount(productsCount, PRODUCT_COUNT_FORMS)} (الأحدث أولاً)`
              : searchTerm.trim()
                ? `نتائج البحث: ${formatCount(productsCount, PRODUCT_COUNT_FORMS)}`
                : `${formatCount(productsCount, PRODUCT_COUNT_FORMS)} في الكتالوج`}
          </span>
          {lowStockCount > 0 && (
            <>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
              {/* 93-C7 / C-UX5 (A11 §1 «{n} نفد مخزونه»): the count
                  before the verb broke the Arabic construction. */}
              <span className="flex items-center gap-1 text-status-low-stock font-bold">
                <AlertTriangle className="w-3 h-3" />
                نفد مخزون {lowStockCount} منتج
              </span>
            </>
          )}
        </div>
      </div>
      <Button
        onClick={onCreate}
        className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 h-9 active:scale-[0.97] transition-transform"
      >
        <Plus className="w-4 h-4 ml-1.5" /> منتج جديد
      </Button>
    </div>
  );
}
