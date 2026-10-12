// R137 (2-a decomposition): the input composer SHELL extracted verbatim
// from CopilotPanel.tsx. Presentational: the panel owns the `input` atom,
// the auto-grow handler (onInputChange), the submit reset and the whole
// send loop — this shell takes the value + callbacks + the shared
// inputRef (values + callbacks only, the checkout CheckoutCta idiom).
// ZERO markup change: the auto-grow textarea (R133 A4-F8 naming), the
// send button and the memory hint row survive byte-identical.

import type { ChangeEvent, RefObject } from "react";
import { Send } from "lucide-react";
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
    <div className="border-t border-border bg-card/95 px-3 py-3">
      <div className="flex items-end gap-2 bg-background border border-border rounded-2xl px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
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
        <button
          onClick={() => onSubmit()}
          disabled={!value.trim()}
          className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center shrink-0 shadow-md shadow-primary/20 transition-all active:scale-95"
          aria-label="إرسال"
        >
          <Send className="w-4 h-4 rtl:-scale-x-100" />
        </button>
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
