import { useEffect, useState } from "react";
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/utils";
import { TOPUP_COUNT_FORMS } from "@/components/admin/topups/topups-queue-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the bulk-action / approve-all confirmation dialog shell. The ONLY state
// it carries is the field-local note draft (reset on open; submitted up
// via the onConfirm(note) callback) — it never imports a mutation or the
// money APIs: the sequential loops (handleBulkAction / approveAll), their
// per-topup Idempotency-Keys, the bulkAction/isBulkProcessing/
// isApproveAllBusy/approveAllProgress atoms stay in the page, which
// passes open/count/loading/progress/onConfirm/onCancel down. The move
// only changes its address; DOM, classes, copy and event semantics are
// byte-identical.

// Bulk action confirmation modal
// F3-03 (R111 WCAG 4.1.2 + 2.4.3): same hand-rolled-overlay retirement as
// RejectModal above — Radix focus trap/return, aria-modal, real DialogTitle,
// and ESC/backdrop guarded while the sequential money loop runs
// (`dismissable`). The live "جاري done/total" counter is additionally a
// role=status region so the per-item progress reaches screen readers while
// the loop runs (the old subtitle swap was visual-only).
// R122 (A2-P2): the modal gains the SAME optional note field the
// single-reject modal has — the bulk loops used to stamp every row with
// the boilerplate «تمت الموافقة الجماعية»/«مرفوض جماعياً», weakening the
// audit trail the note column and the ledgers carry (the mandatory-reason
// discipline wallet edits already enforce). The note stays OPTIONAL
// (matching RejectModal): empty → the boilerplate fallback rides the body.
export function BulkConfirmModal({
  action,
  count,
  open,
  onConfirm,
  onCancel,
  loading,
  progress,
}: {
  action: "approve" | "reject";
  count: number;
  open: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
  /** Live per-item progress while a long approveAll loop runs (B5-01). */
  progress?: { done: number; total: number } | null;
}) {
  const [note, setNote] = useState("");

  // The AppDialog shell stays mounted (Radix owns the close animation),
  // so the note resets on open — same as RejectModal's field.
  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={action === "approve" ? "تأكيد الموافقة الجماعية" : "تأكيد الرفض الجماعي"}
      description={`${formatCount(count, TOPUP_COUNT_FORMS)} سيتم معالجته`}
      dismissable={!loading}
      size="sm"
      footer={
        <>
          {/* R143 (L2-3): the bulk money-confirm pair joins the 44px
              floor the useConfirm twin enforces — h-9 (36px) sat under
              the money-path tap target, and RejectModal's J-1 note
              claiming "BulkConfirmModal already enforce" was false at
              HEAD. active:scale dropped (the Button base's
              press-spring owns the press); labels/handlers/disabled
              wiring byte-identical. */}
          <Button
            variant="outline"
            className="flex-1 min-h-11"
            onClick={onCancel}
            disabled={loading}
          >
            إلغاء
          </Button>
          {/* R143 (L2-3): the reject branch rides variant="destructive"
              (the J-1 AA --destructive-surface pair — ONE register with
              RejectModal's confirm; the hand-rolled fill + /20 shadow
              retire); R157-C: the approve branch rides the NEW
              variant="success" (the same --status-success-surface
              composition TopupCard hand-rolled, now in button.tsx). */}
          <Button
            variant={action === "reject" ? "destructive" : "success"}
            className="flex-1 min-h-11"
            onClick={() => onConfirm(note)}
            disabled={loading}
          >
            {loading && progress
              ? `جاري ${progress.done}/${progress.total}…`
              : loading
                ? "جارٍ المعالجة…"
                : action === "approve"
                  ? "موافقة"
                  : "رفض"}
          </Button>
        </>
      }
    >
      <AppDialogBody>
        {/* R122 (A2-P2): the optional per-action reason — mirrors
            RejectModal's field (label, ⌘/Ctrl+Enter submit, optional). */}
        <div>
          <label
            htmlFor="topups-bulk-note"
            className="text-xs font-bold text-muted-foreground block mb-1.5"
          >
            سبب المعالجة الجماعية <span className="text-muted-foreground">(اختياري)</span>
          </label>
          <textarea
            id="topups-bulk-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              action === "approve"
                ? "مثال: مطابقة كشوف الحسابات المسائية…"
                : "مثال: مراجع غير صحيح، إشعارات مكررة…"
            }
            className="w-full h-20 bg-secondary border border-border rounded-lg px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            /* R143 (L2-5): the money-path note field joins the input.tsx
               focus idiom — focus:ring-1 focus:ring-primary was a 1px
               full-opacity ring compositing under the 3:1 indicator
               floor the shared Input's 2px ring-ring carries (F3-01).
               focus-visible: (not focus:) matches the primitive; the
               field-local ⌘/Ctrl+Enter wiring below is untouched. */
            dir="rtl"
            disabled={loading}
            onKeyDown={(e) => {
              // ESC is Radix's (guarded by `dismissable` while the money
              // loop runs); only the submit shortcut stays field-local.
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !loading) onConfirm(note);
            }}
          />
        </div>
        {/* Live progress (aria-live via role=status) — announced per item
            while the money loop runs; hidden when idle so the static count
            line under the title carries the summary. */}
        <div
          role="status"
          aria-live="polite"
          className="px-1 pt-2 text-xs text-muted-foreground tabular-nums min-h-[1rem]"
        >
          {loading && progress ? `جاري ${progress.done}/${progress.total}…` : ""}
        </div>
      </AppDialogBody>
    </AppDialog>
  );
}
