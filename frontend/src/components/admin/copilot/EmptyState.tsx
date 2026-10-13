// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// empty-conversation state (hero + the suggestion chip list). Presentational:
// flags + onPick only, the chips ride SuggestionRow + the copilot-intent
// copy constants. ZERO markup change (the phase3 super-suggestion gate and
// the Arabic copy survive byte-identical).

import { Sparkles } from "lucide-react";
import type { PhaseFlags } from "./copilot-types";
import { ASK_SUGGESTIONS, SUPER_SUGGESTIONS } from "./copilot-intent";
import { SuggestionRow } from "./SuggestionRow";

export function EmptyState({ flags, onPick }: { flags: PhaseFlags; onPick: (s: string) => void }) {
  return (
    <div className="space-y-4 py-2">
      <div className="text-center space-y-2">
        {/* R139 (precision): the hero tile drops its decorative gradient
            (from-primary/30 → /10) for the page-header icon-stage family
            (bg-primary/10 + border-primary/20 + primary ink — the
            ReferralsHeader/PromotionsHeader tile register). */}
        <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-primary" />
        </div>
        <div className="font-bold text-sm">كيف يمكنني مساعدتك؟</div>
        <div className="text-xs text-muted-foreground leading-6 max-w-xs mx-auto">
          اطرح سؤالاً أو اكتب أمراً للتعديل بأي لغة (عربي، إنجليزي، أو خليط).
          {flags.phase3_enabled && " التعديلات منخفضة الخطورة تُنفّذ مباشرة."}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-2xs text-muted-foreground font-bold pr-1">أمثلة سريعة</div>
        {ASK_SUGGESTIONS.map((s) => (
          <SuggestionRow key={s} text={s} onPick={onPick} />
        ))}
        {flags.phase3_enabled && (
          <>
            {SUPER_SUGGESTIONS.map((s) => (
              <SuggestionRow key={s} text={s} onPick={onPick} icon="pencil" />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
