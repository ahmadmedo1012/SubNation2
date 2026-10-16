import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  CheckSquare,
  Hash,
  MessageSquare,
  Smartphone,
  Square,
  User,
  UserCheck,
  XCircle,
} from "lucide-react";
import React from "react";
// R124-I5 (A6 F8): the shared copy affordance replaces the local
// CopyButton re-implementation that lived in this file (idle→copied→failed
// state machine, ~45 lines) — the shared one carries strictly better
// hygiene (type="button" form-safety, 44px hit box, tracked reset timer,
// aria-live label swap) and orders.tsx already rides it.
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { formatCurrency, formatDate, statusLabel } from "@/lib/utils";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { MethodBadge } from "@/components/admin/topups/MethodBadge";
import { NetworkBadge } from "@/components/admin/topups/NetworkBadge";
import type { AdminTopupRow } from "@/components/admin/topups/topups-queue-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the money queue's row card. The React.memo discipline and the props
// contract ride along untouched: idx/isSelected/isProcessing/isRejecting
// are primitives and the three handlers (onSelect/onApprove/onReject) are
// the PAGE's useCallback-stable money-path callbacks — the extract never
// owns a mutation, a setter or state; a stale closure here can never
// approve the wrong topup. The move only changes its address; DOM,
// classes, aria and Arabic copy are byte-identical.

/* ── R125-I2 (A5-F2): memoized topup rows ──────────────────────────────
 * The money queue missed the R118-B2/R124-I5 memoization pass the
 * sibling big-list pages (orders/users/products/referrals) received:
 * the search box is a CONTROLLED input, and the cards were inline JSX
 * in the map closure with fresh handlers per render — every keystroke
 * (and every processingId/selectedIds flip) re-rendered ALL loaded
 * cards. The queue accumulates 100 rows/page with no cap on load-more
 * (300 cards ≈ a real active-day depth ≈ 10k+ DOM nodes reconciled per
 * keystroke).
 *
 * The row is now a module-level React.memo component (the orders.tsx
 * DesktopOrderRow/MobileOrderCard pattern): `topup` refs come from the
 * memoized allTopups → topups chain, idx/isSelected/isProcessing/
 * isRejecting are primitives, and the three handlers are
 * useCallback-stable — so a keystroke re-renders the search box and
 * NOTHING else; a selection/processing flip busts exactly ONE card.
 * Display-only: the approve/reject/bulk mutation flows are untouched
 * (same handlers, same confirm gating, same Idempotency-Key lifecycle). */
interface TopupCardProps {
  topup: AdminTopupRow;
  /** Position in `topups` — drives the entrance stagger clamp. */
  idx: number;
  isSelected: boolean;
  /** processingId === topup.id — disables both action buttons. */
  isProcessing: boolean;
  /** processingId === topup.id && rejectTarget?.id === topup.id — the
   *  reject modal is open on this row (its confirm label wins over
   *  the row approve «جارٍ...»). */
  isRejecting: boolean;
  onSelect: (id: number) => void;
  onApprove: (id: number) => void;
  onReject: (topup: AdminTopupRow) => void;
}

export const TopupCard = React.memo(function TopupCard({
  topup: t,
  idx,
  isSelected,
  isProcessing,
  isRejecting,
  onSelect,
  onApprove,
  onReject,
}: TopupCardProps) {
  return (
    <div
      /* R139 (precision): the queue card joins the row register (the
         r138-e cart line-data precedent — a queue row is line data,
         not a tile): the colored resting glow
         (shadow-status-warning/4) and the hover elevation
         (hover:shadow-md) retire — no glow halos, no per-row
         elevation. The pending triage mark survives on the warning
         border + the top strip, and hover becomes a border step
         only: non-pending /60→/100 (the family resting step),
         pending warning /20→/40 so the semantic mark survives hover.
         transition-all narrows to the colors it still animates. */
      className={`float-in stagger-${Math.min(idx + 1, 8)} bg-card rounded-2xl border overflow-hidden transition-colors ${
        t.status === "pending"
          ? "border-status-warning/20 hover:border-status-warning/40"
          : "border-border/60 hover:border-border"
      }`}
    >
      {t.status === "pending" && (
        <div className="h-0.5 bg-gradient-to-l from-status-warning/50 via-status-warning/25 to-transparent" />
      )}

      <div className="p-4">
        {/* Checkbox row (pending only) */}
        {t.status === "pending" && (
          <div className="flex items-center mb-3">
            <button
              onClick={() => onSelect(t.id)}
              className="p-1 rounded hover:bg-secondary/50 transition-colors"
              /* A1-6 (R125): per-row naming — the generic «اختيار»/
                 «إلغاء الاختيار» labels were indistinguishable across
                 the queue; orders.tsx:256 names the row it selects. */
              aria-label={`تحديد طلب الشحن ${t.id} للإجراء الجماعي`}
              /* R124-I5 (A6 F10): the selection state feeding the
                 bulk money actions was visual-only — aria-pressed
                 exposes it (the orders.tsx row-selector idiom). */
              aria-pressed={isSelected}
            >
              {isSelected ? (
                <CheckSquare className="w-4 h-4 text-primary" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>
        )}

        {/* Top row: amount + badges + date */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="font-bold text-xl tabular-nums">{formatCurrency(t.amount)}</span>
          {/* R116: shared StatusBadge (STATUS_TONE) replaces the
              deprecated statusColor() — 93-C7 follow-up. */}
          <StatusBadge
            variant={STATUS_TONE[t.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE}
            size="sm"
          >
            {statusLabel(t.status)}
          </StatusBadge>
          <MethodBadge method={t.payment_method ?? "mobile_transfer"} />
          {t.payment_method !== "lypay" && <NetworkBadge net={t.payment_network} />}
          <span className="mr-auto text-xs text-muted-foreground tabular-nums flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {t.created_at ? formatDate(t.created_at) : ""}
          </span>
        </div>

        {/* Details row */}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-3">
          <div className="flex items-center gap-1.5 text-xs">
            <User className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">المستخدم:</span>
            <span className="font-mono font-bold text-foreground">
              {displayUserName(userFromRow(t))}
            </span>
            <CopyButton text={t.user_phone} />
          </div>
          {t.sender_phone && (
            <div className="flex items-center gap-1.5 text-xs">
              <Smartphone className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">المُرسل:</span>
              <span className="font-mono font-bold text-foreground">{t.sender_phone}</span>
              <CopyButton text={t.sender_phone} />
            </div>
          )}
          {t.payment_reference && (
            <div className="flex items-center gap-1.5 text-xs">
              <Hash className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">رمز التحويل:</span>
              <span className="font-mono text-xs text-foreground">{t.payment_reference}</span>
              <CopyButton text={t.payment_reference} />
            </div>
          )}
          {t.sender_account && (
            <div className="flex items-center gap-1.5 text-xs">
              <User className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">الحساب:</span>
              <span className="font-mono font-bold text-foreground">{t.sender_account}</span>
              <CopyButton text={t.sender_account} />
            </div>
          )}
        </div>

        {/* Admin note — R154 (P1-A): also rendered on PENDING rows now:
            the duplicate-risk signal for ref-less mobile transfers is
            written into admin_note at creation (wallet.ts route) and
            must reach the operator BEFORE the ✅ tap, styled as the
            warning it is. Terminal rows keep the muted register. */}
        {t.admin_note &&
          (t.status === "pending" ? (
            <div className="flex items-start gap-2 text-xs text-status-warning bg-status-warning/8 border border-status-warning/22 px-3 py-2 rounded-lg mb-3 leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{t.admin_note}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 border border-border/50 px-3 py-2 rounded-lg mb-3">
              <MessageSquare className="w-3 h-3 shrink-0" />
              {t.admin_note}
            </div>
          ))}

        {/* R116 (A4-04): reviewer attribution — who acted on this
            topup and when (V1-M23 reviewed_by + reviewed_at). */}
        {t.status !== "pending" && (t.reviewed_by || t.reviewed_at) && (
          <div className="flex items-center gap-2 text-2xs text-muted-foreground mb-3">
            <UserCheck className="w-3 h-3 shrink-0" />
            {t.reviewed_by ? `أُقرّ بواسطة ${t.reviewed_by}` : "تمت المراجعة"}
            {t.reviewed_at ? ` · ${formatDate(t.reviewed_at)}` : ""}
          </div>
        )}

        {/* Actions — pending only */}
        {t.status === "pending" && (
          <div className="border-t border-border/40 pt-3">
            <div className="flex gap-2">
              <Button
                size="sm"
                /* R125-I2 (A6-B5): white on emerald-600 measured 3.77:1
                 * — under the 4.5:1 floor (bold 14px is NOT large text);
                 * the emerald-700 hand-roll was the stopgap. R128
                 * (A1-F2): --status-success-surface (152 65% 30% dark /
                 * 152 60% 28% light) = 5.05:1 with white in BOTH themes
                 * — the token replaces the raw pair. hover rides the
                 * Button family's /90 idiom. */
                className="flex-1 h-9 bg-status-success-surface hover:bg-status-success-surface/90 text-white font-bold shadow-sm shadow-status-success-surface/20 active:scale-[0.97] transition-transform"
                onClick={() => onApprove(t.id)}
                disabled={isProcessing}
              >
                <CheckCircle className="w-3.5 h-3.5 ml-1.5" />
                {isProcessing && !isRejecting ? "جارٍ..." : "موافقة"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                /* R139 (precision): quiet danger at rest (the toolbar
                   bulk-reject twin's recipe) — neutral border/60 +
                   muted ink at rest; the error ink surfaces on hover
                   and the severity lives in RejectModal's destructive
                   confirm. The solid-success approve sibling stays
                   the loud one (the money-creating action). */
                className="h-9 border-border/60 text-muted-foreground hover:text-status-error hover:border-status-error/30 hover:bg-status-error/10 font-bold active:scale-[0.97] transition-transform px-5"
                onClick={() => onReject(t)}
                disabled={isProcessing}
              >
                <XCircle className="w-3.5 h-3.5 ml-1.5" />
                رفض
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
