import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the buy-receipt's masked credential row. It was already a self-contained
// component inside the page file; the move only changes its address (the
// order-success screen imports it now). DOM, classes and the reveal
// toggle's local state are byte-identical.
export function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  /** 93-C5 / F-15 (A4 #11): mask the value until explicitly revealed —
   * ported from order-detail's CopyField (V2-H10) so the paid password
   * isn't shoulder-surfable in the first second after purchase on this
   * screen too. Previously rendered in cleartext here while order-detail
   * masked the exact same credential. */
  secret?: boolean;
}) {
  const [revealed, setRevealed] = useState(!secret);
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        {/* 96-F4 (R96 A6 #1): no uppercase/tracking-wider on Arabic labels —
            letter-spacing tears the cursive joins (ج/ح/خ disconnect). */}
        <div className="text-3xs text-muted-foreground font-bold mb-0.5">{label}</div>
        {/* 96-F4 (R96 A2 P1-5): the credential VALUE lives in a NON-button
            selectable element (select-text + break-all) — the old markup
            trapped it inside the copy <button> (unselectable on iOS) and
            clipped it at max-w-[160px] truncate, leaving zero fallback
            when copy failed. dir="ltr" isolation kept from V2-H10: the
            exact data the user PAID for must read (and copy) correctly. */}
        <div
          dir="ltr"
          className="font-mono font-bold text-sm break-all leading-snug text-left select-text"
        >
          {revealed ? value : "•".repeat(Math.min(value.length, 12))}
        </div>
        {secret && (
          /* 96-F4 (R96 A2 P1-4): reveal is its own 44px control on the
              LABEL side — visually separated from the copy affordance on
              the opposite side (they used to be twin pills; a mis-tap hit
              the neighbor's identical pill). */
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            className="mt-2 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-xs font-bold transition-all duration-180 border press-spring bg-muted/40 text-muted-foreground border-border/35 hover:bg-primary/10 hover:text-primary-text hover:border-primary/22"
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {revealed ? "إخفاء" : "إظهار"}
          </button>
        )}
      </div>
      {/* 96-F4 (R96 A2 P1-3): the shared CopyButton (size="md", min-h-11)
          replaces the local reimplementation — copy failure now announces
          itself («تعذّر النسخ») instead of silently keeping the label. */}
      <CopyButton text={value} size="md" />
    </div>
  );
}
