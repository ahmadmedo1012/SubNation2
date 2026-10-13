import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hash, Percent, Plus, RefreshCw } from "lucide-react";
import { type CreateForm } from "@/components/admin/coupons/coupons-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/coupons.tsx —
// the create-coupon dialog shell (code / type chips / value + the 110-M
// inline parity-guard error / min order / max uses / UTC-hinted expiry /
// description). EVERYTHING that mutates stays in the page — the form
// atom (EMPTY_FORM identity-compare dirty guard + the success-only
// reset), the valueError guard atom and the money-discount create POST
// (with the localDateTimeToUtcIso TZ conversion); the inputs call
// the page's setForm/setValueError setters and the submit fires through
// the page-owned onSubmit callback. The move only changes its address;
// DOM, classes, ids, aria-pressed and Arabic copy are byte-identical.

export function CreateCouponDialog({
  open,
  onOpenChange,
  form,
  setForm,
  creating,
  valueError,
  setValueError,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: CreateForm;
  setForm: Dispatch<SetStateAction<CreateForm>>;
  creating: boolean;
  valueError: string | null;
  setValueError: Dispatch<SetStateAction<string | null>>;
  onSubmit: () => void;
}) {
  return (
    // Create modal — 93-C7 / C-UX3 (A12 §11.2, H5): migrated from
    // the hand-rolled fixed overlay to the shared AppDialog. Gained:
    // focus trap + ESC + scroll-lock + role="dialog" + mobile
    // bottom-sheet + the Radix animation family; ESC/backdrop/close
    // are loading-guarded while `creating`, and dismissing NO
    // LONGER resets the form (draft survives reopening).
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="إنشاء كوبون جديد"
      dismissable={!creating}
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
            className="flex-1 sm:flex-none"
          >
            إلغاء
          </Button>
          <Button
            onClick={onSubmit}
            disabled={creating}
            className="flex-1 bg-primary hover:bg-primary/90 press-spring gap-1.5 sm:flex-none"
          >
            {creating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {creating ? "جارٍ الإنشاء…" : "إنشاء الكوبون"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Code */}
        <div className="space-y-1.5">
          <Label htmlFor="coupons-f1-15956" className="text-xs font-bold">
            رمز الكوبون
          </Label>
          <Input
            id="coupons-f1-15956"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="SUMMER20"
            className="font-mono uppercase"
          />
        </div>

        {/* Type + Value */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">نوع الخصم</Label>
            <div className="flex gap-1.5">
              {(["percentage", "fixed"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    // 110-M (109-m P3): a type switch re-scales the
                    // value field — drop any stale guard error.
                    setValueError(null);
                    setForm((f) => ({ ...f, type: t }));
                  }}
                  /* R126-L3 (A4 quick-win): the active chip was purely
                     visual (bg-primary) — a screen reader announced
                     «نسبة / مبلغ» as two identical buttons with no
                     state. aria-pressed exposes the toggle (the
                     topups/orders status-tab chip idiom those pages'
                     comments already cite as "the coupons.tsx chip-bar
                     idiom" — the citation finally points at a real
                     implementation). */
                  aria-pressed={form.type === t}
                  /* R139 (precision): the type toggle joins the r138
                     calm-pill dialect (the PDP VariantSelector /
                     money-path decision, pinned this round): the ACTIVE
                     chip drops its SOLID primary fill + white ink for
                     the family's /15 tint + primary-text + /30 edge
                     (weight carries the selected state), and the
                     resting chip swaps its card fill + full-strength
                     edge for the muted/30 box + /30 edge + /70 border
                     hover step — both states already boxed, no toggle
                     jitter. aria-pressed + the 110-M guard-clearing
                     onClick are byte-identical. */
                  className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold border transition-all press-spring ${
                    form.type === t
                      ? "bg-primary/15 text-primary-text border-primary/30 font-bold"
                      : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
                  }`}
                >
                  {t === "percentage" ? (
                    <>
                      <Percent className="w-3 h-3 inline ml-1" />
                      نسبة
                    </>
                  ) : (
                    <>
                      <Hash className="w-3 h-3 inline ml-1" />
                      مبلغ
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupons-f3-25257" className="text-xs font-bold">
              {form.type === "percentage" ? "النسبة (%)" : "المبلغ (د.ل)"}
            </Label>
            <Input
              id="coupons-f3-25257"
              type="number"
              value={form.value}
              onChange={(e) => {
                // 110-M (109-m P3): any edit clears the stale guard
                // error (re-validated on the next submit).
                setValueError(null);
                setForm((f) => ({ ...f, value: e.target.value }));
              }}
              placeholder={form.type === "percentage" ? "20" : "5.00"}
              min="0.01"
              max={form.type === "percentage" ? "100" : undefined}
            />
            {/* 110-M (109-m P3): inline parity-guard error — the same
                text-xs/text-destructive field-error idiom as
                settings.tsx / wallet.tsx. */}
            {valueError && (
              <p className="text-xs text-destructive" role="alert">
                {valueError}
              </p>
            )}
          </div>
        </div>

        {/* Min order + max uses */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="coupons-f4-28708" className="text-xs font-bold">
              حد أدنى للطلب (اختياري)
            </Label>
            <Input
              id="coupons-f4-28708"
              type="number"
              value={form.min_order_amount}
              onChange={(e) => setForm((f) => ({ ...f, min_order_amount: e.target.value }))}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupons-f5-30186" className="text-xs font-bold">
              الحد الأقصى للاستخدام
            </Label>
            <Input
              id="coupons-f5-30186"
              type="number"
              value={form.max_uses}
              onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
              placeholder="بلا حد"
            />
          </div>
        </div>

        {/* Expires at + description */}
        <div className="space-y-1.5">
          <Label htmlFor="coupons-f6-31815" className="text-xs font-bold">
            تاريخ الانتهاء (اختياري)
          </Label>
          <Input
            id="coupons-f6-31815"
            type="datetime-local"
            value={form.expires_at}
            onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
          />
          {/* 93-C7 / C-UX4: honest hint — the naive local value is
              converted to UTC on save; without it operators assumed
              the server shared their wall-clock. */}
          <p className="text-2xs text-muted-foreground">
            يُحوَّل تلقائياً إلى التوقيت العالمي (UTC) عند الحفظ — ينتهي في نفس اللحظة التي تحددها
            هنا.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="coupons-f7-15994" className="text-xs font-bold">
            وصف (اختياري)
          </Label>
          <Input
            id="coupons-f7-15994"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="مثال: خصم الصيف على الاشتراكات"
          />
        </div>
      </div>
    </AppDialog>
  );
}
