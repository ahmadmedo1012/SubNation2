// R137 (2-a decomposition): the input composer SHELL extracted verbatim
// from CopilotPanel.tsx. Presentational: the panel owns the `input` atom,
// the auto-grow handler (onInputChange), the submit reset and the whole
// send loop — this shell takes the value + callbacks + the shared
// inputRef (values + callbacks only, the checkout CheckoutCta idiom).
// The auto-grow textarea (R133 A4-F8 naming) + the send button survive
// with their a11y byte-identical; R139 (precision) re-chromed the row
// onto the shared Input/Button registers (see in-file comments).

import type { ChangeEvent, RefObject } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MEMORY_TURNS_SENT } from "./copilot-persistence";

export function CopilotComposer({
  value,
  phase2Enabled,
  inputRef,
  onValueChange,
  onSubmit,
}: {
  value: string;
  phase2Enabled: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onValueChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="border-t border-border bg-card px-3 py-3">
      {/* R139 (precision): the input row joins the shared Input register
          — the composite field's edge goes border-muted-foreground/75 on
          a bg-card/60 fill (the input-premium resting recipe) and the
          focus ring rides ring-ring (the ONE focus system's token —
          the old focus-within:ring-primary/30 was a competing brand
          ring at ~2:1). The send button canonicalizes below. */}
      <div className="flex items-end gap-2 bg-card/60 border border-muted-foreground/75 rounded-2xl px-3 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background transition-all">
        <textarea
          ref={inputRef}
          value={value}
          onChange={onValueChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          /* R133 (A4-F8): placeholder-only naming — the
             copilot chat field (one of the audit's 4 admin
             textareas). */
          aria-label="سؤال أو أمر لمساعد الذكاء الاصطناعي"
          placeholder={phase2Enabled ? "اكتب سؤالاً أو أمراً للتعديل…" : "اكتب سؤالك…"}
          className="flex-1 resize-none bg-transparent border-0 text-sm focus:outline-none min-h-[20px] max-h-[240px] py-1"
        />
        {/* R139 (precision): canonical — the hand-rolled gradient disc +
           hover:brightness + shadow-md shadow-primary/20 + active:scale
           retires for the Button family verbatim (buttonVariants surface
           + press-spring + ONE focus system); the mirrored Send glyph,
           aria-label and disabled gate ride byte-identical. */}
        <Button
          onClick={() => onSubmit()}
          disabled={!value.trim()}
          aria-label="إرسال"
          size="icon"
          className="shrink-0"
        >
          <Send className="rtl:-scale-x-100" />
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between text-3xs text-muted-foreground px-1">
        <span>يتذكر آخر {MEMORY_TURNS_SENT} رسائل في هذه المحادثة</span>
        <span className="flex items-center gap-2">
          <kbd className="font-mono bg-muted border border-border/50 px-1 py-0.5 rounded">
            Enter
          </kbd>
          للإرسال
        </span>
      </div>
    </div>
  );
}
