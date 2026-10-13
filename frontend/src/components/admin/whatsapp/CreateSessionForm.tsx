import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/whatsapp.tsx —
// the «إضافة جلسة» create form. The name draft rides down as a value +
// the page's setName setter; the submit fires through the page-owned
// onSubmit (the session-create POST with its toast + reload) and the
// per-action busy gate rides down as a value. The move only changes its
// address; DOM, classes, aria labels and Arabic copy are byte-identical.

export function CreateSessionForm({
  name,
  onNameChange,
  busy,
  onSubmit,
}: {
  name: string;
  onNameChange: (value: string) => void;
  busy: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    /* R139 (precision): the form card joins the resting border family —
       border-border/60 (the page's sessions section + every sibling admin
       card); the full-strength border-border was an outlier. The Input +
       canonical Button already ride the shared recipes. */
    <form onSubmit={onSubmit} className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 font-bold">
        <Plus className="w-4 h-4 text-primary" />
        إضافة جلسة
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="subnation-otp"
          /* R125-I5 (A6-B13): placeholder-only inputs get
              programmatic names. */
          aria-label="اسم الجلسة"
          pattern="[A-Za-z0-9-]{3,50}"
          title="من 3 إلى 50 حرفاً إنجليزياً أو رقماً أو شرطة"
          required
          dir="ltr"
        />
        <Button type="submit" disabled={busy !== null} className="sm:min-w-32">
          {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
          إنشاء
        </Button>
      </div>
    </form>
  );
}
