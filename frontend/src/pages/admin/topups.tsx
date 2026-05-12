import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, statusColor, statusLabel } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAdminTopupsQueryKey,
  useApproveTopup,
  useListAdminTopups,
  useRejectTopup,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle,
  CheckSquare,
  Clock,
  Copy,
  Hash,
  MessageSquare,
  Smartphone,
  Square,
  User,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

function MethodBadge({ method }: { method: string }) {
  if (method === "lypay")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded-full font-bold">
        <Building2 className="w-2.5 h-2.5" /> LyPay
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded-full font-bold">
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
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${d.cls}`}>
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
function RejectModal({
  topup,
  onConfirm,
  onCancel,
  loading,
}: {
  topup: any;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [note, setNote] = useState("");

  return (
    <div
      className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-black text-sm">تأكيد الرفض</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono font-bold text-foreground">
                {formatCurrency(topup.amount)}
              </span>{" "}
              · {topup.user_phone}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4">
          <label className="text-xs font-bold text-muted-foreground block mb-1.5">
            سبب الرفض <span className="text-muted-foreground">(اختياري)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: المرجع غير صحيح، المبلغ غير مطابق..."
            className="w-full h-20 bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-destructive resize-none"
            dir="rtl"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onConfirm(note);
            }}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            <kbd className="font-mono bg-muted/60 border border-border/50 px-1 rounded">⌘↵</kbd>{" "}
            للتأكيد ·
            <kbd className="font-mono bg-muted/60 border border-border/50 px-1 rounded mr-1">
              Esc
            </kbd>{" "}
            للإلغاء
          </p>
        </div>

        <div className="flex gap-2.5">
          <Button variant="outline" className="flex-1 h-9 active:scale-[0.97]" onClick={onCancel}>
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
        </div>
      </div>
    </div>
  );
}

// Bulk action confirmation modal
function BulkConfirmModal({
  action,
  count,
  onConfirm,
  onCancel,
  loading,
}: {
  action: "approve" | "reject";
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-sm shadow-2xl animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-black text-sm">
              {action === "approve" ? "تأكيد الموافقة الجماعية" : "تأكيد الرفض الجماعي"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">{count} طلب سيتم معالجته</p>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2.5">
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
            {loading ? "جارٍ المعالجة..." : action === "approve" ? "موافقة" : "رفض"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text, size = "sm" }: { text: string; size?: "sm" | "xs" }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      title="نسخ"
      className={`shrink-0 rounded transition-colors ${copied ? "text-emerald-400" : "text-muted-foreground hover:text-muted-foreground"}`}
    >
      {copied ? (
        <Check className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      ) : (
        <Copy className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      )}
    </button>
  );
}

export default function AdminTopupsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: "Escape",
      handler: () => {
        if (rejectTarget) {
          setRejectTarget(null);
          setProcessingId(null);
        }
        if (bulkAction) {
          setBulkAction(null);
        }
      },
      description: "إغلاق النافذة",
    },
  ]);

  const {
    data: allTopups = [],
    isLoading,
    refetch,
  } = useListAdminTopups(
    {},
    {
      query: {
        queryKey: getListAdminTopupsQueryKey({}),
        enabled: !!adminToken,
        refetchInterval: 20_000,
      },
      request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    },
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey({}) });

  const approveMutation = useApproveTopup({
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    mutation: {
      onSuccess(_, vars) {
        setProcessingId(null);
        invalidate();
        const t = (allTopups as any[]).find((x: any) => x.id === vars.id);
        toast({
          title: "✓ تمت الموافقة",
          description: t
            ? `${formatCurrency(t.amount)} لـ ${t.user_phone}`
            : "تمت الموافقة على الطلب",
        });
      },
      onError() {
        setProcessingId(null);
        toast({
          title: "خطأ",
          description: "فشلت الموافقة، حاول مرة أخرى",
          variant: "destructive",
        });
      },
    },
  });

  const rejectMutation = useRejectTopup({
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    mutation: {
      onSuccess(_, vars) {
        setProcessingId(null);
        setRejectTarget(null);
        invalidate();
        const t = (allTopups as any[]).find((x: any) => x.id === vars.id);
        toast({
          title: "تم الرفض",
          description: t ? `${formatCurrency(t.amount)} من ${t.user_phone}` : "تم رفض الطلب",
        });
      },
      onError() {
        setProcessingId(null);
        toast({ title: "خطأ", description: "فشل الرفض، حاول مرة أخرى", variant: "destructive" });
      },
    },
  });

  if (!adminToken) {
    navigate("/admin/login");
    return null;
  }

  const pendingTopups = (allTopups as any[]).filter((t: any) => t.status === "pending");
  const allPendingSelected =
    pendingTopups.length > 0 && pendingTopups.every((t: any) => selectedIds.has(t.id));
  const selectedPendingCount = pendingTopups.filter((t: any) => selectedIds.has(t.id)).length;

  const statusCounts = (allTopups as any[]).reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  const pendingCount = statusCounts["pending"] ?? 0;
  const topups = statusFilter
    ? (allTopups as any[]).filter((t: any) => t.status === statusFilter)
    : (allTopups as any[]);

  const handleApprove = (id: number) => {
    setProcessingId(id);
    approveMutation.mutate({ id, data: { admin_note: "تمت الموافقة" } });
  };

  const handleReject = (note: string) => {
    if (!rejectTarget) return;
    setProcessingId(rejectTarget.id);
    rejectMutation.mutate({ id: rejectTarget.id, data: { admin_note: note || "مرفوض" } });
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
    const pendingTopups = (allTopups as any[]).filter((t: any) => t.status === "pending");
    const allSelected = pendingTopups.every((t: any) => selectedIds.has(t.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingTopups.map((t: any) => t.id)));
    }
  };

  const handleBulkAction = async (action: "approve" | "reject") => {
    setIsBulkProcessing(true);
    const ids = Array.from(selectedIds);
    let successCount = 0;

    for (const id of ids) {
      try {
        if (action === "approve") {
          await fetch(`/api/admin/topups/${id}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ admin_note: "تمت الموافقة الجماعية" }),
          });
        } else {
          await fetch(`/api/admin/topups/${id}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ admin_note: "مرفوض جماعياً" }),
          });
        }
        successCount++;
      } catch (e) {
        console.error(`Failed to ${action} topup ${id}`, e);
      }
    }

    setSelectedIds(new Set());
    setBulkAction(null);
    setIsBulkProcessing(false);
    invalidate();
    toast({
      title: action === "approve" ? "✓ تمت الموافقة الجماعية" : "تم الرفض الجماعي",
      description: `${successCount}/${ids.length} طلب تمت معالجته`,
    });
  };

  const approveAll = async () => {
    const pending = (allTopups as any[]).filter((t: any) => t.status === "pending");
    for (const t of pending) {
      await fetch(`/api/admin/topups/${t.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ admin_note: "تمت الموافقة الجماعية" }),
      });
    }
    toast({ title: `✓ تمت الموافقة على ${pending.length} طلب` });
    invalidate();
  };

  return (
    <AdminLayout onRefresh={() => refetch()} badges={{ pendingTopups: pendingCount }}>
      {/* Reject modal */}
      {rejectTarget && (
        <RejectModal
          topup={rejectTarget}
          onConfirm={handleReject}
          onCancel={() => {
            setRejectTarget(null);
            setProcessingId(null);
          }}
          loading={processingId === rejectTarget.id}
        />
      )}

      {/* Bulk action confirmation modal */}
      {bulkAction && (
        <BulkConfirmModal
          action={bulkAction}
          count={selectedPendingCount}
          onConfirm={() => handleBulkAction(bulkAction)}
          onCancel={() => setBulkAction(null)}
          loading={isBulkProcessing}
        />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <h1 className="text-xl font-black">طلبات الشحن</h1>
              {pendingCount > 0 && (
                <span className="flex items-center gap-1 bg-yellow-400/15 text-yellow-400 border border-yellow-400/25 text-xs font-black px-2 py-0.5 rounded-full animate-pulse">
                  <AlertTriangle className="w-3 h-3" />
                  {pendingCount} معلق
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{(allTopups as any[]).length} طلب إجمالاً</span>
              {pendingCount > 0 &&
                (() => {
                  const pendingTotal = (allTopups as any[])
                    .filter((t: any) => t.status === "pending")
                    .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
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

          <div className="flex items-center gap-2">
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
                onClick={approveAll}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                موافقة الكل ({pendingCount})
              </Button>
            )}

            {/* Status filter tabs */}
            <div className="flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1">
              {STATUS_FILTERS.map((s) => {
                const count = s.value ? (statusCounts[s.value] ?? 0) : (allTopups as any[]).length;
                const active = statusFilter === s.value;
                return (
                  <button
                    key={s.value}
                    onClick={() => setStatusFilter(s.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap ${
                      active
                        ? "bg-card shadow-sm text-foreground font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                    {count > 0 && (
                      <span
                        className={`text-[10px] font-black ${active ? "text-muted-foreground" : "text-muted-foreground"}`}
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
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <TopupCardSkeleton key={i} />
            ))}
          </div>
        ) : topups.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border/60 rounded-2xl">
            <div className="w-12 h-12 rounded-2xl bg-muted mx-auto mb-3 flex items-center justify-center">
              <Clock className="w-5 h-5 opacity-30" />
            </div>
            <p className="font-bold text-sm">
              {statusFilter === "pending" ? "لا توجد طلبات معلقة" : "لا توجد طلبات في هذه الفئة"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">ستظهر الطلبات هنا عند ورودها</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {topups.map((t: any, i: number) => (
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
                    <span className="font-black text-xl tabular-nums">
                      {formatCurrency(t.amount)}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${statusColor(t.status)}`}
                    >
                      {statusLabel(t.status)}
                    </span>
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
                      <span className="font-mono font-bold text-foreground">{t.user_phone}</span>
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
                        <span className="text-muted-foreground">المرجع:</span>
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
      </div>
    </AdminLayout>
  );
}
