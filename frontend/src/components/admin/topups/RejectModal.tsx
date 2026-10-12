import { useEffect, useState } from "react";
import { XCircle } from "lucide-react";
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the single-reject dialog shell. The ONLY state it carries is the
// field-local note draft (reset on open; submitted up via the
// onConfirm(note) callback) — it never imports a mutation or the money
// APIs: the reject POST, its Idempotency-Key and the processingId/
// rejectTarget atoms stay in the page, which passes open/loading/
// onConfirm/onCancel down. The move only changes its address; DOM,
// classes, copy and event semantics are byte-identical.

// Reject modal
// F3-03 (R111 WCAG 4.1.2 + 2.4.3): this was a hand-rolled `fixed` div —
// no role="dialog"/aria-modal, no focus trap (Tab walked out into the
// page behind the money modal), no focus return, ESC handled only from
// inside the textarea. It now rides the shared AppDialog shell (Radix):
// focus trap + return, ESC/backdrop guarded while the reject POST is in
// flight via `dismissable`, and a real DialogTitle names the dialog.
// Form logic (note state, ⌘/Ctrl+Enter submit, guarded dismiss) and the
// Arabic copy are preserved as-is.
export function RejectModal({
  topup,
  open,
  onConfirm,
  onCancel,
  loading,
}: {
  topup: {
    id: number;
    amount: number;
    user_phone: string;
    user_display_name?: string | null;
    user_email?: string | null;
    user_auth_provider?: string | null;
    user_has_google?: boolean;
    user_has_telegram?: boolean;
    user_has_firebase?: boolean;
    user_has_whatsapp?: boolean;
    status: string;
    payment_network?: string;
    created_at?: string;
  } | null;
  open: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [note, setNote] = useState("");

  // The old modal unmounted on close (fresh note each open). AppDialog
  // stays mounted so Radix owns the close animation + focus return —
  // so the note resets on open instead.
  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title="تأكيد الرفض"
      description={
        topup ? (
          <>
            <span className="font-mono font-bold text-foreground">
              {formatCurrency(topup.amount)}
            </span>{" "}
            · {displayUserName(userFromRow(topup))}
          </>
        ) : undefined
      }
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
            className="flex-1 h-9 bg-destructive hover:bg-destructive/90 text-destructive-foreground active:scale-[0.97] shadow-sm shadow-destructive/20"
            onClick={() => onConfirm(note)}
            disabled={loading}
          >
            <XCircle className="w-3.5 h-3.5 ml-1.5" />
            {loading ? "جارٍ الرفض..." : "تأكيد الرفض"}
          </Button>
        </>
      }
    >
      <AppDialogBody>
        <div>
          <label
            htmlFor="topups-f1-28266"
            className="text-xs font-bold text-muted-foreground block mb-1.5"
          >
            سبب الرفض <span className="text-muted-foreground">(اختياري)</span>
          </label>
          <textarea
            id="topups-f1-28266"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: رمز التحويل غير صحيح، المبلغ غير مطابق..."
            className="w-full h-20 bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-destructive resize-none"
            dir="rtl"
            autoFocus
            onKeyDown={(e) => {
              // ESC is handled by Radix (guarded by `dismissable` while
              // the request is in flight — the 94-C2 guarded-dismiss
              // contract). Only the submit shortcut stays field-local.
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !loading) onConfirm(note);
            }}
          />
          <p className="text-3xs text-muted-foreground mt-1">
            <kbd className="font-mono bg-muted/60 border border-border/50 px-1 rounded">⌘↵</kbd>{" "}
            للتأكيد ·
            <kbd className="font-mono bg-muted/60 border border-border/50 px-1 rounded mr-1">
              Esc
            </kbd>{" "}
            للإلغاء
          </p>
        </div>
      </AppDialogBody>
    </AppDialog>
  );
}
