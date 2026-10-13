import { WifiOff } from "lucide-react";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the
// stale-list refresh-failure banner (93-C6 / F-07, the referrals.tsx
// idiom). The isError / loadErrorMessage values and the refetch callback
// stay page-owned; the banner renders message + onRetry only. The move
// only changes the address; DOM, classes and aria are byte-identical.

export function StaleListErrorBanner({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      /* R139 (precision): the stale-list banner joins the r138/r139
         calm-error register (the ChartErrorBanner / StaleQueueBanner
         idiom — 139-h flagged this as the lane's last red wall): the
         frame drops the status-error/10 + /25 tinted wall for the card
         family's calm resting chrome, severity concentrates in the
         icon stage (error/8 fill + /22 edge + full-ink glyph — the ONE
         red accent), and the message carries the /80 foreground
         headline register. role=alert + onRetry byte-identical. */
      className="p-3 rounded-2xl bg-card border border-border/60 flex items-center gap-3"
    >
      {/* R139 (precision): the icon stage — w-9 square, an /8 token
          fill + /22 edge; the full-ink glyph carries the state. */}
      <div className="w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0">
        <WifiOff className="w-4 h-4 text-status-error" />
      </div>
      <span className="min-w-0 text-sm font-bold text-foreground/80">
        {message ?? "تعذّر تحديث قائمة الطلبات"}
      </span>
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
