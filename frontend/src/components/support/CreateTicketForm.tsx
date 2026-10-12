import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Send } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { CATEGORIES, categoryIcon } from "./support-meta";

// R137 (FE decomposition): extracted verbatim from pages/support.tsx —
// the create-ticket card (category pill group + title + message + the
// submit/cancel pair). Presentational only: the create POST
// (handleCreate, with its `if (submitting) return` double-submit guard)
// and the open/close disclosure atoms stay IN the page — the draft
// flows down as the `form` value and edits dispatch back through the
// page-owned onFormChange; both buttons resolve through page-owned
// onSubmit / onCancel callbacks. The id="support-create-ticket" anchor
// (the header button's aria-controls target) and the whole markup ride
// verbatim — DOM, classes and Arabic copy are byte-identical.

/** The create-ticket draft shape (title/message/category), as owned by
 * the page's `form` atom. */
export type TicketFormState = { title: string; message: string; category: string };

export function CreateTicketForm({
  form,
  onFormChange,
  submitting,
  onSubmit,
  onCancel,
}: {
  form: TicketFormState;
  onFormChange: Dispatch<SetStateAction<TicketFormState>>;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <div
      id="support-create-ticket"
      className="bg-card border border-primary/22 rounded-2xl overflow-hidden shadow-xl shadow-primary/6 mb-5 float-in"
    >
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/25 bg-primary/4">
        <div className="w-7 h-7 rounded-lg bg-primary/12 border border-primary/20 flex items-center justify-center">
          <Plus className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="font-bold text-sm">تذكرة دعم جديدة</h2>
      </div>

      <form onSubmit={onSubmit} className="p-5 space-y-4">
        {/* Category pills */}
        <div>
          {/* 96-F6 (R96 A6 #10): the category control is a pill GROUP,
             not a single form control — htmlFor can't bind to it. The
             group idiom: visible heading with an id +
             role=group/aria-labelledby on the button row (same
             labelling outcome as Label+htmlFor for a single field). */}
          <p
            id="support-ticket-category-label"
            className="text-xs font-bold text-muted-foreground mb-2.5"
          >
            الفئة
          </p>
          <div
            role="group"
            aria-labelledby="support-ticket-category-label"
            className="flex flex-wrap gap-2"
          >
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => onFormChange((f) => ({ ...f, category: c.value }))}
                /* R124-I4 (A5 #2): the selected pill was conveyed by
                   bg/bold only — aria-pressed per the tested
                   toggle-pill idiom (home.tsx category chips). */
                aria-pressed={form.category === c.value}
                /* R122 (A1 P2-7): min-h-[36px] → min-h-11 — the 44px
                   tap-target floor the catalog chips already ride. */
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 press-spring min-h-11 ${
                  form.category === c.value
                    ? "bg-primary text-white border-primary shadow-sm shadow-primary/20"
                    : "bg-muted/35 border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80"
                }`}
              >
                {categoryIcon(c.value, "w-3.5 h-3.5")}
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {/* 96-F6 (R96 A6 #10): programmatic label + API-aligned cap
              (backend CreateTicketBody: title ≤ 255, message ≤ 4000 —
              A2 P3-3 turns the server round-trip error into a live
              client-side limit). */}
          <Label htmlFor="support-ticket-title" className="text-xs font-bold text-muted-foreground">
            عنوان المشكلة *
          </Label>
          <Input
            id="support-ticket-title"
            value={form.title}
            onChange={(e) => onFormChange((f) => ({ ...f, title: e.target.value }))}
            placeholder="وصف مختصر للمشكلة…"
            required
            maxLength={255}
            className="h-10 rounded-xl border-border/50 focus:border-primary/40 bg-card transition-all"
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="support-ticket-message"
            className="text-xs font-bold text-muted-foreground"
          >
            تفاصيل المشكلة *
          </Label>
          <textarea
            id="support-ticket-message"
            value={form.message}
            onChange={(e) => onFormChange((f) => ({ ...f, message: e.target.value }))}
            placeholder="اشرح المشكلة بالتفصيل لنتمكن من مساعدتك بشكل أسرع…"
            required
            rows={4}
            maxLength={4000}
            /* 96-F6 (R96 A1 #3 / A6 #10): 16px on mobile kills the
               iOS focus-zoom (the shared Input does the same via its
               own text-base; this raw textarea had text-sm). */
            className="w-full bg-card border border-border/50 rounded-xl px-3.5 py-3 text-base md:text-sm focus:border-primary/40 resize-none leading-relaxed transition-all hover:border-border/80 placeholder:text-muted-foreground"
            dir="rtl"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            /* R124-I4 (A4 F1): h-10 (40px) → min-h-11 — the ticket
               form's only submit/cancel pair rides the 44px floor. */
            className="flex-1 min-h-11 active:scale-[0.97] rounded-xl"
          >
            إلغاء
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            className="flex-1 min-h-11 bg-primary hover:bg-primary/90 active:scale-[0.97] shadow-md shadow-primary/22 rounded-xl gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جارٍ الإرسال…
              </>
            ) : (
              <>
                {/* 93-C5 / F-03 (A12 C-UX1): RTL-mirrored Send (twin of
                    the reply box above). */}
                <Send className="w-4 h-4 -scale-x-100" />
                إرسال التذكرة
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
