import { useParams, useLocation } from "wouter";
import { useGetProduct, useCreateOrder, useGetMe, getGetProductQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, ShoppingCart, ArrowRight, Package, Info, Tag, Lock, Wallet } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORY_GRADIENTS: Record<string, string> = {
  streaming:    "from-violet-900/50 to-violet-800/20",
  music:        "from-emerald-900/50 to-emerald-800/20",
  gaming:       "from-blue-900/50 to-blue-800/20",
  productivity: "from-amber-900/50 to-amber-800/20",
};

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

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="h-5 bg-muted skeleton-shimmer rounded w-32 mb-6" />
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="aspect-video bg-muted skeleton-shimmer" />
        <div className="p-6 space-y-4">
          <div className="h-7 bg-muted skeleton-shimmer rounded w-1/2" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-full" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-3/4" />
          <div className="h-16 bg-muted skeleton-shimmer rounded-xl" />
          <div className="h-11 bg-muted skeleton-shimmer rounded-lg" />
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
  const gradientClass = CATEGORY_GRADIENTS[product.category ?? "streaming"] ?? "from-primary/20 to-primary/5";

  // ── Order success ────────────────────────────────────────────────────────
  if (orderResult) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-card border border-emerald-500/30 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-4 ring-4 ring-emerald-500/10">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-black mb-1">تم الشراء بنجاح</h2>
          <p className="text-muted-foreground text-sm mb-6">
            رقم الطلب: <span className="font-mono font-bold text-foreground">{orderResult.order_code}</span>
          </p>

          <div className="bg-muted/40 border border-border/60 rounded-xl p-4 text-right space-y-3 mb-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">بيانات الحساب</h3>
            {orderResult.delivered_email && (
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted-foreground">البريد الإلكتروني</span>
                <span className="font-mono font-bold text-sm select-all">{orderResult.delivered_email}</span>
              </div>
            )}
            {orderResult.delivered_password && (
              <div className="flex justify-between gap-2">
                <span className="text-sm text-muted-foreground">كلمة المرور</span>
                <span className="font-mono font-bold text-sm select-all">{orderResult.delivered_password}</span>
              </div>
            )}
            {orderResult.delivered_extra_details && (
              <div className="pt-2 border-t border-border text-sm text-muted-foreground">{orderResult.delivered_extra_details}</div>
            )}
          </div>

          {orderResult.delivered_usage_terms && (
            <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3 text-right text-sm text-yellow-400 mb-5 flex gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{orderResult.delivered_usage_terms}</span>
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={() => navigate("/orders")} className="flex-1 active:scale-95 transition-transform">عرض جميع الطلبات</Button>
            <Button variant="outline" onClick={() => { setOrderResult(null); setError(""); }} className="flex-1 active:scale-95 transition-transform">شراء مجدداً</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Product page ─────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors active:scale-95 group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        العودة للكتالوج
      </button>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Image section */}
        <div className={`aspect-video bg-gradient-to-br ${gradientClass} flex items-center justify-center relative`}>
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-contain p-10" />
          ) : (
            <span className="text-7xl font-black text-white/20 select-none">{product.name[0]}</span>
          )}
          {/* Category badge */}
          <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm text-white/90 text-xs font-semibold px-2.5 py-1 rounded-full">
            {categoryLabel(product.category)}
          </div>
          {/* Discount badge */}
          {product.discount_percent && (
            <div className="absolute top-3 left-3 bg-primary text-white text-xs font-black px-2.5 py-1 rounded-full flex items-center gap-1 shadow-lg shadow-primary/40">
              <Tag className="w-3 h-3" />
              خصم {product.discount_percent}%
            </div>
          )}
          {/* Bottom gradient fade into card */}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
        </div>

        <div className="p-6 space-y-5">
          {/* Title + description */}
          <div>
            <h1 className="text-2xl font-black mb-2 leading-snug">{product.name}</h1>
            {product.description && (
              <p className="text-muted-foreground leading-relaxed text-sm">{product.description}</p>
            )}
          </div>

          {/* Price + stock block */}
          <div className="flex items-center gap-4 p-4 bg-muted/40 border border-border/60 rounded-xl">
            <div className="flex-1">
              <div className="text-3xl font-black text-primary leading-none">{formatCurrency(displayPrice)}</div>
              {product.sale_price && (
                <div className="text-muted-foreground/60 text-sm line-through mt-1">{formatCurrency(product.price)}</div>
              )}
            </div>
            <div className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg ${
              product.is_available
                ? "bg-emerald-500/12 border border-emerald-500/25 text-emerald-400"
                : "bg-muted border border-border text-muted-foreground"
            }`}>
              {product.is_available ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  متوفر ({product.stock_count} وحدة)
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  نفذ المخزون
                </>
              )}
            </div>
          </div>

          {/* Usage terms */}
          {product.usage_terms && (
            <div className="flex gap-2 text-sm text-yellow-400 bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{product.usage_terms}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* CTA block */}
          {!token ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm text-center">يجب تسجيل الدخول للشراء</p>
              <Button
                onClick={() => navigate("/login")}
                className="w-full bg-primary hover:bg-primary/90 font-bold text-base h-12 shadow-lg shadow-primary/20 active:scale-[0.98] transition-transform"
              >
                تسجيل الدخول للشراء
              </Button>
            </div>
          ) : !product.is_available ? (
            <Button disabled className="w-full h-12 text-base">المنتج غير متوفر حالياً</Button>
          ) : !canAfford ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm px-4 py-3 bg-muted/40 border border-border/60 rounded-xl">
                <span className="text-muted-foreground">رصيدك الحالي</span>
                <span className="font-bold text-foreground">{formatCurrency(user?.wallet_balance ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between text-sm px-4 py-3 bg-primary/8 border border-primary/20 rounded-xl">
                <span className="text-muted-foreground">تحتاج إضافة</span>
                <span className="font-black text-primary">{formatCurrency(displayPrice - (user?.wallet_balance ?? 0))}</span>
              </div>
              <Button
                onClick={() => navigate("/wallet")}
                variant="outline"
                className="w-full h-12 text-base active:scale-[0.98] transition-transform"
              >
                <Wallet className="w-4 h-4 ml-2" />
                شحن المحفظة
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => { setError(""); createOrderMutation.mutate({ data: { product_id: product.id } }); }}
              disabled={createOrderMutation.isPending}
              className="w-full bg-primary hover:bg-primary/90 font-bold text-base h-12 shadow-lg shadow-primary/20 active:scale-[0.98] transition-transform"
            >
              <ShoppingCart className="w-5 h-5 ml-2" />
              {createOrderMutation.isPending ? "جارٍ المعالجة..." : `شراء الآن — ${formatCurrency(displayPrice)}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
