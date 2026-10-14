import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy, X } from "lucide-react";
import { copyToClipboard } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  label?: string;
  size?: "sm" | "md";
  /** R146 (components audit F9): icon-only rendering for surfaces that
   * overlay the affordance on content (copilot's AskAnswer) — the button
   * carries no visible label, so the accessible name rides the full
   * sentence forms ("نسخ" / "تم النسخ" / "تعذّر النسخ") via aria-label. */
  iconOnly?: boolean;
  /** With iconOnly: the surface's own positioning classes (the overlay
   * idiom has no house variant — each surface places it differently). */
  className?: string;
}

/**
 * THE copy affordance (94-C3 / A3 conceptual-dedup #4).
 *
 * One implementation of the idle → copied → failed lifecycle so every
 * surface (wallet, order codes, copilot answers…) shares it instead of
 * re-rolling local `copied` state. The previously missing piece was the
 * failure branch: `copyToClipboard` resolves `false` on insecure
 * contexts / denied permission, and the old button silently kept the
 * "نسخ" label — the user had no idea the copy never happened. Failure
 * now announces itself ("تعذّر النسخ") on every surface, with the same
 * 1.5s/2s reset windows (copilot's AskAnswer was the last local copy
 * of this lifecycle — R146 components audit F9 folded it here).
 *
 * Also carries the 94-C3 hygiene fixes:
 *   • type="button" — safe inside any <form> (previously submitted it)
 *   • the reset timeout is tracked + cleared on re-click/unmount
 *     (A3 P3-10)
 *   • text-primary-text token instead of raw text-primary (A3 P2-4)
 *   • 44px minimum hit box (A3 P1-3 — was ~24×24 in the sm variant)
 */
export function CopyButton({
  text,
  label = "نسخ",
  size = "sm",
  iconOnly = false,
  className,
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  // Reset timer is tracked so a re-click mid-window or an unmount
  // can't leave a stale timer flipping the label back.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    // permission denied / insecure context → visible failure, not a lie
    const ok = await copyToClipboard(text);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState(ok ? "copied" : "failed");
    resetTimer.current = setTimeout(() => setState("idle"), ok ? 1500 : 2000);
  };

  const isMd = size === "md";
  const fullLabel = state === "copied" ? "تم النسخ" : state === "failed" ? "تعذّر النسخ" : label;
  const shownLabel = isMd
    ? fullLabel
    : state === "copied"
      ? "تم"
      : state === "failed"
        ? "تعذّر"
        : label;
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        aria-live="polite"
        aria-label={fullLabel}
        className={className}
      >
        {state === "copied" ? (
          <Check className="w-3 h-3 text-status-success" />
        ) : state === "failed" ? (
          <X className="w-3 h-3 text-status-error" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    );
  }

  const iconClass = isMd ? "w-3.5 h-3.5" : "w-3 h-3";
  const stateTone =
    state === "failed"
      ? "bg-destructive/10 hover:bg-destructive/18 text-destructive"
      : "bg-primary/10 hover:bg-primary/18 text-primary-text";

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-live="polite"
      className={`flex min-h-11 items-center justify-center ${
        isMd ? "gap-1.5 px-3 py-2 text-sm" : "gap-1 px-2.5 py-2 text-xs"
      } rounded-lg ${stateTone} font-bold transition-all active:scale-95 shrink-0`}
    >
      {state === "copied" ? (
        <Check className={iconClass} />
      ) : state === "failed" ? (
        <AlertCircle className={iconClass} />
      ) : (
        <Copy className={iconClass} />
      )}
      {shownLabel}
    </button>
  );
}
