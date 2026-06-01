/**
 * Thin Sonner shim that preserves the `toast({ title, description, variant })`
 * API used across the codebase, while delegating to Sonner under the hood.
 *
 * Why a shim:
 *   - The previous Radix-based reducer in this file shipped with the shadcn/ui
 *     template's `TOAST_REMOVE_DELAY = 1000000` (~16.6 min) bug — toasts were
 *     marked dismissed but never auto-removed from the DOM, causing the
 *     "stuck on screen" behaviour reported in production.
 *   - It also coexisted with `components/ui/sonner.tsx`, leaving the codebase
 *     with two parallel toast systems where Sonner-based callers (e.g.
 *     `hooks/use-socket.ts`) were silently no-op'd because the Sonner
 *     `<Toaster />` was never mounted.
 *
 * Migration: 22 files call `toast({ title, description, variant?: "destructive" })`.
 * This shim accepts the same shape; existing callsites need no changes. The
 * old `useToast()` hook returned `{ toast, dismiss, toasts }`; we preserve
 * `toast` and `dismiss` (the only two used in callers), and the `toasts`
 * array is no longer exposed — Sonner manages its own internal stack.
 */

import { toast as sonnerToast } from "sonner";
import type { ReactNode } from "react";

export interface ToastInput {
  /** Primary text. Maps to Sonner's heading. */
  title?: ReactNode;
  /** Secondary text under the title. Maps to Sonner's `description`. */
  description?: ReactNode;
  /**
   * Visual style. The premium toast surface adds a leading accent strip,
   * tinted icon bubble and colored shadow for each variant. Mapping:
   *   - "default" / "info" → blue informational toast
   *   - "success"          → green confirmation toast
   *   - "warning"          → amber caution toast
   *   - "destructive"      → red error toast (back-compat alias for the old
   *                          shadcn API; existing 22 callsites keep working)
   */
  variant?: "default" | "destructive" | "success" | "warning" | "info";
  /** Auto-dismiss in ms. Default 4000 (Sonner default). */
  duration?: number;
  /** Stable id — passing the same id replaces an existing toast (dedup). */
  id?: string | number;
}

export interface ToastHandle {
  id: string | number;
  dismiss: () => void;
  update: (next: ToastInput) => void;
}

/**
 * Show a toast. Returns a handle for programmatic dismiss / update.
 *
 * @example
 *   toast({ title: "تم", description: "تم حفظ التغييرات" });
 *   toast({ title: "خطأ", description: msg, variant: "destructive" });
 */
function emit(input: ToastInput, idOverride?: string | number): string | number {
  const opts: Parameters<typeof sonnerToast>[1] = {
    description: input.description ?? undefined,
    duration: input.duration ?? 4000,
    id: idOverride ?? input.id,
  };
  const titleText = input.title ?? "";

  switch (input.variant) {
    case "destructive":
      return sonnerToast.error(titleText, opts);
    case "success":
      return sonnerToast.success(titleText, opts);
    case "warning":
      return sonnerToast.warning(titleText, opts);
    case "info":
      return sonnerToast.info(titleText, opts);
    default:
      return sonnerToast(titleText, opts);
  }
}

export function toast(input: ToastInput): ToastHandle {
  const id = emit(input);
  return {
    id,
    dismiss: () => sonnerToast.dismiss(id),
    update: (next) => {
      emit(next, id);
    },
  };
}

/**
 * Convenience helpers for the new variants. Existing callers can keep
 * using `toast({ variant: "destructive", ... })`; new code can read
 * cleaner with `toast.success(...)` etc.
 */
toast.success = (title: ReactNode, description?: ReactNode) =>
  toast({ title, description, variant: "success" });
toast.error = (title: ReactNode, description?: ReactNode) =>
  toast({ title, description, variant: "destructive" });
toast.warning = (title: ReactNode, description?: ReactNode) =>
  toast({ title, description, variant: "warning" });
toast.info = (title: ReactNode, description?: ReactNode) =>
  toast({ title, description, variant: "info" });

/**
 * Hook variant — returns the same `toast` function plus a global `dismiss(id?)`.
 *
 * Returning the function reference is intentional: the previous shadcn
 * implementation also exposed a stable reference, and call sites pass it
 * to `useEffect` / `useCallback` deps without churn.
 */
export function useToast(): {
  toast: typeof toast;
  dismiss: (toastId?: string | number) => void;
} {
  return {
    toast,
    dismiss: (toastId) => {
      if (toastId === undefined) {
        sonnerToast.dismiss();
      } else {
        sonnerToast.dismiss(toastId);
      }
    },
  };
}
