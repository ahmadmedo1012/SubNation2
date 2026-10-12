import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the 96-F7
// masked delivery credential. It was already a self-contained component
// inside the page file (the R135 CopyField precedent): the reveal
// toggle's LOCAL state moves with it — it must reset (re-mask) when the
// row collapses, which is the whole 96-F7 contract — so this leaf
// deliberately owns one useState. It takes NO page state and no
// callbacks beyond its label/value props. The move only changes its
// address; DOM, classes and aria are byte-identical.

// 96-F7 (R96 M7): delivery credentials (email / password) render MASKED
// (••••••) with an eye toggle to reveal + the shared CopyButton per
// value (the topups.tsx idiom, on the canonical 44px component). Both
// the mobile card expansion and the desktop expanded row previously
// printed them in plain mono text — shoulder-surfing exposure in
// public, and no way to copy a long password from a phone. The reveal
// state lives INSIDE the component, so it resets (re-masks) when the
// row collapses. stopPropagation on the root keeps the copy/eye taps
// from toggling the parent row expansion (the mobile card's onClick).
export function MaskedCredential({ label, value }: { label: string; value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div
      className="flex items-center gap-2 min-w-0 flex-wrap text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-muted-foreground shrink-0">{label}: </span>
      <span dir="ltr" className="font-mono font-bold min-w-0 break-all text-left">
        {revealed ? value : "••••••"}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? `إخفاء ${label}` : `إظهار ${label}`}
        aria-pressed={revealed}
        className="p-2 -m-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      <CopyButton text={value} size="sm" />
    </div>
  );
}
