import { useState } from "react";
import { useListAdminOrders, getListAdminOrdersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { ShoppingBag, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const STATUS_FILTERS = [
  { value: "",          label: "الكل" },
  { value: "completed", label: "مكتمل" },
  { value: "pending",   label: "معلق" },
  { value: "failed",    label: "فاشل" },
  { value: "refunded",  label: "مسترجع" },
];

export default function AdminOrdersPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const params: Record<string, string> = {};
  if (statusFilter) params.status = statusFilter;

  const { data: orders = [], isLoading } = useListAdminOrders(params, {
    query: { queryKey: getListAdminOrdersQueryKey(params), enabled: !!adminToken },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  const filtered = search
    ? orders.filter((o: any) =>
        o.order_code?.toLowerCase().includes(search.toLowerCase()) ||
        o.user_phone?.includes(search) ||
        o.product_name?.toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black mb-0.5">الطلبات</h1>
          <p className="text-muted-foreground text-sm">جميع طلبات المستخدمين</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="بحث برقم الطلب أو الهاتف أو المنتج..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-9 h-9"
            />
          </div>
          <div className="flex gap-1.5 bg-secondary/50 border border-border rounded-xl p-1">
            {STATUS_FILTERS.map(s => (
              <button key={s.value} onClick={() => setStatusFilter(s.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${statusFilter === s.value ? "bg-card shadow-sm text-foreground font-bold" : "text-muted-foreground hover:text-foreground"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-14 skeleton-shimmer" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-xl">
            <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-25" />
            <p className="font-bold">لا توجد طلبات</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-right px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">رقم الطلب</th>
                    <th className="text-right px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">المستخدم</th>
                    <th className="text-right px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">المنتج</th>
                    <th className="text-right px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">المبلغ</th>
                    <th className="text-right px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">الحالة</th>
                    <th className="text-right px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((order: any, idx: number) => (
                    <tr key={order.id} className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${idx % 2 === 0 ? "" : "bg-muted/5"}`}>
                      <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{order.order_code}</td>
                      <td className="px-4 py-3.5 font-mono text-sm">{order.user_phone}</td>
                      <td className="px-4 py-3.5 font-medium max-w-40 truncate">{order.product_name}</td>
                      <td className="px-4 py-3.5 font-black text-primary">{formatCurrency(order.amount)}</td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor(order.status)}`}>
                          {statusLabel(order.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground text-xs">{order.created_at ? formatDate(order.created_at) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/10 text-xs text-muted-foreground">
              {filtered.length} طلب
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
