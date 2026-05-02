import { useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { Package, CheckCircle, Clock, ChevronLeft } from "lucide-react";

export default function OrdersPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();

  const { data: orders = [], isLoading } = useListOrders({
    query: { enabled: !!token, queryKey: getListOrdersQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  if (!token) {
    navigate("/login");
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black mb-6">طلباتي</h1>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">لا توجد طلبات بعد</p>
          <p className="text-sm mt-1">ابدأ بتصفح الكتالوج واشترِ أول اشتراك</p>
          <Link href="/" className="inline-block mt-4 px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors">
            تصفح الكتالوج
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order: any) => (
            <Link key={order.id} href={`/orders/${order.order_code}`}>
              <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {order.product_image_url ? (
                      <img src={order.product_image_url} alt={order.product_name} className="w-full h-full object-contain p-1" />
                    ) : (
                      <Package className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm">{order.product_name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono">{order.order_code}</span>
                      {order.created_at && <span className="mr-2">{formatDate(order.created_at)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="font-black text-sm">{formatCurrency(order.amount)}</div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
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
