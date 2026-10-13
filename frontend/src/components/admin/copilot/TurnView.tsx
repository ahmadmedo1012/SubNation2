// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — one
// conversation turn row (the user question bubble, the live tool-trace
// progress feed, the error banner with its retry affordance, the ask
// answer card and the draft preview card). Presentational: the turn DTO +
// callbacks only — the panel owns the conversation truth and the
// approve/cancel/double-confirm/retry mutations. ZERO markup change (the
// «جارٍ التفكير…»/«جارٍ المعالجة…» arms and the R134 A3-F5 retry label
// survive byte-identical).

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { ConversationTurn } from "./copilot-types";
import { AskAnswer } from "./AskAnswer";
import { PreviewCard } from "./PreviewCard";
import { ProgressTraceLine } from "./ProgressTraceLine";

export function TurnView({
  turn,
  onApprove,
  onCancel,
  onDoubleConfirm,
  onRetry,
}: {
  turn: ConversationTurn;
  onApprove: () => void;
  onCancel: () => void;
  onDoubleConfirm: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      {/* User question */}
      <div className="flex justify-end">
        {/* R139 (precision): the pair treatment rhymes with the tickets
           thread (TicketDetailPane's admin bubble — the operator side
           rides the SOLID brand fill, no gradient, no border, no
           elevation): from-primary/15→to-primary/5 gradient + border +
           shadow-sm retire for bg-primary + primary-foreground. The
           assistant counterpart (AskAnswer) rides the muted/60 + /50
           edge — one coherent pair, mirrored corners. */}
        <div className="max-w-[88%] bg-primary text-primary-foreground rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm whitespace-pre-wrap">
          {turn.question}
        </div>
      </div>

      {turn.loading && (
        <div className="space-y-1 pr-1">
          {(turn.progress ?? []).map((line, i) => (
            <ProgressTraceLine key={i} line={line} />
          ))}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            {(turn.progress ?? []).length === 0 ? "جارٍ التفكير…" : "جارٍ المعالجة…"}
          </div>
        </div>
      )}

      {turn.error && (
        /* R139 (precision): the error banner joins the --status-error
           family (the TurnView/HistoryView/DirectExecutionBadge triples
           all migrate this round — one red vocabulary in the console);
           the retry affordance + copy byte-identical. */
        <div className="flex items-start gap-2 text-xs text-status-error bg-status-error/10 border border-status-error/30 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{turn.error}</span>
          <button
            onClick={onRetry}
            className="text-2xs hover:underline shrink-0 flex items-center gap-1"
            /* R134 (A3-F5): the console's canonical retry label — one
               concept one word (fetch-error-card's «إعادة المحاولة»). */
            title="إعادة المحاولة"
          >
            <RefreshCw className="w-3 h-3" /> إعادة المحاولة
          </button>
        </div>
      )}

      {turn.kind === "ask" && turn.answer && (
        <AskAnswer
          answer={turn.answer}
          toolUses={turn.toolUses ?? []}
          directExecutions={turn.directExecutions ?? []}
        />
      )}

      {turn.kind === "draft" && turn.preview && (
        <PreviewCard
          preview={turn.preview}
          state={turn.previewState ?? "pending"}
          cooldownEndsAt={turn.cooldownEndsAt ?? null}
          resultUrl={turn.resultUrl ?? null}
          onApprove={onApprove}
          onCancel={onCancel}
          onDoubleConfirm={onDoubleConfirm}
        />
      )}
    </div>
  );
}
