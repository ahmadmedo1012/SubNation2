import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { EmptyState } from "@/components/admin/EmptyState";
import { ProductCard } from "@/components/admin/products/ProductCard";
import { NETWORK_ERROR_DESCRIPTION } from "@/lib/errors";
import type { AdminProduct } from "@workspace/api-client-react";
import { Package, RefreshCw, WifiOff } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the grid region (the 94-C2 stale-data error banner, the 6-card skeleton
// row, the full-page FetchErrorCard vs the EmptyState branch, and the
// 200-card map itself). Presentational by contract: the page owns the
// query (loading/error/refetch), the filtered array, selectedIds and
// editingStockId — everything flows down as values + the seven card
// callbacks (pass-through props keep the R124-I5 memoization intact: no
// inline arrows are minted here). The move only changes its address;
// DOM, classes, aria and event semantics are byte-identical.

export function ProductsGrid({
  isLoading,
  isError,
  loadedCount,
  loadErrorMessage,
  onRetry,
  filtered,
  selectedIds,
  editingStockId,
  onToggleSelect,
  onEdit,
  onEditStock,
  onStockEditDone,
  onUploadInventory,
  onManageVariants,
  onArchive,
}: {
  isLoading: boolean;
  isError: boolean;
  /** products.length — distinguishes the stale-data banner from the
   * full-page error card (94-C2). */
  loadedCount: number;
  loadErrorMessage: string | null;
  onRetry: () => void;
  filtered: AdminProduct[];
  selectedIds: Set<number>;
  editingStockId: number | null;
  onToggleSelect: (id: number) => void;
  onEdit: (product: AdminProduct) => void;
  onEditStock: (id: number) => void;
  onStockEditDone: () => void;
  onUploadInventory: (product: AdminProduct) => void;
  onManageVariants: (product: AdminProduct) => void;
  onArchive: (product: AdminProduct) => void;
}) {
  return (
    <>
      {/* 94-C2 (A2 P1-2): refresh of an already-rendered catalog
          failed — keep the stale cards, surface the failure inline
          (referrals.tsx banner idiom). */}
      {isError && loadedCount > 0 && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
        >
          <WifiOff className="w-4 h-4 shrink-0" />
          <span className="min-w-0">{loadErrorMessage ?? "تعذّر تحديث قائمة المنتجات"}</span>
          <button
            type="button"
            onClick={onRetry}
            className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-card border border-border/60 rounded-2xl h-40 skeleton-shimmer"
            />
          ))}
        </div>
      ) : isError && loadedCount === 0 ? (
        /* 94-C2 (A2 P1-2): a failed load is NOT an empty catalog — the
           referrals.tsx error-card idiom (an outage/expired session
           previously masqueraded as "لا توجد منتجات"). */
        <FetchErrorCard
          size="page"
          retryIcon={RefreshCw}
          title="تعذّر تحميل المنتجات"
          description={loadErrorMessage ?? NETWORK_ERROR_DESCRIPTION}
          onRetry={onRetry}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Package} title="لا توجد منتجات" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              isSelected={selectedIds.has(product.id)}
              isEditingStock={editingStockId === product.id}
              onToggleSelect={onToggleSelect}
              onEdit={onEdit}
              /* setState dispatchers + the useCallbacks above are all
                 referentially stable — no inline arrows here, or every
                 keystroke would bust all 200 memoized cards. */
              onEditStock={onEditStock}
              onStockEditDone={onStockEditDone}
              onUploadInventory={onUploadInventory}
              onManageVariants={onManageVariants}
              onArchive={onArchive}
            />
          ))}
        </div>
      )}
    </>
  );
}
