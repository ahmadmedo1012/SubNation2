// R137 (2-a decomposition): the floating launcher extracted verbatim
// from CopilotPanel.tsx. Presentational: onOpen only — the panel owns
// the open atom and the Ctrl/Cmd+J shortcut. The R134 A3-F5b single
// accessible name survived the r137 move byte-identical; R139 (precision)
// re-chromed the surface (see the in-file comment) — a11y + handler
// untouched.

import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopilotTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    /* R139 (precision): canonical launcher — the pre-r138 chrome (the
       bg-primary/40 blur-xl glow HALO layer + the gradient disc +
       shadow-2xl + ring-2) retires for the Button family verbatim:
       buttonVariants' default surface (gradient fill + border +
       shadow-md shadow-primary/25), press-spring, and the ONE
       focus-visible system. The glow halo was the design language's
       banned vocabulary (FINAL_UX_SYSTEM §1); the fixed w-14 FAB
       geometry + the R134 A3-F5b single accessible name survive
       byte-identical. */
    <Button
      onClick={onOpen}
      /* R134 (A3-F5b): ONE accessible name — the B15-11 class. The
         tooltip carried the shortcut while the SR name carried a
         different verb form; both now read identical so a sighted
         mouse user and a screen-reader user hear/see the same
         button. */
      title="المساعد الذكي (فتح — Ctrl/Cmd+J)"
      aria-label="المساعد الذكي (فتح — Ctrl/Cmd+J)"
      className="fixed bottom-6 left-6 z-30 w-14 h-14 rounded-full"
    >
      <Bot className="w-6 h-6" />
    </Button>
  );
}
