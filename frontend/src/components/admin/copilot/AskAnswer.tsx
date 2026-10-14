// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// assistant answer card (markdown-lite body + the copy affordance + the
// tool-trace «مصدر البيانات» details + the direct-execution badges). A
// self-contained FEATURE component in the GlobalSearch (R137 1-f) /
// CopilotPanel-left-layout (R124-I5) precedent: its only state was the
// card-LOCAL transient copy feedback (copied/copyFailed — nothing outside
// the card read it). R146 (components audit F9): that lifecycle folded
// onto THE shared CopyButton's icon-only rendering — the card is now
// values-only, its reset timers are tracked/cleared like every other
// copy surface, and the markup is byte-identical. CopilotPanel
// re-exports it so the clipboard-bypass regression test's import path
// resolves unchanged.

import { Sparkles } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
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
        {/* R146 (components audit F9): THE shared copy affordance, icon-only
            — the overlay classes are this surface's own; the lifecycle
            (helper routing + failure feedback + tracked reset timers) is
            CopyButton's, pinned by copilot-copy + copy-button suites. */}
        <CopyButton
          text={answer}
          iconOnly
          className="absolute top-1.5 left-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-2 rounded-md hover:bg-secondary transition-all"
        />
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
