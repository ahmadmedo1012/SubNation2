import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 93-C7 / C-UX3 (A12 §11.2): the shared app dialog shell.
 *
 * Built on Radix `Dialog` primitives, so every instance gets for free:
 * focus trap, ESC handling, scroll-lock, `role="dialog"` +
 * `aria-modal` + labelled/described wiring, and the Radix
 * zoom/slide animation family — the exact list 0/10 hand-rolled
 * overlays had (A12 census H1-H10).
 *
 * Canonical behaviors baked in:
 *   • Mobile bottom-sheet (`rounded-t-2xl` + slide-in-from-bottom) that
 *     becomes a centered card ≥sm — matches the H2-H4/H6/H7 majority.
 *   • Long Arabic content: the BODY scrolls (`overflow-y-auto`), the
 *     header/footer never do, and the whole card is capped at
 *     `max-h-[85vh]`.
 *   • Loading-guarded dismiss: pass `dismissable={false}` while a
 *     mutation is in flight — backdrop click, ESC and the close button
 *     are all prevented, so a half-filled financial form can't be
 *     destroyed by a stray tap (the A12 F-01 / H4-H5 data-loss class).
 *     Idiom proven in TopupWaitingModal's guarded handlers.
 *   • Close button: `aria-label="إغلاق"` + 44px touch target
 *     (94-C3 / A3 P1-3 — was h-9 w-9 = 36px, under the WCAG 2.5.5
 *     mobile floor).
 *
 * Binary confirmations should use `useConfirm()` instead — this shell
 * is for forms and detail overlays.
 */

const APP_DIALOG_SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  wide: "sm:max-w-3xl",
} as const;

export type AppDialogSize = keyof typeof APP_DIALOG_SIZES;

export interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Optional second line under the title (Radix DialogDescription). */
  description?: React.ReactNode;
  /**
   * While `false` (e.g. `dismissable={!saving}`) ESC / backdrop / close
   * button are all blocked — the card can't dismiss mid-mutation.
   */
  dismissable?: boolean;
  /** Width preset (default `md`). */
  size?: AppDialogSize;
  /** Sticky footer row (cancel/confirm buttons) — never scrolls. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Extra classes appended to the content card. */
  className?: string;
}

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  dismissable = true,
  size = "md",
  footer,
  children,
  className,
}: AppDialogProps) {
  // The single guard hook — same idiom as TopupWaitingModal: prevent the
  // default dismiss for ESC (onEscapeKeyDown) and outside interactions
  // (onPointerDownOutside/onInteractOutside) while not dismissable.
  const guardDismiss = React.useCallback(
    (e: Event) => {
      if (!dismissable) e.preventDefault();
    },
    [dismissable],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          onEscapeKeyDown={guardDismiss}
          onPointerDownOutside={guardDismiss}
          onInteractOutside={guardDismiss}
          // Explicit modal semantics (this Radix version sets role +
          // aria-labelledby/describedby but not aria-modal itself).
          aria-modal="true"
          // Radix warns when `aria-describedby` points at a Description
          // that isn't rendered — silence it for optional descriptions.
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            // Mobile: full-width bottom sheet; ≥sm: centered card.
            "fixed inset-x-0 bottom-0 z-50 flex w-full flex-col gap-0",
            "rounded-t-2xl border bg-card shadow-2xl duration-200",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom-4",
            "sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
            "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
            "sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%]",
            "sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]",
            // §11.2 rule 5: outer cap for long Arabic content.
            "max-h-[85vh]",
            APP_DIALOG_SIZES[size],
            className,
          )}
        >
          {/* Header — non-scrolling */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-start font-black text-base leading-snug">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-0.5 truncate text-start text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissable && onOpenChange(false)}
              disabled={!dismissable}
              aria-label="إغلاق"
              title="إغلاق"
              className="flex h-11 w-11 shrink-0 items-center justify-center touch-target rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body — the only scrolling region */}
          <AppDialogBody>{children}</AppDialogBody>

          {footer && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2.5 border-t border-border px-5 py-4">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Scrollable body region — put form fields / detail content here. */
export function AppDialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", className)} {...props} />;
}
