import { useParams, useLocation } from "wouter";
import { useGetOrder, getGetOrderQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { Package, ArrowRight, Copy, CheckCircle, Info } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function OrderDetailPage() {
  const { orderCode } = useParams<{ orderCode: string }>();
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState<string | null>(null);

  const { data: order, isLoading } = useGetOrder(orderCode ?? "", {
    query: { queryKey: getGetOrderQueryKey(orderCode ?? ""), enabled: !!orderCode && !!token },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!token) { navigate("/login"); return null; }

  if (isLoading) return (
    <div className="max-w-2xl mx-auto px-4 py-12 animate-pulse">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div className="h-6 bg-muted rounded w-1/3" />
        <div className="h-4 bg-muted rounded w-full" />
        <div className="h-4 bg-muted rounded w-2/3" />
      </div>
    </div>
  );

  if (!order) return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center text-muted-foreground">
      <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="font-medium">الطلب غير موجود</p>
    </div>
  );

  const CopyField = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg">
      <div>
        <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
        <div className="font-mono font-bold text-sm break-all">{value}</div>
      </div>
      <button
        onClick={() => copyToClipboard(value, label)}
        className="p-2 rounded-lg hover:bg-secondary transition-colors shrink-0"
      >
        {copied === label ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
      </button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <button onClick={() => navigate("/orders")} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-6 transition-colors">
        <ArrowRight className="w-4 h-4" />
        العودة للطلبات
      </button>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-bold text-lg">{order.product_name}</div>
              <div className="text-sm text-muted-foreground font-mono mt-1">{order.order_code}</div>
            </div>
            <span className={`text-sm font-bold px-3 py-1 rounded-full border ${statusColor(order.status ?? "")}`}>
              {statusLabel(order.status ?? "")}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
            <span>المبلغ: <strong className="text-foreground">{formatCurrency(order.amount ?? 0)}</strong></span>
            {order.created_at && <span>{formatDate(order.created_at)}</span>}
          </div>
        </div>

        {(order.delivered_email || order.delivered_password || order.delivered_extra_details) ? (
          <div className="p-6">
            <h2 className="font-black mb-4 text-sm text-muted-foreground uppercase tracking-wider">بيانات الحساب</h2>
            <div className="space-y-3">
              {order.delivered_email && <CopyField label="البريد الإلكتروني" value={order.delivered_email} />}
              {order.delivered_password && <CopyField label="كلمة المرور" value={order.delivered_password} />}
              {order.delivered_extra_details && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm">{order.delivered_extra_details}</div>
              )}
            </div>

            {order.delivered_usage_terms && (
              <div className="mt-4 flex gap-2 text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{order.delivered_usage_terms}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 text-center text-muted-foreground text-sm">
            <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>لا توجد بيانات تسليم لهذا الطلب</p>
          </div>
        )}

        <div className="px-6 pb-6">
          <Button onClick={() => navigate("/")} variant="outline" className="w-full">
            العودة للكتالوج
          </Button>
        </div>
      </div>
    </div>
  );
}
