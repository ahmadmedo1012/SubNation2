import {
  CheckCheck,
  CheckCircle,
  CheckSquare,
  Loader2,
  Search,
  Square,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusFilterTabs } from "@/components/admin/topups/StatusFilterTabs";
import type { AdminTopupRow } from "@/components/admin/topups/topups-queue-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the queue's action toolbar: the client-side search box, the bulk
// approve/reject triggers, select-all and approve-all. setBulkAction only
// OPENS the BulkConfirmModal (a plain state flip) — the money POSTs fire
// exclusively from the page-owned onConfirm handlers (handleBulkAction /
// approveAll) behind that modal, never here; the selection atoms and
// isApproveAllBusy stay centralized in the page. The move only changes
// its address; DOM, classes, aria and Arabic copy are byte-identical.

export function TopupsToolbar({
  search,
  setSearch,
  selectedPendingCount,
  setBulkAction,
  handleSelectAll,
  allPendingSelected,
  pendingTopups,
  pendingCount,
  isApproveAllBusy,
  approveAllProgress,
  hasNextPage,
  statusFilter,
  setStatusFilter,
  allTopups,
}: {
  search: string;
  setSearch: (value: string) => void;
  selectedPendingCount: number;
  setBulkAction: (action: "approve" | "reject" | "approveAll") => void;
  handleSelectAll: () => void;
  allPendingSelected: boolean;
  pendingTopups: AdminTopupRow[];
  pendingCount: number;
  isApproveAllBusy: boolean;
  approveAllProgress: { done: number; total: number } | null;
  hasNextPage: boolean;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  allTopups: AdminTopupRow[];
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* R124-I5 (A6 F14a): the money queue's search box — the
          orders/users/products chrome (icon-in-box + ✕ clear).
          Filters the ACCUMULATED pages client-side; see the
          honest-range hint below the header when pages remain. */}
      <div className="relative order-first w-full sm:order-none sm:w-auto">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          placeholder="بحث برقم التحويل أو الهاتف…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pr-9 h-9 w-full sm:w-52 text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="مسح البحث"
            /* 93-C6 / F-07 (A5 S-6): the orders.tsx ✕-button hit-area
               fix — p-2 lifts the tappable area to ~28px. */
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {selectedPendingCount > 0 && (
        <>
          <Button
            size="sm"
            /* R125-I2 (A6-B3): variant="outline" — the missing
             * variant left the DEFAULT primary gradient under the
             * emerald label. Outline keeps the success ink on the
             * card surface (the reject sibling's recipe). R128
             * (A1-F1): the ink/border/hover triple moves to the
             * theme-aware --status-* tokens. */
            variant="outline"
            className="h-9 gap-1.5 text-status-success border-status-success/25 hover:bg-status-success/10 text-xs"
            onClick={() => setBulkAction("approve")}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            موافقة ({selectedPendingCount})
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 border-status-error/30 text-status-error hover:bg-status-error/10 text-xs"
            onClick={() => setBulkAction("reject")}
          >
            <XCircle className="w-3.5 h-3.5 ml-1.5" />
            رفض ({selectedPendingCount})
          </Button>
        </>
      )}

      {pendingTopups.length > 0 && (
        <button
          onClick={handleSelectAll}
          /* R125-I2 (A6-B10 / A1-6): aria-pressed + the
             state-aware label — the select-all feeding the bulk
             money actions was visual-only AND its label never
             flipped (orders.tsx:1529-1536 names the state). */
          aria-pressed={allPendingSelected}
          aria-label={
            allPendingSelected
              ? "إلغاء تحديد كل طلبات الشحن قيد الانتظار"
              : "تحديد كل طلبات الشحن قيد الانتظار"
          }
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/60 bg-secondary/30 hover:bg-secondary/50 transition-colors text-xs"
        >
          {allPendingSelected ? (
            <CheckSquare className="w-3.5 h-3.5 text-primary" />
          ) : (
            <Square className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="text-muted-foreground">
            {allPendingSelected ? "إلغاء اختيار الكل" : "اختيار الكل"}
          </span>
        </button>
      )}

      {pendingCount > 1 && selectedPendingCount === 0 && (
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 text-status-success border-status-success/25 hover:bg-status-success/10 text-xs"
          onClick={() => setBulkAction("approveAll")}
          disabled={isApproveAllBusy}
        >
          {isApproveAllBusy && approveAllProgress ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCheck className="w-3.5 h-3.5" />
          )}
          {isApproveAllBusy && approveAllProgress
            ? `جاري ${approveAllProgress.done}/${approveAllProgress.total}...`
            : /* R134 (the R126-A1-11 close-out): while more pages
                 remain unloaded, «الكل» over-promises — the loop
                 only iterates the loaded window. The label now
                 says what will actually run; the count shown is
                 at least accurate for the window. */
              hasNextPage
              ? `موافقة المعروض (${pendingCount})`
              : `موافقة الكل (${pendingCount})`}
        </Button>
      )}

      {/* Status filter tabs */}
      <StatusFilterTabs
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        allTopups={allTopups}
      />
    </div>
  );
}
