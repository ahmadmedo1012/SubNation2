import { Bell, BellOff, Check } from "lucide-react";
import type { FilterType } from "@/components/admin/alerts/alerts-inbox-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/alerts.tsx —
// the loaded-but-filtered empty branch (R125 A6 B-8: role="status" so the
// loaded→empty transition announces). The unread/all split rides the
// page's filter atom down as a prop. The move only changes its address;
// DOM, classes, aria and Arabic copy are byte-identical.

export function AlertsEmptyState({ filter }: { filter: FilterType }) {
  return (
    // R125 (A6 B-8): role="status" — the loaded→empty transition
    // now announces (the shared EmptyState got the same role).
    <div
      role="status"
      className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground"
    >
      <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center">
        {filter === "unread" ? (
          <Bell className="w-7 h-7 text-muted-foreground" />
        ) : (
          <BellOff className="w-7 h-7 text-muted-foreground" />
        )}
      </div>
      <div className="text-center">
        <div className="font-semibold text-foreground/60">
          {filter === "unread" ? "لا توجد تنبيهات غير مقروءة" : "لا توجد تنبيهات"}
        </div>
        <div className="text-xs mt-1 text-muted-foreground">
          {/* R128-A6 (P4-4): ✓ text glyph → lucide Check (the
              product.tsx:1959 pattern) — icon on the reading line,
              aria-hidden, AT reads the Arabic only. */}
          {filter === "unread" ? (
            <span className="inline-flex items-center gap-1 justify-center">
              أنت على اطلاع كامل بكل شيء
              <Check className="w-3 h-3 text-status-success" aria-hidden />
            </span>
          ) : (
            "ستظهر هنا تنبيهات المخزون والكوبونات تلقائياً"
          )}
        </div>
      </div>
    </div>
  );
}
