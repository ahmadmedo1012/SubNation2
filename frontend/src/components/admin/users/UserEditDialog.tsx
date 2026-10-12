import { CheckCircle, Minus, Plus } from "lucide-react";
import type { FormEvent } from "react";
// 94-C2 (A2 P2-5): the wallet-edit shell migrates from the hand-rolled
// fixed overlay to the shared AppDialog — focus trap, ESC handling,
// role="dialog"/aria-modal and a guarded dismiss while the money PATCH
// is in flight (the old backdrop closed mid-save and stranded the
// request with no visible surface).
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate, tierColor, tierLabel } from "@/lib/utils";
import { type AdminUser } from "@workspace/api-client-react";
import { type EditUserForm } from "@/components/admin/users/user-directory-meta";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the wallet/points money-edit dialog shell: the current snapshot, the
// quick info row, the wallet mode segmented control + amount + note +
// points fields, and the finance-gated submit footer. EVERYTHING that
// mutates stays in the page — the form atom, handleSave (the money
// PATCH + the 99-M3 save-intent Idempotency-Key) and the note-gate
// derivations; the inputs call page-owned handlers
// (onWalletModeChange / onWalletValueChange / onNoteChange /
// onPointsChange), never a raw setter. The move only changes its
// address; DOM, classes and aria are byte-identical.

const WALLET_MODES = [
  { value: "add", label: "إضافة", icon: Plus },
  { value: "subtract", label: "خصم", icon: Minus },
  { value: "set", label: "تحديد", icon: null },
];

export function UserEditDialog({
  editingUser,
  form,
  saving,
  canEditMoney,
  noteRequired,
  noteValid,
  editingPointsNow,
  onWalletModeChange,
  onWalletValueChange,
  onNoteChange,
  onPointsChange,
  onClose,
  onSubmit,
}: {
  editingUser: AdminUser | null;
  form: EditUserForm;
  saving: boolean;
  canEditMoney: boolean;
  noteRequired: boolean;
  noteValid: boolean;
  editingPointsNow: number | null;
  onWalletModeChange: (mode: EditUserForm["wallet_mode"]) => void;
  onWalletValueChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPointsChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <AppDialog
      open={!!editingUser}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="تعديل المستخدم"
      description={editingUser?.phone}
      dismissable={!saving}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-10 active:scale-[0.97] sm:flex-none"
          >
            إلغاء
          </Button>
          <Button
            type="submit"
            form="user-edit-form"
            className="flex-1 h-10 bg-primary hover:bg-primary/90 active:scale-[0.97]"
            // (r110 + R115) Contract gate: a wallet OR points edit is
            // submittable only with a valid (≥3 trimmed chars) note —
            // the backend 400s otherwise (round-94 wallet contract,
            // R115 points contract). A nothing-changed form stays
            // enabled and is answered honestly at the save path.
            // R120-B4 (A2-F4): a non-finance operator has nothing
            // editable in this dialog (wallet/points are finance-
            // gated, tier is derived) — the submit stays disabled
            // instead of 403ing after the confirm.
            disabled={saving || !canEditMoney || (noteRequired && !noteValid)}
          >
            <CheckCircle className="w-4 h-4 ml-1.5" />
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </>
      }
    >
      <AppDialogBody className="space-y-4">
        {editingUser && (
          <>
            {/* Current snapshot */}
            <div className="grid grid-cols-3 gap-2 p-3.5 bg-muted/25 border border-border/50 rounded-2xl">
              {[
                {
                  label: "الرصيد",
                  value: formatCurrency(editingUser.wallet_balance),
                  // R125-I4 (A6 B-6): text-primary-text — a money
                  // value, not a surface (5.75:1 dark vs 3.76:1).
                  cls: "text-primary-text",
                },
                { label: "النقاط", value: editingUser.loyalty_points, cls: "text-foreground" },
                {
                  label: "المستوى",
                  value: tierLabel(editingUser.loyalty_tier),
                  cls: tierColor(editingUser.loyalty_tier),
                },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <div className="text-3xs text-muted-foreground mb-0.5">{item.label}</div>
                  <div className={`font-bold text-sm tabular-nums ${item.cls}`}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Extra quick info */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground border border-border/30 rounded-lg px-3 py-2 bg-muted/10">
              <span>
                الطلبات: <strong className="text-foreground">{editingUser.order_count}</strong>
              </span>
              <span>
                الإنفاق:{" "}
                <strong className="text-status-success">
                  {formatCurrency(editingUser.lifetime_spend)}
                </strong>
              </span>
              {editingUser.created_at && (
                <span>
                  التسجيل:{" "}
                  <strong className="text-foreground">{formatDate(editingUser.created_at)}</strong>
                </span>
              )}
            </div>

            <form id="user-edit-form" onSubmit={onSubmit} className="space-y-4">
              {/* R120-B4 (A2-F4): the honest gate — shown instead of
                  letting a users-only operator fill the form and hit
                  the finance 403 at save time. */}
              {!canEditMoney && (
                <p className="text-xs text-status-warning bg-status-warning/10 border border-status-warning/25 rounded-xl px-3 py-2">
                  تعديل المحفظة والنقاط يتطلب صلاحية المالية — الحقول للعرض فقط
                </p>
              )}
              <div>
                {/* R125-I4 (A1-2 / A6 B-12): the money field itself —
                    htmlFor↔id pair (the r103 label idiom the note
                    + points fields already rode) + an
                    aria-describedby hint that states the MODE
                    (the placeholder alone is not a persistent
                    label; screen readers announced only the
                    mode-dependent placeholder before). */}
                <Label htmlFor="user-edit-wallet" className="mb-2 block text-sm font-semibold">
                  تعديل المحفظة (د.ل)
                </Label>
                <div className="flex gap-1 mb-2 bg-secondary/50 border border-border/60 rounded-2xl p-1">
                  {WALLET_MODES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={!canEditMoney}
                      title={canEditMoney ? undefined : "يتطلب صلاحية المالية"}
                      /* R125-I4 (A6 B-10/A1-6): a money-mode
                         control — the selected mode was purely
                         visual. aria-pressed exposes it (the
                         wallet-mode segmented control A10 §C-17
                         pin). */
                      aria-pressed={form.wallet_mode === opt.value}
                      onClick={() => onWalletModeChange(opt.value as EditUserForm["wallet_mode"])}
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${form.wallet_mode === opt.value ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {opt.icon && <opt.icon className="w-3 h-3" />}
                      {opt.label}
                    </button>
                  ))}
                </div>
                <Input
                  id="user-edit-wallet"
                  type="number"
                  min="0"
                  step="0.5"
                  disabled={!canEditMoney}
                  title={canEditMoney ? undefined : "يتطلب صلاحية المالية"}
                  aria-describedby="user-edit-wallet-hint"
                  placeholder={
                    form.wallet_mode === "set"
                      ? "الرصيد الجديد"
                      : form.wallet_mode === "add"
                        ? "المبلغ للإضافة"
                        : "المبلغ للخصم"
                  }
                  value={form.wallet_value}
                  onChange={(e) => onWalletValueChange(e.target.value)}
                  dir="ltr"
                  className="h-10"
                />
                <p
                  id="user-edit-wallet-hint"
                  className="text-3xs text-muted-foreground mt-1 leading-relaxed"
                >
                  {form.wallet_mode === "set"
                    ? "سيحل الرصيد المُدخل محل الرصيد الحالي"
                    : form.wallet_mode === "add"
                      ? "سيُضاف المبلغ إلى الرصيد الحالي"
                      : "سيُخصم المبلغ من الرصيد الحالي"}
                </p>
                {/* (r110 + R115) The money-edit note: mandatory
                    whenever a wallet field OR a points change will
                    ride the PATCH (both are LYD money — the wallet
                    balance 1:1, points at 100:1 via
                    /loyalty/convert-points); the backend rejects a
                    missing note with a 400 and the value persists on
                    the wallet_ledger / points_ledger rows. */}
                <div className="mt-3">
                  <Label htmlFor="user-edit-note" className="mb-1.5 block text-sm font-semibold">
                    سبب تعديل المحفظة / النقاط
                  </Label>
                  <Input
                    id="user-edit-note"
                    type="text"
                    disabled={!canEditMoney}
                    title={canEditMoney ? undefined : "يتطلب صلاحية المالية"}
                    value={form.note}
                    onChange={(e) => onNoteChange(e.target.value)}
                    placeholder="سبب التعديل (3 أحرف على الأقل)"
                    // (r110 + R115) mirror the backend contract:
                    // required + ≥3 chars when a money field will
                    // ride the PATCH; 500 max (both ledger services
                    // slice).
                    required={noteRequired}
                    minLength={noteRequired ? 3 : undefined}
                    maxLength={500}
                    className="h-10"
                  />
                  <p className="text-3xs text-muted-foreground mt-1 leading-relaxed">
                    إلزامي عند تعديل المحفظة أو النقاط (3 أحرف على الأقل) ويُسجَّل في سجل الحركات
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="user-edit-points" className="mb-1.5 block text-sm font-semibold">
                    نقاط الولاء
                  </Label>
                  <Input
                    id="user-edit-points"
                    type="number"
                    min="0"
                    step="1"
                    disabled={!canEditMoney}
                    title={canEditMoney ? undefined : "يتطلب صلاحية المالية"}
                    value={form.loyalty_points}
                    onChange={(e) => onPointsChange(e.target.value)}
                    dir="ltr"
                    className="h-10"
                  />
                  {/* R115 (A1/A5): points are LYD-convertible money
                      (100:1) — the hint states the dinar value of
                      the number in the box + the note/scope contract
                      so the operator knows the rules BEFORE the
                      400/403 ever fires. */}
                  <p className="text-3xs text-muted-foreground mt-1 leading-relaxed">
                    القيمة بالدينار: {formatCurrency((editingPointsNow ?? 0) / 100)} (كل 100 نقطة =
                    1 د.ل عند التحويل)
                    <br />
                    التعديل يتطلب سببًا وصلاحية «المعاملات المالية»
                  </p>
                </div>
                {/* R115 (Part 11): the tier is DERIVED from net
                    qualifying spend (computeTier on every
                    purchase/refund) — the manual override select is
                    GONE (the backend 400s any loyalty_tier); the
                    current tier shows read-only with the derivation
                    hint. */}
                <div>
                  <Label className="mb-1.5 block text-sm font-semibold">المستوى</Label>
                  <div className="h-10 px-3 flex items-center bg-muted/30 border border-border/60 rounded-lg">
                    <span className={`font-bold text-sm ${tierColor(editingUser.loyalty_tier)}`}>
                      {tierLabel(editingUser.loyalty_tier)}
                    </span>
                  </div>
                  <p className="text-3xs text-muted-foreground mt-1 leading-relaxed">
                    مستوى مشتق من الإنفاق الصافي — لا يُعدّل يدويًا
                  </p>
                </div>
              </div>
            </form>
          </>
        )}
      </AppDialogBody>
    </AppDialog>
  );
}
