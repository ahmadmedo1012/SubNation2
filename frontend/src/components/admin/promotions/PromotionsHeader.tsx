import { Button } from "@/components/ui/button";
import { AlertTriangle, Plus, Zap } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/promotions.tsx —
// the page-section header (icon tile + h1 + the «إنشاء عرض» /
// «إغلاق النموذج» toggle CTA) and the one-active-sale warning banner.
// showForm + hasActive are page-owned values passed DOWN; the CTA flips
// the form atom through the page-owned onToggleForm (the create POST and
// every form/busy atom stay in the page). The move only changes its
// address; DOM, classes and Arabic copy are byte-identical.

export function PromotionsHeader({
  showForm,
  hasActive,
  onToggleForm,
}: {
  showForm: boolean;
  hasActive: boolean;
  onToggleForm: () => void;
}) {
  return (
    <>
      {/* Page-section header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-xl">العروض السريعة</h1>
            <p className="text-xs text-muted-foreground">
              عرض واحد نشط في كل وقت — يطبَّق على المتجر بأكمله
            </p>
          </div>
        </div>
        <Button onClick={onToggleForm} disabled={hasActive && !showForm} className="gap-2">
          <Plus className="w-4 h-4" />
          {showForm ? "إغلاق النموذج" : "إنشاء عرض"}
        </Button>
      </div>

      {hasActive && !showForm && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl border border-status-warning/30 bg-status-warning/10 text-status-warning text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            يوجد عرض نشط حالياً. أوقف العرض الحالي قبل إنشاء عرض جديد — يُسمح بعرض واحد فقط في كل
            وقت.
          </span>
        </div>
      )}
    </>
  );
}
