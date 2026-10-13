import { RefreshCw, WifiOff } from "lucide-react";

// R137 (FE admin decomposition): the chart fetch error banner moved verbatim
// from pages/admin/dashboard.tsx — the chartError/chartLoading derivation
// and the refetch mutation stay in the page; the message + retry callback
// flow down.

export function ChartErrorBanner({
  error,
  loading,
  onRetry,
}: {
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}) {
  if (!error || loading) return null;
  return (
    <div
      role="alert"
      /* R139 (precision): the chart-failure banner joins the r138
         calm-error register (FetchErrorCard's re-tune): the frame drops
         its status-error/10 + /25 red wall for the card family's calm
         resting chrome (bg-card + border-border/60 + rounded-2xl —
         same shape as the chart panels it replaces), and the error
         tone concentrates in the icon stage below (bg-status-error/8 +
         /22 edge + full-ink glyph — the ONE red accent on the card).
         The message text moves to text-foreground/80 (the FetchErrorCard
         headline ink) and the retry keeps the error ink so the recovery
         affordance reads in the state's voice — severity lives in
         CONTENT (message + role=alert + icon), not a tinted wall.
         rounded-xl → rounded-2xl rhymes with the charts column's
         cards. aria/handler byte-identical. */
      className="xl:col-span-3 p-4 rounded-2xl bg-card border border-border/60 flex items-center gap-3"
    >
      <div className="w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0">
        <WifiOff className="w-4.5 h-4.5 text-status-error" />
      </div>
      <span className="min-w-0 text-sm font-bold text-foreground/80">{error}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ms-auto shrink-0 flex items-center gap-1 text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80"
      >
        <RefreshCw className="w-3 h-3" />
        إعادة المحاولة
      </button>
    </div>
  );
}
