import { Info } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the «المصادقة» tab's static info box (the [SET] masking explainer).
// Zero props: nothing here reads page state. The move only changes its
// address; DOM, classes and Arabic copy are byte-identical.

export function AuthHowItWorksInfo() {
  return (
    /* R139 (precision): VERIFIED, no change — the info box rides the
       lane's quiet inset register (bg-muted/30 + border-border/50);
       the [SET] code chip is the mono token family. */
    <div className="flex items-start gap-3 p-4 bg-muted/30 border border-border/50 rounded-2xl">
      <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
        <p className="font-bold text-foreground/80">كيف يعمل النظام؟</p>
        <p>
          عند تفعيل مزود وإدخال بيانات الاعتماد، يظهر زر تسجيل الدخول به تلقائياً في صفحات الدخول
          والتسجيل.
        </p>
        <p>
          قيم{" "}
          <span className="font-mono bg-background/80 px-1 rounded border border-border/60">
            [SET]
          </span>{" "}
          تعني أن القيمة مُعيَّنة مسبقاً — أترك الحقل فارغاً لعدم تغييرها.
        </p>
      </div>
    </div>
  );
}
