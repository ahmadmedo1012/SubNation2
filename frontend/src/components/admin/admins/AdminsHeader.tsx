import { Plus } from "lucide-react";

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
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-3.5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold shadow-sm hover:bg-primary/90"
      >
        <Plus className="w-3.5 h-3.5" />
        إضافة مسؤول
      </button>
    </div>
  );
}
