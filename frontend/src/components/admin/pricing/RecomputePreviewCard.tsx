import { Eye, X } from "lucide-react";
import { fmt } from "@/components/admin/pricing/pricing-format";
import type { RecomputeDryRun } from "@/components/admin/pricing/pricing-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the R115 (Part 15 / A5 P1-1) dry-run preview card (Step 1 of the two-step
// recompute): counts + the capped BEFORE→AFTER sample straight from POST
// /api/admin/pricing/recompute?dry_run=true. ZERO writes live here — the
// preview fetch and the destructive applied run (with its confirm gate)
// stay centralized in the page; this extract renders the dryRun value the
// page owns and calls one close callback. The move only changes its
// address; DOM, classes and Arabic copy are byte-identical.

export function RecomputePreviewCard({
  dryRun,
  onClosePreview,
}: {
  dryRun: RecomputeDryRun;
  onClosePreview: () => void;
}) {
  return (
    /* R139 (precision): the §6 destructive-contract preview joins the
       calm family — the warning-tinted shell border (status-warning/30)
       goes to the resting border-border/60 register; the severity stays
       where the dialect puts it: the Eye icon stage + «معاينة فقط — لم
       يُعدّل أي سعر بعد» + the APPLY step's destructive confirm. */
    <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-status-warning/10 border border-status-warning/20 flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4 text-status-warning" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm">معاينة إعادة الاحتساب</h2>
            <p className="text-3xs text-muted-foreground truncate">
              معاينة فقط — لم يُعدّل أي سعر بعد
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClosePreview}
          aria-label="إغلاق المعاينة"
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {dryRun.variants_drifted > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted/20 border border-border/40 rounded-xl text-center">
              {/* R139 (precision): receipt rhythm on the preview numbers —
                  weight (700) + size (text-lg) + tabular-nums carry the
                  emphasis, NOT color: the drifted-count is impact data,
                  not a status (the OrdersStatsPanel revenue-tile rule);
                  the warning identity lives in the icon stage + subtitle. */}
              <div className="font-bold text-lg tabular-nums">{dryRun.variants_drifted}</div>
              <div className="text-3xs text-muted-foreground">باقة سينحرف سعرها</div>
            </div>
            <div className="p-3 bg-muted/20 border border-border/40 rounded-xl text-center">
              <div className="font-bold text-lg tabular-nums">{dryRun.products_affected}</div>
              <div className="text-3xs text-muted-foreground">منتجًا يتأثر</div>
            </div>
          </div>

          {/* R139 (precision): the BEFORE→AFTER sample table joins the
              register — container /50 → /60 edge, thead bg-muted/15 →
              the /30 quiet band, row seams /30 → /60 (one seam value
              with the orders grid). */}
          <div className="overflow-x-auto border border-border/60 rounded-xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-2 text-right font-semibold">الباقة</th>
                  <th className="px-3 py-2 text-right font-semibold">المنتج</th>
                  <th className="px-3 py-2 text-left font-semibold">السعر الحالي</th>
                  <th className="px-3 py-2 text-left font-semibold">السعر الجديد</th>
                  <th className="px-3 py-2 text-left font-semibold">الفرق</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.sample.map((s) => (
                  <tr key={s.variant_id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      #{s.variant_id}
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      #{s.product_id}
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {fmt(s.price_before)} د.ل
                    </td>
                    <td className="px-3 py-2 tabular-nums font-bold" dir="ltr">
                      {fmt(s.price_after)} د.ل
                    </td>
                    <td
                      className={`px-3 py-2 tabular-nums font-bold ${
                        /* R139 (precision): the −delta joins its + sibling
                           on the --status-* family — the signed-direction
                           pair reads success/error tokens (the discount
                           exception class), never the raw destructive
                           channel. */
                        s.delta >= 0 ? "text-status-success" : "text-status-error"
                      }`}
                      dir="ltr"
                    >
                      {s.delta >= 0 ? "+" : ""}
                      {fmt(s.delta)} د.ل
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-3xs text-muted-foreground leading-relaxed">
            {dryRun.sample.length >= 25
              ? `عينة أول 25 باقة من أصل ${dryRun.variants_drifted} — `
              : ""}
            {dryRun.note} التطبيق الفعلي يتم عبر «إعادة احتساب أسعار الكتالوج» أعلاه.
          </p>
        </>
      ) : (
        <p className="text-2xs text-muted-foreground leading-relaxed">
          كل الأسعار مطابقة للقاعدة الحالية — لا تغييرات عند التطبيق.
        </p>
      )}
    </div>
  );
}
