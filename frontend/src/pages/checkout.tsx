import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import {
  CheckCircle2,
  Loader2,
  Lock,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

type PaymentMethod = "wallet" | "cod";

interface MeResponse {
  user: {
    wallet_balance?: number | null;
  };
}

interface CreatedOrder {
  id: number;
  order_code: string;
  amount: number;
  product_name?: string;
}

function formatBalance(value: number | null | undefined): string {
  return formatCurrency(value ?? 0);
}

export default function CheckoutPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { items, totalLYD, clear } = useCart();
  const [method, setMethod] = useState<PaymentMethod>("wallet");
  const [coupon, setCoupon] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate("/login?redirect=/checkout");
    }
  }, [token, navigate]);

  useEffect(() => {
    if (!token) return;
    let aborted = false;
    setBalanceLoading(true);
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data: MeResponse) => {
        if (aborted) return;
        setBalance(data?.user?.wallet_balance ?? 0);
      })
      .catch(() => {
        if (!aborted) setBalance(0);
      })
      .finally(() => {
        if (!aborted) setBalanceLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [token]);

  const insufficient = method === "wallet" && balance !== null && balance < totalLYD;
  const isEmpty = items.length === 0;

  const canSubmit = useMemo(() => {
    if (!token || isEmpty || submitting) return false;
    if (method === "wallet" && insufficient) return false;
    return true;
  }, [token, isEmpty, submitting, method, insufficient]);

  async function handleConfirm() {
    if (!token || items.length === 0) return;
    setSubmitting(true);
    try {
      const created: CreatedOrder[] = [];
      let firstOrderCode: string | null = null;
      // Place each cart item as its own order — `CreateOrderBody` only
      // accepts a single product_id. The cart UI guarantees that all
      // items reference real products; pricing/finalization is handled
      // by the backend checkout service so we don't need to pass
      // price here.
      for (const it of items) {
        const body: Record<string, unknown> = { product_id: it.productId };
        if (coupon.trim()) body.coupon_code = coupon.trim();
        if (method === "cod") body.payment_method = "cod";
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        const orderData = await res.json();
        if (!res.ok) {
          throw new Error((orderData as { message?: string }).message ?? "فشل في إنشاء الطلب");
        }
        created.push(orderData as CreatedOrder);
        if (!firstOrderCode) firstOrderCode = (orderData as CreatedOrder).order_code;
      }
      clear();
      toast({
        title: "تم تأكيد الطلب",
        description: `تم إنشاء ${created.length} طلب بنجاح`,
      });
      if (firstOrderCode) navigate(`/orders/${firstOrderCode}`);
    } catch (e) {
      const msg = e instanceof Error ? getErrorMessage(e) : "تعذّر إكمال الطلب";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-7 page-in">
        <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
          <ShoppingBag className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-black leading-tight">إتمام الطلب</h1>
          <p className="text-sm text-muted-foreground">راجع مشترياتك وأكمل عملية الدفع</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-5">
        {/* Payment details (left on desktop) */}
        <div className="space-y-4">
          {/* Payment method */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-black text-base">طريقة الدفع</h2>
            </div>
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setMethod("wallet")}
                className={`w-full flex items-start gap-3 p-4 rounded-xl border text-right transition-all duration-150 ${
                  method === "wallet"
                    ? "border-primary/50 bg-primary/8 shadow-sm"
                    : "border-border/60 bg-card hover:border-border hover:bg-secondary/40"
                }`}
                aria-pressed={method === "wallet"}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    method === "wallet"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Wallet className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">خصم من المحفظة</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    رصيدك:{" "}
                    <span className="font-black text-foreground tabular-nums">
                      {balanceLoading ? "…" : formatBalance(balance)}
                    </span>
                  </div>
                </div>
                {method === "wallet" && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
              </button>

              <button
                type="button"
                onClick={() => setMethod("cod")}
                className={`w-full flex items-start gap-3 p-4 rounded-xl border text-right transition-all duration-150 ${
                  method === "cod"
                    ? "border-primary/50 bg-primary/8 shadow-sm"
                    : "border-border/60 bg-card hover:border-border hover:bg-secondary/40"
                }`}
                aria-pressed={method === "cod"}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    method === "cod"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">دفع عند الاستلام</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ادفع نقداً عند استلام الطلب
                  </div>
                </div>
                {method === "cod" && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
              </button>
            </div>

            {method === "wallet" && insufficient && (
              <div className="mt-3 p-3 rounded-xl bg-status-error/10 border border-status-error/22 text-status-error text-xs font-bold flex items-start gap-2">
                <X className="w-4 h-4 shrink-0 mt-px" />
                <span>رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً.</span>
              </div>
            )}
          </div>

          {/* Coupon */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-black text-base">كوبون خصم</h2>
              <span className="text-[10px] text-muted-foreground font-bold">(اختياري)</span>
            </div>
            <Input
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              placeholder="أدخل كود الكوبون"
              className="font-mono uppercase"
              dir="ltr"
            />
          </div>

          {/* Trust */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-bold px-1">
            <ShieldCheck className="w-4 h-4 text-status-success" />
            <span>دفعتك آمنة ومشفّرة بالكامل</span>
          </div>
        </div>

        {/* Cart summary (right on desktop) */}
        <aside className="md:sticky md:top-20 md:self-start">
          <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
            <h2 className="font-black text-base mb-4">ملخص الطلب</h2>

            {isEmpty ? (
              <div className="text-center py-8 text-muted-foreground">
                <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-bold mb-3">سلتك فارغة</p>
                <Link href="/">
                  <Button variant="outline" size="sm" className="font-bold">
                    تصفح المنتجات
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                <ul className="space-y-2 mb-4 max-h-72 overflow-y-auto">
                  {items.map((it) => {
                    const price = it.salePriceLYD ?? it.priceLYD;
                    return (
                      <li key={it.productId} className="flex items-center gap-2.5 text-sm">
                        <div className="w-9 h-9 rounded-lg bg-muted/60 border border-border/40 shrink-0 overflow-hidden flex items-center justify-center">
                          {it.imageUrl ? (
                            <img
                              src={it.imageUrl}
                              alt={it.name}
                              loading="lazy"
                              className="w-full h-full object-contain p-1"
                            />
                          ) : (
                            <span className="text-xs font-black text-primary/50 select-none">
                              {(it.name ?? "?")[0]}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold truncate">{it.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {it.quantity} × {formatCurrency(price)}
                          </div>
                        </div>
                        <div className="font-black tabular-nums text-sm shrink-0">
                          {formatCurrency(price * it.quantity)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-border/50 pt-3 space-y-1.5 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">المجموع الفرعي</span>
                    <span className="font-bold tabular-nums">{formatCurrency(totalLYD)}</span>
                  </div>
                  <div className="flex items-center justify-between text-base font-black pt-1">
                    <span>الإجمالي</span>
                    <span className="tabular-nums text-primary">{formatCurrency(totalLYD)}</span>
                  </div>
                </div>

                <Button
                  onClick={handleConfirm}
                  disabled={!canSubmit}
                  className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 active:scale-[0.99] transition-all font-bold h-12"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>تأكيد الطلب ({formatCurrency(totalLYD)})</>
                  )}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center mt-3">
                  بالنقر على «تأكيد الطلب» فإنك توافق على شروط الاستخدام
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
