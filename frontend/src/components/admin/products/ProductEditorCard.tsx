import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORY_OPTIONS, type ProductForm } from "@/components/admin/products/products-meta";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle, X } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the create/edit editor card (header + ⌘S/Esc hint + the nine-field form
// with the cost-margin hint, the image preview, the SEO override pair with
// their live counters/warnings and the is_active checkbox). Presentational
// shell by contract: the form/baseline/seoTouched atoms, handleSubmit, the
// create/update mutations and the ⌘S/Escape keyboard wiring all stay IN the
// page — the fields dispatch through the page-owned onFormChange /
// onSeoTouchedChange dispatchers (no extract-local truth; the 98-F7 dirty
// guard keeps reading the page's form vs baseline). The move only changes
// its address; DOM, classes, aria and event semantics are byte-identical.

export function ProductEditorCard({
  editingId,
  form,
  onFormChange,
  onSeoTouchedChange,
  onSubmit,
  onCancel,
  createPending,
  updatePending,
}: {
  editingId: number | null;
  form: ProductForm;
  /** The page's setForm dispatcher — the one form owner. */
  onFormChange: Dispatch<SetStateAction<ProductForm>>;
  /** The page's setSeoTouched dispatcher (R123 touched flags). */
  onSeoTouchedChange: Dispatch<SetStateAction<{ title: boolean; description: boolean }>>;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  createPending: boolean;
  updatePending: boolean;
}) {
  return (
    <div className="bg-card border border-primary/20 rounded-2xl overflow-hidden shadow-lg shadow-primary/5">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/15">
        <div>
          <h2 className="font-bold text-sm">{editingId ? "تعديل المنتج" : "إضافة منتج جديد"}</h2>
          <p className="text-3xs text-muted-foreground mt-0.5">
            <kbd className="font-mono bg-muted/80 border border-border/60 px-1 rounded">⌘S</kbd>{" "}
            للحفظ ·
            <kbd className="font-mono bg-muted/80 border border-border/60 px-1 rounded mr-1">
              Esc
            </kbd>{" "}
            للإغلاق
          </p>
        </div>
        <button
          onClick={onCancel}
          aria-label="إغلاق النموذج"
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <form
        id="product-form"
        onSubmit={onSubmit}
        className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        {/* R124-I5 (A6 F3 — AUD103-6-F2 completion): every editor
          field carries a real htmlFor↔id pair. The r103 label pass
          covered coupons/users/topups/admins/settings/security but
          missed this — the biggest admin form (9 fields) had
          programmatically-unassociated labels. */}
        <div>
          <Label
            htmlFor="product-editor-name"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            اسم المنتج *
          </Label>
          <Input
            id="product-editor-name"
            value={form.name}
            onChange={(e) => onFormChange((f) => ({ ...f, name: e.target.value }))}
            required
            placeholder="مثال: Netflix Premium"
          />
        </div>
        <div>
          <Label
            htmlFor="product-editor-price"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            السعر (د.ل) *
          </Label>
          <Input
            id="product-editor-price"
            type="number"
            min="0"
            step="0.5"
            value={form.price}
            onChange={(e) => onFormChange((f) => ({ ...f, price: e.target.value }))}
            required
            dir="ltr"
            placeholder="0.00"
          />
        </div>
        <div>
          <Label
            htmlFor="product-editor-cost"
            className="text-xs font-bold text-muted-foreground mb-1.5 block flex items-center gap-2"
          >
            سعر التكلفة (د.ل)
            {/* 96-F7 (R96 A6 #11): 9px → 10px — functional hint
                text, not decoration. R128 (A4-F2): /70 → /85 —
                11px muted ink needs the AA-safe alpha pair. */}
            <span className="text-3xs font-normal text-muted-foreground/85">
              اختياري — للإدارة فقط، لا يظهر للمستخدم
            </span>
          </Label>
          <Input
            id="product-editor-cost"
            type="number"
            min="0"
            step="0.01"
            value={form.cost_price}
            onChange={(e) => onFormChange((f) => ({ ...f, cost_price: e.target.value }))}
            dir="ltr"
            placeholder="0.00"
          />
          {form.price && form.cost_price && (
            <p className="text-3xs mt-1 text-muted-foreground">
              {(() => {
                const p = parseFloat(form.price);
                const c = parseFloat(form.cost_price);
                if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0) return null;
                const margin = p - c;
                const pct = (margin / p) * 100;
                const tone =
                  margin < 0
                    ? "text-destructive"
                    : pct < 10
                      ? "text-status-warning"
                      : "text-status-success";
                return (
                  <span className={tone}>
                    {/* 96-F7 (R96 A6 #18): formatCurrency — the
                        manual toFixed(2) skipped thousands grouping
                        (the established money convention, see
                        utils.ts). */}
                    هامش الربح: {formatCurrency(margin)} ({pct.toFixed(1)}%)
                  </span>
                );
              })()}
            </p>
          )}
        </div>
        <div className="md:col-span-2">
          <Label
            htmlFor="product-editor-description"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            الوصف
          </Label>
          <Input
            id="product-editor-description"
            value={form.description}
            onChange={(e) => onFormChange((f) => ({ ...f, description: e.target.value }))}
            placeholder="وصف مختصر للمنتج…"
          />
        </div>
        <div>
          <Label
            htmlFor="product-editor-image"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            رابط الصورة
          </Label>
          <Input
            id="product-editor-image"
            value={form.image_url}
            onChange={(e) => onFormChange((f) => ({ ...f, image_url: e.target.value }))}
            dir="ltr"
            placeholder="https://..."
          />
          {form.image_url.trim() && (
            <div className="mt-2 flex items-center gap-2.5">
              <div className="relative w-16 h-16 shrink-0 rounded-xl border border-border/50 bg-card overflow-hidden">
                <img
                  src={form.image_url.trim()}
                  alt="معاينة"
                  className="absolute inset-0 m-auto max-w-[74%] max-h-[74%] w-auto h-auto object-contain"
                  onLoad={(e) => {
                    (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty(
                      "display",
                      "none",
                    );
                    e.currentTarget.style.display = "block";
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty(
                      "display",
                      "flex",
                    );
                  }}
                />
                <div
                  style={{ display: "none" }}
                  className="absolute inset-0 items-center justify-center text-3xs font-bold text-destructive text-center px-1"
                >
                  رابط غير صالح
                </div>
              </div>
              <p className="text-2xs text-muted-foreground leading-relaxed">
                معاينة كما ستظهر في البطاقة. استخدم صورة شفافة (PNG/SVG) عالية الدقة لأفضل نتيجة.
              </p>
            </div>
          )}
        </div>
        <div>
          <Label
            htmlFor="product-editor-category"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            الفئة
          </Label>
          <select
            id="product-editor-category"
            value={form.category}
            onChange={(e) => onFormChange((f) => ({ ...f, category: e.target.value }))}
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-10"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <Label
            htmlFor="product-editor-usage"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            شروط الاستخدام
          </Label>
          <Input
            id="product-editor-usage"
            value={form.usage_terms}
            onChange={(e) => onFormChange((f) => ({ ...f, usage_terms: e.target.value }))}
            placeholder="ملاحظات مهمة تظهر بعد الشراء…"
          />
        </div>
        {/* R123 (E3 item 2): the SEO override fields the CHANGELOG
            claimed existed — they feed the product page's meta tags
            (seo-builders consume the overrides; empty falls back to
            name/description). Column-aligned caps: 200/320. */}
        <div className="md:col-span-2">
          <Label
            htmlFor="product-editor-seo-title"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            عنوان SEO (اختياري)
          </Label>
          <Input
            id="product-editor-seo-title"
            value={form.seo_title}
            onChange={(e) => {
              onFormChange((f) => ({ ...f, seo_title: e.target.value }));
              onSeoTouchedChange((t) => (t.title ? t : { ...t, title: true }));
            }}
            maxLength={200}
            placeholder="عنوان مخصص لنتائج البحث — يُترك فارغاً لاستخدام اسم المنتج"
          />
          <p className="text-3xs mt-1 text-muted-foreground">
            يظهر كعنوان صفحة المنتج في محركات البحث ومشاركات الروابط — فارغ يعني العنوان الافتراضي (
            {200 - form.seo_title.length} حرف متبقٍ).
            {/* R134 (A7-F7): the DB column accepts 200 but every
                DISPLAY surface clamps at 60 chars (MetaTags.clamp —
                the raw shell, og:title and the share card share the
                budget); an operator title past 60 truncates
                mid-brand on ALL surfaces with no cue at write
                time. The warn surfaces exactly at the budget. */}
            {form.seo_title.length > 60 && (
              <span className="text-status-warning font-bold">
                {" "}
                تنبيه: تجاوزت حد العرض (60 حرفاً من أصل {form.seo_title.length}) — كل الأسطح تقتطع
                العنوان عند حدود الكلمة بما فيها ذيل العلامة «| SubNation»؛ قصِّر العنوان لضمان
                ظهوره كاملاً.
              </span>
            )}
          </p>
        </div>
        <div className="md:col-span-2">
          <Label
            htmlFor="product-editor-seo-description"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            وصف SEO (اختياري)
          </Label>
          <textarea
            id="product-editor-seo-description"
            value={form.seo_description}
            onChange={(e) => {
              onFormChange((f) => ({ ...f, seo_description: e.target.value }));
              onSeoTouchedChange((t) => (t.description ? t : { ...t, description: true }));
            }}
            maxLength={320}
            rows={3}
            dir="rtl"
            placeholder="وصف مخصص يظهر تحت عنوان الصفحة في نتائج البحث…"
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-y"
          />
          <p className="text-3xs mt-1 text-muted-foreground">
            يظهر كوصف صفحة المنتج في محركات البحث — فارغ يعني الوصف الافتراضي ({" "}
            {form.seo_description.length}/320).
          </p>
        </div>
        <div className="md:col-span-2 flex items-center gap-3 py-1">
          <input
            type="checkbox"
            id="is_active"
            checked={form.is_active}
            onChange={(e) => onFormChange((f) => ({ ...f, is_active: e.target.checked }))}
            className="w-4 h-4 accent-primary"
          />
          <Label htmlFor="is_active" className="cursor-pointer text-sm">
            منتج نشط (ظاهر للمستخدمين)
          </Label>
        </div>
        <div className="md:col-span-2 flex gap-3 justify-end pt-1 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="h-9 active:scale-[0.97] transition-transform"
          >
            إلغاء
          </Button>
          <Button
            type="submit"
            className="h-9 bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
            disabled={createPending || updatePending}
          >
            <CheckCircle className="w-4 h-4 ml-1.5" />
            {editingId ? "حفظ التعديلات" : "إضافة المنتج"}
          </Button>
        </div>
      </form>
    </div>
  );
}
