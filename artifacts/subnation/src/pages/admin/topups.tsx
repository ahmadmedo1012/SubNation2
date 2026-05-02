import { useState } from "react";
import { useListAdminTopups, useApproveTopup, useRejectTopup, getListAdminTopupsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Clock, Smartphone, Building2, User, Hash, Calendar, MessageSquare, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

function MethodBadge({ method }: { method: string }) {
  if (method === "lypay") return (
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
    madar:   { label: "مدار",    cls: "text-blue-400  bg-blue-500/10  border-blue-500/20" },
  };
  const d = map[net] ?? { label: net, cls: "text-muted-foreground bg-muted border-border" };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${d.cls}`}>{d.label}</span>;
}

const STATUS_FILTERS = [
  { value: "",         label: "الكل" },
  { value: "pending",  label: "معلق" },
  { value: "approved", label: "مقبول" },
  { value: "rejected", label: "مرفوض" },
];

function TopupCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-4 mb-3">
        <div className="h-6 bg-muted skeleton-shimmer rounded w-24" />
        <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14" />
        <div className="h-5 bg-muted skeleton-shimmer rounded-full w-16" />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="h-4 bg-muted skeleton-shimmer rounded w-full" />
        <div className="h-4 bg-muted skeleton-shimmer rounded w-4/5" />
      </div>
      <div className="h-9 bg-muted skeleton-shimmer rounded-lg" />
    </div>
  );
}

export default function AdminTopupsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [rejectNote, setRejectNote] = useState<Record<number, string>>({});
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [expandedReject, setExpandedReject] = useState<number | null>(null);

  const { data: allTopups = [], isLoading, refetch } = useListAdminTopups({}, {
    query: { queryKey: getListAdminTopupsQueryKey({}), enabled: !!adminToken, refetchInterval: 20_000 },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey({}) });

  const approveMutation = useApproveTopup({
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    mutation: { onSuccess() { setProcessingId(null); invalidate(); } },
  });

  const rejectMutation = useRejectTopup({
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    mutation: { onSuccess() { setProcessingId(null); setExpandedReject(null); invalidate(); } },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  const statusCounts = (allTopups as any[]).reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  const pendingCount = statusCounts["pending"] ?? 0;
  const topups = statusFilter ? (allTopups as any[]).filter((t: any) => t.status === statusFilter) : allTopups as any[];

  const handleApprove = (id: number) => {
    setProcessingId(id);
    approveMutation.mutate({ id, data: { admin_note: "تمت الموافقة" } });
  };

  const handleReject = (id: number) => {
    setProcessingId(id);
    rejectMutation.mutate({ id, data: { admin_note: rejectNote[id] || "مرفوض" } });
  };

  return (
    <AdminLayout onRefresh={() => refetch()} badges={{ pendingTopups: pendingCount }}>
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
            <p className="text-xs text-muted-foreground">{(allTopups as any[]).length} طلب إجمالاً</p>
          </div>

          {/* Status filter tabs */}
          <div className="flex gap-1 bg-secondary/40 border border-border rounded-xl p-1">
            {STATUS_FILTERS.map(s => {
              const count = s.value ? (statusCounts[s.value] ?? 0) : (allTopups as any[]).length;
              const active = statusFilter === s.value;
              return (
                <button
                  key={s.value}
                  onClick={() => setStatusFilter(s.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap ${
                    active ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                  {count > 0 && (
                    <span className={`text-[10px] font-black ${active ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <TopupCardSkeleton key={i} />)}
          </div>
        ) : topups.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-muted mx-auto mb-3 flex items-center justify-center">
              <Clock className="w-5 h-5 opacity-30" />
            </div>
            <p className="font-bold text-sm">
              {statusFilter === "pending" ? "لا توجد طلبات معلقة" : "لا توجد طلبات في هذه الفئة"}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {topups.map((t: any) => (
              <div
                key={t.id}
                className={`bg-card rounded-xl border overflow-hidden transition-all ${
                  t.status === "pending" ? "border-yellow-400/20 shadow-sm shadow-yellow-400/4" : "border-border"
                }`}
              >
                {t.status === "pending" && (
                  <div className="h-0.5 bg-gradient-to-l from-yellow-400/50 via-yellow-400/25 to-transparent" />
                )}

                <div className="p-4">
                  {/* Top row: amount + badges + date */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="font-black text-xl tabular-nums">{formatCurrency(t.amount)}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${statusColor(t.status)}`}>
                      {statusLabel(t.status)}
                    </span>
                    <MethodBadge method={t.payment_method ?? "mobile_transfer"} />
                    {t.payment_method !== "lypay" && <NetworkBadge net={t.payment_network} />}
                    <span className="mr-auto text-xs text-muted-foreground/50 tabular-nums">
                      {t.created_at ? formatDate(t.created_at) : ""}
                    </span>
                  </div>

                  {/* Details row */}
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <User className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">المستخدم:</span>
                      <span className="font-mono font-bold text-foreground">{t.user_phone}</span>
                    </div>
                    {t.sender_phone && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Smartphone className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">المُرسل:</span>
                        <span className="font-mono font-bold text-foreground">{t.sender_phone}</span>
                      </div>
                    )}
                    {t.payment_reference && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Hash className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">المرجع:</span>
                        <span className="font-mono text-xs text-foreground">{t.payment_reference}</span>
                      </div>
                    )}
                    {t.sender_account && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <User className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">الحساب:</span>
                        <span className="font-mono font-bold text-foreground">{t.sender_account}</span>
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
                    <div className="border-t border-border/40 pt-3 space-y-2">
                      {expandedReject === t.id && (
                        <input
                          type="text"
                          placeholder="سبب الرفض (اختياري)"
                          value={rejectNote[t.id] ?? ""}
                          onChange={e => setRejectNote(prev => ({ ...prev, [t.id]: e.target.value }))}
                          className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          dir="rtl"
                          autoFocus
                        />
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm shadow-emerald-600/20 active:scale-[0.97] transition-transform"
                          onClick={() => handleApprove(t.id)}
                          disabled={processingId === t.id}
                        >
                          <CheckCircle className="w-3.5 h-3.5 ml-1.5" />
                          {processingId === t.id ? "جارٍ..." : "موافقة"}
                        </Button>
                        {expandedReject === t.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold active:scale-[0.97] transition-transform px-4"
                              onClick={() => handleReject(t.id)}
                              disabled={processingId === t.id}
                            >
                              <XCircle className="w-3.5 h-3.5 ml-1.5" />
                              تأكيد الرفض
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 text-muted-foreground hover:text-foreground px-3"
                              onClick={() => setExpandedReject(null)}
                            >
                              إلغاء
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 border-red-500/20 text-red-400/70 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/8 active:scale-[0.97] transition-transform px-4"
                            onClick={() => setExpandedReject(t.id)}
                          >
                            <XCircle className="w-3.5 h-3.5 ml-1.5" />
                            رفض
                          </Button>
                        )}
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
