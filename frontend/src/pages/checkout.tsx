import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Loader2, Lock, ShieldCheck, ShoppingBag, Tag, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

// `/api/auth/me` returns the user FLAT ({...formatUser(user), linked_identities})
// — there is no `user` wrapper. The old `data?.user?.wallet_balance` read
// always evaluated to undefined -> balance 0 -> the confirm button was
// permanently disabled for every authed visitor (P0-1, live-confirmed).
interface MeResponse {
  wallet_balance?: number | null;
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

/**
 * Checkout — the money path.
 *
 * Payment method is wallet-only BY DESIGN: the backend's POST /api/orders
 * reads only product_id + coupon_code and ALWAYS charges the wallet — a
 * "cash on delivery" option that the server silently drops (previously
 * selectable here) let users believe they would pay on delivery while the
 * wallet was charged anyway. Removing the fake option is the honest UX.
 */
export default function CheckoutPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { items, totalLYD, clear, removeItem, updateQuantity } = useCart();
  const [coupon, setCoupon] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState(false);
  // Persistent in-page failure banner (critical money errors must NOT
  // live in a 4-second toast). Cleared on a new submission attempt.
  const [orderError, setOrderError] = useState<string | null>(null);
  // Partial-success bookkeeping: orders that DID go through before a
  // failure — shown in the banner so the user knows what was charged.
  const [partialCount, setPartialCount] = useState(0);
  // Server-side hard cap mirrors the backend validation — protects the
  // per-unit purchase loop from a self-DoS via huge quantities (H7).
  const MAX_UNITS_PER_LINE = 99;

  useEffect(() => {
    if (!token) {
      navigate("/login?redirect=/checkout");
    }
  }, [token, navigate]);

  useEffect(() => {
    if (!token) return;
    let aborted = false;
    setBalanceLoading(true);
    setBalanceError(false);
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("balance fetch failed");
        return res.json();
      })
      .then((data: MeResponse) => {
        if (aborted) return;
        setBalance(
          typeof data?.wallet_balance === "number" && Number.isFinite(data.wallet_balance)
            ? data.wallet_balance
            : null,
        );
      })
      .catch(() => {
        // Do NOT fake balance=0 — a failed probe used to render the
        // "insufficient balance" banner for solvent users. Show a
        // retry-able error instead of lying about the balance.
        if (!aborted) {
          setBalance(null);
          setBalanceError(true);
        }
      })
      .finally(() => {
        if (!aborted) setBalanceLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [token]);

  // A wallet-method purchase only blocks on a CONFIRMED insufficient
  // balance — an unknown balance (probe failed) must not hard-block,
  // the server remains the source of truth on submission.
  const insufficient = !balanceLoading && !balanceError && balance !== null && balance < totalLYD;
  const isEmpty = items.length === 0;

  const canSubmit = useMemo(() => {
    if (!token || isEmpty || submitting) return false;
    if (insufficient) return false;
    return true;
  }, [token, isEmpty, submitting, insufficient]);

  async function handleConfirm() {
    if (!token || items.length === 0) return;
    setSubmitting(true);
    setOrderError(null);
    setPartialCount(0);
    const created: CreatedOrder[] = [];
    let firstOrderCode: string | null = null;
    let failureMessage: string | null = null;
    // Per-line bookkeeping of units that ACTUALLY got ordered (P0-3). A
    // mid-line failure (e.g. unit 2 of 3) previously left the full qty=3
    // in the cart while 1 unit was already charged — a retry then bought
    // 3 more units = 4 charges for 3 products. The cart must mirror
    // exactly what was charged: fully-ordered lines are removed,
    // partially-ordered lines keep only the unordered remainder.
    const orderedUnitsByProduct = new Map<number, number>();

    try {
      for (const it of items) {
        const unitsWanted = Math.min(it.quantity, MAX_UNITS_PER_LINE);
        let unitsOrdered = 0;
        // `CreateOrderBody` accepts a single product_id with quantity 1
        // per order — a qty>1 cart line becomes N unit orders.
        for (let unit = 0; unit < unitsWanted; unit++) {
          const body: Record<string, unknown> = { product_id: it.productId };
          if (coupon.trim()) body.coupon_code = coupon.trim();
          const res = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          const orderData = await res.json().catch(() => ({}));
          if (!res.ok) {
            // The backend error envelope is {error, code} — NEVER
            // `.message` (P0-2). getErrorMessage maps `code` to the
            // precise Arabic money message (INSUFFICIENT_BALANCE,
            // OUT_OF_STOCK, ...) and falls back to the raw `error` text.
            failureMessage = getErrorMessage(orderData) || "فشل في إنشاء الطلب";
            break;
          }
          created.push(orderData as CreatedOrder);
          unitsOrdered++;
          if (!firstOrderCode) firstOrderCode = (orderData as CreatedOrder).order_code;
        }
        if (unitsOrdered > 0) orderedUnitsByProduct.set(it.productId, unitsOrdered);
        if (failureMessage) break;
      }

      // Sync the cart to exactly what was charged — remove full lines,
      // shrink partial lines to the un-bought remainder.
      orderedUnitsByProduct.forEach((unitsOrdered, productId) => {
        const line = items.find((i) => i.productId === productId);
        if (!line) return;
        if (unitsOrdered >= line.quantity) removeItem(productId);
        else updateQuantity(productId, line.quantity - unitsOrdered);
      });

      if (failureMessage && created.length === 0) {
        // Complete failure — persistent in-page banner + toast cue.
        setOrderError(failureMessage);
        toast({ title: failureMessage, variant: "destructive" });
      } else if (failureMessage && created.length > 0) {
        // Partial success: some orders were charged, then one failed.
        // Tell the user EXACTLY what happened — never silently retry.
        setPartialCount(created.length);
        setOrderError(failureMessage);
      } else {
        // Full success.
        clear();
        toast({
          title: "تم تأكيد الطلب",
          description: `تم إنشاء ${created.length} طلب بنجاح`,
        });
        if (firstOrderCode) navigate(`/orders/${firstOrderCode}`);
      }
    } catch (e) {
      const msg = getErrorMessage(e);
      setOrderError(msg);
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
          {/* Payment method — wallet only (see component docblock) */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 reveal-up">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-black text-base">طريقة الدفع</h2>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/50 bg-primary/8 shadow-sm">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-primary/15 text-primary">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm flex items-center gap-2">
                  خصم من المحفظة
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  رصيدك:{" "}
                  <span className="font-black text-foreground tabular-nums">
                    {balanceLoading ? "…" : formatBalance(balance)}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              سيُخصم ثمن طلباتك من رصيد المحفظة فوراً، وتُسلَّم بيانات الحسابات مباشرة بعد الدفع.
            </p>

            {balanceError && (
              <div role="alert" className="mt-3 p-3 rounded-xl bg-status-warning/10 border border-status-warning/22 text-status-warning text-xs font-bold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span>تعذّر التحقق من رصيدك. يمكن المتابعة وسيتم التحقق من الرصيد عند التأكيد.</span>
              </div>
            )}

            {insufficient && (
              <div role="alert" className="mt-3 p-3 rounded-xl bg-status-error/10 border border-status-error/22 text-status-error text-xs font-bold flex items-start gap-2">
                <X className="w-4 h-4 shrink-0 mt-px" />
                <div className="flex-1">
                  <p>رصيد المحفظة غير كافٍ (الناقص {formatCurrency(totalLYD - (balance ?? 0))}).</p>
                  <Link
                    href="/wallet?return=/checkout"
                    className="inline-flex items-center gap-1 mt-1.5 text-status-error underline underline-offset-2 hover:opacity-80"
                  >
                    اشحن المحفظة ثم عُد لإكمال الطلب
                  </Link>
                </div>
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
              aria-label="كود الكوبون"
              className="font-mono uppercase"
              dir="ltr"
            />
            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
              يُتحقَّق من الكوبون ويُطبَّق على المنتجات المؤهلة عند تأكيد الطلب.
            </p>
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
                    <span className="tabular-nums text-primary-text">{formatCurrency(totalLYD)}</span>
                  </div>
                </div>

                {/* Persistent money-failure banner: an error here must be
                    actionable, not a 4-second toast. */}
                {orderError && (
                  <div
                    role="alert"
                    className="mb-4 p-3.5 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-xs font-bold flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                    <div className="flex-1 leading-relaxed">
                      {partialCount > 0 ? (
                        <>
                          <p>تم إنشاء {partialCount} طلب بنجاح قبل توقف العملية.</p>
                          <p className="mt-1 font-normal">{orderError}</p>
                          <Link
                            href="/orders"
                            className="inline-flex items-center gap-1 mt-1.5 text-status-error underline underline-offset-2 hover:opacity-80"
                          >
                            راجع طلباتك المنشأة
                          </Link>
                        </>
                      ) : (
                        <>
                          <p>تعذّر إتمام الطلب: {orderError}</p>
                          <p className="mt-1 font-normal text-muted-foreground">
                            لم يتم خصم أي مبلغ. راجع الرصيد والمخزون ثم أعد المحاولة.
                          </p>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setOrderError(null)}
                      aria-label="إغلاق رسالة الخطأ"
                      className="shrink-0 p-1 -m-1 rounded-md hover:bg-status-error/10"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <Button
                  onClick={handleConfirm}
                  disabled={!canSubmit}
                  className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 active:scale-[0.99] transition-all font-bold h-12"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جارٍ المعالجة… ({formatCurrency(totalLYD)})
                    </>
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
