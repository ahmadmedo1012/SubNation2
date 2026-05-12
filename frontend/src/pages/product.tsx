import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { categoryLabel, formatCurrency } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getGetProductQueryKey,
  useCreateOrder,
  useGetMe,
  useGetProduct,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle,
  Copy,
  Headphones,
  Info,
  Loader2,
  Lock,
  Package,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useParams } from "wouter";

const CATEGORY_GRADIENTS: Record<string, string> = {
  streaming: "from-violet-950 via-violet-900/60 to-violet-800/20",
  music: "from-emerald-950 via-emerald-900/60 to-emerald-800/20",
  gaming: "from-blue-950 via-blue-900/60 to-blue-800/20",
  productivity: "from-amber-950 via-amber-900/60 to-amber-800/20",
};

const CATEGORY_INITIAL_COLOR: Record<string, string> = {
  streaming: "text-violet-300",
  music: "text-emerald-300",
  gaming: "text-blue-300",
  productivity: "text-amber-300",
};

const TRUST_SIGNALS = [
  { icon: Truck, label: "تسليم فوري", desc: "حصل عليه فور الدفع" },
  { icon: ShieldCheck, label: "دفع آمن", desc: "من محفظتك المشحونة" },
  { icon: Headphones, label: "دعم متاح", desc: "تواصل معنا أي وقت" },
];

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <button
        onClick={handleCopy}
        className={`flex items-center gap-2 font-mono font-bold text-sm transition-all duration-200 active:scale-95 group ${
          copied ? "text-emerald-400" : "text-foreground hover:text-primary"
        }`}
      >
        <span className="max-w-[160px] truncate">{value}</span>
        <div
          className={`w-5 h-5 rounded-md flex items-center justify-center transition-all duration-200 ${
            copied
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-muted/60 text-muted-foreground group-hover:bg-primary/12 group-hover:text-primary"
          }`}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </div>
      </button>
    </div>
  );
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [orderResult, setOrderResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [couponValidating, setCouponValidating] = useState(false);
  const [couponResult, setCouponResult] = useState<null | {
    code: string;
    discount_amount: number;
    final_amount: number;
    type: string;
    value: number;
    description: string | null;
  }>(null);
  const [couponError, setCouponError] = useState("");

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
        setError(getErrorMessage(err));
      },
    },
  });

  const validateCoupon = async () => {
    if (!couponInput.trim() || !product) return;
    setCouponValidating(true);
    setCouponError("");
    setCouponResult(null);
    try {
      const basePrice = product.sale_price ?? product.price;
      const r = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: couponInput.trim().toUpperCase(), order_amount: basePrice }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setCouponResult(data);
    } catch (err: any) {
      setCouponError(err.message);
    } finally {
      setCouponValidating(false);
    }
  };

  const clearCoupon = () => {
    setCouponInput("");
    setCouponResult(null);
    setCouponError("");
  };

  const copyField = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast({ title: `تم نسخ ${label}` }));
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading)
    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
        <div className="h-4 bg-muted skeleton-shimmer rounded w-28 mb-6" />
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="aspect-[16/9] skeleton-shimmer" />
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

  if (!product)
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center text-muted-foreground">
        <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
          <Package className="w-7 h-7 opacity-40" />
        </div>
        <p className="font-bold mb-1">المنتج غير موجود</p>
        <button
          onClick={() => navigate("/")}
          className="text-sm text-primary hover:underline mt-2 press-spring"
        >
          العودة للكتالوج
        </button>
      </div>
    );

  const displayPrice = product.sale_price ?? product.price;
  const canAfford = user && (user.wallet_balance ?? 0) >= displayPrice;
  const gradientClass =
    CATEGORY_GRADIENTS[product.category ?? "streaming"] ??
    "from-primary/20 via-primary/8 to-transparent";
  const initialColorClass = CATEGORY_INITIAL_COLOR[product.category ?? ""] ?? "text-white/30";
  const shortfall = displayPrice - (user?.wallet_balance ?? 0);

  // ── Order success ─────────────────────────────────────────────────────────
  if (orderResult) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
        <div className="bg-card border border-emerald-500/20 rounded-2xl overflow-hidden float-in">
          {/* Success header */}
          <div className="p-6 text-center border-b border-border/40 bg-gradient-to-b from-emerald-500/8 to-transparent">
            {/* Animated ring */}
            <div className="relative w-20 h-20 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full bg-emerald-500/15 success-ring" />
              <div className="absolute inset-0 rounded-full bg-emerald-500/8" />
              <div className="w-full h-full bg-emerald-500/15 rounded-full flex items-center justify-center ring-4 ring-emerald-500/12">
                <CheckCircle className="w-9 h-9 text-emerald-400" />
              </div>
            </div>
            <h2 className="text-xl font-black mb-1.5">تم الشراء بنجاح!</h2>
            <p className="text-muted-foreground text-sm">
              رقم الطلب:{" "}
              <button
                onClick={() => copyField(orderResult.order_code, "رقم الطلب")}
                className="font-mono font-bold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1 press-spring"
              >
                {orderResult.order_code}
                <Copy className="w-3 h-3 opacity-60" />
              </button>
            </p>
          </div>

          <div className="p-5 space-y-4">
            {/* Credentials box */}
            {(orderResult.delivered_email || orderResult.delivered_password) && (
              <div className="bg-muted/20 border border-border/50 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/30 bg-muted/20 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    بيانات الحساب
                  </h3>
                </div>
                <div className="divide-y divide-border/25">
                  {orderResult.delivered_email && (
                    <CopyField label="البريد الإلكتروني" value={orderResult.delivered_email} />
                  )}
                  {orderResult.delivered_password && (
                    <CopyField label="كلمة المرور" value={orderResult.delivered_password} />
                  )}
                </div>
              </div>
            )}

            {orderResult.delivered_extra_details && (
              <div className="bg-muted/15 border border-border/40 rounded-xl px-4 py-3 text-sm text-muted-foreground leading-relaxed">
                {orderResult.delivered_extra_details}
              </div>
            )}

            {orderResult.delivered_usage_terms && (
              <div className="flex gap-2.5 text-sm bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3.5">
                <Info className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <span className="text-yellow-400 leading-relaxed">
                  {orderResult.delivered_usage_terms}
                </span>
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              <Button
                onClick={() => navigate("/orders")}
                className="flex-1 h-11 press-spring bg-primary hover:bg-primary/90 shadow-md shadow-primary/20"
              >
                <ShoppingCart className="w-4 h-4 ml-1.5" />
                عرض طلباتي
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setOrderResult(null);
                  setError("");
                }}
                className="flex-1 h-11 press-spring"
              >
                شراء مجدداً
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Product page ──────────────────────────────────────────────────────────
  const mobileContentPad = token ? "mobile-product-pad-auth" : "mobile-product-pad-guest";

  return (
    <div className={`max-w-xl mx-auto px-4 py-6 sm:py-8 sm:pb-8 ${mobileContentPad}`}>
      {/* Back link */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors press-spring group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
        العودة للكتالوج
      </button>

      <div className="bg-card border border-border/55 rounded-2xl overflow-hidden float-in shadow-xl shadow-black/15">
        {/* Image */}
        <div
          className={`aspect-[16/9] bg-gradient-to-b ${gradientClass} flex items-center justify-center relative overflow-hidden group/img`}
        >
          {/* Ambient inner glow */}
          <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-black/20 pointer-events-none" />

          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain p-8 sm:p-10 transition-transform duration-500 ease-out group-hover/img:scale-[1.04] drop-shadow-2xl"
            />
          ) : (
            <span
              className={`text-8xl font-black select-none opacity-30 drop-shadow-2xl ${initialColorClass}`}
            >
              {product.name[0]}
            </span>
          )}

          {/* Top badges */}
          <div className="absolute top-3 right-3 bg-black/55 backdrop-blur-sm text-white/85 text-[11px] font-bold px-2.5 py-1 rounded-full border border-white/8">
            {categoryLabel(product.category)}
          </div>
          {product.discount_percent && (
            <div className="absolute top-3 left-3 flex items-center gap-1 bg-primary text-white text-xs font-black px-2.5 py-1 rounded-full shadow-lg shadow-primary/40">
              <Tag className="w-3 h-3" />
              خصم {product.discount_percent}%
            </div>
          )}

          {/* Fade into card body */}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card to-transparent" />
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <h1 className="text-fluid-2xl font-black mb-1.5 leading-tight tracking-tight">
              {product.name}
            </h1>
            {product.description && (
              <p className="text-muted-foreground leading-relaxed text-sm">
                {product.description}
              </p>
            )}
          </div>

          {/* Price + stock */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 bg-muted/20 border border-border/45 rounded-xl">
            <div className="flex-1">
              <div className="text-3xl font-black text-primary leading-none tabular-nums">
                {formatCurrency(displayPrice)}
              </div>
              {product.sale_price && (
                <div className="text-muted-foreground text-sm line-through mt-1.5 tabular-nums">
                  {formatCurrency(product.price)}
                </div>
              )}
            </div>
            <div
              className={`flex items-center gap-1.5 self-start text-sm font-bold px-3 py-2 rounded-xl border ${
                product.is_available
                  ? "bg-emerald-500/10 border-emerald-500/22 text-emerald-400"
                  : "bg-muted/50 border-border/50 text-muted-foreground"
              }`}
            >
              {product.is_available ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" /> متوفر ({product.stock_count})
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" /> نفذ المخزون
                </>
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
            <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-4 py-3 rounded-xl shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Trust signals */}
          <div className="grid grid-cols-3 gap-2">
            {TRUST_SIGNALS.map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center gap-1 p-2.5 bg-muted/15 border border-border/35 rounded-xl text-center transition-colors hover:bg-muted/25 hover:border-border/55"
              >
                <item.icon className="w-4 h-4 text-muted-foreground mb-0.5" />
                <span className="text-[11px] font-bold text-foreground leading-tight">
                  {item.label}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {item.desc}
                </span>
              </div>
            ))}
          </div>

          {/* Mobile coupon entry stays in the scrollable content; the sticky bar remains thumb-sized. */}
          {token && (
            <div className="sm:hidden rounded-xl border border-border/45 bg-muted/10 p-3">
              <CouponField
                token={token}
                couponInput={couponInput}
                couponResult={couponResult}
                couponError={couponError}
                couponValidating={couponValidating}
                onCouponChange={setCouponInput}
                onCouponValidate={validateCoupon}
                onCouponClear={clearCoupon}
              />
            </div>
          )}

          {/* CTA — desktop only (mobile uses sticky bar) */}
          <div className="hidden sm:block">
            <CtaBlock
              token={token}
              product={product}
              user={user}
              displayPrice={couponResult ? couponResult.final_amount : displayPrice}
              canAfford={
                !!(
                  user &&
                  (user.wallet_balance ?? 0) >=
                    (couponResult ? couponResult.final_amount : displayPrice)
                )
              }
              shortfall={
                (couponResult ? couponResult.final_amount : displayPrice) -
                (user?.wallet_balance ?? 0)
              }
              isPending={createOrderMutation.isPending}
              onBuy={() => {
                setError("");
                createOrderMutation.mutate({
                  data: { product_id: product.id, coupon_code: couponResult?.code } as any,
                });
              }}
              onLogin={() => navigate("/login")}
              onWallet={() => navigate("/wallet")}
              couponInput={couponInput}
              couponResult={couponResult}
              couponError={couponError}
              couponValidating={couponValidating}
              onCouponChange={setCouponInput}
              onCouponValidate={validateCoupon}
              onCouponClear={clearCoupon}
            />
          </div>
        </div>
      </div>

      {/* ── Sticky mobile buy bar ─────────────────────────── */}
      <div
        className={`sm:hidden fixed left-0 right-0 z-[45] bg-card/97 backdrop-blur-xl border-t border-border/50 px-4 pt-3 shadow-2xl shadow-black/30 ${
          token ? "mobile-sticky-above-nav pb-3" : "mobile-sticky-bottom-safe"
        }`}
      >
        <CtaBlock
          token={token}
          product={product}
          user={user}
          displayPrice={couponResult ? couponResult.final_amount : displayPrice}
          canAfford={
            !!(
              user &&
              (user.wallet_balance ?? 0) >=
                (couponResult ? couponResult.final_amount : displayPrice)
            )
          }
          shortfall={
            (couponResult ? couponResult.final_amount : displayPrice) - (user?.wallet_balance ?? 0)
          }
          isPending={createOrderMutation.isPending}
          onBuy={() => {
            setError("");
            createOrderMutation.mutate({
              data: { product_id: product.id, coupon_code: couponResult?.code } as any,
            });
          }}
          onLogin={() => navigate("/login")}
          onWallet={() => navigate("/wallet")}
          couponInput={couponInput}
          couponResult={couponResult}
          couponError={couponError}
          couponValidating={couponValidating}
          onCouponChange={setCouponInput}
          onCouponValidate={validateCoupon}
          onCouponClear={clearCoupon}
          compact
        />
      </div>
    </div>
  );
}

interface CouponResult {
  code: string;
  discount_amount: number;
  final_amount: number;
  type: string;
  value: number;
  description: string | null;
}

function CouponField({
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  token,
  onCouponChange,
  onCouponValidate,
  onCouponClear,
}: {
  couponInput: string;
  couponResult: CouponResult | null;
  couponError: string;
  couponValidating: boolean;
  token: string | null;
  onCouponChange: (v: string) => void;
  onCouponValidate: () => void;
  onCouponClear: () => void;
}) {
  if (!token) return null;
  return (
    <div className="space-y-1.5">
      {/* Input row */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Tag className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={couponInput}
            onChange={(e) => {
              onCouponChange(e.target.value.toUpperCase());
              if (couponResult) onCouponClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !couponResult) onCouponValidate();
            }}
            placeholder="رمز الكوبون"
            className="pr-9 h-9 text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans"
            disabled={!!couponResult}
          />
        </div>
        {couponResult ? (
          <button
            onClick={onCouponClear}
            className="h-9 px-3 rounded-lg border border-border/60 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all press-spring"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={onCouponValidate}
            disabled={!couponInput.trim() || couponValidating}
            className="h-9 px-3 rounded-lg bg-muted/50 border border-border/60 text-xs font-bold hover:bg-muted hover:border-border transition-all press-spring disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {couponValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "تحقق"}
          </button>
        )}
      </div>

      {/* Error */}
      {couponError && (
        <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {couponError}
        </div>
      )}

      {/* Success */}
      {couponResult && (
        <div className="flex items-center justify-between gap-2 text-xs bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle className="w-3 h-3 shrink-0" />
            <span className="font-mono font-black">{couponResult.code}</span>
            <span>
              —{" "}
              {couponResult.type === "percentage"
                ? `${couponResult.value}%`
                : `${couponResult.value} د.ل`}{" "}
              خصم
            </span>
          </div>
          <span className="font-black text-emerald-400">
            −{formatCurrency(couponResult.discount_amount)}
          </span>
        </div>
      )}
    </div>
  );
}

function CtaBlock({
  token,
  product,
  user,
  displayPrice,
  canAfford,
  shortfall,
  isPending,
  onBuy,
  onLogin,
  onWallet,
  compact,
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  onCouponChange,
  onCouponValidate,
  onCouponClear,
}: {
  token: string | null;
  product: any;
  user: any;
  displayPrice: number;
  canAfford: boolean;
  shortfall: number;
  isPending: boolean;
  onBuy: () => void;
  onLogin: () => void;
  onWallet: () => void;
  compact?: boolean;
  couponInput?: string;
  couponResult?: CouponResult | null;
  couponError?: string;
  couponValidating?: boolean;
  onCouponChange?: (v: string) => void;
  onCouponValidate?: () => void;
  onCouponClear?: () => void;
}) {
  if (!token) {
    return (
      <div className={`${compact ? "flex items-center gap-3" : "space-y-2"}`}>
        {compact && (
          <div className="flex-1 text-right">
            <div className="font-black text-primary text-xl tabular-nums">
              {formatCurrency(displayPrice)}
            </div>
            <div className="text-xs text-muted-foreground">سجل الدخول للشراء</div>
          </div>
        )}
        <Button
          onClick={onLogin}
          className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-6" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 press-spring`}
        >
          {compact ? "دخول" : "تسجيل الدخول للشراء"}
        </Button>
      </div>
    );
  }

  if (!product.is_available) {
    return (
      <div className={compact ? "flex items-center gap-3" : ""}>
        {compact && (
          <div className="flex-1 font-black text-xl text-muted-foreground tabular-nums">
            {formatCurrency(displayPrice)}
          </div>
        )}
        <Button
          disabled
          className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-6" : "w-full h-12 text-base"}`}
        >
          <Lock className="w-4 h-4 ml-2" /> نفذ المخزون
        </Button>
      </div>
    );
  }

  const couponField =
    !compact && onCouponChange && onCouponValidate && onCouponClear ? (
      <CouponField
        token={token}
        couponInput={couponInput ?? ""}
        couponResult={couponResult ?? null}
        couponError={couponError ?? ""}
        couponValidating={couponValidating ?? false}
        onCouponChange={onCouponChange}
        onCouponValidate={onCouponValidate}
        onCouponClear={onCouponClear}
      />
    ) : null;

  if (!canAfford) {
    return (
      <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
        {compact ? (
          <>
            <div className="flex-1 text-right">
              <div className="font-black text-primary text-xl tabular-nums">
                {formatCurrency(displayPrice)}
              </div>
              <div className="text-xs text-destructive/75">
                تحتاج {formatCurrency(shortfall)} إضافية
              </div>
            </div>
            <Button
              onClick={onWallet}
              variant="outline"
              className="shrink-0 h-12 min-w-[7.5rem] px-5 press-spring"
            >
              <Wallet className="w-4 h-4 ml-1.5" /> شحن
            </Button>
          </>
        ) : (
          <>
            {couponField}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-muted/25 border border-border/50 rounded-xl col-span-2">
                <span className="text-muted-foreground">رصيدك الحالي</span>
                <span className="font-bold tabular-nums">
                  {formatCurrency(user?.wallet_balance ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-primary/8 border border-primary/20 rounded-xl col-span-2">
                <span className="text-muted-foreground">تحتاج إضافة</span>
                <span className="font-black text-primary tabular-nums">
                  {formatCurrency(shortfall)}
                </span>
              </div>
            </div>
            <Button
              onClick={onWallet}
              variant="outline"
              className="w-full h-12 text-base press-spring"
            >
              <Wallet className="w-5 h-5 ml-2" /> شحن المحفظة
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
      {!compact && couponField}
      {compact && (
        <div className="flex-1 text-right">
          <div className="font-black text-primary text-xl tabular-nums">
            {formatCurrency(displayPrice)}
          </div>
          <div className="text-xs text-emerald-400">رصيد كافٍ ✓</div>
        </div>
      )}
      <Button
        onClick={onBuy}
        disabled={isPending}
        className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-6" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 press-spring ${!compact ? "cta-glow" : ""}`}
      >
        <ShoppingCart className={`${compact ? "w-4 h-4" : "w-5 h-5"} ml-2`} />
        {isPending
          ? "جارٍ المعالجة..."
          : compact
            ? "اشترِ"
            : `اشترِ الآن — ${formatCurrency(displayPrice)}`}
      </Button>
    </div>
  );
}
