import { Button } from "@/components/ui/button";
import { KeyRound, RefreshCw } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/whatsapp.tsx —
// the sessions section header (title row + the aria-labelled refresh icon
// button). loading/refreshing ride down as values (the R125-I5 A3-4c
// first-load skeleton vs silent-refresh spin split); the refresh fires
// through the page-owned onRefresh (the sessions list reload). The move
// only changes its address; DOM, classes and Arabic copy are byte-identical.

export function SessionsSectionHeader({
  loading,
  refreshing,
  onRefresh,
}: {
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
      <div className="flex items-center gap-2 font-bold">
        <KeyRound className="w-4 h-4 text-primary" />
        الجلسات الحالية
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        disabled={loading || refreshing}
        aria-label="تحديث"
      >
        <RefreshCw className={loading || refreshing ? "animate-spin" : ""} />
      </Button>
    </div>
  );
}
