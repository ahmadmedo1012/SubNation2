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
    // R143 (L2-1): the create card rides the two-layer calm elevation
    //   as the theme-aware `shadow-calm` token in index.css (the r138
    //   recipe — dark byte-identical; .light re-tuned inside the
    //   documented 6–14% ceiling). See the R139 comment below for the
    //   register's lineage.
    <div
      id="support-create-ticket"
      className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-calm mb-5 float-in"
    >
      {/* R139 (precision): the create card is the page's prominent ACTIVE
          card — the brand border (border-primary/22) + brand-tinted shadow
          (shadow-xl shadow-primary/6) retire for the resting family edge
          + the r138 two-layer calm elevation (ProductEditorCard's exact
          conversion, 139-f); the Plus icon tile + the primary submit
          below still carry the flow's brand identity. */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60 bg-muted/30">
        {/* R139 (precision): the header band joins the quiet band register
            (bg-muted/30 on a /60 seam — the TicketThread meta twin); was
            bg-primary/4 on a /25 seam. */}
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
                   tap-target floor the catalog chips already ride.
                   R139 (precision): the category picker migrates to the
                   calm pill — the SOLID selected fill (bg-primary +
                   text-white + shadow-sm shadow-primary/20) retires for
                   the tinted trio (bg-primary/15 + text-primary-text +
                   border-primary/30, the PDP VariantSelector dialect
                   money-path-chrome-r139 pins); the inactive chip joins
                   the muted box family (bg-muted/30 + /30 edge + the
                   /70 + muted/60 hover steps — the products category-
                   bar values). aria-pressed + onClick byte-identical. */
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 press-spring min-h-11 ${
                  form.category === c.value
                    ? "bg-primary/15 text-primary-text border-primary/30"
                    : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
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
            /* R139 (precision): the field returns to the shared Input
               register — the border-border/50 override sat under the
               A4-F12 3:1 border floor and focus:border-primary/40
               competed with the ONE focus system; buttonVariants-style
               ownership now lives in the component (the 139-i nine-field
               convergence, storefront side). id/value/onChange/required/
               maxLength byte-identical. */
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
               own text-base; this raw textarea had text-sm).
               R139 (precision): the textarea joins the shared field
               register — border-border/50 → the A4-F12 ≥3:1 edge
               (border-muted-foreground/75, + hover step to /90) and
               the border-swap focus cue → the ONE focus system
               (focus-visible ring-ring, the Input's own pair). No
               shared Textarea primitive exists to adopt — the token
               family is the unification lane here (the 139-i OTP-field
               precedent). Geometry/padding/cap byte-identical.
               R143 (L3-4): md:text-sm → the A13-F7 pointer:fine guard
               (input.tsx:43 idiom) — the bare md: re-defeated the
               zoom fix on iPad-class (≥768px coarse-pointer) viewports;
               desktop fine-pointer rendering is unchanged. */
            className="w-full bg-card border border-muted-foreground/75 rounded-xl px-3.5 py-3 text-base [@media(min-width:48rem)_and_(pointer:fine)]:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none leading-relaxed transition-all hover:border-muted-foreground/90 placeholder:text-muted-foreground"
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
            /* R139 (precision): canonical CTA — the flat bg-primary +
               hover:bg-primary/90 + active:scale + shadow-md
               shadow-primary/22 stack retires for buttonVariants (the
               shared recipe owns fill/elevation/hover/press + the ONE
               focus ring); min-h-11 keeps the 44px storefront floor
               (R124-I4) over the variant's default. Spinner/label/
               disabled byte-identical. */
            className="flex-1 min-h-11 gap-1.5"
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
