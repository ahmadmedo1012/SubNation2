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
          <Button
            variant="outline"
            className="flex-1 h-9 active:scale-[0.97]"
            onClick={onCancel}
            disabled={loading}
          >
            إلغاء
          </Button>
          <Button
            className={`flex-1 h-9 active:scale-[0.97] shadow-sm ${
              action === "approve"
                ? "bg-status-success-surface hover:bg-status-success-surface/90 text-white shadow-status-success-surface/20"
                : "bg-destructive-surface hover:bg-destructive-surface/90 text-destructive-foreground shadow-destructive/20"
            }`}
            onClick={() => onConfirm(note)}
            disabled={loading}
          >
            {loading && progress
              ? `جاري ${progress.done}/${progress.total}...`
              : loading
                ? "جارٍ المعالجة..."
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
                ? "مثال: مطابقة كشوف الحسابات المسائية..."
                : "مثال: مراجع غير صحيح، إشعارات مكررة..."
            }
            className="w-full h-20 bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
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
          {loading && progress ? `جاري ${progress.done}/${progress.total}...` : ""}
        </div>
      </AppDialogBody>
    </AppDialog>
  );
}
