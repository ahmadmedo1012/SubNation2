import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Drop-in async replacement for `window.confirm()` that renders a
 * styled, theme-aware, RTL-correct dialog.
 *
 *   const confirm = useConfirm();
 *
 *   if (!(await confirm({ title: "حذف المنتج؟" }))) return;
 *   await deleteProduct(id);
 *
 * One dialog instance per consuming component — call `useConfirm()`
 * at the top of any component that needs confirmations and render
 * `<ConfirmDialog />` from its return value once in the JSX. Multiple
 * consecutive `confirm({...})` calls reuse the same dialog mount.
 *
 * Why not a global provider: the existing toast system is already
 * scoped per consumer (each admin page imports `useToast`); matching
 * that pattern keeps the API consistent and avoids needing a new
 * provider in App.tsx (which would force a re-render on every
 * confirm change).
 */

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses a destructive (red) treatment. */
  destructive?: boolean;
}

interface DialogState extends ConfirmOptions {
  open: boolean;
}

const DEFAULT_STATE: DialogState = { open: false, title: "" };

export function useConfirm() {
  const [state, setState] = useState<DialogState>(DEFAULT_STATE);
  // Resolver of the pending promise — set when confirm() is called,
  // cleared when the dialog closes. Held in a ref so updating it
  // doesn't re-render and accidentally close the dialog.
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  // A4-F3 (R120-B2): the element that had focus when confirm() opened.
  // This dialog is controlled/programmatic — there is no Radix
  // <AlertDialogTrigger>, so on close Radix has no trigger to return
  // focus to and document.activeElement lands on <body>, dropping
  // keyboard users back to the top of the tab order mid-task.
  const invokerRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // If a previous confirm is somehow still pending (rare — a
      // double-tap on the trigger button before the dialog opened),
      // resolve it as cancelled so the caller's await unblocks.
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
      // Capture BEFORE opening — after the dialog mounts, focus moves
      // into it and the invoker would be lost.
      if (typeof document !== "undefined") {
        invokerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      resolverRef.current = resolve;
      setState({ open: true, ...opts });
    });
  }, []);

  // A4-F3 (R120-B2): hand focus back to the invoking element. Guarded —
  // the invoker may have unmounted while the dialog was open (list
  // re-render, navigation), in which case focus stays where Radix
  // left it instead of throwing on a detached node.
  const restoreInvokerFocus = useCallback(() => {
    const el = invokerRef.current;
    invokerRef.current = null;
    if (el && el.isConnected) el.focus();
  }, []);

  const settle = useCallback((value: boolean) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
    setState((s) => ({ ...s, open: false }));
  }, []);

  const ConfirmDialog = useCallback(() => {
    return (
      <AlertDialog
        open={state.open}
        onOpenChange={(open) => {
          // Radix calls onOpenChange(false) on outside-click / ESC.
          // Treat that as cancel so the caller's await unblocks.
          if (!open) settle(false);
        }}
      >
        <AlertDialogContent
          /* A4-F3 (R120-B2): fires once on every close path (cancel
             click, action click, ESC) AFTER Radix would otherwise move
             focus — preventDefault stops the body-focus default and
             returns focus to the captured invoker instead. */
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            restoreInvokerFocus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{state.title}</AlertDialogTitle>
            {state.description && (
              <AlertDialogDescription>{state.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {state.cancelLabel ?? "إلغاء"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={
                state.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {state.confirmLabel ?? "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }, [state, settle, restoreInvokerFocus]);

  return { confirm, ConfirmDialog };
}
