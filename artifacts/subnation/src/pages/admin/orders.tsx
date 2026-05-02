import { useState } from "react";
import { useListAdminOrders, getListAdminOrdersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { ShoppingBag, Filter } from "lucide-react";

export default function AdminOrdersPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("");

  const params: Record<string, string> = {};
  if (statusFilter) params.status = statusFilter;

  const { data: orders = [], isLoading } = useListAdminOrders(params, {
    query: { queryKey: getListAdminOrdersQueryKey(params), enabled: !!adminToken },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  return (
    <AdminLayout>
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black">الطلبات</h1>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {["", "pending", "completed", "failed", "refunded"].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? "bg-primary text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                {s === "" ? "الكل" : statusLabel(s)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-16 animate-pulse" />)}</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>لا توجد طلبات</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">رقم الطلب</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">المستخدم</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">المنتج</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">المبلغ</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">الحالة</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order: any) => (
                  <tr key={order.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{order.order_code}</td>
                    <td className="px-4 py-3 font-mono">{order.user_phone}</td>
                    <td className="px-4 py-3 font-medium">{order.product_name}</td>
                    <td className="px-4 py-3 font-bold">{formatCurrency(order.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor(order.status)}`}>{statusLabel(order.status)}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{order.created_at ? formatDate(order.created_at) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
