import { useState } from "react";
import { useListAdminTopups, useApproveTopup, useRejectTopup, getListAdminTopupsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Clock, Smartphone, Building2, User, Hash, Calendar, MessageSquare } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

function methodBadge(method: string) {
  if (method === "lypay") return (
    <span className="inline-flex items-center gap-1 text-[11px] bg-purple-500/12 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full font-bold">
      <Building2 className="w-3 h-3" /> LyPay
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] bg-blue-500/12 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-bold">
      <Smartphone className="w-3 h-3" /> تحويل رصيد
    </span>
  );
}

function networkBadge(net?: string | null) {
  if (!net) return null;
  const map: Record<string, { label: string; cls: string }> = {
    libyana: { label: "ليبيانا", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
    madar:   { label: "مدار",    cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  };
  const d = map[net] ?? { label: net, cls: "text-muted-foreground bg-muted border-border" };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border font-bold ${d.cls}`}>{d.label}</span>;
}

const STATUS_FILTERS = [
  { value: "",         label: "الكل" },
  { value: "pending",  label: "معلق" },
  { value: "approved", label: "مقبول" },
  { value: "rejected", label: "مرفوض" },
];

export default function AdminTopupsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [rejectNote, setRejectNote] = useState<Record<number, string>>({});
  const [processingId, setProcessingId] = useState<number | null>(null);

  const params: Record<string, string> = {};
  if (statusFilter) params.status = statusFilter;

  const { data: topups = [], isLoading, refetch } = useListAdminTopups(params, {
    query: { queryKey: getListAdminTopupsQueryKey(params), enabled: !!adminToken, refetchInterval: 30_000 },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  const approveMutation = useApproveTopup({
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    mutation: {
      onSuccess() {
        setProcessingId(null);
        queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey(params) });
      },
    },
  });

  const rejectMutation = useRejectTopup({
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    mutation: {
      onSuccess() {
        setProcessingId(null);
        queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey(params) });
      },
    },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  const allTopups = useListAdminTopups({}, { query: { queryKey: getListAdminTopupsQueryKey({}), enabled: !!adminToken }, request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } } });
  const pendingCount = (allTopups.data ?? []).filter((t: any) => t.status === "pending").length;

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black">طلبات الشحن</h1>
              {pendingCount > 0 && (
                <span className="bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 text-xs font-black px-2.5 py-1 rounded-full animate-pulse">
                  {pendingCount} معلق
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm mt-0.5">مراجعة وإدارة طلبات الشحن</p>
          </div>
          <div className="flex gap-1.5 bg-secondary/50 border border-border rounded-xl p-1">
            {STATUS_FILTERS.map(s => (
              <button key={s.value} onClick={() => setStatusFilter(s.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${statusFilter === s.value ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl h-36 skeleton-shimmer" />
            ))}
          </div>
        ) : topups.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-xl">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-25" />
            <p className="font-bold">لا توجد طلبات في هذه الفئة</p>
          </div>
        ) : (
          <div className="space-y-3">
            {topups.map((t: any) => (
              <div key={t.id} className={`bg-card rounded-xl border overflow-hidden transition-all ${t.status === "pending" ? "border-yellow-400/20 shadow-sm shadow-yellow-400/5" : "border-border"}`}>
                {/* Card header strip */}
                {t.status === "pending" && (
                  <div className="h-0.5 bg-gradient-to-l from-yellow-400/60 via-yellow-400/30 to-transparent" />
                )}
                <div className="p-5">
                  <div className="flex flex-wrap items-start gap-5">
                    {/* Left: info */}
                    <div className="flex-1 min-w-0">
                      {/* Amount + badges row */}
                      <div className="flex flex-wrap items-center gap-2 mb-4">
                        <span className="font-black text-2xl text-foreground">{formatCurrency(t.amount)}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor(t.status)}`}>
                          {statusLabel(t.status)}
                        </span>
                        {methodBadge(t.payment_method ?? "mobile_transfer")}
                        {t.payment_method !== "lypay" && networkBadge(t.payment_network)}
                      </div>

                      {/* Details grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="flex items-center gap-2 text-sm">
                          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">المستخدم:</span>
                          <strong className="font-mono text-foreground">{t.user_phone}</strong>
                        </div>
                        {t.sender_phone && (
                          <div className="flex items-center gap-2 text-sm">
                            <Smartphone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">المُرسل:</span>
                            <strong className="font-mono text-foreground">{t.sender_phone}</strong>
                          </div>
                        )}
                        {t.sender_account && (
                          <div className="flex items-center gap-2 text-sm">
                            <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">الحساب:</span>
                            <strong className="font-mono text-foreground">{t.sender_account}</strong>
                          </div>
                        )}
                        {t.payment_reference && (
                          <div className="flex items-center gap-2 text-sm">
                            <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">المرجع:</span>
                            <strong className="font-mono text-foreground text-xs">{t.payment_reference}</strong>
                          </div>
                        )}
                        {t.created_at && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="w-3.5 h-3.5 shrink-0" />
                            <span>{formatDate(t.created_at)}</span>
                          </div>
                        )}
                      </div>

                      {t.admin_note && t.status !== "pending" && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/8 border border-yellow-400/20 px-3 py-2 rounded-lg">
                          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                          {t.admin_note}
                        </div>
                      )}
                    </div>

                    {/* Right: actions */}
                    {t.status === "pending" && (
                      <div className="flex flex-col gap-2.5 shrink-0 min-w-48">
                        <input
                          type="text"
                          placeholder="سبب الرفض (اختياري)"
                          value={rejectNote[t.id] ?? ""}
                          onChange={e => setRejectNote(prev => ({ ...prev, [t.id]: e.target.value }))}
                          className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-full"
                          dir="rtl"
                        />
                        <Button
                          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-10 shadow-md shadow-emerald-600/20 active:scale-95 transition-transform"
                          onClick={() => handleApprove(t.id)}
                          disabled={processingId === t.id}
                        >
                          <CheckCircle className="w-4 h-4 ml-1.5" />
                          {processingId === t.id ? "جاري..." : "موافقة"}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 font-bold h-10 active:scale-95 transition-transform"
                          onClick={() => handleReject(t.id)}
                          disabled={processingId === t.id}
                        >
                          <XCircle className="w-4 h-4 ml-1.5" />
                          رفض
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
