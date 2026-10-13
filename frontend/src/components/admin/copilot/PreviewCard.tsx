// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// Phase-2/3 change preview card (intent header, ChangeDiff rows, side
// effects, validation warnings + the per-state action footer). A
// self-contained FEATURE component in the GlobalSearch (R137 1-f) /
// CopilotPanel-left-layout (R124-I5) precedent: its state is card-LOCAL
// (the 100ms cooldown countdown for the high-risk double-confirm —
// nothing outside the card reads it), so it moves as a unit with its own
// hooks; the panel owns the preview truth + the confirm/cancel mutations
// and passes values + callbacks only. ZERO behavior, zero markup change.

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConversationTurn, PreviewView } from "./copilot-types";
import { ChangeDiff } from "./ChangeDiff";

export function PreviewCard({
  preview,
  state,
  cooldownEndsAt,
  resultUrl,
  onApprove,
  onCancel,
  onDoubleConfirm,
}: {
  preview: PreviewView;
  state: NonNullable<ConversationTurn["previewState"]>;
  cooldownEndsAt: number | null;
  resultUrl: string | null;
  onApprove: () => void;
  onCancel: () => void;
  onDoubleConfirm: () => void;
}) {
  const isHighRisk = preview.risk_tier === "high";
  const isNoExec = preview.risk_tier === "no_execute";
  const changes = preview.payload.changes ?? [];

  // Cooldown countdown for the high-risk path.
  const [remainingMs, setRemainingMs] = useState(() =>
    cooldownEndsAt ? Math.max(0, cooldownEndsAt - Date.now()) : 0,
  );
  useEffect(() => {
    if (state !== "awaiting_double_confirm" || !cooldownEndsAt) return;
    const tick = () => setRemainingMs(Math.max(0, cooldownEndsAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [state, cooldownEndsAt]);
  const cooldownDone = remainingMs <= 0;

  return (
    /* R139 (precision): the preview card rhymes with the assistant-side
       pair — border-border (full) → /50 (the muted-bubble edge value)
       and shadow-sm retires (flat paper); the intent header + action
       footer bands ride the receipt hairline (/20 at the band seams,
       the CartSummaryAside section-rule value). */
    <div className="border border-border/50 rounded-2xl rounded-tr-md bg-muted/20 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/20 flex items-center gap-2 text-2xs bg-muted/30">
        {/* R139 (precision): text-primary → text-primary-text — the 11px
            intent label rides the text-safe brand ink (R126-L5 sweep). */}
        <span className={`font-bold ${isHighRisk ? "text-status-warning" : "text-primary-text"}`}>
          معاينة — {preview.action_class}
        </span>
        <span className="text-muted-foreground">
          • {isHighRisk ? "عالية الخطورة" : isNoExec ? "إحالة لأداة المحفظة" : "منخفضة الخطورة"}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        <div className="text-sm">{preview.intent_summary}</div>

        {changes.length > 0 && (
          <div className="space-y-1.5">
            {changes.map((c, i) => (
              <ChangeDiff key={i} change={c} />
            ))}
          </div>
        )}

        {preview.payload.side_effects.length > 0 && (
          <ul className="text-2xs text-status-warning list-disc pr-4 space-y-0.5">
            {preview.payload.side_effects.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}

        {preview.payload.validation_warnings.map((w, i) => (
          /* R139 (precision): the validation-warning chip joins the
             --status-error family (the console's one red vocabulary —
             TurnView/HistoryView/DirectExecutionBadge migrate with it). */
          <div
            key={i}
            className="text-2xs text-status-error bg-status-error/10 border border-status-error/30 rounded-lg px-2 py-1"
          >
            {w.message}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-border/20 flex items-center gap-2 bg-muted/10">
        {state === "pending" && (
          <>
            {/* R139 (precision): canonical CTA — the hand-rolled
               from-primary→to-primary/70 gradient + hover:brightness +
               shadow-sm retires for the Button family verbatim
               (buttonVariants default surface + press-spring + the ONE
               focus system); the money-critical approve is the console's
               primary action and now reads exactly like every canonical
               CTA in the app. Handler/disabled/label byte-identical —
               and the pinned double-confirm sibling below keeps its
               calm-tinted AA surface untouched. */}
            <Button
              onClick={onApprove}
              disabled={isNoExec}
              size="sm"
              className="flex-1 rounded-xl py-2 font-bold"
            >
              {isHighRisk ? "موافقة (تأكيد أول)" : "موافقة وتنفيذ"}
            </Button>
            <button
              onClick={onCancel}
              className="px-3 py-2 rounded-xl bg-muted hover:bg-muted/70 text-xs transition-colors"
            >
              إلغاء
            </button>
          </>
        )}
        {state === "confirming" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> جارٍ التحقق…
          </div>
        )}
        {state === "awaiting_double_confirm" && (
          <>
            <button
              onClick={onDoubleConfirm}
              disabled={!cooldownDone}
              /* 94-C2 (A2 colors): was a raw amber-500/90 surface +
                 amber-50 ink ≈ 1.9:1 (AA fail) on the money-critical
                 second confirm — now the primary-token treatment the
                 StatusBadge primary variant uses (AA-safe on both
                 themes). (Class names paraphrased so the R128
                 admin-palette negative guard can keep scanning this
                 file for literal raw-hue utilities.) */
              className="flex-1 px-3 py-2 rounded-xl bg-primary/10 border border-primary/40 text-primary-text text-xs font-bold hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {/* R127-L7 (B14-4): the countdown rendered a bare number
                  («الانتظار 3…») on the money-critical double-confirm.
                  Unit added — plural forms follow the BE twin on the
                  same 3s cooldown («مدة الانتظار 3 ثوانٍ», previews.ts). */}
              {cooldownDone
                ? "تأكيد ثانٍ — تنفيذ الآن"
                : `الانتظار ${Math.ceil(remainingMs / 1000)} ${
                    Math.ceil(remainingMs / 1000) === 1
                      ? "ثانية"
                      : Math.ceil(remainingMs / 1000) === 2
                        ? "ثانيتين"
                        : "ثوانٍ"
                  }…`}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-2 rounded-xl bg-muted hover:bg-muted/70 text-xs transition-colors"
            >
              تراجع
            </button>
          </>
        )}
        {state === "double_confirming" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> جارٍ التنفيذ…
          </div>
        )}
        {state === "executed" && (
          <div className="flex items-center gap-2 text-xs text-status-success w-full">
            <CheckCircle2 className="w-3.5 h-3.5" /> تم التنفيذ بنجاح
            {resultUrl && (
              <a
                href={resultUrl}
                /* R139 (precision): text-primary → text-primary-text — the
                   12px result link rides the text-safe brand ink (the
                   R126-L5 sweep class). */
                className="text-primary-text hover:underline flex items-center gap-1 mr-auto"
              >
                فتح <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
        {state === "cancelled" && <div className="text-xs text-muted-foreground">تم الإلغاء</div>}
        {state === "rejected" && (
          <div className="text-xs text-muted-foreground">المرحلة 3 غير مفعّلة — مراجعة فقط</div>
        )}
        {state === "expired" && (
          <div className="text-xs text-muted-foreground">انتهت صلاحية المعاينة (5 دقائق)</div>
        )}
      </div>
    </div>
  );
}
