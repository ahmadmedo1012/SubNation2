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
import { isValidElement } from "react";
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
  /** Auto-dismiss in ms. Defaults by severity (94-C3 / A3 P3-1):
   * 8s for destructive/warning, 4s otherwise. */
  duration?: number;
  /** Stable id — passing the same id replaces an existing toast (dedup). */
  id?: string | number;
  /** 96-main (R96 F-7b): sonner action button — used by the SW-update
   * toast («إعادة التحميل»). Untouched by every other variant path. */
  action?: {
    label: ReactNode;
    onClick: () => void;
  };
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
/**
 * Severity-aware auto-dismiss (94-C3 / A3 P3-1).
 *
 * The old flat 4s swallowed real errors: a long Arabic failure
 * message ("تعذّر إرسال الرمز…") needs reading time the success
 * confirmation doesn't. Errors and warnings — the variants a user
 * may need to ACT on — stay twice as long; success/info keep the
 * snappy default. Explicit `duration` still wins for every variant.
 */
const SUCCESS_DURATION = 4_000;
const CRITICAL_DURATION = 8_000;

function defaultDuration(variant: ToastInput["variant"]): number {
  return variant === "destructive" || variant === "warning" ? CRITICAL_DURATION : SUCCESS_DURATION;
}

function emit(input: ToastInput, idOverride?: string | number): string | number {
  const opts: Parameters<typeof sonnerToast>[1] = {
    description: input.description ?? undefined,
    duration: input.duration ?? defaultDuration(input.variant),
    id: idOverride ?? input.id,
    // 96-main (R96 F-7b): pass-through — only the SW-update toast sets it.
    action: input.action,
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
/**
 * Helper-argument normalizer (R116): the variant helpers historically
 * took a positional `description` ReactNode, but sonner-idiomatic callers
 * (and the A5-5 replay tests) pass sonner's own shape —
 * `toast.error(title, { description, duration, action, id })`. Accept
 * BOTH: a non-element object is treated as the opts bag, anything else
 * stays the legacy positional description. No existing callsite changes.
 */
function helperInput(
  title: ReactNode,
  second: ReactNode | Omit<ToastInput, "title" | "variant"> | undefined,
  variant: ToastInput["variant"],
): ToastInput {
  if (
    second !== null &&
    typeof second === "object" &&
    !isValidElement(second) &&
    !Array.isArray(second)
  ) {
    const { description, duration, action, id } = second as Omit<ToastInput, "title" | "variant">;
    return { title, description, duration, action, id, variant };
  }
  return { title, description: second, variant };
}

toast.success = (title: ReactNode, second?: Parameters<typeof helperInput>[1]) =>
  toast(helperInput(title, second, "success"));
toast.error = (title: ReactNode, second?: Parameters<typeof helperInput>[1]) =>
  toast(helperInput(title, second, "destructive"));
toast.warning = (title: ReactNode, second?: Parameters<typeof helperInput>[1]) =>
  toast(helperInput(title, second, "warning"));
toast.info = (title: ReactNode, second?: Parameters<typeof helperInput>[1]) =>
  toast(helperInput(title, second, "info"));

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
