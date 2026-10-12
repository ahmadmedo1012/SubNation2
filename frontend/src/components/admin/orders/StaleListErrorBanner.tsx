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
      className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span className="min-w-0">{message ?? "تعذّر تحديث قائمة الطلبات"}</span>
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
