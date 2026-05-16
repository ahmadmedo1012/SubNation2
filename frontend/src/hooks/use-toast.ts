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
   * Visual style:
   *   - "default"     → neutral / informational
   *   - "destructive" → red, used for errors and destructive confirms
   * Maps to `sonnerToast.error()` for destructive, plain `sonnerToast()` otherwise.
   */
  variant?: "default" | "destructive";
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
export function toast(input: ToastInput): ToastHandle {
  const opts: Parameters<typeof sonnerToast>[1] = {
    description: input.description ?? undefined,
    duration: input.duration ?? 4000,
    id: input.id,
  };

  const titleText = input.title ?? "";

  let id: string | number;
  if (input.variant === "destructive") {
    id = sonnerToast.error(titleText, opts);
  } else {
    id = sonnerToast(titleText, opts);
  }

  return {
    id,
    dismiss: () => sonnerToast.dismiss(id),
    update: (next) => {
      const updateOpts: Parameters<typeof sonnerToast>[1] = {
        description: next.description ?? undefined,
        duration: next.duration ?? 4000,
        id,
      };
      if (next.variant === "destructive") {
        sonnerToast.error(next.title ?? "", updateOpts);
      } else {
        sonnerToast(next.title ?? "", updateOpts);
      }
    },
  };
}

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
