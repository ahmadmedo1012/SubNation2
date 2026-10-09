import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
// R124-I5 (A6 F8): the shared copy affordance replaces the local
// CopyButton re-implementation that lived in this file (idle→copied→failed
// state machine, ~45 lines) — the shared one carries strictly better
// hygiene (type="button" form-safety, 44px hit box, tracked reset timer,
// aria-live label swap) and orders.tsx already rides it.
import { CopyButton } from "@/components/CopyButton";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/admin/EmptyState";
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { formatCount, formatCurrency, formatDate, statusLabel } from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  approveTopup,
  customFetch,
  getListAdminTopupsQueryKey,
  type AdminTopup,
  rejectTopup,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCheck,
  CheckCircle,
  CheckSquare,
  Clock,
  Hash,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Smartphone,
  Square,
  User,
  UserCheck,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

type AdminTopupRow = AdminTopup & { payment_method?: string; sender_account?: string };

function MethodBadge({ method }: { method: string }) {
  if (method === "lypay")
    return (
      <span className="inline-flex items-center gap-1 text-3xs bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded-full font-bold">
        <Building2 className="w-2.5 h-2.5" /> LyPay
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-3xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded-full font-bold">
      <Smartphone className="w-2.5 h-2.5" /> تحويل رصيد
    </span>
  );
}

function NetworkBadge({ net }: { net?: string | null }) {
  if (!net) return null;
  const map: Record<string, { label: string; cls: string }> = {
    libyana: { label: "ليبيانا", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
    madar: { label: "مدار", cls: "text-blue-400  bg-blue-500/10  border-blue-500/20" },
  };
  const d = map[net] ?? { label: net, cls: "text-muted-foreground bg-muted border-border" };
  return (
    <span className={`text-3xs px-1.5 py-0.5 rounded-full border font-bold ${d.cls}`}>
      {d.label}
    </span>
  );
}

// R124-I5 (A6 F2): tab labels derive from statusLabel — the same map
// that feeds the row badges (the tickets.tsx STATUS_FILTERS pattern). The
// tabs previously hand-rolled «معلق»/«مقبول» while the badges on the very
// same cards read «قيد الانتظار»/«موافق عليه» — one status can never show
// two different Arabic words on one page (the status-badge invariant).
const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  ...(["pending", "approved", "rejected"] as const).map((s) => ({
    value: s,
    label: statusLabel(s),
  })),
];

/** 94-C2 (A2 P1-1): page size for the topup queue — the backend
 *  truncates at 100 rows with NO page param (money queue), so the
 *  frontend now drives the frozen `?page=&limit=` contract itself and
 *  accumulates pages in place. 100 keeps the first payload identical
 *  to what the route already returned. */
const TOPUPS_PAGE_SIZE = 100;

/** Arabic plural forms for the queue counter (formatCount, A2 P3-4). */
const TOPUP_COUNT_FORMS = {
  zero: "طلبات",
  one: "طلب",
  two: "طلبان",
  few: "طلبات",
  many: "طلبًا",
  other: "طلب",
};

function TopupCardSkeleton() {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4">
      <div className="flex items-center gap-4 mb-3">
        <div className="h-7 bg-muted skeleton-shimmer rounded-lg w-24" />
        <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14" />
        <div className="h-5 bg-muted skeleton-shimmer rounded-full w-16" />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="h-4 bg-muted skeleton-shimmer rounded-md w-full" />
        <div className="h-4 bg-muted skeleton-shimmer rounded-md w-4/5" />
      </div>
      <div className="h-9 bg-muted skeleton-shimmer rounded-xl" />
    </div>
  );
}

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

const TopupCard = React.memo(function TopupCard({
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
      className={`float-in stagger-${Math.min(idx + 1, 8)} bg-card rounded-2xl border overflow-hidden transition-all hover:shadow-md hover:shadow-black/10 ${
        t.status === "pending"
          ? "border-yellow-400/20 shadow-sm shadow-yellow-400/4"
          : "border-border/60"
      }`}
    >
      {t.status === "pending" && (
        <div className="h-0.5 bg-gradient-to-l from-yellow-400/50 via-yellow-400/25 to-transparent" />
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

        {/* Admin note */}
        {t.admin_note && t.status !== "pending" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 border border-border/50 px-3 py-2 rounded-lg mb-3">
            <MessageSquare className="w-3 h-3 shrink-0" />
            {t.admin_note}
          </div>
        )}

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
                /* R125-I2 (A6-B5): white on emerald-600 is 3.77:1 —
                 * under the 4.5:1 text floor (bold 14px is NOT large
                 * text). emerald-700 (#047857) = 5.48:1 in both themes
                 * (the audit's computed fix). Surface-only change. */
                className="flex-1 h-9 bg-emerald-700 hover:bg-emerald-600 text-white font-bold shadow-sm shadow-emerald-700/20 active:scale-[0.97] transition-transform"
                onClick={() => onApprove(t.id)}
                disabled={isProcessing}
              >
                <CheckCircle className="w-3.5 h-3.5 ml-1.5" />
                {isProcessing && !isRejecting ? "جارٍ..." : "موافقة"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold active:scale-[0.97] transition-transform px-5"
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

// Reject modal
// F3-03 (R111 WCAG 4.1.2 + 2.4.3): this was a hand-rolled `fixed` div —
// no role="dialog"/aria-modal, no focus trap (Tab walked out into the
// page behind the money modal), no focus return, ESC handled only from
// inside the textarea. It now rides the shared AppDialog shell (Radix):
// focus trap + return, ESC/backdrop guarded while the reject POST is in
// flight via `dismissable`, and a real DialogTitle names the dialog.
// Form logic (note state, ⌘/Ctrl+Enter submit, guarded dismiss) and the
// Arabic copy are preserved as-is.
function RejectModal({
  topup,
  open,
  onConfirm,
  onCancel,
  loading,
}: {
  topup: {
    id: number;
    amount: number;
    user_phone: string;
    user_display_name?: string | null;
    user_email?: string | null;
    user_auth_provider?: string | null;
    user_has_google?: boolean;
    user_has_telegram?: boolean;
    user_has_firebase?: boolean;
    user_has_whatsapp?: boolean;
    status: string;
    payment_network?: string;
    created_at?: string;
  } | null;
  open: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [note, setNote] = useState("");

  // The old modal unmounted on close (fresh note each open). AppDialog
  // stays mounted so Radix owns the close animation + focus return —
  // so the note resets on open instead.
  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title="تأكيد الرفض"
      description={
        topup ? (
          <>
            <span className="font-mono font-bold text-foreground">
              {formatCurrency(topup.amount)}
            </span>{" "}
            · {displayUserName(userFromRow(topup))}
          </>
        ) : undefined
      }
      dismissable={!loading}
      size="sm"
      footer={
        <>
          <Button
            variant="outline"
            className="flex-1 h-9 active:scale-[0.97]"
            onClick={onCancel}
            disabled={loading}
          >
            إلغاء
          </Button>
          <Button
            className="flex-1 h-9 bg-destructive hover:bg-destructive/90 text-destructive-foreground active:scale-[0.97] shadow-sm shadow-destructive/20"
            onClick={() => onConfirm(note)}
            disabled={loading}
          >
            <XCircle className="w-3.5 h-3.5 ml-1.5" />
            {loading ? "جارٍ الرفض..." : "تأكيد الرفض"}
          </Button>
        </>
      }
    >
      <AppDialogBody>
        <div>
          <label
            htmlFor="topups-f1-28266"
            className="text-xs font-bold text-muted-foreground block mb-1.5"
          >
            سبب الرفض <span className="text-muted-foreground">(اختياري)</span>
          </label>
          <textarea
            id="topups-f1-28266"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: المرجع غير صحيح، المبلغ غير مطابق..."
            className="w-full h-20 bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-destructive resize-none"
            dir="rtl"
            autoFocus
            onKeyDown={(e) => {
              // ESC is handled by Radix (guarded by `dismissable` while
              // the request is in flight — the 94-C2 guarded-dismiss
              // contract). Only the submit shortcut stays field-local.
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !loading) onConfirm(note);
            }}
          />
          <p className="text-3xs text-muted-foreground mt-1">
            <kbd className="font-mono bg-muted/60 border border-border/50 px-1 rounded">⌘↵</kbd>{" "}
            للتأكيد ·
            <kbd className="font-mono bg-muted/60 border border-border/50 px-1 rounded mr-1">
              Esc
            </kbd>{" "}
            للإلغاء
          </p>
        </div>
      </AppDialogBody>
    </AppDialog>
  );
}

// Bulk action confirmation modal
// F3-03 (R111 WCAG 4.1.2 + 2.4.3): same hand-rolled-overlay retirement as
// RejectModal above — Radix focus trap/return, aria-modal, real DialogTitle,
// and ESC/backdrop guarded while the sequential money loop runs
// (`dismissable`). The live "جاري done/total" counter is additionally a
// role=status region so the per-item progress reaches screen readers while
// the loop runs (the old subtitle swap was visual-only).
// R122 (A2-P2): the modal gains the SAME optional note field the
// single-reject modal has — the bulk loops used to stamp every row with
// the boilerplate «تمت الموافقة الجماعية»/«مرفوض جماعياً», weakening the
// audit trail the note column and the ledgers carry (the mandatory-reason
// discipline wallet edits already enforce). The note stays OPTIONAL
// (matching RejectModal): empty → the boilerplate fallback rides the body.
function BulkConfirmModal({
  action,
  count,
  open,
  onConfirm,
  onCancel,
  loading,
  progress,
}: {
  action: "approve" | "reject";
  count: number;
  open: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
  /** Live per-item progress while a long approveAll loop runs (B5-01). */
  progress?: { done: number; total: number } | null;
}) {
  const [note, setNote] = useState("");

  // The AppDialog shell stays mounted (Radix owns the close animation),
  // so the note resets on open — same as RejectModal's field.
  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={action === "approve" ? "تأكيد الموافقة الجماعية" : "تأكيد الرفض الجماعي"}
      description={`${count} طلب سيتم معالجته`}
      dismissable={!loading}
      size="sm"
      footer={
        <>
          <Button
            variant="outline"
            className="flex-1 h-9 active:scale-[0.97]"
            onClick={onCancel}
            disabled={loading}
          >
            إلغاء
          </Button>
          <Button
            className={`flex-1 h-9 active:scale-[0.97] shadow-sm ${
              action === "approve"
                ? "bg-emerald-700 hover:bg-emerald-600 text-white shadow-emerald-700/20"
                : "bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-destructive/20"
            }`}
            onClick={() => onConfirm(note)}
            disabled={loading}
          >
            {loading && progress
              ? `جاري ${progress.done}/${progress.total}...`
              : loading
                ? "جارٍ المعالجة..."
                : action === "approve"
                  ? "موافقة"
                  : "رفض"}
          </Button>
        </>
      }
    >
      <AppDialogBody>
        {/* R122 (A2-P2): the optional per-action reason — mirrors
            RejectModal's field (label, ⌘/Ctrl+Enter submit, optional). */}
        <div>
          <label
            htmlFor="topups-bulk-note"
            className="text-xs font-bold text-muted-foreground block mb-1.5"
          >
            سبب المعالجة الجماعية <span className="text-muted-foreground">(اختياري)</span>
          </label>
          <textarea
            id="topups-bulk-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              action === "approve"
                ? "مثال: مطابقة كشوف الحسابات المسائية..."
                : "مثال: مراجع غير صحيح، إشعارات مكررة..."
            }
            className="w-full h-20 bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            dir="rtl"
            disabled={loading}
            onKeyDown={(e) => {
              // ESC is Radix's (guarded by `dismissable` while the money
              // loop runs); only the submit shortcut stays field-local.
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !loading) onConfirm(note);
            }}
          />
        </div>
        {/* Live progress (aria-live via role=status) — announced per item
            while the money loop runs; hidden when idle so the static count
            line under the title carries the summary. */}
        <div
          role="status"
          aria-live="polite"
          className="px-1 pt-2 text-xs text-muted-foreground tabular-nums min-h-[1rem]"
        >
          {loading && progress ? `جاري ${progress.done}/${progress.total}...` : ""}
        </div>
      </AppDialogBody>
    </AppDialog>
  );
}

export default function AdminTopupsPage() {
  const { adminToken } = useAuth();
  const jsonHeaders = useAdminHeaders({ json: true });
  const headers = useAdminHeaders();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // R120-B4 (A2-F7): the layout's «قيد الانتظار فقط» context action (the
  // R124-C2 statusLabel-aligned label) deep-links
  // /admin/topups?status=pending — the initial filter now consumes the
  // param (validated against the real filter values; anything else falls
  // back to the queue's default "pending" view).
  const [statusFilter, setStatusFilter] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("status") ?? "";
    return STATUS_FILTERS.some((s) => s.value === fromUrl) ? fromUrl : "pending";
  });
  // R124-I5 (A6 F14a): the money queue's search. The frozen list route
  // (routes/admin/topups.ts) supports ?status=&page=&limit= but NO
  // ?search= — so the filter runs client-side over the ACCUMULATED
  // pages, with the honest partial-window hint while more pages exist
  // (the products.tsx category-filter discipline). 300ms debounce per
  // the admin search idiom (orders/users/products) so typing pauses,
  // not keystrokes, drive the re-filter.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | "approveAll" | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  // B5-01 (round-92 audit): approveAll busy state + live progress — see
  // the approveAll comment below.
  const [isApproveAllBusy, setIsApproveAllBusy] = useState(false);
  const [approveAllProgress, setApproveAllProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // 93-C6 / F-07 (A5 T-1/S-1): the single "موافقة" button credits a
  // wallet in ONE TAP — it now opens the shared useConfirm dialog
  // (amount + user + payment reference) before the POST fires, the
  // same friction the reject modal already had. Asymmetric money
  // friction fixed: the money-CREATING action was the unconfirmed one.
  const { confirm, ConfirmDialog } = useConfirm();

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: "Escape",
      handler: () => {
        // 94-C2 (A2 P3-7): ESC during an in-flight reject no longer
        // closes the modal + re-arms the row buttons while the POST is
        // still running (double-action window). The modal itself guards
        // ESC/backdrop with `loading` — this global handler defers to it.
        if (rejectTarget) {
          const rejecting = processingId === rejectTarget.id;
          if (!rejecting) {
            setRejectTarget(null);
            setProcessingId(null);
          }
        }
        // Don't dismiss the bulk confirm mid-loop: the money requests
        // are already in flight and the modal carries the live progress
        // counter — closing it would strand the busy state with no
        // visible indicator (the cancel button is disabled while
        // loading for the same reason).
        if (bulkAction && !isBulkProcessing && !isApproveAllBusy) {
          setBulkAction(null);
        }
      },
      description: "إغلاق النافذة",
    },
  ]);

  // R126-L3 (A1-10) + 94-C2 (A2 P1-1): the money queue is an
  // accumulating infinite query over the frozen `?page=&limit=`
  // contract — now with the backend `?status=` param riding the ACTIVE
  // TAB (a per-tab query key, the tickets.tsx statusFilter idiom).
  // Previously the fetch pulled ALL statuses and the tabs filtered
  // client-side, so the PENDING tab over a partial window could read
  // the hard «لا توجد طلبات قيد الانتظار» while pending rows older
  // than the newest 100 sat on unloaded pages — and the header chip /
  // tab count read 0 against the sidebar badge's server truth. With
  // the server-side filter, page 1 of the pending tab IS the pending
  // head: the tab can never false-empty while a pending row exists,
  // and its counts describe the server-filtered window. The key keeps
  // the "/api/admin/topups" prefix so the existing invalidations
  // (approve/reject/bulk loops/socket) still refresh the accumulated
  // pages of every tab.
  const topupsListParams = { status: statusFilter || undefined, limit: TOPUPS_PAGE_SIZE };
  const {
    data: topupsPages,
    isLoading,
    // 93-C6 / F-07 (A5 S-2): a failed load previously fell through to
    // "لا توجد طلبات معلقة" — the money queue LOOKED empty during an
    // outage (the worst possible page for that).
    isError,
    error,
    refetch,
    // 94-C2 (A2 P1-1): append controls + the implicit "more may exist"
    // flag (a full page).
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AdminTopupRow[], Error>({
    queryKey: ["/api/admin/topups", "load-more", topupsListParams],
    queryFn: ({ pageParam, signal }) =>
      customFetch<AdminTopupRow[]>(
        `/api/admin/topups?page=${pageParam}&limit=${TOPUPS_PAGE_SIZE}${statusFilter ? `&status=${statusFilter}` : ""}`,
        {
          signal,
          headers,
        },
      ),
    initialPageParam: 1,
    // Frozen contract (A2 P1-1): plain-array body — a full page means
    // the next page MIGHT exist; a short page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === TOPUPS_PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: !!adminToken,
    // Round-4 (perf P1-3): the admin-room socket listener invalidates
    // topups on every `admin-stats-update` push (approve/reject) —
    // 5-min fallback only (was 20 s).
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  // R125-I2 (A5-F2): memoized — `.flat()` mints a fresh array identity
  // on every render, which defeated the useMemo chain below (and every
  // card's `topup` prop identity) on each keystroke. topupsPages only
  // changes identity on query updates. The `?? []` fallback keeps a
  // STABLE empty identity inside the memo — a fresh `[]` per render was
  // the exact trap orders.tsx:647-654 and users.tsx:446-449 fixed.
  const allTopups = useMemo(
    () => (topupsPages?.pages ?? []).flat() as AdminTopupRow[],
    [topupsPages],
  );

  // 94-C2 (A2 P1-1): the queue total is only provably known when a
  // single short page arrived — otherwise «عرض N» (never «إجمالاً
  // N» for a truncated window).
  const knownTotal = (topupsPages?.pages.length ?? 0) <= 1 && allTopups.length < TOPUPS_PAGE_SIZE;

  const invalidate = () =>
    // Base key (no params) so the accumulating infinite query — and any
    // other consumer under /api/admin/topups — refreshes on approve/
    // reject/bulk loops.
    queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey() });

  // F-008 (security audit 004) — every state-changing admin call to
  // /api/admin/topups/:id/{approve,reject} carries an Idempotency-Key
  // header. The backend middleware
  // (backend/src/middlewares/idempotency.ts) caches the response per
  // (admin, route, key) for 24 h, so a network retry / accidental
  // double-click cannot double-credit the wallet. We use useMutation
  // directly (not the generated useApproveTopup / useRejectTopup
  // hooks) because the generated hooks fix the variable type to
  // `{id, data}`, which doesn't accommodate the per-call
  // idempotencyKey we need to thread through.
  const approveMutation = useMutation({
    mutationKey: ["approveTopup"],
    mutationFn: ({
      id,
      data,
      idempotencyKey,
    }: {
      id: number;
      data: { admin_note?: string };
      idempotencyKey: string;
    }) =>
      approveTopup(id, data, {
        headers: withIdempotencyKey(headers, idempotencyKey),
      }),
    onSuccess(_, vars) {
      setProcessingId(null);
      invalidate();
      const t = allTopups.find((x) => x.id === vars.id);
      // R124-I5 (A6 F1): success variant — the single approve/reject are
      // money actions and were the only blue-default toasts on the page
      // while their bulk equivalents (below) render green.
      toast({
        title: "تمت الموافقة",
        description: t
          ? `${formatCurrency(t.amount)} لـ ${t.user_phone}`
          : "تمت الموافقة على الطلب",
        variant: "success",
      });
    },
    onError(err: unknown) {
      setProcessingId(null);
      // 93-C6 / F-07 (SIM P1 + A5 S-1): the error envelope is parsed —
      // C1's backend now returns 409 DUPLICATE_PAYMENT_REFERENCE with
      // a full Arabic explanation (sibling topup ids) and 409 CONFLICT
      // for concurrent-state races; the generic "حاول مرة أخرى" hid
      // all of it.
      toast({
        title: "فشلت الموافقة",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationKey: ["rejectTopup"],
    mutationFn: ({
      id,
      data,
      idempotencyKey,
    }: {
      id: number;
      data: { admin_note?: string };
      idempotencyKey: string;
    }) =>
      rejectTopup(id, data, {
        headers: withIdempotencyKey(headers, idempotencyKey),
      }),
    onSuccess(_, vars) {
      setProcessingId(null);
      setRejectTarget(null);
      invalidate();
      const t = allTopups.find((x) => x.id === vars.id);
      // R124-I5 (A6 F1): same success variant as the approve toast above
      // (parity with the green bulk-reject summary at the bottom of the
      // file) — the action completed; the queue is safer for it.
      toast({
        title: "تم الرفض",
        description: t ? `${formatCurrency(t.amount)} من ${t.user_phone}` : "تم رفض الطلب",
        variant: "success",
      });
    },
    onError(err: unknown) {
      setProcessingId(null);
      // 93-C6 / F-07: same envelope-parsing as approve (see above).
      toast({
        title: "فشل الرفض",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R124-I5 (A6 F14a): the status tab now rides the SERVER-side
  // ?status= param (R126-L3 A1-10) — only the debounced SEARCH stays
  // client-side over the accumulated pages of the active tab (the
  // route supports no ?search=). Lives ABOVE the adminToken
  // early-return (rules of hooks).
  const topups = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return allTopups;
    return allTopups.filter((t) =>
      // Search by reference / phone / user: the operator's lookup keys
      // for a single topup in the queue (payment reference, sender +
      // user phone, and the display name when present).
      [
        t.payment_reference,
        t.user_phone,
        t.sender_phone,
        t.sender_account,
        t.user_display_name,
      ].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [allTopups, debouncedSearch]);
  // R125-I2 (A5-F2): the inline per-render aggregates moved up here
  // into the memo chain — pendingTopups/statusCounts previously
  // re-filtered the full accumulated set on EVERY render (each
  // keystroke, each processingId/selectedIds flip). Lives ABOVE the
  // adminToken early-return (rules of hooks — same as `topups`).
  const pendingTopups = useMemo(() => allTopups.filter((t) => t.status === "pending"), [allTopups]);
  const selectedPendingCount = useMemo(
    () => pendingTopups.reduce((n, t) => (selectedIds.has(t.id) ? n + 1 : n), 0),
    [pendingTopups, selectedIds],
  );
  const allPendingSelected =
    pendingTopups.length > 0 && selectedPendingCount === pendingTopups.length;

  const statusCounts = useMemo(
    () =>
      allTopups.reduce((acc: Record<string, number>, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
    [allTopups],
  );

  // R126-L3 (A1-10): with the per-tab server-side fetch, the loaded
  // window speaks only for the ACTIVE tab's status. On the pending
  // tab this is the server-filtered pending head (a real count, never
  // a false 0 while pending rows exist); on the all-tab it is the
  // within-window count as before; on other tabs it is not claimable
  // — 0 keeps the chip + bulk bar hidden instead of lying, and the
  // sidebar badge (layout's server stats) carries the global truth.
  const pendingCount = statusCounts["pending"] ?? 0;

  const searchActive = debouncedSearch.trim() !== "";

  // R125-I2 (A5-F2): useCallback-stable handlers so the memoized
  // TopupCard bails on keystroke/selection re-renders (the orders.tsx
  // :936-953 idiom). Declared BEFORE the !adminToken early return —
  // hooks must run unconditionally (rules of hooks; setters + the
  // memoized inputs are stable so hoisting is behavior-neutral for the
  // authenticated render). allTopups is itself memoized and `confirm` +
  // the mutation `.mutate` are stable across renders, so these
  // identities survive unrelated state flips; a data update re-mints
  // them, which is correct (the rows re-render with fresh data then).
  const handleApprove = useCallback(
    async (id: number) => {
      // 93-C6 / F-07 (A5 T-1): confirm BEFORE the money moves. The
      // amount, user, and payment reference are all already on the card
      // — surface them in one dialog so an accidental tap (or a
      // touch-screen double-fire on a list where REJECT sits beside
      // approve) can never credit a wallet.
      const t = allTopups.find((x) => x.id === id);
      if (!t) return;
      const ok = await confirm({
        title: "تأكيد الموافقة",
        description: `سيتم إضافة ${formatCurrency(t.amount)} إلى محفظة ${t.user_phone}${t.sender_phone ? ` · المُرسل: ${t.sender_phone}` : ""}${t.payment_reference ? ` · مرجع التحويل: ${t.payment_reference}` : ""}.`,
        confirmLabel: "موافقة",
      });
      if (!ok) return;
      setProcessingId(id);
      // F-008: one Idempotency-Key per click. React Query reuses these
      // variables on internal retries, so the key survives a transient
      // network failure and the backend replays the cached response
      // instead of double-crediting.
      approveMutation.mutate({
        id,
        data: { admin_note: "تمت الموافقة" },
        idempotencyKey: generateIdempotencyKey(),
      });
    },
    [allTopups, confirm, approveMutation],
  );

  const handleReject = useCallback(
    (note: string) => {
      if (!rejectTarget) return;
      setProcessingId(rejectTarget.id);
      rejectMutation.mutate({
        id: rejectTarget.id,
        data: { admin_note: note || "مرفوض" },
        idempotencyKey: generateIdempotencyKey(),
      });
    },
    [rejectTarget, rejectMutation],
  );

  const handleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    // R125-I2: rides the memoized pendingTopups (was a fresh filter per
    // call — same work, now shared with the header aggregates).
    const allSelected = pendingTopups.every((t) => selectedIds.has(t.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingTopups.map((t) => t.id)));
    }
  }, [pendingTopups, selectedIds]);

  if (!adminToken) return null;

  // R122 (A2-P2): the bulk loops accept the operator's optional note
  // (BulkConfirmModal's new field) — empty keeps the old boilerplate
  // fallback so the ledger always carries SOME reason.
  const handleBulkAction = async (action: "approve" | "reject", note = "") => {
    setIsBulkProcessing(true);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    const failures: Array<{ id: number; reason: string }> = [];
    // R123 (E3 P3h): the session-expiry exit breaks and returns INSIDE
    // try/finally — the old fallthrough also reset the flags, but only
    // after firing invalidate() + a per-failure toast into the redirect
    // (noise on top of the global «انتهت الجلسة» toast).
    let sessionExpired = false;
    try {
      // 93-C6 / F-07 (A5 T-2): the selected-bulk loop now parses each
      // failure body (approveAll, one function below, already did) —
      // count-only feedback ("فشل 2 من 5") hid the 409
      // DUPLICATE_PAYMENT_REFERENCE / CONFLICT reasons behind a generic
      // toast while the adjacent approveAll summarized them properly.

      // F-008 (security audit 004): one Idempotency-Key per topup, NOT
      // one for the whole bulk. The backend dedup is per-(admin, route,
      // key); a single key shared across N approvals would let only the
      // first call commit and the next N-1 would replay the first
      // response, leaving the rest of the topups untouched. Each topup
      // is its own logical action — generate a fresh key per iteration.
      for (const id of ids) {
        const url = `/api/admin/topups/${id}/${action}`;
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
            body: JSON.stringify({
              admin_note:
                note.trim() || (action === "approve" ? "تمت الموافقة الجماعية" : "مرفوض جماعياً"),
            }),
          });
          // 93-C6 / F-07 (A5 S-3): session expired mid-loop — stop the
          // money loop; the global handler has toasted + redirected.
          if (isAdminUnauthorized(r, url)) {
            sessionExpired = true;
            break;
          }
          if (!r.ok) {
            const body = (await r.json().catch(() => null)) as {
              error?: string;
              code?: string;
            } | null;
            failures.push({
              id,
              // R126-L3 (A2/A8): route through getErrorMessage — the
              // Arabic guard maps the body's code/error to Arabic and
              // collapses message-less bodies (proxy 502s) to the
              // generic Arabic line instead of a bare English
              // "HTTP 502" inside the Arabic summary toast.
              reason: getErrorMessage(body),
            });
            continue;
          }
          successCount++;
        } catch (e) {
          // R126-L3 (A2/A8): network-level failures speak Arabic too —
          // "Failed to fetch" used to land raw in the summary toast.
          failures.push({
            id,
            reason: getErrorMessage(e),
          });
        }
      }

      if (sessionExpired) return;
      setSelectedIds(new Set());
      invalidate();
      if (failures.length > 0) {
        toast({
          title:
            successCount > 0
              ? `${action === "approve" ? "تمت الموافقة الجماعية" : "تم الرفض الجماعي"} — ${successCount} من ${ids.length}`
              : "خطأ",
          description: `فشلت ${failures.length} من ${ids.length} — ${failures
            .map((f) => `#${f.id}: ${f.reason}`)
            .join("، ")}`,
          variant: "destructive",
        });
      }
      // Only announce success when at least one item actually succeeded —
      // the unconditional toast used to show "✓ تمت الموافقة 0/N" right
      // after the failure toast on a total failure.
      if (successCount > 0 && failures.length === 0) {
        toast({
          title: action === "approve" ? "تمت الموافقة الجماعية" : "تم الرفض الجماعي",
          description: `${successCount}/${ids.length} طلب تمت معالجته`,
          variant: "success",
        });
      }
    } finally {
      // R123 (E3 P3h): the flags reset on EVERY exit path — including
      // the session-expiry return above.
      setBulkAction(null);
      setIsBulkProcessing(false);
    }
  };

  // B5-01 (round-92 audit): approveAll previously ran its sequential
  // money loop with NO busy state — the "موافقة الكل" button stayed
  // enabled, so a double-click started TWO parallel loops, each
  // generating fresh Idempotency-Keys per iteration, which the backend
  // per-(admin, route, key) dedupe cannot correlate. The confirmation
  // is the file's own BulkConfirmModal (replacing the raw
  // window.confirm), the loop is single-entry (re-click guard +
  // disabled button), the modal/button carry a live "جاري done/total"
  // counter for long queues, and per-item failures are collected and
  // summarized in ONE toast with per-item reasons instead of two
  // count-only toasts.
  const approveAll = async (note = "") => {
    if (isApproveAllBusy) return; // re-click guard (double-loop prevention)
    const pending = allTopups.filter((t) => t.status === "pending");
    if (pending.length === 0) return;
    setIsApproveAllBusy(true);
    setApproveAllProgress({ done: 0, total: pending.length });
    let approvedCount = 0;
    const failures: Array<{ id: number; reason: string }> = [];
    // R123 (E3 P3h): the session-expiry exit rides the same
    // sessionExpired + try/finally shape as handleBulkAction above —
    // the flags reset on EVERY exit path and no summary toast/
    // invalidate fires into the redirect.
    let sessionExpired = false;
    try {
      for (const [index, t] of pending.entries()) {
        try {
          const url = `/api/admin/topups/${t.id}/approve`;
          const r = await fetch(url, {
            method: "POST",
            // Same per-iteration key generation as handleBulkAction above.
            headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
            body: JSON.stringify({
              // R122 (A2-P2): the operator's bulk-confirm note rides every
              // row — empty keeps the boilerplate fallback (see
              // handleBulkAction).
              admin_note: note.trim() || "تمت الموافقة الجماعية",
            }),
          });
          // 93-C6 / F-07 (A5 S-3): session expired mid-loop — abort the
          // money loop (the global handler has toasted + redirected);
          // nothing further is submitted or summarized.
          if (isAdminUnauthorized(r, url)) {
            sessionExpired = true;
            break;
          }
          if (!r.ok) {
            const body = (await r.json().catch(() => null)) as {
              error?: string;
              code?: string;
            } | null;
            // R126-L3 (A2/A8): same Arabic guard as handleBulkAction —
            // no bare "HTTP 502" fragments in the money summary toast.
            throw new Error(getErrorMessage(body));
          }
          approvedCount++;
        } catch (e) {
          // R126-L3 (A2/A8): the thrown reason above is already Arabic
          // (getErrorMessage is idempotent on its own output); network
          // TypeErrors collapse to the Arabic connection line.
          failures.push({
            id: t.id,
            reason: getErrorMessage(e),
          });
        }
        setApproveAllProgress({ done: index + 1, total: pending.length });
      }
      if (sessionExpired) return;
      invalidate();
      // Summary toast: "X نجحت / Y فشلت" + per-item failure reasons.
      if (failures.length === 0) {
        toast({
          title: `تمت الموافقة على ${approvedCount} طلب`,
          variant: "success",
        });
      } else {
        toast({
          title:
            approvedCount > 0
              ? `تمت الموافقة على ${approvedCount} من ${pending.length} طلب`
              : "خطأ",
          description: `نجحت ${approvedCount} · فشلت ${failures.length} — ${failures
            .map((f) => `#${f.id}: ${f.reason}`)
            .join("، ")}`,
          variant: "destructive",
        });
      }
    } finally {
      // R123 (E3 P3h): the flags reset on EVERY exit path — including
      // the session-expiry return above (previously duplicated inline).
      setBulkAction(null);
      setIsApproveAllBusy(false);
      setApproveAllProgress(null);
      setSelectedIds(new Set());
    }
  };

  return (
    <AdminLayout onRefresh={() => refetch()} badges={{ pendingTopups: pendingCount }}>
      {/* Reject modal — F3-03 (R111): always mounted, Radix owns the
          open/close lifecycle (focus trap + return + close animation);
          `open` is driven by rejectTarget exactly like the old
          conditional render. */}
      <RejectModal
        topup={rejectTarget}
        open={!!rejectTarget}
        onConfirm={handleReject}
        onCancel={() => {
          setRejectTarget(null);
          setProcessingId(null);
        }}
        loading={!!rejectTarget && processingId === rejectTarget.id}
      />

      {/* Bulk action confirmation modal — also backs the approveAll
          flow (B5-01: replaced its raw window.confirm). */}
      <BulkConfirmModal
        open={bulkAction !== null}
        action={bulkAction === "approveAll" ? "approve" : (bulkAction ?? "approve")}
        count={bulkAction === "approveAll" ? pendingCount : selectedPendingCount}
        // R122 (A2-P2): the modal's optional note threads into whichever
        // loop the confirm fires (bulk approve/reject or approveAll).
        onConfirm={(note) =>
          bulkAction === "approveAll"
            ? void approveAll(note)
            : bulkAction === "approve" || bulkAction === "reject"
              ? void handleBulkAction(bulkAction, note)
              : undefined
        }
        onCancel={() => setBulkAction(null)}
        loading={bulkAction === "approveAll" ? isApproveAllBusy : isBulkProcessing}
        progress={bulkAction === "approveAll" ? approveAllProgress : null}
      />

      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
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

          {/* flex-wrap: bulk actions + status tabs overflow the 375px
              viewport without it (select-all + approve-all + reject + 4
              status chips on one row). */}
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
                   * variant left the DEFAULT primary gradient (hsl(348
                   * 80% 48%)) under the emerald-400 label: 2.57:1, a
                   * WCAG fail on the highest-stakes bulk money control.
                   * Outline puts the emerald ink on the card surface
                   * (9.68:1 dark / matches the reject sibling + the
                   * approveAll button, which already had it). */
                  variant="outline"
                  className="h-9 gap-1.5 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/10 text-xs"
                  onClick={() => setBulkAction("approve")}
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  موافقة ({selectedPendingCount})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
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
                className="h-9 gap-1.5 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/10 text-xs"
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
                  : `موافقة الكل (${pendingCount})`}
              </Button>
            )}

            {/* Status filter tabs */}
            <div className="flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1">
              {STATUS_FILTERS.map((s) => {
                const active = statusFilter === s.value;
                // R126-L3 (A1-10): the per-tab server-side fetch means
                // the loaded window only speaks for the ACTIVE tab's
                // status — an inactive tab's count is UNKNOWN (its rows
                // are not in this window), and rendering the accidental
                // 0 was exactly the false-count the audit flagged. The
                // active tab keeps its live count; the sidebar badge
                // carries the global pending truth.
                const count = active ? allTopups.length : null;
                return (
                  <button
                    key={s.value}
                    onClick={() => {
                      setStatusFilter(s.value);
                      // R123 (E3 P3a): write-back — the deep-link param
                      // the initializer reads stays truthful after the
                      // operator flips the tab (replaceState: flips
                      // don't spam the history stack).
                      const url = new URL(window.location.href);
                      if (s.value) url.searchParams.set("status", s.value);
                      else url.searchParams.delete("status");
                      window.history.replaceState(null, "", url.toString());
                    }}
                    /* R124-I5 (A6 F10): the active chip was purely visual —
                       a screen reader announced four identical buttons.
                       aria-pressed exposes the toggle state (the
                       coupons.tsx chip-bar idiom). */
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                      active
                        ? "bg-card shadow-sm text-foreground font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                    {count !== null && count > 0 && (
                      <span
                        className={`text-3xs font-bold ${active ? "text-muted-foreground" : "text-muted-foreground"}`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* R124-I5 (A6 F14a): partial-window honesty — the client-side
            search only sees the ACCUMULATED pages; while load-more
            remains, say so instead of letting «لا نتائج» claim the whole
            history (the products.tsx capped-window hint idiom). */}
        {searchActive && hasNextPage && !isLoading && !isError && (
          <p className="text-3xs text-muted-foreground">
            البحث يعمل على الطلبات المعروضة فقط — حمّل المزيد لتوسيع النطاق
          </p>
        )}

        {/* List */}
        {/* 93-C6 / F-07 (A5 S-2): refresh of an already-rendered queue
            failed — keep the stale cards, surface the failure inline. */}
        {isError && allTopups.length > 0 && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="min-w-0">{getErrorMessage(error)}</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <TopupCardSkeleton key={i} />
            ))}
          </div>
        ) : isError && allTopups.length === 0 ? (
          /* 93-C6 / F-07 (A5 S-2): a failed load is NOT an empty money
             queue — an outage/expired session previously rendered "لا
             توجد طلبات معلقة" and the operator believed the queue was
             clear (the worst false-empty in the panel). */
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل طلبات الشحن"
            description={`${getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة`}
            onRetry={() => refetch()}
          />
        ) : topups.length === 0 ? (
          searchActive && hasNextPage ? (
            /* R126-L3 (A1-10): the search still filters CLIENT-side over
               the accumulated pages of the active tab, so a zero-match
               search over a partial window is NOT global emptiness — the
               orders.tsx:1471-1506 partial-empty block: honest wording +
               load-more as the remedy + the one-tap search clear. The
               status-tab empties no longer need this guard (the ?status=
               fetch makes page 1 the tab's head — a tab-empty is a
               server-verified claim now). */
            <div className="text-center py-14 text-muted-foreground bg-card border border-border/60 rounded-2xl space-y-3">
              <Clock className="w-10 h-10 mx-auto opacity-20" />
              <p className="text-sm font-bold text-foreground/80">
                لا طلبات مطابقة لـ &quot;{debouncedSearch.trim()}&quot; ضمن الصفحات المحمّلة
              </p>
              <p className="text-xs">قد تكون النتائج غير مكتملة — حمّل المزيد لتوسيع النطاق</p>
              <div className="flex justify-center gap-2 flex-wrap">
                <LoadMoreButton
                  busy={isFetchingNextPage}
                  disabled={isLoading}
                  onClick={() => void fetchNextPage()}
                />
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-xs text-primary-text hover:underline mt-1.5"
                >
                  مسح البحث
                </button>
              </div>
            </div>
          ) : (
            /* R126-L3 (A1-10): the hard empty is now only reached over a
               server-verified window — a status tab's page 1 was EMPTY
               (no such rows exist at all) or the search covered a
               complete tab window. The pending-tab wording stays the
               statusLabel vocabulary (R125-I2 A1-8). */
            <EmptyState
              icon={Clock}
              title={
                searchActive
                  ? `لا نتائج لـ "${debouncedSearch.trim()}"`
                  : statusFilter === "pending"
                    ? /* R125-I2 (A1-8): the statusLabel vocabulary — the
                       tab above reads «قيد الانتظار»; the empty claim
                       said «معلق» for the same status (one status, one
                       Arabic word — the status-badge invariant). */
                      "لا توجد طلبات قيد الانتظار"
                    : "لا توجد طلبات في هذه الفئة"
              }
              description={
                searchActive
                  ? "جرّب رقم تحويل أو هاتفاً آخر — أو امسح البحث"
                  : "ستظهر الطلبات هنا عند ورودها"
              }
              action={
                searchActive ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    /* R125-I2 (A6-B6): --primary-text — raw --primary on a
                       dark card is 3.76:1, under the 4.5:1 text floor. */
                    className="text-xs text-primary-text hover:underline mt-1"
                  >
                    مسح البحث
                  </button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="space-y-2.5">
            {/* R125-I2 (A5-F2): the memoized row component — see the
                TopupCard block comment above the component definition. */}
            {topups.map((t, i: number) => (
              <TopupCard
                key={t.id}
                topup={t}
                idx={i}
                isSelected={selectedIds.has(t.id)}
                isProcessing={processingId === t.id}
                isRejecting={processingId === t.id && rejectTarget?.id === t.id}
                onSelect={handleSelect}
                onApprove={handleApprove}
                onReject={setRejectTarget}
              />
            ))}
          </div>
        )}

        {/* 94-C2 (A2 P1-1): "load more" appends the next page of the
            frozen `?page=N+1&limit=` contract in place — the pending
            rows hidden behind the old silent 100-row cap become
            reachable without wiping the operator's selections. The
            button hides once a short page arrives. */}
        {hasNextPage && !isLoading && !isError && (
          <div className="flex justify-center pt-1">
            <LoadMoreButton busy={isFetchingNextPage} onClick={() => void fetchNextPage()} />
          </div>
        )}
      </div>
      {/* 93-C6 / F-07: the single-approve confirmation dialog mount
          (useConfirm idiom — styled AlertDialog, ESC/rtl-correct). */}
      <ConfirmDialog />
    </AdminLayout>
  );
}

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
