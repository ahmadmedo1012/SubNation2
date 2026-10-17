import { AlertTriangle, Edit2, Eye, EyeOff, Layers, Plus, Trash2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtUsd, variantTitle } from "@/components/admin/product-variants/variants-meta";
// R158 (admin polish): the loading branch joins the shared
// TableSkeleton the risk/coupons/users tables ride — this was the
// console's last hand-rolled centered-spinner list loader (a swap the
// R136 UX-1 sweep skipped: the old block carried no role="status"
// pair, so the loading→loaded transition was silent to AT).
import { TableSkeleton } from "@/components/admin/TableSkeleton";
import { formatCount, formatCurrency } from "@/lib/utils";
import type { AdminProductVariant } from "@workspace/api-client-react";

// R137 (FE, closing decomposition): extracted verbatim from
// components/admin/ProductVariantsDialog.tsx — the variant rows surface
// (loading skeleton / load-error card with retry / empty state with the
// first-add CTA / the sticky-glass drift table with per-row
// edit/toggle/delete actions). Presentational by contract: the variants
// query, the three mutations and the confirm-gated delete stay in the
// dialog core; values + callbacks flow down with their dialog-side names
// (refetchVariants/startAdd/startEdit/toggleActive/removeVariant) so the
// moved JSX is byte-identical. Zero hooks live here — the per-row drift
// derivation rides row-local exactly as before.
export function VariantRows({
  variants,
  variantsLoading,
  variantsError,
  busy,
  refetchVariants,
  startAdd,
  startEdit,
  toggleActive,
  removeVariant,
}: {
  variants: AdminProductVariant[];
  variantsLoading: boolean;
  variantsError: boolean;
  busy: boolean;
  refetchVariants: () => void;
  startAdd: () => void;
  startEdit: (v: AdminProductVariant) => void;
  toggleActive: (v: AdminProductVariant) => void;
  removeVariant: (v: AdminProductVariant) => void;
}) {
  return (
    <>
      {variantsLoading ? (
        /* R158 (admin polish): the shared TableSkeleton mirrors the
           loaded 8-column grid below (الباقة/التكلفة/السعر/المحسوب/
           SKU/الترتيب/الحالة/إجراءات) with per-cell widths tuned to
           each column's real content width; role="status" + the sr-only
           label ride the primitive (the R125 A6-B8 pair the old
           centered spinner lacked). */
        <TableSkeleton cells={["w-24", "w-16", "w-16", "w-16", "w-20", "w-10", "w-16", "w-24"]} />
      ) : variantsError ? (
        <div
          role="alert"
          className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
        >
          <WifiOff className="w-4 h-4 shrink-0" />
          <span className="min-w-0">تعذّر تحميل الباقات</span>
          <button
            type="button"
            onClick={() => void refetchVariants()}
            className="ms-auto text-xs underline underline-offset-2 hover:opacity-80 shrink-0"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : variants.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border border-dashed border-border/60 rounded-xl">
          <Layers className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-bold mb-1">لا توجد باقات بعد</p>
          <p className="text-xs mb-4">أضف أول باقة ليُسعّر المنتج تلقائيًا من تكلفتها.</p>
          <Button
            size="sm"
            onClick={startAdd}
            /* R158 (admin polish): the flat bg-primary/hover-darken/
               active:scale overrides retire — buttonVariants owns the
               canonical fill (gradient + shadow + press-spring); the
               sm sizing is kept (the empty-state card's rhythm). */
          >
            <Plus className="w-3.5 h-3.5 me-1" /> إضافة باقة
          </Button>
        </div>
      ) : (
        /* R139 (precision): container edge /55 → /60 — the resting
           border family value every catalog card rides; the row
           hairlines (/30) and calm hover:bg-muted/10 step below are
           already the family register, and the money columns
           (cost/price/computed) verified tabular-nums. */
        <div className="bg-card border border-border/60 rounded-xl overflow-x-auto">
          {/* R-140-l (semantics): Arabic aria-label — the variants grid
              announces itself inside the dialog (scope="col" already
              rode every th; per-row edit/toggle/delete buttons already
              carry state-aware aria-labels). Not sortable — the
              «الترتيب» column displays the operator-set sort_order,
              it does not sort the view. */}
          <table aria-label="جدول باقات المنتج" className="w-full text-2xs min-w-[680px]">
            {/* R139 (precision): th font-bold → font-semibold — the
               quiet header-row register (bg-muted/20-30 + 600) the
               orders table and the r138 family ride; 700 stays on the
               row DATA (titles/prices) where the weight ladder belongs. */}
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th scope="col" className="text-start font-semibold px-2 py-1.5">
                  الباقة
                </th>
                <th scope="col" className="text-start font-semibold px-2 py-1.5">
                  التكلفة
                </th>
                <th scope="col" className="text-start font-semibold px-2 py-1.5">
                  السعر
                </th>
                <th scope="col" className="text-start font-semibold px-2 py-1.5">
                  المحسوب
                </th>
                <th scope="col" className="text-start font-semibold px-2 py-1.5">
                  SKU
                </th>
                <th scope="col" className="text-start font-semibold px-2 py-1.5">
                  الترتيب
                </th>
                <th scope="col" className="text-start font-semibold px-2 py-1.5">
                  الحالة
                </th>
                <th scope="col" className="text-start font-semibold px-2 py-1.5">
                  إجراءات
                </th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => {
                // Engine drift: the stored price no longer matches what
                // the CURRENT rule would price (yellow alert per spec).
                const drift =
                  v.computed_price_lyd != null &&
                  Math.abs(v.price_lyd - v.computed_price_lyd) >= 0.005;
                return (
                  <tr
                    key={v.id}
                    className={`border-t border-border/30 ${
                      !v.is_active ? "opacity-55" : "hover:bg-muted/10"
                    }`}
                  >
                    <td className="px-2 py-2">
                      <div className="font-bold">{variantTitle(v)}</div>
                      {v.duration_days != null && (
                        <div className="text-3xs text-muted-foreground">
                          {formatCount(v.duration_days, {
                            one: "يوم",
                            two: "يومان",
                            few: "أيام",
                            many: "يومًا",
                            other: "يوم",
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 tabular-nums font-mono" dir="ltr">
                      {fmtUsd(v.cost_price)}
                    </td>
                    <td className="px-2 py-2 font-bold tabular-nums">
                      {formatCurrency(v.price_lyd)}
                    </td>
                    <td className="px-2 py-2">
                      {v.computed_price_lyd == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : drift ? (
                        <span
                          className="inline-flex items-center gap-1 text-3xs font-bold text-status-warning bg-status-warning/15 border border-status-warning/30 px-1.5 py-0.5 rounded tabular-nums"
                          title={`السعر المحسوب بالإعدادات الحالية (${formatCurrency(
                            v.computed_price_lyd,
                          )}) يختلف عن المخزّن — عدّل السعر/التكلفة أو أعد الاحتساب من صفحة التسعير`}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {formatCurrency(v.computed_price_lyd)}
                        </span>
                      ) : (
                        <span
                          className="text-muted-foreground tabular-nums"
                          title="مطابق للسعر المخزّن"
                        >
                          {formatCurrency(v.computed_price_lyd)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 max-w-[130px]">
                      {v.sku ? (
                        <span
                          className="block truncate font-mono text-3xs text-foreground/80"
                          dir="ltr"
                          title={v.sku}
                        >
                          {v.sku}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{v.sort_order}</td>
                    <td className="px-2 py-2">
                      {v.is_active ? (
                        <StatusBadge variant="success" size="xs">
                          نشطة
                        </StatusBadge>
                      ) : (
                        <StatusBadge variant="neutral" size="xs">
                          معطّلة
                        </StatusBadge>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(v)}
                          disabled={busy}
                          aria-label={`تعديل باقة ${variantTitle(v)}`}
                          title="تعديل الباقة"
                          className="h-8 min-w-8 px-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(v)}
                          disabled={busy}
                          aria-label={
                            v.is_active
                              ? `تعطيل باقة ${variantTitle(v)}`
                              : `تفعيل باقة ${variantTitle(v)}`
                          }
                          title={v.is_active ? "تعطيل الباقة" : "تفعيل الباقة"}
                          className="h-8 min-w-8 px-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                        >
                          {v.is_active ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeVariant(v)}
                          disabled={busy}
                          aria-label={`حذف باقة ${variantTitle(v)}`}
                          title="حذف الباقة"
                          className="h-8 min-w-8 px-2 rounded-lg text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
