import { Button } from "@/components/ui/button";
import { ChevronDown, Download, RefreshCw, X, Zap } from "lucide-react";
import type { RefObject } from "react";
import { BULK_STATUSES } from "@/components/admin/orders/orders-meta";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the bulk
// action bar + the hand-rolled R120-B4 status menu. THE MONEY PATH
// STAYS IN THE PAGE: onApplyStatus IS the page's applyBulkStatus (the
// B5-02 confirm with the TOTAL LYD → the F-008/99-C8 per-click
// Idempotency-Key → the 207 partial-failure parse → the base-key
// invalidation) — it only flows down as a callback. The menu open/close
// STATE and the ESC-focus-return triggerRef stay page-owned too (the
// ref rides down as a prop — the BalanceCard glowRef idiom). The move
// only changes the address; DOM, classes, ARIA menu semantics and the
// keyboard contract are byte-identical.

export function BulkActionBar({
  selectedCount,
  open,
  onToggleMenu,
  onCloseMenu,
  bulkUpdating,
  canBulkRefund,
  triggerRef,
  onApplyStatus,
  onExportSelected,
  onClearSelection,
}: {
  selectedCount: number;
  open: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  bulkUpdating: boolean;
  canBulkRefund: boolean;
  /** R120-B4 (A2-F19): the page-owned menu trigger — ESC returns focus
   *  here when the menu closes (keyboard users rejoin where they left). */
  triggerRef: RefObject<HTMLButtonElement | null>;
  onApplyStatus: (status: string) => void;
  onExportSelected: () => void;
  onClearSelection: () => void;
}) {
  return (
    /* R139 (precision): the bulk bar reads as a distinct floating
       layer now — solid bg-card (r138 retired tinted/glass surfaces on
       action chrome) + the family resting border /60 + the r138
       two-layer calm elevation register (the cart/summary-card
       shadow). Selection identity rides the Zap icon + the
       primary-text count, not the surface. Quiet danger verified: no
       destructive ink at rest anywhere on the bar — the refund
       severity lives in the useConfirm dialog (B5-05), and the refund
       menu entry itself reads info-blue (refunds-as-refunds, §4).
       R143 (L2-1): the calm elevation is now the theme-aware
       `shadow-calm` token in index.css (dark byte-identical; .light
       re-tuned inside the documented 6–14% ceiling). */
    <div className="flex items-center gap-3 px-4 py-2.5 bg-card border border-border/60 rounded-2xl shadow-calm animate-in fade-in slide-in-from-top-1 duration-150 flex-wrap">
      <Zap className="w-4 h-4 text-primary shrink-0" />
      {/* R125-I2 (A6-B6): --primary-text (raw --primary is 3.76:1
          on dark — the text floor is 4.5:1; the Zap icon keeps
          text-primary: icons only need the 3:1 non-text floor). */}
      <span className="text-sm font-bold text-primary-text">{selectedCount} طلب محدد</span>
      <div className="flex gap-2 ms-auto flex-wrap items-center">
        {/* Bulk status dropdown */}
        {/* R120-B4 (A2-F19): menu semantics on the hand-rolled
            dropdown — role="menu"/menuitem, ESC closes + returns
            focus to the trigger, ↑/↓ move between items, focus
            lands on the first item on open. A repo Radix
            DropdownMenu primitive does not exist (components/ui
            ships only alert-dialog/app-dialog) and adding one is
            out of scope — this is the minimal ARIA + keyboard
            contract instead. */}
        <div className="relative">
          <Button
            ref={triggerRef}
            aria-haspopup="menu"
            aria-expanded={open}
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={onToggleMenu}
            disabled={bulkUpdating}
          >
            {bulkUpdating ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" /> جارٍ التحديث…
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> تغيير الحالة
              </>
            )}
          </Button>
          {open && (
            <>
              <div className="fixed inset-0 z-20" onClick={onCloseMenu} />
              <div
                role="menu"
                aria-label="تغيير الحالة الجماعي"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    onCloseMenu();
                    triggerRef.current?.focus();
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const items = Array.from(
                      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
                    );
                    if (items.length === 0) return;
                    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
                    const next =
                      e.key === "ArrowDown"
                        ? items[(idx + 1 + items.length) % items.length]
                        : items[(idx - 1 + items.length) % items.length];
                    next?.focus();
                  }
                }}
                /* R159 (audit motion sweep): duration-100 → 150 — the
                   state-feedback tier + the admin dropdown family's
                   GlobalSearch precedent. */
                className="absolute left-0 top-full mt-1 z-30 bg-card border border-border/60 rounded-2xl shadow-xl overflow-hidden min-w-[160px] animate-in fade-in zoom-in-95 duration-150"
              >
                {BULK_STATUSES.filter(
                  // R120-B4 (A2-F4): the refund entry is
                  // finance-gated (see canBulkRefund above) — it
                  // renders only when the operator can actually
                  // execute it.
                  (s) => s.value !== "refunded" || canBulkRefund,
                ).map((s, i) => (
                  <button
                    key={s.value}
                    role="menuitem"
                    autoFocus={i === 0}
                    onClick={() => onApplyStatus(s.value)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold hover:bg-muted/40 focus:bg-muted/40 focus:outline-none transition-colors text-start ${s.color}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.color.replace("text-", "bg-")}`}
                    />
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={onExportSelected}
        >
          <Download className="w-3 h-3" /> تصدير
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={onClearSelection}
        >
          <X className="w-3 h-3 me-1" /> إلغاء
        </Button>
      </div>
    </div>
  );
}
