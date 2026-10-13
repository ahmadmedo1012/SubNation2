import type { Dispatch, FormEvent, SetStateAction } from "react";
import { AlertTriangle, Layers, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fmtFactor,
  fmtUsd,
  type VariantForm,
} from "@/components/admin/product-variants/variants-meta";
import { formatCurrency } from "@/lib/utils";

// R137 (FE, closing decomposition): extracted verbatim from
// components/admin/ProductVariantsDialog.tsx — the shared add/edit form
// panel (one form, two modes — the page product form's idiom). The
// dialog core keeps the {showForm && …} branch, the form/editingId/
// formError atoms, the live-preview derivations and submitForm (the
// validator + body builders ride in the React-free variants-meta module);
// every value + callback flows down with its dialog-side name so the
// moved JSX is byte-identical. Zero hooks live here.
export function VariantFormPanel({
  form,
  setForm,
  editingId,
  formError,
  busy,
  previewCost,
  factor,
  rate,
  expectedPrice,
  submitForm,
  resetForm,
}: {
  form: VariantForm;
  /** The dialog's setForm dispatcher — the one form owner. */
  setForm: Dispatch<SetStateAction<VariantForm>>;
  editingId: number | null;
  formError: string | null;
  busy: boolean;
  previewCost: number;
  factor: number | null;
  rate: number | null;
  expectedPrice: number | null;
  submitForm: (e: FormEvent) => void;
  resetForm: () => void;
}) {
  return (
    /* R139 (precision): the panel edge joins the resting border family
       (border-primary/20 → border-border/60) — the dialog's active
       editing surface is carried by the header + the primary submit,
       not a brand-tinted border; bg-muted/15 wash stays. */
    <div className="bg-muted/15 border border-border/60 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-primary" />
          {editingId != null ? "تعديل الباقة" : "إضافة باقة جديدة"}
        </h3>
        <button
          type="button"
          onClick={resetForm}
          aria-label="إغلاق نموذج الباقة"
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <form onSubmit={submitForm} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* R125-I3 (A2-4): every form field carries a real htmlFor↔id
            pair — the R124-I5 label pass covered the pages/ forms
            but this dialog (the catalog's second-biggest money
            form, in components/admin/) was outside that sweep. */}
        <div>
          <Label
            htmlFor="variant-form-plan-label"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            اسم الباقة
          </Label>
          <Input
            id="variant-form-plan-label"
            value={form.plan_label}
            onChange={(e) => setForm((f) => ({ ...f, plan_label: e.target.value }))}
            maxLength={120}
            placeholder="مثال: Premium 4K"
          />
        </div>
        <div>
          <Label
            htmlFor="variant-form-duration-label"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            المدة
          </Label>
          <Input
            id="variant-form-duration-label"
            value={form.duration_label}
            onChange={(e) => setForm((f) => ({ ...f, duration_label: e.target.value }))}
            maxLength={120}
            placeholder="مثال: شهر واحد"
          />
        </div>
        <div>
          <Label
            htmlFor="variant-form-duration-days"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            أيام المدة (اختياري)
          </Label>
          <Input
            id="variant-form-duration-days"
            type="number"
            min="0"
            step="1"
            value={form.duration_days}
            onChange={(e) => setForm((f) => ({ ...f, duration_days: e.target.value }))}
            dir="ltr"
            placeholder="30"
          />
        </div>
        <div>
          <Label
            htmlFor="variant-form-cost-price"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            التكلفة بالدولار ($) *
          </Label>
          <Input
            id="variant-form-cost-price"
            type="number"
            min="0.01"
            step="0.01"
            value={form.cost_price}
            onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
            required
            dir="ltr"
            placeholder="3.99"
          />
          <p className="text-3xs mt-1 text-muted-foreground">
            داخلية للإدارة فقط — لا تظهر للمستخدم.
          </p>
        </div>
        {editingId != null && (
          <div>
            <Label
              htmlFor="variant-form-price-lyd"
              className="text-xs font-bold text-muted-foreground mb-1.5 block flex items-center gap-2"
            >
              السعر (د.ل)
              {/* R128 (A4-F2): /70 → /85 — 11px muted ink
                  needs the AA-safe alpha pair (products.tsx's
                  cost-price hint is the sibling). */}
              <span className="text-3xs font-normal text-muted-foreground/85">
                اتركه فارغًا ليُحسب من التكلفة
              </span>
            </Label>
            <Input
              id="variant-form-price-lyd"
              type="number"
              min="0.01"
              step="0.01"
              value={form.price_lyd}
              onChange={(e) => setForm((f) => ({ ...f, price_lyd: e.target.value }))}
              dir="ltr"
              placeholder={expectedPrice != null ? String(expectedPrice) : "تلقائي"}
            />
          </div>
        )}
        <div>
          <Label
            htmlFor="variant-form-sku"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            SKU (اختياري)
          </Label>
          <Input
            id="variant-form-sku"
            value={form.sku}
            onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            maxLength={160}
            dir="ltr"
            placeholder="netflix|1 Month"
          />
        </div>
        <div>
          <Label
            htmlFor="variant-form-sort-order"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            الترتيب
          </Label>
          <Input
            id="variant-form-sort-order"
            type="number"
            min="0"
            step="1"
            value={form.sort_order}
            onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
            dir="ltr"
            placeholder="0"
          />
        </div>

        {/* Live expected price — the engine formula with the
            CURRENT rule, before any save. */}
        {expectedPrice != null && factor != null && rate != null && (
          /* R139 (precision): receipt rhythm — the money preview drops
             its primary-tinted box + brand ink for the family's slip
             register: a /20 hairline rule at the boundary + emphasis
             by weight (label 400 → amount 700) and size (2xs → xs),
             NOT color — the CartSummaryAside terminal-line idiom. */
          <div className="sm:col-span-2 flex items-center justify-between border-t border-border/20 pt-2.5">
            <span className="text-2xs text-muted-foreground">السعر المتوقع (يُحسب تلقائيًا)</span>
            <span className="text-xs font-bold tabular-nums">
              {fmtUsd(Number.isFinite(previewCost) ? previewCost : 0)} × {fmtFactor(factor)} ×{" "}
              {fmtFactor(rate)} = {formatCurrency(expectedPrice)}
            </span>
          </div>
        )}

        {formError && (
          <p
            role="alert"
            className="sm:col-span-2 text-2xs font-bold text-destructive flex items-center gap-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {formError}
          </p>
        )}

        <div className="sm:col-span-2 flex gap-3 justify-end pt-1 border-t border-border/60">
          <Button
            type="button"
            variant="outline"
            onClick={resetForm}
            disabled={busy}
            className="h-9 active:scale-[0.97] transition-transform"
          >
            إلغاء
          </Button>
          <Button
            type="submit"
            disabled={busy}
            className="h-9 bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 ml-1.5" />
            )}
            {editingId != null ? "حفظ التعديلات" : "إضافة الباقة"}
          </Button>
        </div>
      </form>
    </div>
  );
}
