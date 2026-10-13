import { AlertCircle } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/tickets.tsx —
// the stale-queue inline banner (the orders.tsx StaleListErrorBanner
// idiom): a refresh of an already-rendered queue failed, so the stale
// cards stay visible and the failure surfaces inline instead of
// blanking the list. The page owns the query + the loadError derivation;
// the extract takes the message + the onRetry callback only.

export function StaleQueueBanner({
  loadError,
  onRetry,
}: {
  loadError: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      /* R139 (precision): the stale-queue banner joins the r138
         calm-error register (the ChartErrorBanner idiom): the frame
         drops its status-error/10 + /25 red wall for the card family's
         calm resting chrome (bg-card + border-border/60 + rounded-2xl,
         the same shape as the queue cards it sits above), and the
         error tone concentrates in the icon stage below (an error/8
         fill + /22 edge + full-ink glyph — the ONE red accent on the
         card). The message moves to the /80 foreground headline ink
         and the retry keeps the error ink so the recovery affordance
         reads in the state's voice — severity lives in CONTENT
         (message + role=alert + glyph), not a tinted wall. p-3 keeps
         the queue strip's density (§6). role/alert + onRetry are
         byte-identical. */
      className="p-3 rounded-2xl bg-card border border-border/60 flex items-center gap-3"
    >
      {/* R139 (precision): the icon stage — the calm-error banner's
          w-9 square (an /8 token fill + /22 edge) replaces the bare
          inline glyph; the full-ink glyph carries the state. */}
      <div className="w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0">
        <AlertCircle className="w-4 h-4 text-status-error" />
      </div>
      <span className="min-w-0 text-sm font-bold text-foreground/80">{loadError}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ms-auto shrink-0 text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
