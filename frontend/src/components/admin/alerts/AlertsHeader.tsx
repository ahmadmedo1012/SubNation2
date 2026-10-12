import { Button } from "@/components/ui/button";
import { CheckCheck, RefreshCw, Trash2 } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/alerts.tsx —
// the inbox header + its three bulk action buttons (قراءة الكل / حذف
// المقروءة / حذف الكل) and the manual refresh affordance. The five
// mutations those buttons fire stay in the page — this shell takes the
// pending flags + callbacks down and owns NO state; the confirm-gated
// destructive flows run through the page's onDeleteRead/onDeleteAll
// (useConfirm) handlers. The move only changes its address; DOM,
// classes, aria and Arabic copy are byte-identical.

export function AlertsHeader({
  unreadCount,
  readCount,
  alertsCount,
  markAllPending,
  deleteReadPending,
  deleteAllPending,
  onRefresh,
  onMarkAllRead,
  onDeleteRead,
  onDeleteAll,
}: {
  unreadCount: number;
  readCount: number;
  alertsCount: number;
  markAllPending: boolean;
  deleteReadPending: boolean;
  deleteAllPending: boolean;
  onRefresh: () => void;
  onMarkAllRead: () => void;
  /** R123 (E3 item 3) / R125 (A3 #6): confirm-gated in the page. */
  onDeleteRead: () => void;
  /** R125 (A3 #6): confirm-gated in the page (names the count). */
  onDeleteAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">صندوق التنبيهات</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          سجل تنبيهات النظام — المخزون، الكوبونات، والأحداث المهمة
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <button
          onClick={onRefresh}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="تحديث"
          aria-label="تحديث التنبيهات"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onMarkAllRead}
            disabled={markAllPending}
            className="gap-1.5 text-xs h-8"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            قراءة الكل
          </Button>
        )}

        {readCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDeleteRead}
            disabled={deleteReadPending}
            className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-destructive hover:border-destructive/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
            حذف المقروءة ({readCount})
          </Button>
        )}

        {alertsCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDeleteAll}
            disabled={deleteAllPending}
            className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
            حذف الكل
          </Button>
        )}
      </div>
    </div>
  );
}
