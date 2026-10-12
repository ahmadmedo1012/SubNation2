// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — one
// preview change row (the before/after diff tile the PreviewCard renders
// per field). Presentational: the PreviewChange DTO only. ZERO markup
// change (the null→«(فارغ)» formatter and the قبل/بعد columns survive
// byte-identical).

import type { PreviewChange } from "./copilot-types";

export function ChangeDiff({ change }: { change: PreviewChange }) {
  const fmt = (v: unknown) => {
    if (v === null || v === undefined) return "(فارغ)";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  };
  return (
    <div className="border border-border/40 rounded-lg bg-background/50 overflow-hidden">
      <div className="px-2 py-1 text-2xs font-bold text-muted-foreground border-b border-border/40 bg-muted/20">
        {change.field}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border/40">
        <div className="bg-destructive/5 px-2 py-1.5 text-xs whitespace-pre-wrap break-words">
          <div className="text-3xs text-muted-foreground mb-0.5">قبل</div>
          {fmt(change.before)}
        </div>
        <div className="bg-status-success/5 px-2 py-1.5 text-xs whitespace-pre-wrap break-words">
          <div className="text-3xs text-muted-foreground mb-0.5">بعد</div>
          {fmt(change.after)}
        </div>
      </div>
    </div>
  );
}
