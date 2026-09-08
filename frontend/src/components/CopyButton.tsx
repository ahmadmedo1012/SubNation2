import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  label?: string;
  size?: "sm" | "md";
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
 * now announces itself ("تعذّر النسخ") exactly like CopilotPanel's
 * AskAnswer copy does, with the same 1.5s/2s reset windows.
 *
 * Also carries the 94-C3 hygiene fixes:
 *   • type="button" — safe inside any <form> (previously submitted it)
 *   • the reset timeout is tracked + cleared on re-click/unmount
 *     (A3 P3-10)
 *   • text-primary-text token instead of raw text-primary (A3 P2-4)
 *   • 44px minimum hit box (A3 P1-3 — was ~24×24 in the sm variant)
 */
export function CopyButton({ text, label = "نسخ", size = "sm" }: CopyButtonProps) {
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
    resetTimer.current = setTimeout(
      () => setState("idle"),
      ok ? 1500 : 2000,
    );
  };

  const isMd = size === "md";
  const shownLabel =
    state === "copied"
      ? isMd
        ? "تم النسخ"
        : "تم"
      : state === "failed"
        ? isMd
          ? "تعذّر النسخ"
          : "تعذّر"
        : label;
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
