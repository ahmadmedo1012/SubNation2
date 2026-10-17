import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VARIANT_COUNT_FORMS } from "@/components/admin/product-variants/variants-meta";
import { formatCount } from "@/lib/utils";

// R137 (FE, closing decomposition): extracted verbatim from
// components/admin/ProductVariantsDialog.tsx — the toolbar strip (the
// count + active count + display-price rule + the add entry point).
// Presentational by contract: the variants query, the mutations and the
// dialog-owned busy flag stay in the dialog core; values + the startAdd
// callback flow down. The two duplicated formatCount literals converged
// on the meta module's VARIANT_COUNT_FORMS (the products/topups
// COUNT_FORMS idiom); DOM, classes and Arabic copy are byte-identical.
export function VariantsToolbar({
  total,
  activeCount,
  busy,
  startAdd,
}: {
  total: number;
  activeCount: number;
  busy: boolean;
  startAdd: () => void;
}) {
  return (
    // Toolbar: counts + add entry point
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
        <span className="shrink-0">{formatCount(total, VARIANT_COUNT_FORMS)}</span>
        <span className="w-1 h-1 rounded-full bg-muted-foreground/30" aria-hidden="true" />
        <span className="shrink-0">{activeCount} نشطة</span>
        <span className="w-1 h-1 rounded-full bg-muted-foreground/30" aria-hidden="true" />
        {/* Display-price rule so the operator understands why the
            product card price moves after variant edits. */}
        <span className="truncate">سعر عرض المنتج = أرخص باقة نشطة</span>
      </div>
      <Button
        size="sm"
        onClick={startAdd}
        disabled={busy}
        /* R158 (admin polish): the flat bg-primary/hover-darken/
           active:scale overrides retire — buttonVariants owns the
           canonical fill (gradient + shadow + press-spring); the
           h-8 text-xs sizing is kept (the toolbar's compact rhythm). */
        className="h-8 text-xs"
      >
        <Plus className="w-3.5 h-3.5 me-1" /> إضافة باقة
      </Button>
    </div>
  );
}
