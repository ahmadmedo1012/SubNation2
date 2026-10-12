import { Button } from "@/components/ui/button";
import { RefreshCw, ShieldAlert } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/risk.tsx —
// the page header (h1 + subtitle + the «تحديث» refresh CTA). The refresh
// fires through the page-owned onRefresh (which refetches BOTH the
// dashboard and events queries); the busy flag is a page value passed
// DOWN. The move only changes its address; DOM, classes and Arabic copy
// are byte-identical.

export function RiskHeader({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <header className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-primary" />
          مراقبة المخاطر
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          أحداث الأمان والاحتيال المرصودة من خط أنابيب التسجيل (003-anomaly-detection)
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        className="gap-2"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        تحديث
      </Button>
    </header>
  );
}
