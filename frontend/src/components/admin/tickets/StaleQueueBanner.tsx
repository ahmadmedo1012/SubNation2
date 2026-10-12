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
      className="p-3 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
    >
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{loadError}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
