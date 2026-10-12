import type { ReactNode } from "react";
// 94-C2 (A2 P2-6): the create/edit admin shells migrate from the
// hand-rolled overlay (unguarded backdrop, no ESC/aria/focus-trap) to
// the shared AppDialog — dismissable while busy is false keeps the
// form alive while the POST/PATCH runs.
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";

// R137 (FE decomposition): extracted verbatim from pages/admin/admins.tsx —
// the two dialogs' shared AppDialog shell. The busy flag + close
// callback are page-owned values that flow down; the shell owns no
// state. The move only changes its address; DOM and event semantics are
// byte-identical.

export function AdminDialogShell({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  /** 94-C2 (A2 P2-6): while a save is in flight the dialog is NOT
   * dismissable (ESC / backdrop / close button all guarded) — the old
   * shell's backdrop closed mid-POST and stranded the request with no
   * visible surface for its result. */
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <AppDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
      dismissable={!busy}
    >
      <AppDialogBody>{children}</AppDialogBody>
    </AppDialog>
  );
}
