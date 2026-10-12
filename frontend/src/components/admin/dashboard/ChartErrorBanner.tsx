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
      className="xl:col-span-3 p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span className="min-w-0">{error}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ms-auto flex items-center gap-1 text-xs underline underline-offset-2 hover:opacity-80"
      >
        <RefreshCw className="w-3 h-3" />
        إعادة المحاولة
      </button>
    </div>
  );
}
