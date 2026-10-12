import { Button } from "@/components/ui/button";
import { Archive, Eye, EyeOff, X, Zap } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the bulk action bar (selection count + activate/hide/archive/cancel).
// Presentational by contract: the page owns selectedIds + bulkProcessing
// and every destructive branch (bulkToggleActive / bulkDelete with their
// styled confirms, mid-loop 401 guards and summarizeBulk accounting) —
// this bar renders the count and calls the page-owned callbacks. The move
// only changes its address; DOM, classes, aria and event semantics are
// byte-identical.

export function BulkActionBar({
  selectedCount,
  processing,
  onActivate,
  onDeactivate,
  onArchive,
  onClear,
}: {
  selectedCount: number;
  processing: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onArchive: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/8 border border-primary/20 rounded-2xl animate-in fade-in slide-in-from-top-1 duration-150">
      <Zap className="w-4 h-4 text-primary shrink-0" />
      <span className="text-sm font-bold text-primary">{selectedCount} منتج محدد</span>
      <div className="flex gap-2 mr-auto flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 text-status-success border-status-success/25 hover:bg-status-success/10"
          onClick={onActivate}
          disabled={processing}
        >
          <Eye className="w-3 h-3" /> تفعيل
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 text-muted-foreground border-border hover:bg-secondary"
          onClick={onDeactivate}
          disabled={processing}
        >
          <EyeOff className="w-3 h-3" /> إخفاء
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 text-destructive border-destructive/20 hover:bg-destructive/10"
          onClick={onArchive}
          disabled={processing}
        >
          <Archive className="w-3 h-3" /> {processing ? "جارٍ…" : "أرشفة"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={onClear}
        >
          <X className="w-3 h-3 ml-1" /> إلغاء
        </Button>
      </div>
    </div>
  );
}
