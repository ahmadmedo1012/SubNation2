import { useParams, useLocation } from "wouter";
import { useGetProduct, useCreateOrder, useGetMe, getGetProductQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, categoryLabel, statusLabel, statusColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, ShoppingCart, ArrowRight, Package, Info } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [orderResult, setOrderResult] = useState<any>(null);
  const [error, setError] = useState("");

  const numericId = parseInt(id ?? "0");

  const { data: product, isLoading } = useGetProduct(numericId, {
    query: { queryKey: getGetProductQueryKey(numericId), enabled: !!numericId },
  });

  const { data: user } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const createOrderMutation = useCreateOrder({
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
    mutation: {
      onSuccess(data) {
        setOrderResult(data);
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
      onError(err: any) {
        setError(err?.response?.data?.error ?? "فشل في إتمام الطلب. حاول مرة أخرى.");
      },
    },
  });

  if (isLoading) return (
    <div className="max-w-2xl mx-auto px-4 py-12 animate-pulse">
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="aspect-video bg-muted" />
        <div className="p-6 space-y-3">
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-4 bg-muted rounded w-full" />
          <div className="h-4 bg-muted rounded w-3/4" />
        </div>
      </div>
    </div>
  );

  if (!product) return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center text-muted-foreground">
      <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="font-medium">المنتج غير موجود</p>
    </div>
  );

  const displayPrice = product.sale_price ?? product.price;
  const canAfford = user && (user.wallet_balance ?? 0) >= displayPrice;

  if (orderResult) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-card border border-emerald-500/30 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-black mb-2">تم الشراء بنجاح</h2>
          <p className="text-muted-foreground text-sm mb-6">رقم الطلب: <span className="font-mono font-bold text-foreground">{orderResult.order_code}</span></p>

          <div className="bg-muted/50 rounded-xl p-4 text-right space-y-3 mb-6">
            <h3 className="font-bold text-sm text-muted-foreground mb-3">بيانات الحساب</h3>
            {orderResult.delivered_email && (
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted-foreground">البريد الإلكتروني</span>
                <span className="font-mono font-bold text-sm">{orderResult.delivered_email}</span>
              </div>
            )}
            {orderResult.delivered_password && (
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted-foreground">كلمة المرور</span>
                <span className="font-mono font-bold text-sm">{orderResult.delivered_password}</span>
              </div>
            )}
            {orderResult.delivered_extra_details && (
              <div className="pt-2 border-t border-border text-sm text-muted-foreground">{orderResult.delivered_extra_details}</div>
            )}
          </div>

          {orderResult.delivered_usage_terms && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-right text-sm text-yellow-400 mb-6 flex gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{orderResult.delivered_usage_terms}</span>
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={() => navigate("/orders")} className="flex-1">عرض جميع الطلبات</Button>
            <Button variant="outline" onClick={() => { setOrderResult(null); setError(""); }} className="flex-1">شراء مجدداً</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-6 transition-colors">
        <ArrowRight className="w-4 h-4" />
        العودة للكتالوج
      </button>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="aspect-video bg-muted flex items-center justify-center">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-contain p-10" />
          ) : (
            <div className="text-6xl font-black text-muted-foreground/20">{product.name[0]}</div>
          )}
        </div>

        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h1 className="text-2xl font-black">{product.name}</h1>
            <Badge variant="secondary">{categoryLabel(product.category)}</Badge>
          </div>

          {product.description && (
            <p className="text-muted-foreground leading-relaxed mb-4">{product.description}</p>
          )}

          <div className="flex items-center gap-4 mb-6 p-4 bg-muted/50 rounded-xl">
            <div>
              <div className="text-3xl font-black text-primary">{formatCurrency(displayPrice)}</div>
              {product.sale_price && (
                <div className="text-muted-foreground text-sm line-through">{formatCurrency(product.price)}</div>
              )}
            </div>
            {product.discount_percent && (
              <div className="bg-primary text-white text-xs font-bold px-2 py-1 rounded-lg">خصم {product.discount_percent}%</div>
            )}
            <div className={`mr-auto text-sm font-medium px-3 py-1.5 rounded-lg ${product.is_available ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {product.is_available ? `متوفر (${product.stock_count} وحدة)` : "نفذ المخزون"}
            </div>
          </div>

          {product.usage_terms && (
            <div className="mb-6 flex gap-2 text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{product.usage_terms}</span>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!token ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm text-center">يجب تسجيل الدخول للشراء</p>
              <Button onClick={() => navigate("/login")} className="w-full bg-primary hover:bg-primary/90 font-bold">
                تسجيل الدخول للشراء
              </Button>
            </div>
          ) : !product.is_available ? (
            <Button disabled className="w-full">المنتج غير متوفر حالياً</Button>
          ) : !canAfford ? (
            <div className="space-y-2">
              <p className="text-sm text-center text-muted-foreground">
                رصيدك: <span className="font-bold text-foreground">{formatCurrency(user?.wallet_balance ?? 0)}</span> — تحتاج <span className="font-bold text-primary">{formatCurrency(displayPrice - (user?.wallet_balance ?? 0))}</span> إضافية
              </p>
              <Button onClick={() => navigate("/wallet")} variant="outline" className="w-full">شحن المحفظة</Button>
            </div>
          ) : (
            <Button
              onClick={() => { setError(""); createOrderMutation.mutate({ data: { product_id: product.id } }); }}
              disabled={createOrderMutation.isPending}
              className="w-full bg-primary hover:bg-primary/90 font-bold text-base h-11"
            >
              <ShoppingCart className="w-4 h-4 ml-2" />
              {createOrderMutation.isPending ? "جارٍ المعالجة..." : `شراء الآن — ${formatCurrency(displayPrice)}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
