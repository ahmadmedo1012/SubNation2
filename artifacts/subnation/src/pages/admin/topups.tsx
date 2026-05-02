import { useState } from "react";
import { useListAdminTopups, useApproveTopup, useRejectTopup, getListAdminTopupsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Clock, Filter } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function AdminTopupsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [rejectNote, setRejectNote] = useState<Record<number, string>>({});
  const [processingId, setProcessingId] = useState<number | null>(null);

  const params: Record<string, string> = {};
  if (statusFilter) params.status = statusFilter;

  const { data: topups = [], isLoading } = useListAdminTopups(params, {
    query: { queryKey: getListAdminTopupsQueryKey(params), enabled: !!adminToken },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  const approveMutation = useApproveTopup({
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    mutation: {
      onSuccess() {
        setProcessingId(null);
        queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey({}) });
      },
    },
  });

  const rejectMutation = useRejectTopup({
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
    mutation: {
      onSuccess() {
        setProcessingId(null);
        queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey({}) });
      },
    },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  const handleApprove = (id: number) => {
    setProcessingId(id);
    approveMutation.mutate({ id, data: { admin_note: "تمت الموافقة" } });
  };

  const handleReject = (id: number) => {
    setProcessingId(id);
    rejectMutation.mutate({ id, data: { admin_note: rejectNote[id] || "مرفوض" } });
  };

  return (
    <AdminLayout>
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black">طلبات الشحن</h1>
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
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-24 animate-pulse" />)}</div>
        ) : topups.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>لا توجد طلبات شحن</p>
          </div>
        ) : (
          <div className="space-y-3">
            {topups.map((t: any) => (
              <div key={t.id} className="bg-card border border-border rounded-xl p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-black text-lg">{formatCurrency(t.amount)}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor(t.status)}`}>{statusLabel(t.status)}</span>
                      <span className="text-sm bg-secondary px-2 py-0.5 rounded font-medium">{t.payment_network === "madar" ? "مدار" : "ليبيانا"}</span>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-0.5">
                      <div>المستخدم: <strong className="text-foreground font-mono">{t.user_phone}</strong></div>
                      {t.sender_phone && <div>رقم المرسل: <strong className="text-foreground font-mono">{t.sender_phone}</strong></div>}
                      {t.payment_reference && <div>المرجع: <strong className="text-foreground font-mono">{t.payment_reference}</strong></div>}
                      {t.created_at && <div>{formatDate(t.created_at)}</div>}
                      {t.admin_note && <div className="text-yellow-400">ملاحظة: {t.admin_note}</div>}
                    </div>
                  </div>

                  {t.status === "pending" && (
                    <div className="flex flex-col gap-2 min-w-48">
                      <input
                        type="text"
                        placeholder="ملاحظة الرفض (اختياري)"
                        value={rejectNote[t.id] ?? ""}
                        onChange={e => setRejectNote(prev => ({ ...prev, [t.id]: e.target.value }))}
                        className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        dir="rtl"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => handleApprove(t.id)}
                          disabled={processingId === t.id}
                        >
                          <CheckCircle className="w-3.5 h-3.5 ml-1" />
                          موافقة
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                          onClick={() => handleReject(t.id)}
                          disabled={processingId === t.id}
                        >
                          <XCircle className="w-3.5 h-3.5 ml-1" />
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
