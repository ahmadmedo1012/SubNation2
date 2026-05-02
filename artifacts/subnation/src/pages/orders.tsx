import { useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { Package, ChevronLeft, ShoppingBag, Clock, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function StatusIcon({ status }: { status: string }) {
  if (status === "delivered") return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "failed" || status === "refunded") return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  if (status === "processing") return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
  return <Clock className="w-3.5 h-3.5 text-yellow-400" />;
}

function OrderCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
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

  const pending = orders.filter((o: any) => o.status === "pending" || o.status === "processing");
  const delivered = orders.filter((o: any) => o.status === "delivered");

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-7">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black">طلباتي</h1>
            <p className="text-sm text-muted-foreground">سجل مشترياتك ومتابعة حالتها</p>
          </div>
        </div>
        {!isLoading && orders.length > 0 && (
          <div className="text-sm text-muted-foreground bg-card border border-border/60 px-3 py-1.5 rounded-full">
            {orders.length} طلب
          </div>
        )}
      </div>

      {/* Summary chips — only when loaded and has data */}
      {!isLoading && orders.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {pending.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-bold bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-3 py-1.5 rounded-full">
              <Clock className="w-3 h-3" />
              {pending.length} قيد الانتظار
            </div>
          )}
          {delivered.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full">
              <CheckCircle className="w-3 h-3" />
              {delivered.length} مكتمل
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
        <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
            <Package className="w-7 h-7 opacity-35" />
          </div>
          <p className="font-bold text-base mb-1.5">لا توجد طلبات بعد</p>
          <p className="text-sm text-muted-foreground/70 mb-6">ابدأ بتصفح الكتالوج واشترِ أول اشتراك</p>
          <Link href="/">
            <Button className="bg-primary hover:bg-primary/90 shadow-sm shadow-primary/20 active:scale-[0.97] transition-transform">
              تصفح الكتالوج
            </Button>
          </Link>
        </div>

      /* Orders list */
      ) : (
        <div className="space-y-2.5">
          {orders.map((order: any) => (
            <Link key={order.id} href={`/orders/${order.order_code}`}>
              <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/35 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 cursor-pointer group active:scale-[0.99]">
                <div className="flex items-center gap-4">
                  {/* Product image */}
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden border border-border/50">
                    {order.product_image_url ? (
                      <img
                        src={order.product_image_url}
                        alt={order.product_name}
                        className="w-full h-full object-contain p-1.5"
                      />
                    ) : (
                      <Package className="w-5 h-5 text-muted-foreground/40" />
                    )}
                  </div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm leading-snug truncate group-hover:text-foreground transition-colors">
                      {order.product_name}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="font-mono text-[11px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded">
                        {order.order_code}
                      </span>
                      {order.created_at && (
                        <span className="text-[11px] text-muted-foreground/60">{formatDate(order.created_at)}</span>
                      )}
                    </div>
                  </div>

                  {/* Right side */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <div className="font-black text-sm tabular-nums">{formatCurrency(order.amount)}</div>
                      <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border mt-1 justify-end ${statusColor(order.status)}`}>
                        <StatusIcon status={order.status} />
                        <span>{statusLabel(order.status)}</span>
                      </div>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
