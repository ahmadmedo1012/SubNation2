import { Package } from "lucide-react";

// R137 (closing decomposition): extracted verbatim from pages/product.tsx —
// the outage card (the isError early return that is NOT a 404). The page
// keeps the branch condition and passes the two recovery callbacks down;
// DOM, classes, Arabic copy and the R125-I7 tap-floor comments are
// byte-identical (the only substitution is the documented prop rebind:
// refetchProduct/navigate → onRetry/onNavigateHome arrows).
export function ProductOutageCard({
  onRetry,
  onNavigateHome,
}: {
  onRetry: () => void;
  onNavigateHome: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto px-4 py-20 text-center text-muted-foreground">
      <div className="w-16 h-16 rounded-2xl bg-status-error/8 border border-status-error/22 mx-auto mb-4 flex items-center justify-center">
        <Package className="w-7 h-7 text-status-error" aria-hidden="true" />
      </div>
      <p className="font-bold mb-1 text-foreground/80">تعذّر تحميل المنتج</p>
      <p className="text-sm mb-3">حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة</p>
      <div className="flex items-center justify-center gap-2.5">
        {/* R125-I7 (A7 B-4): both recovery buttons ride the 44px tap
            floor (min-h-11) — the drifted px-5 py-2 measured ~37px.
            The two-button row (retry + escape hatch) stays bespoke
            per the R124-I8 extraction ledger. */}
        <button
          onClick={() => onRetry()}
          className="min-h-11 text-sm font-bold text-primary-text border border-primary/25 px-5 rounded-xl hover:bg-primary/8 transition-colors press-spring"
        >
          إعادة المحاولة
        </button>
        <button
          onClick={() => onNavigateHome()}
          className="min-h-11 text-sm text-muted-foreground hover:text-foreground border border-border/50 px-5 rounded-xl transition-colors press-spring"
        >
          العودة للكتالوج
        </button>
      </div>
    </div>
  );
}
