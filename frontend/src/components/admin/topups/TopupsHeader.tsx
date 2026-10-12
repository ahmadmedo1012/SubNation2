import { AlertTriangle } from "lucide-react";
import { formatCount, formatCurrency, statusLabel } from "@/lib/utils";
import { TOPUP_COUNT_FORMS } from "@/components/admin/topups/topups-queue-meta";
import type { AdminTopupRow } from "@/components/admin/topups/topups-queue-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the money queue's stat strip (title, the live pending chip and the
// honest count lines). Every value it renders (pendingCount, knownTotal,
// statusFilter, searchActive + the three memoized lists) stays
// centralized in the page and flows down as props; the extract owns no
// state and no callbacks. The move only changes its address; DOM,
// classes, aria and Arabic copy are byte-identical.

export function TopupsHeader({
  pendingCount,
  knownTotal,
  statusFilter,
  searchActive,
  allTopups,
  topups,
  pendingTopups,
}: {
  pendingCount: number;
  knownTotal: boolean;
  statusFilter: string;
  searchActive: boolean;
  allTopups: AdminTopupRow[];
  topups: AdminTopupRow[];
  pendingTopups: AdminTopupRow[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-0.5">
        <h1 className="text-xl font-bold">طلبات الشحن</h1>
        {pendingCount > 0 && (
          /* R125-I2 (A6-B4 + A1-8): raw yellow-400 ink on the light
             admin theme is 1.43-1.53:1 — the --status-warning token
             pair is both-theme safe; and the label derives from the
             statusLabel vocabulary («قيد الانتظار», like the tabs
             below) instead of the drifted «معلق». */
          <span className="flex items-center gap-1 bg-status-warning/15 text-status-warning border border-status-warning/25 text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
            <AlertTriangle className="w-3 h-3" />
            {pendingCount} قيد الانتظار
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {/* 94-C2 (A2 P1-1): honest count — «إجمالاً» only when a
            single short page proves the whole queue fits; the
            accumulating list labels what it actually shows. The
            pending chip below counts the LOADED pending rows; the
            sidebar badge carries the server-side truth. */}
        <span>
          {/* R126-L3 (A1-10): the count line names the ACTIVE tab
              when one is on — with the per-tab server-side fetch
              the numbers describe that tab's server-filtered
              window, and the qualifier keeps «إجمالاً» from
              reading as the whole queue's total. */}
          {knownTotal
            ? `${formatCount(allTopups.length, TOPUP_COUNT_FORMS)} إجمالاً${statusFilter ? ` (${statusLabel(statusFilter)})` : ""}`
            : `عرض ${formatCount(allTopups.length, TOPUP_COUNT_FORMS)}${statusFilter ? ` (${statusLabel(statusFilter)})` : ""} (الأحدث أولاً)`}
        </span>
        {/* R124-I5 (A6 F14a): honest search-result count — the
            header keeps describing the loaded window; the filter's
            own result set is labeled separately (never «إجمالاً»). */}
        {searchActive && (
          <>
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
            <span>نتائج البحث: {formatCount(topups.length, TOPUP_COUNT_FORMS)}</span>
          </>
        )}
        {pendingCount > 0 &&
          (() => {
            /* R125-I2: memoized pendingTopups replaces the fresh
               per-render filter (A5-F2). */
            const pendingTotal = pendingTopups.reduce(
              (s: number, t) => s + (Number(t.amount) || 0),
              0,
            );
            return pendingTotal > 0 ? (
              <>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                {/* R125-I2 (A6-B4 + A1-8): status-warning ink (both
                    themes) + the statusLabel vocabulary — «معلق»
                    never matched the «قيد الانتظار» tabs. */}
                <span className="text-status-warning font-bold tabular-nums">
                  {formatCurrency(pendingTotal)} إجمالي قيد الانتظار
                </span>
              </>
            ) : null;
          })()}
      </div>
    </div>
  );
}
