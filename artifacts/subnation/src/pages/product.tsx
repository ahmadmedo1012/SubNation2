import { useParams, useLocation } from "wouter";
import { useGetProduct, useCreateOrder, useGetMe, getGetProductQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertCircle, CheckCircle, ShoppingCart, ArrowRight, Package,
  Info, Tag, Lock, Wallet, Truck, ShieldCheck, Headphones, Copy
} from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_GRADIENTS: Record<string, string> = {
  streaming:    "from-violet-950 via-violet-900/60 to-violet-800/20",
  music:        "from-emerald-950 via-emerald-900/60 to-emerald-800/20",
  gaming:       "from-blue-950 via-blue-900/60 to-blue-800/20",
  productivity: "from-amber-950 via-amber-900/60 to-amber-800/20",
};

const TRUST_SIGNALS = [
  { icon: Truck,       label: "تسليم فوري", desc: "حصل عليه فور الدفع" },
  { icon: ShieldCheck, label: "دفع آمن",    desc: "من محفظتك المشحونة" },
  { icon: Headphones,  label: "دعم متاح",   desc: "تواصل معنا أي وقت" },
];

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `تم نسخ ${label}` });
    });
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
      <div className="h-4 bg-muted skeleton-shimmer rounded w-28 mb-6" />
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="aspect-[16/9] bg-muted skeleton-shimmer" />
        <div className="p-6 space-y-4">
          <div className="h-7 bg-muted skeleton-shimmer rounded-lg w-3/5" />
          <div className="space-y-2">
            <div className="h-3.5 bg-muted skeleton-shimmer rounded w-full" />
            <div className="h-3.5 bg-muted skeleton-shimmer rounded w-4/5" />
          </div>
          <div className="h-20 bg-muted skeleton-shimmer rounded-xl" />
          <div className="h-12 bg-muted skeleton-shimmer rounded-xl" />
        </div>
      </div>
    </div>
  );

  if (!product) return (
    <div className="max-w-xl mx-auto px-4 py-20 text-center text-muted-foreground">
      <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
        <Package className="w-7 h-7 opacity-40" />
      </div>
      <p className="font-bold mb-1">المنتج غير موجود</p>
      <button onClick={() => navigate("/")} className="text-sm text-primary hover:underline mt-2">العودة للكتالوج</button>
    </div>
  );

  const displayPrice = product.sale_price ?? product.price;
  const canAfford = user && (user.wallet_balance ?? 0) >= displayPrice;
  const gradientClass = CATEGORY_GRADIENTS[product.category ?? "streaming"] ?? "from-primary/20 via-primary/8 to-transparent";
  const shortfall = displayPrice - (user?.wallet_balance ?? 0);

  // ── Order success ─────────────────────────────────────────────────────────
  if (orderResult) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
        <div className="bg-card border border-emerald-500/20 rounded-2xl overflow-hidden">
          {/* Success header */}
          <div className="p-6 text-center border-b border-border/50 bg-emerald-500/5">
            <div className="w-16 h-16 bg-emerald-500/15 rounded-2xl flex items-center justify-center mx-auto mb-3 ring-4 ring-emerald-500/10">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-black mb-0.5">تم الشراء بنجاح!</h2>
            <p className="text-muted-foreground text-sm">
              رقم الطلب:{" "}
              <button
                onClick={() => copyToClipboard(orderResult.order_code, "رقم الطلب")}
                className="font-mono font-bold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
              >
                {orderResult.order_code}
                <Copy className="w-3 h-3" />
              </button>
            </p>
          </div>

          <div className="p-6 space-y-4">
            {/* Delivered credentials */}
            {(orderResult.delivered_email || orderResult.delivered_password) && (
              <div className="bg-muted/30 border border-border/60 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/40 bg-muted/20">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">بيانات الحساب</h3>
                </div>
                <div className="divide-y divide-border/30">
                  {orderResult.delivered_email && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-muted-foreground">البريد الإلكتروني</span>
                      <button
                        onClick={() => copyToClipboard(orderResult.delivered_email, "البريد")}
                        className="flex items-center gap-1.5 font-mono font-bold text-sm text-foreground hover:text-primary transition-colors active:scale-95"
                      >
                        {orderResult.delivered_email}
                        <Copy className="w-3.5 h-3.5 shrink-0" />
                      </button>
                    </div>
                  )}
                  {orderResult.delivered_password && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-muted-foreground">كلمة المرور</span>
                      <button
                        onClick={() => copyToClipboard(orderResult.delivered_password, "كلمة المرور")}
                        className="flex items-center gap-1.5 font-mono font-bold text-sm text-foreground hover:text-primary transition-colors active:scale-95"
                      >
                        {orderResult.delivered_password}
                        <Copy className="w-3.5 h-3.5 shrink-0" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {orderResult.delivered_extra_details && (
              <div className="bg-muted/20 border border-border/40 rounded-xl px-4 py-3 text-sm text-muted-foreground leading-relaxed">
                {orderResult.delivered_extra_details}
              </div>
            )}

            {orderResult.delivered_usage_terms && (
              <div className="flex gap-2.5 text-sm bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3.5">
                <Info className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <span className="text-yellow-400">{orderResult.delivered_usage_terms}</span>
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              <Button onClick={() => navigate("/orders")} className="flex-1 active:scale-[0.97] transition-transform">عرض طلباتي</Button>
              <Button variant="outline" onClick={() => { setOrderResult(null); setError(""); }} className="flex-1 active:scale-[0.97] transition-transform">شراء مجدداً</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Product page ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:py-8 pb-28 sm:pb-8">
      {/* Back link */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors active:scale-95 group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        العودة للكتالوج
      </button>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Image */}
        <div className={`aspect-[16/9] bg-gradient-to-b ${gradientClass} flex items-center justify-center relative`}>
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-contain p-10" />
          ) : (
            <span className="text-8xl font-black text-white/15 select-none">{product.name[0]}</span>
          )}
          <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm text-white/85 text-[11px] font-bold px-2.5 py-1 rounded-full">
            {categoryLabel(product.category)}
          </div>
          {product.discount_percent && (
            <div className="absolute top-3 left-3 flex items-center gap-1 bg-primary text-white text-xs font-black px-2.5 py-1 rounded-full shadow-lg shadow-primary/30">
              <Tag className="w-3 h-3" />
              خصم {product.discount_percent}%
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card to-transparent" />
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <h1 className="text-2xl font-black mb-1.5 leading-tight">{product.name}</h1>
            {product.description && (
              <p className="text-muted-foreground leading-relaxed text-sm">{product.description}</p>
            )}
          </div>

          {/* Price + stock */}
          <div className="flex items-center gap-4 p-4 bg-muted/30 border border-border/50 rounded-xl">
            <div className="flex-1">
              <div className="text-3xl font-black text-primary leading-none tabular-nums">{formatCurrency(displayPrice)}</div>
              {product.sale_price && (
                <div className="text-muted-foreground/50 text-sm line-through mt-1 tabular-nums">{formatCurrency(product.price)}</div>
              )}
            </div>
            <div className={`flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-xl ${
              product.is_available
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : "bg-muted border border-border text-muted-foreground"
            }`}>
              {product.is_available ? (
                <><CheckCircle className="w-3.5 h-3.5" /> متوفر ({product.stock_count})</>
              ) : (
                <><Lock className="w-3.5 h-3.5" /> نفذ المخزون</>
              )}
            </div>
          </div>

          {/* Usage terms */}
          {product.usage_terms && (
            <div className="flex gap-2.5 text-sm text-yellow-400 bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{product.usage_terms}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-4 py-3 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Trust signals */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {TRUST_SIGNALS.map(item => (
              <div key={item.label} className="flex flex-col items-center gap-1 p-2.5 bg-muted/20 border border-border/40 rounded-xl text-center">
                <item.icon className="w-4 h-4 text-muted-foreground mb-0.5" />
                <span className="text-[11px] font-bold text-foreground leading-tight">{item.label}</span>
                <span className="text-[10px] text-muted-foreground/70 leading-tight">{item.desc}</span>
              </div>
            ))}
          </div>

          {/* CTA — desktop only (mobile uses sticky bar) */}
          <div className="hidden sm:block">
            <CtaBlock
              token={token}
              product={product}
              user={user}
              displayPrice={displayPrice}
              canAfford={!!canAfford}
              shortfall={shortfall}
              isPending={createOrderMutation.isPending}
              onBuy={() => { setError(""); createOrderMutation.mutate({ data: { product_id: product.id } }); }}
              onLogin={() => navigate("/login")}
              onWallet={() => navigate("/wallet")}
            />
          </div>
        </div>
      </div>

      {/* ── Sticky mobile buy bar ─────────────────────────── */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <CtaBlock
          token={token}
          product={product}
          user={user}
          displayPrice={displayPrice}
          canAfford={!!canAfford}
          shortfall={shortfall}
          isPending={createOrderMutation.isPending}
          onBuy={() => { setError(""); createOrderMutation.mutate({ data: { product_id: product.id } }); }}
          onLogin={() => navigate("/login")}
          onWallet={() => navigate("/wallet")}
          compact
        />
      </div>
    </div>
  );
}

function CtaBlock({
  token, product, user, displayPrice, canAfford, shortfall,
  isPending, onBuy, onLogin, onWallet, compact,
}: {
  token: string | null; product: any; user: any; displayPrice: number; canAfford: boolean;
  shortfall: number; isPending: boolean; onBuy: () => void; onLogin: () => void; onWallet: () => void; compact?: boolean;
}) {
  if (!token) {
    return (
      <div className={`${compact ? "flex items-center gap-3" : "space-y-2"}`}>
        {compact && (
          <div className="flex-1 text-right">
            <div className="font-black text-primary text-xl tabular-nums">{formatCurrency(displayPrice)}</div>
            <div className="text-xs text-muted-foreground">سجل الدخول للشراء</div>
          </div>
        )}
        <Button
          onClick={onLogin}
          className={`${compact ? "shrink-0 h-11 px-5" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/20 active:scale-[0.97] transition-all`}
        >
          {compact ? "دخول" : "تسجيل الدخول للشراء"}
        </Button>
      </div>
    );
  }

  if (!product.is_available) {
    return (
      <div className={compact ? "flex items-center gap-3" : ""}>
        {compact && <div className="flex-1 font-black text-xl text-muted-foreground/60 tabular-nums">{formatCurrency(displayPrice)}</div>}
        <Button disabled className={`${compact ? "shrink-0 h-11 px-5" : "w-full h-12 text-base"}`}>
          <Lock className="w-4 h-4 ml-2" /> نفذ المخزون
        </Button>
      </div>
    );
  }

  if (!canAfford) {
    return (
      <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
        {compact ? (
          <>
            <div className="flex-1 text-right">
              <div className="font-black text-primary text-xl tabular-nums">{formatCurrency(displayPrice)}</div>
              <div className="text-xs text-destructive/80">
                تحتاج {formatCurrency(shortfall)} إضافية
              </div>
            </div>
            <Button onClick={onWallet} variant="outline" className="shrink-0 h-11 px-4 active:scale-[0.97] transition-transform">
              <Wallet className="w-4 h-4 ml-1.5" /> شحن
            </Button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-muted/30 border border-border/50 rounded-xl col-span-2">
                <span className="text-muted-foreground">رصيدك الحالي</span>
                <span className="font-bold tabular-nums">{formatCurrency(user?.wallet_balance ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-primary/8 border border-primary/20 rounded-xl col-span-2">
                <span className="text-muted-foreground">تحتاج إضافة</span>
                <span className="font-black text-primary tabular-nums">{formatCurrency(shortfall)}</span>
              </div>
            </div>
            <Button onClick={onWallet} variant="outline" className="w-full h-12 text-base active:scale-[0.97] transition-transform">
              <Wallet className="w-5 h-5 ml-2" /> شحن المحفظة
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={compact ? "flex items-center gap-3" : ""}>
      {compact && (
        <div className="flex-1 text-right">
          <div className="font-black text-primary text-xl tabular-nums">{formatCurrency(displayPrice)}</div>
          <div className="text-xs text-emerald-400">رصيد كافٍ</div>
        </div>
      )}
      <Button
        onClick={onBuy}
        disabled={isPending}
        className={`${compact ? "shrink-0 h-11 px-5" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/20 active:scale-[0.97] transition-all`}
      >
        <ShoppingCart className={`${compact ? "w-4 h-4" : "w-5 h-5"} ml-2`} />
        {isPending ? "جارٍ المعالجة..." : compact ? "اشترِ" : `اشترِ الآن — ${formatCurrency(displayPrice)}`}
      </Button>
    </div>
  );
}
