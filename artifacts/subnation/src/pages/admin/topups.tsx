import { useState } from "react";
import { useListAdminTopups, useApproveTopup, useRejectTopup, getListAdminTopupsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Clock, Filter, Smartphone, Building2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

function methodBadge(method: string) {
  if (method === "lypay") {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full font-bold">
        <Building2 className="w-3 h-3" /> LyPay
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-bold">
      <Smartphone className="w-3 h-3" /> تحويل رصيد
    </span>
  );
}

function networkBadge(net?: string | null) {
  if (!net) return null;
  const map: Record<string, { label: string; cls: string }> = {
    libyana: { label: "ليبيانا", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
    madar: { label: "مدار", cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  };
  const d = map[net] ?? { label: net, cls: "text-muted-foreground bg-muted border-border" };
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${d.cls}`}>{d.label}</span>;
}

export default function AdminTopupsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
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

  const pendingCount = topups.filter((t: any) => t.status === "pending").length;

  const handleApprove = (id: number) => {
    setProcessingId(id);
    approveMutation.mutate({ id, data: { admin_note: "تمت الموافقة" } });
  };

  const handleReject = (id: number) => {
    setProcessingId(id);
    rejectMutation.mutate({ id, data: { admin_note: rejectNote[id] || "مرفوض" } });
  };

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black">طلبات الشحن</h1>
            {pendingCount > 0 && (
              <span className="bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 text-xs font-black px-2.5 py-1 rounded-full">
                {pendingCount} معلق
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {["", "pending", "approved", "rejected"].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? "bg-primary text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                {s === "" ? "الكل" : statusLabel(s)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-28 animate-pulse" />)}</div>
        ) : topups.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>لا توجد طلبات شحن</p>
          </div>
        ) : (
          <div className="space-y-3">
            {topups.map((t: any) => (
              <div key={t.id} className={`bg-card border rounded-xl p-5 transition-colors ${t.status === "pending" ? "border-yellow-400/20" : "border-border"}`}>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="font-black text-xl">{formatCurrency(t.amount)}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor(t.status)}`}>{statusLabel(t.status)}</span>
                      {methodBadge(t.payment_method ?? "mobile_transfer")}
                      {t.payment_method !== "lypay" && networkBadge(t.payment_network)}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4 text-sm">
                      <div className="text-muted-foreground">
                        المستخدم: <strong className="text-foreground font-mono">{t.user_phone}</strong>
                      </div>
                      {t.sender_phone && (
                        <div className="text-muted-foreground">
                          رقم المُرسل: <strong className="text-foreground font-mono">{t.sender_phone}</strong>
                        </div>
                      )}
                      {t.sender_account && (
                        <div className="text-muted-foreground">
                          حساب المُرسل: <strong className="text-foreground font-mono">{t.sender_account}</strong>
                        </div>
                      )}
                      {t.payment_reference && (
                        <div className="text-muted-foreground">
                          المرجع: <strong className="text-foreground font-mono">{t.payment_reference}</strong>
                        </div>
                      )}
                      {t.created_at && (
                        <div className="text-muted-foreground text-xs">{formatDate(t.created_at)}</div>
                      )}
                    </div>

                    {t.admin_note && t.status !== "pending" && (
                      <div className="mt-2 text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2.5 py-1.5 rounded-lg inline-block">
                        {t.admin_note}
                      </div>
                    )}
                  </div>

                  {t.status === "pending" && (
                    <div className="flex flex-col gap-2 min-w-44 shrink-0">
                      <input
                        type="text"
                        placeholder="ملاحظة الرفض (اختياري)"
                        value={rejectNote[t.id] ?? ""}
                        onChange={e => setRejectNote(prev => ({ ...prev, [t.id]: e.target.value }))}
                        className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        dir="rtl"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => handleApprove(t.id)} disabled={processingId === t.id}>
                          <CheckCircle className="w-3.5 h-3.5 ml-1" /> موافقة
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                          onClick={() => handleReject(t.id)} disabled={processingId === t.id}>
                          <XCircle className="w-3.5 h-3.5 ml-1" /> رفض
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
