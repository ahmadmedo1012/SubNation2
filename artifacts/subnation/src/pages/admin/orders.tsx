import { useState, useEffect } from "react";
import { useListAdminOrders, getListAdminOrdersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { ShoppingBag, Search, Package, Download, X, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STATUS_FILTERS = [
  { value: "",           label: "الكل" },
  { value: "delivered",  label: "مكتمل" },
  { value: "pending",    label: "معلق" },
  { value: "processing", label: "جارٍ" },
  { value: "failed",     label: "فاشل" },
  { value: "refunded",   label: "مسترجع" },
];

function TableSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="border-b border-border bg-muted/30 h-11" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className={`flex items-center gap-4 px-4 py-3 border-b border-border/30 ${i % 2 !== 0 ? "bg-muted/5" : ""}`}>
          <div className="h-3.5 bg-muted skeleton-shimmer rounded w-24 shrink-0" />
          <div className="h-3.5 bg-muted skeleton-shimmer rounded w-28" />
          <div className="h-3.5 bg-muted skeleton-shimmer rounded flex-1" />
          <div className="h-3.5 bg-muted skeleton-shimmer rounded w-16 shrink-0" />
          <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14 shrink-0" />
          <div className="h-3.5 bg-muted skeleton-shimmer rounded w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function AdminOrdersPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const { data: allOrders = [], isLoading, refetch } = useListAdminOrders({}, {
    query: { queryKey: getListAdminOrdersQueryKey({}), enabled: !!adminToken, refetchInterval: 30_000 },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  // Keyboard shortcut: / to focus search, Esc to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as Element)?.tagName)) {
        e.preventDefault();
        document.getElementById("orders-search")?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const statusCounts = (allOrders as any[]).reduce((acc: Record<string, number>, o: any) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  const byStatus = statusFilter ? (allOrders as any[]).filter((o: any) => o.status === statusFilter) : (allOrders as any[]);
  const filtered = search
    ? byStatus.filter((o: any) =>
        o.order_code?.toLowerCase().includes(search.toLowerCase()) ||
        o.user_phone?.includes(search) ||
        o.product_name?.toLowerCase().includes(search.toLowerCase())
      )
    : byStatus;

  const todayCount = (allOrders as any[]).filter((o: any) => {
    if (!o.created_at) return false;
    const d = new Date(o.created_at);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;

  const exportCSV = () => {
    const headers = ["رقم الطلب", "المستخدم", "المنتج", "المبلغ", "الحالة", "التاريخ"];
    const rows = filtered.map((o: any) => [
      o.order_code ?? "",
      o.user_phone ?? "",
      (o.product_name ?? "").replace(/,/g, "؛"),
      o.amount ?? 0,
      statusLabel(o.status),
      o.created_at ? formatDate(o.created_at) : "",
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black mb-0.5">الطلبات</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{(allOrders as any[]).length} طلب إجمالاً</span>
              {todayCount > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span className="text-primary font-bold">{todayCount} اليوم</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                id="orders-search"
                placeholder="بحث... ( / )"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 h-9 w-56 text-sm"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Export */}
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={exportCSV}
              disabled={filtered.length === 0}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">تصدير CSV</span>
            </Button>
          </div>
        </div>

        {/* Status filter tabs with counts */}
        <div className="flex gap-1 bg-secondary/40 border border-border rounded-xl p-1 overflow-x-auto scrollbar-none">
          {STATUS_FILTERS.map(s => {
            const count = s.value ? statusCounts[s.value] ?? 0 : (allOrders as any[]).length;
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
                  <span className={`text-[10px] font-black px-1 rounded ${active ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Table */}
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-muted mx-auto mb-3 flex items-center justify-center">
              <ShoppingBag className="w-5 h-5 opacity-30" />
            </div>
            <p className="font-bold text-sm mb-1">لا توجد طلبات</p>
            {(search || statusFilter) && (
              <button onClick={() => { setSearch(""); setStatusFilter(""); }} className="text-xs text-primary hover:underline mt-1">
                مسح الفلاتر
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/25">
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">رقم الطلب</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">المستخدم</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">المنتج</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">المبلغ</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">الحالة</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">التاريخ</th>
                      <th className="w-8 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((order: any, idx: number) => (
                      <>
                        <tr
                          key={order.id}
                          onClick={() => setExpandedRow(expandedRow === order.id ? null : order.id)}
                          className={`border-b border-border/30 transition-colors hover:bg-muted/20 cursor-pointer group ${idx % 2 !== 0 ? "bg-muted/[0.035]" : ""}`}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{order.order_code}</td>
                          <td className="px-4 py-3 font-mono text-xs font-bold">{order.user_phone}</td>
                          <td className="px-4 py-3 font-medium text-sm max-w-40 truncate">{order.product_name}</td>
                          <td className="px-4 py-3 font-black text-primary text-sm tabular-nums">{formatCurrency(order.amount)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${statusColor(order.status)}`}>
                              {statusLabel(order.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">{order.created_at ? formatDate(order.created_at) : "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors">
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${expandedRow === order.id ? "rotate-180" : ""}`} />
                          </td>
                        </tr>
                        {expandedRow === order.id && (
                          <tr key={`exp-${order.id}`} className="bg-muted/10">
                            <td colSpan={7} className="px-4 py-3 border-b border-border/30">
                              <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
                                {order.delivered_email && (
                                  <div><span className="text-muted-foreground">البريد: </span><span className="font-mono font-bold">{order.delivered_email}</span></div>
                                )}
                                {order.delivered_password && (
                                  <div><span className="text-muted-foreground">كلمة المرور: </span><span className="font-mono font-bold">{order.delivered_password}</span></div>
                                )}
                                {order.delivered_extra_details && (
                                  <div><span className="text-muted-foreground">تفاصيل: </span><span>{order.delivered_extra_details}</span></div>
                                )}
                                {!order.delivered_email && !order.delivered_password && !order.delivered_extra_details && (
                                  <span className="text-muted-foreground/50">لا توجد بيانات تسليم</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
                <span>{filtered.length} طلب{search && ` · نتائج "${search}"`}</span>
                <span className="hidden sm:inline text-muted-foreground/40">انقر على الصف لعرض بيانات التسليم</span>
              </div>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {filtered.map((order: any) => (
                <div
                  key={order.id}
                  className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-border/60 transition-colors"
                  onClick={() => setExpandedRow(expandedRow === order.id ? null : order.id)}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="font-bold text-sm">{order.product_name}</div>
                      <div className="font-mono text-xs text-muted-foreground mt-0.5">{order.user_phone}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-black text-primary tabular-nums">{formatCurrency(order.amount)}</div>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border mt-1 inline-block ${statusColor(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 border-t border-border/30 pt-2">
                    <span className="font-mono">{order.order_code}</span>
                    {order.created_at && <><span>·</span><span>{formatDate(order.created_at)}</span></>}
                  </div>
                  {expandedRow === order.id && (order.delivered_email || order.delivered_password) && (
                    <div className="mt-2 pt-2 border-t border-border/30 space-y-1 text-xs">
                      {order.delivered_email && <div><span className="text-muted-foreground">البريد: </span><span className="font-mono font-bold">{order.delivered_email}</span></div>}
                      {order.delivered_password && <div><span className="text-muted-foreground">كلمة المرور: </span><span className="font-mono font-bold">{order.delivered_password}</span></div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
