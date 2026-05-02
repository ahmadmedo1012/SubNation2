import { useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor } from "@/lib/utils";
import { Package, ChevronLeft, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OrdersPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();

  const { data: orders = [], isLoading } = useListOrders({
    query: { enabled: !!token, queryKey: getListOrdersQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  if (!token) { navigate("/login"); return null; }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-7">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <ShoppingBag className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-black">طلباتي</h1>
          <p className="text-sm text-muted-foreground">سجل مشترياتك ومتابعة حالتها</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-2xl">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-25" />
          <p className="font-bold mb-1">لا توجد طلبات بعد</p>
          <p className="text-sm">ابدأ بتصفح الكتالوج واشترِ أول اشتراك</p>
          <Link href="/" className="inline-block mt-5">
            <Button className="bg-primary hover:bg-primary/90 shadow-sm shadow-primary/20">تصفح الكتالوج</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {orders.map((order: any) => (
            <Link key={order.id} href={`/orders/${order.order_code}`}>
              <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {order.product_image_url ? (
                      <img src={order.product_image_url} alt={order.product_name} className="w-full h-full object-contain p-1.5" />
                    ) : (
                      <Package className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm leading-snug">{order.product_name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">{order.order_code}</span>
                      {order.created_at && <span>{formatDate(order.created_at)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="font-black text-sm">{formatCurrency(order.amount)}</div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border inline-block mt-0.5 ${statusColor(order.status)}`}>
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
