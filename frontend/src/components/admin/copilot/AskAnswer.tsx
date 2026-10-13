// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// assistant answer card (markdown-lite body + the copy affordance + the
// tool-trace «مصدر البيانات» details + the direct-execution badges). A
// self-contained FEATURE component in the GlobalSearch (R137 1-f) /
// CopilotPanel-left-layout (R124-I5) precedent: its state is card-LOCAL
// transient copy feedback (copied/copyFailed — nothing outside the card
// reads it), so it moves as a unit with its own hooks; the panel owns the
// conversation truth and passes values only. CopilotPanel re-exports it so
// the clipboard-bypass regression test's import path resolves unchanged.
// ZERO behavior, zero markup change.

import { useState } from "react";
import { Check, Copy, Sparkles, X } from "lucide-react";
import { copyToClipboard } from "@/lib/utils";
import type { DirectExecution, ToolUseTracePreview } from "./copilot-types";
import { DirectExecutionBadge } from "./DirectExecutionBadge";
import { MarkdownLite } from "./MarkdownLite";

/**
 * Assistant answer card with the copy affordance. Exported for the
 * clipboard-bypass regression test (copilot-copy.test.tsx) — the copy
 * path must route through the shared `copyToClipboard` helper and
 * surface failures instead of swallowing them (B6-P2-2).
 */
export function AskAnswer({
  answer,
  toolUses,
  directExecutions,
}: {
  answer: string;
  toolUses: ToolUseTracePreview[];
  directExecutions: DirectExecution[];
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  async function handleCopy() {
    // Shared helper (secure-context check + execCommand fallback +
    // boolean result), mirroring wallet.tsx's CopyBtn (B4 P1-2).
    // The previous raw navigator.clipboard.writeText had `// ignore` as
    // its failure handler: on insecure contexts / strict Firefox the
    // copy died silently AND left an unhandled promise rejection
    // (B6-P2-2 — the only component-scope clipboard bypass).
    const ok = await copyToClipboard(answer);
    if (!ok) {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="space-y-2">
      {directExecutions.length > 0 && (
        <div className="space-y-1.5">
          {directExecutions.map((d, i) => (
            <DirectExecutionBadge key={i} item={d} />
          ))}
        </div>
      )}
      {/* R139 (precision): the counterpart bubble completes the pair —
          bg-muted/40 → /60 + border/50 edge (the tickets user-bubble
          register, TurnView's solid-primary operator twin on the other
          side); shadow-sm retires (thread content rests flat paper). */}
      <div className="group relative bg-muted/60 border border-border/50 rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm">
        <MarkdownLite text={answer} />
        <button
          onClick={() => void handleCopy()}
          className="absolute top-1.5 left-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-2 rounded-md hover:bg-secondary transition-all"
          aria-label={copyFailed ? "تعذّر النسخ" : copied ? "تم النسخ" : "نسخ"}
        >
          {copyFailed ? (
            <X className="w-3 h-3 text-status-error" />
          ) : copied ? (
            <Check className="w-3 h-3 text-status-success" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>
      {toolUses.length > 0 && (
        <details className="text-2xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            مصدر البيانات ({toolUses.length})
          </summary>
          <div className="mt-1.5 space-y-1 pr-3 border-r-2 border-primary/20">
            {toolUses.map((tu, i) => (
              <div key={i} className="font-mono leading-5 text-3xs">
                {/* R139 (precision): text-primary → text-primary-text —
                    the 11px tool name rides the text-safe brand ink (the
                    R126-L5 sweep class; raw primary is a surface color). */}
                <span className="text-primary-text">{tu.name}</span>(
                <span className="text-muted-foreground">{Object.keys(tu.input).length} args</span>)
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
