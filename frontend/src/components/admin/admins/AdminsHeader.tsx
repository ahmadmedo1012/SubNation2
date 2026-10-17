import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// R137 (FE decomposition): extracted verbatim from pages/admin/admins.tsx —
// the page header (h1 + «إضافة مسؤول» CTA). The CTA opens the create
// flow through the page-owned onAdd (openCreate — which re-seeds the
// hoisted create-form atoms before flipping `creating`, exactly the
// fresh-mount useState the dialog component had). The move only changes
// its address; DOM, classes and Arabic copy are byte-identical.

export function AdminsHeader({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold mb-0.5">إدارة المسؤولين</h1>
        <p className="text-muted-foreground text-sm">إنشاء وإدارة حسابات المسؤولين وصلاحياتهم</p>
      </div>
      {/* R139 (precision): the CTA de-hand-rolls onto the shared Button —
          the ProductsHeader «منتج جديد» recipe (flat bg-primary fill +
          hover /90 + h-9 + press feedback; the buttonVariants chrome rides
          along). h-9 ≥ the 24px admin edge floor. onClick + label
          byte-identical. */}
      <Button
        onClick={onAdd}
        /* R158 (A6 tail): the flat bg-primary/hover-darken/active:scale
         * override retires — buttonVariants owns the canonical fill
         * (gradient + shadow + press-spring). */
        className="h-9"
      >
        <Plus className="w-4 h-4 me-1.5" />
        إضافة مسؤول
      </Button>
    </div>
  );
}
