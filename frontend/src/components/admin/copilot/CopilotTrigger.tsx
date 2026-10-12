// R137 (2-a decomposition): the floating launcher extracted verbatim from
// CopilotPanel.tsx. Presentational: onOpen only — the panel owns the open
// atom and the Ctrl/Cmd+J shortcut. ZERO markup change (the gradient
// circle + the R134 A3-F5b single accessible name survive byte-identical).

import { Bot } from "lucide-react";

export function CopilotTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="fixed bottom-6 left-6 z-30 group"
      /* R134 (A3-F5b): ONE accessible name — the B15-11 class. The
         tooltip carried the shortcut while the SR name carried a
         different verb form; both now read identical so a sighted
         mouse user and a screen-reader user hear/see the same
         button. */
      title="المساعد الذكي (فتح — Ctrl/Cmd+J)"
      aria-label="المساعد الذكي (فتح — Ctrl/Cmd+J)"
    >
      <span className="absolute inset-0 rounded-full bg-primary/40 blur-xl group-hover:bg-primary/60 transition-colors" />
      <span className="relative w-14 h-14 rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-2xl group-hover:scale-110 active:scale-95 transition-transform flex items-center justify-center ring-2 ring-primary/30">
        <Bot className="w-6 h-6" />
      </span>
    </button>
  );
}
