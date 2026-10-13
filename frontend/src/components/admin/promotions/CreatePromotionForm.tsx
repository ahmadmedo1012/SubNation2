import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { type PromotionForm } from "@/components/admin/promotions/promotions-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/promotions.tsx —
// the create form (title / the 95%-capped discount / the datetime-local
// expiry / the live price preview / the cancel + create CTAs). EVERYTHING
// that mutates stays in the page — the form atom (EMPTY_FORM
// identity-compare dirty guard + the success-only reset), the submitting
// busy flag and the flash-sale create POST (with the 0–95% + 5-minute +
// 30-day guards); the inputs call the page's setForm setter, and the
// submit/cancel fire through the page-owned onSubmit/onCancel callbacks.
// The move only changes its address; DOM, classes, ids and Arabic copy
// are byte-identical.

export function CreatePromotionForm({
  form,
  setForm,
  submitting,
  onSubmit,
  onCancel,
}: {
  form: PromotionForm;
  setForm: Dispatch<SetStateAction<PromotionForm>>;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    /* R139 (precision): border/55 → /60 — the create shell joins the
       resting one-edge register (bg-card already solid, flat). */
    <form onSubmit={onSubmit} className="bg-card border border-border/60 rounded-2xl p-5 space-y-4">
      <h2 className="font-bold text-sm flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" /> إنشاء عرض جديد
      </h2>

      {/* R124-I5 (A6 F3 — AUD103-6-F2 completion): real
                htmlFor↔id pairs on the three create-form fields (the
                r103 label pass missed this page). */}
      <div>
        <Label
          htmlFor="promotion-form-title"
          className="text-xs font-bold text-muted-foreground mb-1.5 block"
        >
          عنوان العرض
        </Label>
        <Input
          id="promotion-form-title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="عرض رمضان، تخفيضات الصيف…"
          maxLength={255}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label
            htmlFor="promotion-form-discount"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            نسبة الخصم (%)
          </Label>
          <Input
            id="promotion-form-discount"
            type="number"
            min="1"
            max="95"
            step="1"
            value={form.discount_percent}
            onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))}
            required
            dir="ltr"
          />
          <p className="text-3xs text-muted-foreground mt-1">
            الحد الأقصى 95% — يحمي من بيع المنتج مجاناً عند تجمّع الكوبونات.
          </p>
        </div>
        <div>
          <Label
            htmlFor="promotion-form-ends-at"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            ينتهي في
          </Label>
          <Input
            id="promotion-form-ends-at"
            type="datetime-local"
            value={form.ends_at}
            onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
            required
            dir="ltr"
          />
          <p className="text-3xs text-muted-foreground mt-1">
            يجب أن يكون بعد 5 دقائق من الآن على الأقل، وأقل من 30 يوماً.
          </p>
        </div>
      </div>

      {/* Live preview */}
      {(() => {
        const d = parseFloat(form.discount_percent);
        if (!Number.isFinite(d) || d <= 0) return null;
        return (
          /* R139 (precision): receipt register — the live price preview
             leaves the brand-tinted box (bg-primary/8 + border-primary/25)
             for the hairline-ruled slip row (border-t border-border/20,
             the VariantFormPanel expected-price conversion); the projected
             price drops text-primary + font-mono for weight +
             tabular-nums — emphasis by weight+size, never color. */
          <div className="border-t border-border/20 pt-2.5">
            {/* 94-C2 (A2 P2-10): uppercase/tracking dropped —
                      letter-spacing severs Arabic letter connections
                      (A11 §8, rule documented in layout.tsx). */}
            <div className="text-3xs text-muted-foreground font-bold mb-1">معاينة سريعة</div>
            <div className="text-xs text-foreground/90 leading-relaxed">
              منتج بسعر <span className="font-bold tabular-nums">10.00 د.ل</span> سيُعرض بـ{" "}
              <span className="font-bold tabular-nums">
                {/* 96-F7 (R96 A6 #18): formatCurrency — the manual
                          toFixed(2) skipped the two-decimal + grouping
                          money convention (see utils.ts). */}
                {formatCurrency(10 * (1 - d / 100))}
              </span>{" "}
              (وفر {d}%).
              {d >= 30 && (
                <span className="flex items-center gap-1 mt-1 text-status-warning">
                  {/* R125-I3 (A2-10c): the ⚠ text glyph is gone —
                            lucide icon, the R124 emoji convention. */}
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  خصم كبير — راجع الهامش في حاسبة الأسعار قبل التفعيل.
                </span>
              )}
            </div>
          </div>
        );
      })()}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" disabled={submitting} className="gap-2">
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {submitting ? "جارٍ الإنشاء…" : "إنشاء وتفعيل"}
        </Button>
      </div>
    </form>
  );
}
