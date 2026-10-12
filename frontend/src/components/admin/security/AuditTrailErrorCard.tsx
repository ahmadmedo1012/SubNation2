import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the audit tab's failed-load card (94-C2 A2 P2-1 idiom: a failed load
// is an error card with retry — NOT a false «لا توجد إجراءات» empty).
// The page owns the auditQuery + the auditError derivation; the extract
// takes the message + the onRetry callback only.

export function AuditTrailErrorCard({
  auditError,
  onRetry,
}: {
  auditError: string;
  onRetry: () => void;
}) {
  return (
    <div className="text-center py-10 text-muted-foreground">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
        <WifiOff className="w-7 h-7 text-status-error" />
      </div>
      <p className="font-bold text-base mb-1.5 text-foreground/80">تعذّر تحميل سجل الإجراءات</p>
      <p className="text-sm mb-5 max-w-xs mx-auto leading-relaxed">{auditError}</p>
      <Button onClick={onRetry} className="gap-2 font-bold" variant="outline" size="sm">
        <RefreshCw className="w-3.5 h-3.5" />
        إعادة المحاولة
      </Button>
    </div>
  );
}
