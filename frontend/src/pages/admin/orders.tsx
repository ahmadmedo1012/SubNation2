import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, statusColor, statusLabel } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAdminOrdersQueryKey,
  type AdminOrder,
  useListAdminOrders,
} from "@workspace/api-client-react";
import {
  BadgePercent,
  BarChart2,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  RefreshCw,
  Search,
  ShoppingBag,
  Square,
  Tag,
  Ticket,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

/** API may return extra delivery / coupon fields */
type AdminOrderRow = AdminOrder & {
  coupon_code?: string;
  discount_amount?: number;
  delivered_extra_details?: string | null;
};

const BULK_STATUSES = [
  { value: "completed", label: "مكتمل", color: "text-emerald-400" },
  { value: "pending", label: "قيد الانتظار", color: "text-yellow-400" },
  { value: "failed", label: "فشل", color: "text-red-400" },
  { value: "refunded", label: "مسترجع", color: "text-blue-400" },
];

const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  { value: "completed", label: "مكتمل" },
  { value: "pending", label: "معلق" },
  { value: "failed", label: "فاشل" },
  { value: "refunded", label: "مسترجع" },
];

const DATE_RANGES = [
  { label: "الكل", days: 0 },
  { label: "اليوم", days: 1 },
  { label: "7 أيام", days: 7 },
  { label: "30 يوم", days: 30 },
];

function isWithinDays(dateStr: string, days: number) {
  if (!days) return true;
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

function TableSkeleton() {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      <div className="border-b border-border/60 bg-muted/30 h-11" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center gap-4 px-4 py-3 border-b border-border/25 ${i % 2 !== 0 ? "bg-muted/5" : ""}`}
        >
          <div className="h-3.5 bg-muted skeleton-shimmer rounded-md w-24 shrink-0" />
          <div className="h-3.5 bg-muted skeleton-shimmer rounded-md w-28" />
          <div className="h-3.5 bg-muted skeleton-shimmer rounded-md flex-1" />
          <div className="h-3.5 bg-muted skeleton-shimmer rounded-md w-16 shrink-0" />
          <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14 shrink-0" />
          <div className="h-3.5 bg-muted skeleton-shimmer rounded-md w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function AdminOrdersPage() {
  const { adminToken } = useAuth();
  const jsonHeaders = useAdminHeaders({ json: true });
  const headers = useAdminHeaders();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showStats, setShowStats] = useState(true);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const {
    data: allOrdersRaw = [],
    isLoading,
    refetch,
  } = useListAdminOrders(
    {},
    {
      query: {
        queryKey: getListAdminOrdersQueryKey({}),
        enabled: !!adminToken,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
      },
      request: { headers },
    },
  );

  const allOrders = allOrdersRaw as AdminOrderRow[];

  if (!adminToken) {
    navigate("/admin/login");
    return null;
  }

  const applyBulkStatus = async (status: string) => {
    setBulkUpdating(true);
    setBulkStatusOpen(false);
    try {
      await fetch("/api/admin/orders/bulk-status", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      setSelectedIds(new Set());
      refetch();
      qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey({}) });
    } finally {
      setBulkUpdating(false);
    }
  };

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

  const statusCounts = allOrders.reduce((acc: Record<string, number>, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  const byStatus = statusFilter ? allOrders.filter((o) => o.status === statusFilter) : allOrders;
  const byDate = dateRange
    ? byStatus.filter((o) => o.created_at && isWithinDays(o.created_at, dateRange))
    : byStatus;
  const filtered = search
    ? byDate.filter(
        (o) =>
          o.order_code?.toLowerCase().includes(search.toLowerCase()) ||
          o.user_phone?.includes(search) ||
          o.product_name?.toLowerCase().includes(search.toLowerCase()),
      )
    : byDate;

  const todayCount = allOrders.filter((o) => {
    if (!o.created_at) return false;
    const d = new Date(o.created_at);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }).length;

  const totalRevenue = filtered.reduce((sum: number, o) => sum + (Number(o.amount) || 0), 0);

  // Coupon stats from ALL orders (not filtered) for the overview panel
  const couponOrders = allOrders.filter((o) => o.coupon_code);
  const totalDiscounts = couponOrders.reduce(
    (sum: number, o) => sum + (Number(o.discount_amount) || 0),
    0,
  );
  const totalRevenueAll = allOrders.reduce((sum: number, o) => sum + (Number(o.amount) || 0), 0);

  // Top coupon codes: { code, uses, totalDiscount }
  const couponMap = couponOrders.reduce(
    (acc: Record<string, { uses: number; totalDiscount: number }>, o) => {
      const c = o.coupon_code as string;
      if (!acc[c]) acc[c] = { uses: 0, totalDiscount: 0 };
      acc[c].uses++;
      acc[c].totalDiscount += Number(o.discount_amount) || 0;
      return acc;
    },
    {},
  );
  const topCoupons = (
    Object.entries(couponMap) as Array<[string, { uses: number; totalDiscount: number }]>
  )
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 4);

  const exportCSV = () => {
    const csvHeaders = ["رقم الطلب", "المستخدم", "المنتج", "المبلغ", "الحالة", "التاريخ"];
    const rows = filtered.map((o) => [
      o.order_code ?? "",
      o.user_phone ?? "",
      (o.product_name ?? "").replace(/,/g, "؛"),
      o.amount ?? 0,
      statusLabel(o.status),
      o.created_at ? formatDate(o.created_at) : "",
    ]);
    const csv = [csvHeaders, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((o) => o.id)));
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));

  const exportSelected = () => {
    const sel = filtered.filter((o) => selectedIds.has(o.id));
    const csvHeaders = ["رقم الطلب", "المستخدم", "المنتج", "المبلغ", "الحالة", "التاريخ"];
    const rows = sel.map((o) => [
      o.order_code ?? "",
      o.user_phone ?? "",
      (o.product_name ?? "").replace(/,/g, "؛"),
      o.amount ?? 0,
      statusLabel(o.status),
      o.created_at ? formatDate(o.created_at) : "",
    ]);
    const csv = [csvHeaders, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders_selected_${new Date().toISOString().slice(0, 10)}.csv`;
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
              <span>{allOrders.length} طلب إجمالاً</span>
              {todayCount > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span className="text-primary font-bold">{todayCount} اليوم</span>
                </>
              )}
              {filtered.length !== allOrders.length && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span className="text-emerald-400 font-bold tabular-nums">
                    {formatCurrency(totalRevenue)}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                id="orders-search"
                placeholder="بحث... ( / )"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9 h-9 w-full sm:w-56 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Export */}
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={selectedIds.size > 0 ? exportSelected : exportCSV}
              disabled={filtered.length === 0}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {selectedIds.size > 0 ? `تصدير (${selectedIds.size})` : "تصدير CSV"}
              </span>
            </Button>
          </div>
        </div>

        {/* Stats Panel */}
        {!isLoading && allOrders.length > 0 && (
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden float-in stagger-1">
            <button
              onClick={() => setShowStats((s) => !s)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors"
            >
              <div className="flex items-center gap-2 text-sm font-bold">
                <BarChart2 className="w-4 h-4 text-primary" />
                إحصائيات الطلبات والكوبونات
              </div>
              <div className="flex items-center gap-3">
                {!showStats && (
                  <span className="text-xs text-muted-foreground font-normal">
                    {couponOrders.length} طلب بكوبون · خصم {formatCurrency(totalDiscounts)}
                  </span>
                )}
                {showStats ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </div>
            </button>

            {showStats && (
              <div className="border-t border-border/50 p-4 space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Total revenue */}
                  <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
                      <TrendingUp className="w-3 h-3" />
                      إجمالي الإيرادات
                    </div>
                    <div className="font-black text-base tabular-nums text-primary">
                      {formatCurrency(totalRevenueAll)}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {allOrders.length} طلب
                    </div>
                  </div>

                  {/* Total discounts */}
                  <div className="bg-emerald-500/5 rounded-2xl p-3 border border-emerald-500/15">
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/80 mb-1.5">
                      <BadgePercent className="w-3 h-3" />
                      إجمالي الخصومات
                    </div>
                    <div className="font-black text-base tabular-nums text-emerald-400">
                      {formatCurrency(totalDiscounts)}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {totalRevenueAll + totalDiscounts > 0
                        ? `${(((totalDiscounts || 0) / ((totalRevenueAll || 0) + (totalDiscounts || 0))) * 100).toFixed(1)}% من المبيعات`
                        : "—"}
                    </div>
                  </div>

                  {/* Orders with coupons */}
                  <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
                      <Ticket className="w-3 h-3" />
                      طلبات بكوبون
                    </div>
                    <div className="font-black text-base tabular-nums">{couponOrders.length}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {allOrders.length > 0
                        ? `${(((couponOrders.length || 0) / allOrders.length) * 100).toFixed(0)}% من الكل`
                        : "—"}
                    </div>
                  </div>

                  {/* Unique coupons */}
                  <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
                      <Tag className="w-3 h-3" />
                      كوبونات مستخدمة
                    </div>
                    <div className="font-black text-base tabular-nums">
                      {Object.keys(couponMap).length}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">كود فريد</div>
                  </div>
                </div>

                {/* Top coupons table */}
                {topCoupons.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Tag className="w-3 h-3" />
                      أكثر الكوبونات استخداماً
                    </p>
                    <div className="space-y-1.5">
                      {topCoupons.map((c, i) => {
                        const maxUses = topCoupons[0].uses;
                        const barWidth = maxUses > 0 ? (c.uses / maxUses) * 100 : 0;
                        return (
                          <div key={c.code} className="flex items-center gap-3 group">
                            <span className="text-[10px] font-black text-muted-foreground w-4 shrink-0 text-center">
                              {i + 1}
                            </span>
                            <span className="font-mono font-black text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md shrink-0 min-w-[80px] text-center">
                              {c.code}
                            </span>
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500/60 rounded-full transition-all duration-500"
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold tabular-nums shrink-0">
                                {c.uses}×
                              </span>
                            </div>
                            <span className="text-xs font-bold text-emerald-400 tabular-nums shrink-0 hidden sm:block">
                              -{formatCurrency(c.totalDiscount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {topCoupons.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    لم يُستخدم أي كوبون بعد
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/8 border border-primary/20 rounded-2xl animate-in fade-in slide-in-from-top-1 duration-150 flex-wrap">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-bold text-primary">{selectedIds.size} طلب محدد</span>
            <div className="flex gap-2 mr-auto flex-wrap items-center">
              {/* Bulk status dropdown */}
              <div className="relative">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setBulkStatusOpen((v) => !v)}
                  disabled={bulkUpdating}
                >
                  {bulkUpdating ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" /> جارٍ التحديث...
                    </>
                  ) : (
                    <>
                      <ChevronRight className="w-3 h-3 rotate-90" /> تغيير الحالة
                    </>
                  )}
                </Button>
                {bulkStatusOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setBulkStatusOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-30 bg-card border border-border/60 rounded-2xl shadow-xl overflow-hidden min-w-[160px] animate-in fade-in zoom-in-95 duration-100">
                      {BULK_STATUSES.map((s) => (
                        <button
                          key={s.value}
                          onClick={() => applyBulkStatus(s.value)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium hover:bg-muted/40 transition-colors text-right ${s.color}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.color.replace("text-", "bg-")}`}
                          />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={exportSelected}
              >
                <Download className="w-3 h-3" /> تصدير
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="w-3 h-3 ml-1" /> إلغاء
              </Button>
            </div>
          </div>
        )}

        {/* Filters row */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Status filter tabs with counts */}
          <div className="flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1 overflow-x-auto scrollbar-none">
            {STATUS_FILTERS.map((s) => {
              const count = s.value ? (statusCounts[s.value] ?? 0) : allOrders.length;
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
                      className={`text-[10px] font-black px-1 rounded ${active ? "text-muted-foreground" : "text-muted-foreground"}`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Date range quick-filter */}
          <div className="flex items-center gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1">
            <Calendar className="w-3 h-3 text-muted-foreground mx-1" />
            {DATE_RANGES.map((dr) => (
              <button
                key={dr.days}
                onClick={() => setDateRange(dr.days)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap ${
                  dateRange === dr.days
                    ? "bg-card shadow-sm text-foreground font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {dr.label}
              </button>
            ))}
          </div>

          {(search || statusFilter || dateRange > 0) && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setDateRange(0);
              }}
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              مسح الكل
            </button>
          )}

          <span className="text-xs text-muted-foreground mr-auto">{filtered.length} نتيجة</span>
        </div>

        {/* Table */}
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border/60 rounded-2xl">
            <div className="w-12 h-12 rounded-2xl bg-muted mx-auto mb-3 flex items-center justify-center">
              <ShoppingBag className="w-5 h-5 opacity-30" />
            </div>
            <p className="font-bold text-sm mb-1">لا توجد طلبات</p>
            {(search || statusFilter || dateRange > 0) && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("");
                  setDateRange(0);
                }}
                className="text-xs text-primary hover:underline mt-1"
              >
                مسح الفلاتر
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/25">
                      <th className="px-4 py-3 w-8">
                        <button
                          onClick={toggleSelectAll}
                          className="text-muted-foreground hover:text-primary transition-colors"
                        >
                          {allFilteredSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        رقم الطلب
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        المستخدم
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        المنتج
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        المبلغ
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        الحالة
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        التاريخ
                      </th>
                      <th className="w-8 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((order, idx: number) => {
                      const isSelected = selectedIds.has(order.id);
                      return (
                        <React.Fragment key={order.id}>
                          <tr
                            className={`border-b border-border/30 transition-colors hover:bg-muted/20 cursor-pointer group ${
                              isSelected ? "bg-primary/3" : idx % 2 !== 0 ? "bg-muted/[0.035]" : ""
                            }`}
                          >
                            <td className="px-4 py-2.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelect(order.id);
                                }}
                                className="text-muted-foreground hover:text-primary transition-colors"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-primary" />
                                ) : (
                                  <Square className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </td>
                            <td
                              className="px-4 py-2.5 font-mono text-xs text-muted-foreground"
                              onClick={() =>
                                setExpandedRow(expandedRow === order.id ? null : order.id)
                              }
                            >
                              {order.order_code}
                            </td>
                            <td
                              className="px-4 py-2.5 font-mono text-xs font-bold"
                              onClick={() =>
                                setExpandedRow(expandedRow === order.id ? null : order.id)
                              }
                            >
                              {order.user_phone}
                            </td>
                            <td
                              className="px-4 py-2.5 font-medium text-sm max-w-40 truncate"
                              onClick={() =>
                                setExpandedRow(expandedRow === order.id ? null : order.id)
                              }
                            >
                              {order.product_name}
                            </td>
                            <td
                              className="px-4 py-2.5 font-black text-primary text-sm tabular-nums"
                              onClick={() =>
                                setExpandedRow(expandedRow === order.id ? null : order.id)
                              }
                            >
                              {formatCurrency(order.amount)}
                            </td>
                            <td
                              className="px-4 py-2.5"
                              onClick={() =>
                                setExpandedRow(expandedRow === order.id ? null : order.id)
                              }
                            >
                              <span
                                className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${statusColor(order.status)}`}
                              >
                                {statusLabel(order.status)}
                              </span>
                            </td>
                            <td
                              className="px-4 py-2.5 text-muted-foreground text-xs tabular-nums"
                              onClick={() =>
                                setExpandedRow(expandedRow === order.id ? null : order.id)
                              }
                            >
                              {order.created_at ? formatDate(order.created_at) : "—"}
                            </td>
                            <td
                              className="px-4 py-2.5 text-muted-foreground group-hover:text-muted-foreground transition-colors"
                              onClick={() =>
                                setExpandedRow(expandedRow === order.id ? null : order.id)
                              }
                            >
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform duration-150 ${expandedRow === order.id ? "rotate-180" : ""}`}
                              />
                            </td>
                          </tr>
                          {expandedRow === order.id && (
                            <tr key={`exp-${order.id}`} className="bg-muted/10">
                              <td colSpan={8} className="px-4 py-3 border-b border-border/30">
                                <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
                                  {order.delivered_email && (
                                    <div>
                                      <span className="text-muted-foreground">البريد: </span>
                                      <span className="font-mono font-bold">
                                        {order.delivered_email}
                                      </span>
                                    </div>
                                  )}
                                  {order.delivered_password && (
                                    <div>
                                      <span className="text-muted-foreground">كلمة المرور: </span>
                                      <span className="font-mono font-bold">
                                        {order.delivered_password}
                                      </span>
                                    </div>
                                  )}
                                  {order.delivered_extra_details && (
                                    <div>
                                      <span className="text-muted-foreground">تفاصيل: </span>
                                      <span>{order.delivered_extra_details}</span>
                                    </div>
                                  )}
                                  {order.coupon_code && (
                                    <div>
                                      <span className="text-muted-foreground">الكوبون: </span>
                                      <span className="font-mono font-bold text-emerald-400">
                                        {order.coupon_code}
                                      </span>
                                      {(order.discount_amount ?? 0) > 0 && (
                                        <span className="text-muted-foreground mr-1">
                                          (خصم {formatCurrency(order.discount_amount ?? 0)})
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {!order.delivered_email &&
                                    !order.delivered_password &&
                                    !order.delivered_extra_details &&
                                    !order.coupon_code && (
                                      <span className="text-muted-foreground">
                                        لا توجد بيانات تسليم
                                      </span>
                                    )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {filtered.length} طلب
                  {search && ` · نتائج "${search}"`}
                  {filtered.length > 0 && ` · إجمالي ${formatCurrency(totalRevenue)}`}
                </span>
                <span className="hidden sm:inline text-muted-foreground">
                  انقر على الصف لعرض بيانات التسليم
                </span>
              </div>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {filtered.map((order) => {
                const isSelected = selectedIds.has(order.id);
                return (
                  <div
                    key={order.id}
                    className={`bg-card border rounded-2xl p-4 cursor-pointer transition-colors ${isSelected ? "border-primary/40 bg-primary/3" : "border-border/60 hover:border-border"}`}
                    onClick={() => setExpandedRow(expandedRow === order.id ? null : order.id)}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(order.id);
                        }}
                        className="mt-0.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm">{order.product_name}</div>
                        <div className="font-mono text-xs text-muted-foreground mt-0.5">
                          {order.user_phone}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-black text-primary tabular-nums">
                          {formatCurrency(order.amount)}
                        </div>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full border mt-1 inline-block ${statusColor(order.status)}`}
                        >
                          {statusLabel(order.status)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground border-t border-border/30 pt-2">
                      <span className="font-mono">{order.order_code}</span>
                      {order.created_at && (
                        <>
                          <span>·</span>
                          <span>{formatDate(order.created_at)}</span>
                        </>
                      )}
                    </div>
                    {expandedRow === order.id &&
                      (order.delivered_email || order.delivered_password) && (
                        <div className="mt-2 pt-2 border-t border-border/30 space-y-1 text-xs">
                          {order.delivered_email && (
                            <div>
                              <span className="text-muted-foreground">البريد: </span>
                              <span className="font-mono font-bold">{order.delivered_email}</span>
                            </div>
                          )}
                          {order.delivered_password && (
                            <div>
                              <span className="text-muted-foreground">كلمة المرور: </span>
                              <span className="font-mono font-bold">
                                {order.delivered_password}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
