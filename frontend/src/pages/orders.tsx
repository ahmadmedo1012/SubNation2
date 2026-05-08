import { useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { formatCurrency, formatDateShort, statusLabel, statusColor } from "@/lib/utils";
import { Package, ChevronLeft, ShoppingBag, Clock, CheckCircle, XCircle, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";

const STAGGER = ["", "stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6", "stagger-7", "stagger-8", "stagger-9", "stagger-10", "stagger-11", "stagger-12"];

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "failed" || status === "refunded") return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  return <Clock className="w-3.5 h-3.5 text-yellow-400" />;
}

function statusLeftBorder(status: string): string {
  if (status === "completed") return "border-l-emerald-500/55";
  if (status === "failed" || status === "refunded") return "border-l-red-500/55";
  return "border-l-yellow-500/45";
}

function OrderCardSkeleton() {
  return (
    <div className="bg-card border border-border border-l-2 border-l-border/30 rounded-xl p-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-muted skeleton-shimmer shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-2/5" />
          <div className="flex gap-2">
            <div className="h-3 bg-muted skeleton-shimmer rounded w-24" />
            <div className="h-3 bg-muted skeleton-shimmer rounded w-20" />
          </div>
        </div>
        <div className="shrink-0 space-y-1.5 text-right">
          <div className="h-4 bg-muted skeleton-shimmer rounded w-16" />
          <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14" />
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();

  const { data: orders = [], isLoading } = useListOrders({
    query: { enabled: !!token, queryKey: getListOrdersQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  if (!token) { navigate("/login"); return null; }

  const pending = orders.filter((o: any) => o.status === "pending");
  const completed = orders.filter((o: any) => o.status === "completed");

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-7 page-in">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
            <ShoppingBag className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black leading-tight">طلباتي</h1>
            <p className="text-sm text-muted-foreground/80">سجل مشترياتك ومتابعة حالتها</p>
          </div>
        </div>
        {!isLoading && orders.length > 0 && (
          <div className="text-sm font-bold text-muted-foreground bg-card border border-border/60 px-3 py-1.5 rounded-full shadow-sm">
            {orders.length} طلب
          </div>
        )}
      </div>

      {/* Summary chips */}
      {!isLoading && orders.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap slide-up">
          {pending.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-bold bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-3 py-1.5 rounded-full">
              <Clock className="w-3 h-3" />
              {pending.length} قيد الانتظار
            </div>
          )}
          {completed.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full">
              <CheckCircle className="w-3 h-3" />
              {completed.length} مكتمل
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => <OrderCardSkeleton key={i} />)}
        </div>

      /* Empty state */
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
          <div className="relative w-20 h-20 mx-auto mb-5">
            <div className="absolute inset-0 rounded-2xl bg-primary/6 blur-xl" />
            <div className="relative w-20 h-20 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center">
              <Package className="w-9 h-9 opacity-25" />
            </div>
          </div>
          <p className="font-black text-lg mb-1.5 text-foreground/80">لا توجد طلبات بعد</p>
          <p className="text-sm text-muted-foreground/65 mb-7 max-w-xs mx-auto leading-relaxed">
            ابدأ بتصفح الكتالوج واشترِ أول اشتراك رقمي
          </p>
          <Link href="/">
            <Button className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold">
              <Sparkles className="w-4 h-4" />
              تصفح الكتالوج
            </Button>
          </Link>
        </div>

      /* Orders list */
      ) : (
        <div className="space-y-2.5">
          {orders.map((order: any, i: number) => {
            const staggerClass = STAGGER[Math.min(i, 12)] ?? "";
            return (
              <Link key={order.id} href={`/orders/${order.order_code}`}>
                <div className={`
                  float-in ${staggerClass}
                  bg-card border border-border/60 border-l-[3px] ${statusLeftBorder(order.status)}
                  rounded-xl p-4
                  hover:border-border hover:border-l-[3px] hover:shadow-xl hover:shadow-black/20 hover:-translate-y-0.5
                  transition-all duration-200 cursor-pointer group active:scale-[0.995] active:translate-y-0
                `}>
                  <div className="flex items-center gap-3.5">
                    {/* Product image */}
                    <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border/40 group-hover:border-border/70 transition-colors">
                      {order.product_image_url ? (
                        <img
                          src={order.product_image_url}
                          alt={order.product_name}
                          className="w-full h-full object-contain p-1.5 group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <span className="text-xl font-black text-primary/50 select-none">
                          {(order.product_name ?? "؟")[0]}
                        </span>
                      )}
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm leading-snug truncate group-hover:text-primary transition-colors duration-150">
                        {order.product_name}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="font-mono text-[11px] bg-muted/50 text-muted-foreground/70 px-1.5 py-0.5 rounded border border-border/30">
                          {order.order_code}
                        </span>
                        {order.created_at && (
                          <span className="text-[11px] text-muted-foreground/50">{formatDateShort(order.created_at)}</span>
                        )}
                        {(order as any).coupon_code && (
                          <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                            <Tag className="w-2.5 h-2.5" />
                            {(order as any).coupon_code}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right side */}
                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="text-right">
                        {(order as any).discount_amount > 0 && (
                          <div className="text-[10px] text-muted-foreground/40 line-through tabular-nums">
                            {formatCurrency((order.amount ?? 0) + (order as any).discount_amount)}
                          </div>
                        )}
                        <div className="font-black text-sm tabular-nums">{formatCurrency(order.amount)}</div>
                        <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border mt-1 justify-end ${statusColor(order.status)}`}>
                          <StatusIcon status={order.status} />
                          <span>{statusLabel(order.status)}</span>
                        </div>
                      </div>
                      <ChevronLeft className="w-4 h-4 text-muted-foreground/35 group-hover:text-primary group-hover:translate-x-[-2px] transition-all duration-150 shrink-0" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
