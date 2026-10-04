import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import {
  copyToClipboard,
  formatCount,
  formatCurrency,
  formatDate,
  statusLabel,
} from "@/lib/utils";
import {
  STATUS_TONE,
  StatusBadge,
  UNKNOWN_STATUS_TONE,
} from "@/components/ui/status-badge";
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
  Check,
  CheckCheck,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  Clock,
  Copy,
  Hash,
  Loader2,
  MessageSquare,
  RefreshCw,
  Smartphone,
  Square,
  User,
  UserCheck,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
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

const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  { value: "pending", label: "معلق" },
  { value: "approved", label: "مقبول" },
  { value: "rejected", label: "مرفوض" },
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
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  /** Live per-item progress while a long approveAll loop runs (B5-01). */
  progress?: { done: number; total: number } | null;
}) {
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
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20"
                : "bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-destructive/20"
            }`}
            onClick={onConfirm}
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
      <AppDialogBody className="p-0">
        {/* Live progress (aria-live via role=status) — announced per item
            while the money loop runs; hidden when idle so the static count
            line under the title carries the summary. */}
        <div
          role="status"
          aria-live="polite"
          className="px-5 pt-3 text-xs text-muted-foreground tabular-nums min-h-[1rem]"
        >
          {loading && progress ? `جاري ${progress.done}/${progress.total}...` : ""}
        </div>
      </AppDialogBody>
    </AppDialog>
  );
}

function CopyButton({ text, size = "sm" }: { text: string; size?: "sm" | "xs" }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    // B6 (round-92 audit): the shared helper (secure-context check +
    // execCommand fallback + boolean result) replaces the raw
    // `navigator.clipboard.writeText(text).catch(() => {})` — the raw
    // call silently rejected on non-secure contexts / strict Firefox
    // and still flipped the button to the "copied" check icon.
    const ok = await copyToClipboard(text);
    if (!ok) {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      title={failed ? "تعذّر النسخ" : "نسخ"}
      aria-label={failed ? "تعذّر النسخ" : "نسخ"}
      /* 93-C6 / F-07 (A5 S-6): the bare w-3 icon was a ~12px touch
         target — below any usable minimum on the 375px admin layout
         and directly adjacent to money-action rows. p-2 (the audit's
         recommendation) lifts it to ~28px. */
      className={`shrink-0 rounded p-2 transition-colors ${
        failed
          ? "text-red-400"
          : copied
            ? "text-emerald-400"
            : "text-muted-foreground hover:text-muted-foreground"
      }`}
    >
      {failed ? (
        <XCircle className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      ) : copied ? (
        <Check className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      ) : (
        <Copy className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      )}
    </button>
  );
}

export default function AdminTopupsPage() {
  const { adminToken } = useAuth();
  const jsonHeaders = useAdminHeaders({ json: true });
  const headers = useAdminHeaders();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("pending");
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

  // 94-C2 (A2 P1-1): the money queue is an accumulating infinite query
  // over the frozen `?page=&limit=` contract (the backend historically
  // hard-capped at the newest 100 rows with no page param — pending
  // topups older than the cap were INVISIBLE while the sidebar badge
  // counted the true total). The key keeps the "/api/admin/topups"
  // prefix so the existing invalidations (approve/reject/bulk loops)
  // still refresh the accumulated pages.
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
    queryKey: ["/api/admin/topups", "load-more"],
    queryFn: ({ pageParam, signal }) =>
      customFetch<AdminTopupRow[]>(
        `/api/admin/topups?page=${pageParam}&limit=${TOPUPS_PAGE_SIZE}`,
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

  const allTopups: AdminTopupRow[] = (topupsPages?.pages ?? []).flat();

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
      toast({
        title: "تمت الموافقة",
        description: t
          ? `${formatCurrency(t.amount)} لـ ${t.user_phone}`
          : "تمت الموافقة على الطلب",
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
      toast({
        title: "تم الرفض",
        description: t ? `${formatCurrency(t.amount)} من ${t.user_phone}` : "تم رفض الطلب",
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

  if (!adminToken) return null;

  const pendingTopups = allTopups.filter((t) => t.status === "pending");
  const allPendingSelected =
    pendingTopups.length > 0 && pendingTopups.every((t) => selectedIds.has(t.id));
  const selectedPendingCount = pendingTopups.filter((t) => selectedIds.has(t.id)).length;

  const statusCounts = allTopups.reduce((acc: Record<string, number>, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  const pendingCount = statusCounts["pending"] ?? 0;
  const topups = statusFilter ? allTopups.filter((t) => t.status === statusFilter) : allTopups;

  const handleApprove = async (id: number) => {
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
  };

  const handleReject = (note: string) => {
    if (!rejectTarget) return;
    setProcessingId(rejectTarget.id);
    rejectMutation.mutate({
      id: rejectTarget.id,
      data: { admin_note: note || "مرفوض" },
      idempotencyKey: generateIdempotencyKey(),
    });
  };

  const handleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const pendingTopups = allTopups.filter((t) => t.status === "pending");
    const allSelected = pendingTopups.every((t) => selectedIds.has(t.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingTopups.map((t) => t.id)));
    }
  };

  const handleBulkAction = async (action: "approve" | "reject") => {
    setIsBulkProcessing(true);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    const failures: Array<{ id: number; reason: string }> = [];
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
        let r: Response;
        if (action === "approve") {
          r = await fetch(url, {
            method: "POST",
            headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
            body: JSON.stringify({ admin_note: "تمت الموافقة الجماعية" }),
          });
        } else {
          r = await fetch(url, {
            method: "POST",
            headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
            body: JSON.stringify({ admin_note: "مرفوض جماعياً" }),
          });
        }
        // 93-C6 / F-07 (A5 S-3): session expired mid-loop — stop the
        // money loop; the global handler has toasted + redirected.
        if (isAdminUnauthorized(r, url)) break;
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          failures.push({
            id,
            reason: body && (body.error || body.code) ? getErrorMessage(body) : `HTTP ${r.status}`,
          });
          continue;
        }
        successCount++;
      } catch (e) {
        failures.push({
          id,
          reason: e instanceof Error ? e.message : "خطأ غير معروف",
        });
      }
    }

    setSelectedIds(new Set());
    setBulkAction(null);
    setIsBulkProcessing(false);
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
  const approveAll = async () => {
    if (isApproveAllBusy) return; // re-click guard (double-loop prevention)
    const pending = allTopups.filter((t) => t.status === "pending");
    if (pending.length === 0) return;
    setIsApproveAllBusy(true);
    setApproveAllProgress({ done: 0, total: pending.length });
    let approvedCount = 0;
    const failures: Array<{ id: number; reason: string }> = [];
    for (const [index, t] of pending.entries()) {
      try {
        const url = `/api/admin/topups/${t.id}/approve`;
        const r = await fetch(url, {
          method: "POST",
          // Same per-iteration key generation as handleBulkAction above.
          headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
          body: JSON.stringify({ admin_note: "تمت الموافقة الجماعية" }),
        });
        // 93-C6 / F-07 (A5 S-3): session expired mid-loop — abort the
        // money loop (the global handler has toasted + redirected);
        // nothing further is submitted or summarized.
        if (isAdminUnauthorized(r, url)) {
          setBulkAction(null);
          setIsApproveAllBusy(false);
          setApproveAllProgress(null);
          setSelectedIds(new Set());
          return;
        }
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          throw new Error(
            body && (body.error || body.code) ? getErrorMessage(body) : `HTTP ${r.status}`,
          );
        }
        approvedCount++;
      } catch (e) {
        failures.push({
          id: t.id,
          reason: e instanceof Error ? e.message : "خطأ غير معروف",
        });
      }
      setApproveAllProgress({ done: index + 1, total: pending.length });
    }
    setBulkAction(null);
    setIsApproveAllBusy(false);
    setApproveAllProgress(null);
    setSelectedIds(new Set());
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
        onConfirm={() =>
          bulkAction === "approveAll"
            ? void approveAll()
            : bulkAction === "approve" || bulkAction === "reject"
              ? void handleBulkAction(bulkAction)
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
                <span className="flex items-center gap-1 bg-yellow-400/15 text-yellow-400 border border-yellow-400/25 text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                  <AlertTriangle className="w-3 h-3" />
                  {pendingCount} معلق
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
                {knownTotal
                  ? `${formatCount(allTopups.length, TOPUP_COUNT_FORMS)} إجمالاً`
                  : `عرض ${formatCount(allTopups.length, TOPUP_COUNT_FORMS)} (الأحدث أولاً)`}
              </span>
              {pendingCount > 0 &&
                (() => {
                  const pendingTotal = allTopups
                    .filter((t) => t.status === "pending")
                    .reduce((s: number, t) => s + (Number(t.amount) || 0), 0);
                  return pendingTotal > 0 ? (
                    <>
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                      <span className="text-yellow-400 font-bold tabular-nums">
                        {formatCurrency(pendingTotal)} إجمالي معلق
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
            {selectedPendingCount > 0 && (
              <>
                <Button
                  size="sm"
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
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/60 bg-secondary/30 hover:bg-secondary/50 transition-colors text-xs"
              >
                {allPendingSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span className="text-muted-foreground">اختيار الكل</span>
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
                const count = s.value ? (statusCounts[s.value] ?? 0) : allTopups.length;
                const active = statusFilter === s.value;
                return (
                  <button
                    key={s.value}
                    onClick={() => setStatusFilter(s.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                      active
                        ? "bg-card shadow-sm text-foreground font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                    {count > 0 && (
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
          <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
              <WifiOff className="w-8 h-8 text-status-error/70" />
            </div>
            <p className="font-bold text-lg mb-1.5 text-foreground/80">تعذّر تحميل طلبات الشحن</p>
            <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
              {getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة
            </p>
            <Button
              onClick={() => refetch()}
              className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة المحاولة
            </Button>
          </div>
        ) : topups.length === 0 ? (
          <EmptyState
            icon={Clock}
            title={
              statusFilter === "pending" ? "لا توجد طلبات معلقة" : "لا توجد طلبات في هذه الفئة"
            }
            description="ستظهر الطلبات هنا عند ورودها"
          />
        ) : (
          <div className="space-y-2.5">
            {topups.map((t, i: number) => (
              <div
                key={t.id}
                className={`float-in stagger-${Math.min(i + 1, 8)} bg-card rounded-2xl border overflow-hidden transition-all hover:shadow-md hover:shadow-black/10 ${
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
                        onClick={() => handleSelect(t.id)}
                        className="p-1 rounded hover:bg-secondary/50 transition-colors"
                        aria-label={selectedIds.has(t.id) ? "إلغاء الاختيار" : "اختيار"}
                      >
                        {selectedIds.has(t.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* Top row: amount + badges + date */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="font-bold text-xl tabular-nums">
                      {formatCurrency(t.amount)}
                    </span>
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
                      <CopyButton text={t.user_phone} size="xs" />
                    </div>
                    {t.sender_phone && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Smartphone className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">المُرسل:</span>
                        <span className="font-mono font-bold text-foreground">
                          {t.sender_phone}
                        </span>
                        <CopyButton text={t.sender_phone} size="xs" />
                      </div>
                    )}
                    {t.payment_reference && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Hash className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">رمز التحويل:</span>
                        <span className="font-mono text-xs text-foreground">
                          {t.payment_reference}
                        </span>
                        <CopyButton text={t.payment_reference} size="xs" />
                      </div>
                    )}
                    {t.sender_account && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <User className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">الحساب:</span>
                        <span className="font-mono font-bold text-foreground">
                          {t.sender_account}
                        </span>
                        <CopyButton text={t.sender_account} size="xs" />
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
                      {t.reviewed_by
                        ? `أُقرّ بواسطة ${t.reviewed_by}`
                        : "تمت المراجعة"}
                      {t.reviewed_at ? ` · ${formatDate(t.reviewed_at)}` : ""}
                    </div>
                  )}

                  {/* Actions — pending only */}
                  {t.status === "pending" && (
                    <div className="border-t border-border/40 pt-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm shadow-emerald-600/20 active:scale-[0.97] transition-transform"
                          onClick={() => handleApprove(t.id)}
                          disabled={processingId === t.id}
                        >
                          <CheckCircle className="w-3.5 h-3.5 ml-1.5" />
                          {processingId === t.id && rejectTarget?.id !== t.id
                            ? "جارٍ..."
                            : "موافقة"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold active:scale-[0.97] transition-transform px-5"
                          onClick={() => setRejectTarget(t)}
                          disabled={processingId === t.id}
                        >
                          <XCircle className="w-3.5 h-3.5 ml-1.5" />
                          رفض
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
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
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ التحميل…
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" /> تحميل المزيد
                </>
              )}
            </Button>
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
