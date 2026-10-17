// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — one
// empty-state suggestion chip row. Presentational: text + onPick only.
// ZERO markup change (the spark/pencil icon arms ride along byte-identical).

import { Pencil, Sparkles } from "lucide-react";

export function SuggestionRow({
  text,
  onPick,
  icon = "spark",
}: {
  text: string;
  onPick: (s: string) => void;
  icon?: "spark" | "pencil";
}) {
  const Icon = icon === "pencil" ? Pencil : Sparkles;
  return (
    <button
      onClick={() => onPick(text)}
      className="w-full text-start text-xs px-3 py-2.5 rounded-xl bg-muted/30 hover:bg-muted/60 border border-border/30 hover:border-primary/30 transition-all flex items-center gap-2 group"
    >
      {/* R139 (precision): VERIFIED calm at rest — the chip already rides
          the family's inactive pill register (bg-muted/30 + border/30 +
          muted/60 hover wash). The 12px label's hover ink joins the
          R126-L5 sweep: group-hover:text-primary → text-primary-text (the
          text-safe brand ink); the decorative icon keeps its stage ink. */}
      <Icon className="w-3 h-3 text-primary shrink-0" />
      <span className="flex-1 group-hover:text-primary-text transition-colors">{text}</span>
    </button>
  );
}
