import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { roundToCents, useCart } from "@/lib/cart";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import {
  AlertCircle,
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
import { useQueryClient } from "@tanstack/react-query";
import {
  createOrder,
  getGetMeQueryKey,
  getGetWalletQueryKey,
  getListOrdersQueryKey,
  getMe,
  type CreateOrderBody,
  type Order,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { formatCount } from "@/lib/utils";

// `/api/auth/me` returns the user FLAT ({...formatUser(user), linked_identities})
// — there is no `user` wrapper. The old `data?.user?.wallet_balance` read
// always evaluated to undefined -> balance 0 -> the confirm button was
// permanently disabled for every authed visitor (P0-1, live-confirmed).
interface MeResponse {
  wallet_balance?: number | null;
}

function formatBalance(value: number | null | undefined): string {
  return formatCurrency(value ?? 0);
}

/**
 * customFetch throws `ApiError` (an Error subclass with `name: "ApiError"`)
 * for EVERY non-2xx HTTP response, and a browser `TypeError` for network-level
 * failures (DNS/offline/request never delivered). The distinction matters for
 * the partial-failure bookkeeping below: an HTTP failure means the server
 * DEFINITIVELY rejected this unit (safe to shrink the cart to the remainder),
 * while a network failure means the server state is UNKNOWN (the request may
 * have landed and charged the wallet) — the cart must be left untouched.
 */
function isHttpApiError(error: unknown): boolean {
  return error instanceof Error && error.name === "ApiError";
}

/**
 * The backend error envelope ({error, code}) carried by an ApiError.
 * 93-C5 / F-15 (A4 #9): the orders route maps several coupon failures to
 * the generic INVALID_DATA code, which getErrorMessage() flattens to
 * "بيانات غير صالحة" — a confusing money-looking error. Prefer the
 * backend's specific Arabic sentence on this path.
 */
function apiErrorData(error: unknown): { error?: string; code?: string } | null {
  if (!isHttpApiError(error)) return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return data as { error?: string; code?: string };
}

/**
 * Coupon-family failures (invalid / inactive / expired / maxed / exhausted)
 * — every one of the backend's coupon messages carries the word "كوبون".
 * 93-C5 / F-15 (A4 #9): used to special-case the recovery guidance.
 */
function isCouponFailureMessage(message: string | undefined): boolean {
  return typeof message === "string" && message.includes("كوبون");
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
  // V3-A2: transactional funnel — never index (robots.txt also Disallows).
  const seoBlock = useSeo({
    title: "إتمام الطلب — SubNation",
    description: "أكمل عملية الدفع من محفظة SubNation.",
    path: "/checkout",
    robots: "noindex,follow",
  });
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { items, totalLYD, clear, removeItem, updateQuantity } = useCart();
  const [coupon, setCoupon] = useState("");
  // R94-A1 #9 (P3): the pre-validated coupon result. checkout used to
  // fetch /coupons/validate (final_amount / discount_amount for THIS
  // basket), throw the body away, and label the confirm button with the
  // UN-discounted total — the user confirmed "105.00 د.ل" and was charged
  // 100.00. The stored result is invalidated whenever the coupon input or
  // the cart lines change (see the effect + onChange below); the server
  // re-validates on every unit order regardless.
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    final_amount: number;
    discount_amount: number;
  } | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);
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
    // 93-C5 / sim P2 (navbar balance staleness after cart purchase):
    // cache:"no-store" — /api/auth/me serves Cache-Control: private,
    // max-age=30, so this probe used to seed the browser HTTP cache with
    // the PRE-purchase balance seconds before purchase; the
    // post-purchase invalidate→refetch was then answered from that cache
    // and the Navbar kept showing the old balance. Don't poison it.
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
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

  // Cart lines are part of the validation input (order_amount = basket
  // total) — any line/quantity change voids the stored coupon result so
  // the "الإجمالي بعد الكوبون" label can never go stale.
  useEffect(() => {
    setAppliedCoupon(null);
    setCouponNotice(null);
  }, [items]);

  // A wallet-method purchase only blocks on a CONFIRMED insufficient
  // balance — an unknown balance (probe failed) must not hard-block,
  // the server remains the source of truth on submission.
  // R94-A1 #1 (P2, FP gate): the comparison uses the CENT-ROUNDED total
  // (and the coupon-adjusted one when a pre-check succeeded). The raw
  // sum 8.33 × 6 = 49.980000000000004 made `49.98 < total` true for a
  // user whose balance was EXACTLY the total — a blocked purchase with
  // the nonsensical "الناقص 0.00 د.ل".
  const comparisonTotal = roundToCents(appliedCoupon ? appliedCoupon.final_amount : totalLYD);
  const insufficient =
    !balanceLoading && !balanceError && balance !== null && balance < comparisonTotal;
  const isEmpty = items.length === 0;

  /** R94-A1 #9: pre-check the coupon against this basket and KEEP the
   * result (final_amount / discount_amount) so the summary and the CTA
   * can state the post-coupon total before submission. Mirrors
   * product.tsx's validateCoupon contract. */
  const applyCoupon = async () => {
    const code = coupon.trim().toUpperCase();
    if (!code || totalLYD <= 0) return;
    setCouponChecking(true);
    setCouponNotice(null);
    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ code, order_amount: totalLYD }),
      });
      const body = await res.json().catch(() => null);
      const finalAmount = Number(body?.final_amount);
      const discountAmount = Number(body?.discount_amount);
      if (!(res.ok && body && body.valid === true)) {
        const message =
          (body && typeof body.error === "string" && body.error) || "الكوبون غير صالح";
        setAppliedCoupon(null);
        setCouponNotice(message);
        return;
      }
      if (!Number.isFinite(finalAmount) || !Number.isFinite(discountAmount)) {
        setAppliedCoupon(null);
        setCouponNotice("استجابة تحقق غير صالحة — أعد المحاولة");
        return;
      }
      setAppliedCoupon({ code, final_amount: finalAmount, discount_amount: discountAmount });
    } catch {
      // Network-level failure — inconclusive; nothing is applied.
      setCouponNotice("تعذّر التحقق من الكوبون — تحقّق من شبكتك ثم أعد المحاولة");
    } finally {
      setCouponChecking(false);
    }
  };

  const clearAppliedCoupon = () => {
    setAppliedCoupon(null);
    setCouponNotice(null);
  };

  const canSubmit = useMemo(() => {
    if (!token || isEmpty || submitting) return false;
    if (insufficient) return false;
    return true;
  }, [token, isEmpty, submitting, insufficient]);

  /**
   * 93-C5 / sim P2 (navbar balance staleness after cart purchase):
   * every charged unit moved the wallet balance, but a plain
   * invalidate→refetch of /api/auth/me can be served from the browser
   * HTTP cache (private, max-age=30) with the pre-purchase body — the
   * Navbar's useGetMe chip then stayed stale until the next navigation
   * (product.tsx's single-buy only "worked" because its last /me fetch
   * was >30 s old by purchase time). Refresh me with cache:"no-store"
   * and seed the query cache DIRECTLY — no refetch race, every useGetMe
   * observer re-renders with the new wallet_balance immediately. Falls
   * back to a plain invalidation if the refresh itself fails.
   */
  const refreshMeBalance = async () => {
    try {
      const freshUser = await getMe({ cache: "no-store" });
      queryClient.setQueryData(getGetMeQueryKey(), freshUser);
    } catch {
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    }
  };

  async function handleConfirm() {
    if (!token || items.length === 0) return;
    setSubmitting(true);
    setOrderError(null);
    setPartialCount(0);
    const created: Order[] = [];
    let firstOrderCode: string | null = null;
    let failureMessage: string | null = null;
    let couponFailure = false;
    // Per-line bookkeeping of units that ACTUALLY got ordered (P0-3). A
    // mid-line failure (e.g. unit 2 of 3) previously left the full qty=3
    // in the cart while 1 unit was already charged — a retry then bought
    // 3 more units = 4 charges for 3 products. The cart must mirror
    // exactly what was charged: fully-ordered lines are removed,
    // partially-ordered lines keep only the unordered remainder.
    const orderedUnitsByProduct = new Map<number, number>();
    const couponCode = coupon.trim().toUpperCase();

    try {
      // 93-C5 / F-15 (A4 #9): pre-flight the coupon ONCE against the
      // basket BEFORE the per-unit loop charges anything. Deterministic
      // coupon failures (invalid / inactive / expired / maxed /
      // min-order) previously surfaced mid-loop — after some units had
      // already been charged ("guaranteed partial failure" for a qty≥2
      // line: the first unit consumes a single-use coupon's only slot,
      // every following unit fails). A network failure is inconclusive
      // → fail-open: the server re-validates the coupon on every unit
      // order anyway.
      if (couponCode) {
        // Skip the pre-flight when THIS exact code was already validated
        // against the current basket (applyCoupon above) — the server
        // re-validates on every unit order anyway.
        if (appliedCoupon?.code !== couponCode) {
          try {
            const res = await fetch("/api/coupons/validate", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              credentials: "include",
              body: JSON.stringify({ code: couponCode, order_amount: totalLYD }),
            });
            const body = await res.json().catch(() => null);
            if (!(res.ok && body && body.valid === true)) {
              const message =
                (body && typeof body.error === "string" && body.error) || "الكوبون غير صالح";
              setOrderError(
                `الكوبون: ${message} — أزل الكوبون أو صحّحه ثم أعد المحاولة. لم يتم خصم أي مبلغ.`,
              );
              toast({
                title: "تعذّر تطبيق الكوبون",
                description: message,
                variant: "destructive",
              });
              return;
            }
          } catch {
            // Network-level failure — inconclusive, fail-open (see above).
          }
        }
      }

      for (const it of items) {
        const unitsWanted = Math.min(it.quantity, MAX_UNITS_PER_LINE);
        let unitsOrdered = 0;
        // `CreateOrderBody` accepts a single product_id with quantity 1
        // per order — a qty>1 cart line becomes N unit orders.
        for (let unit = 0; unit < unitsWanted; unit++) {
          const body: CreateOrderBody = { product_id: it.productId };
          if (couponCode) body.coupon_code = couponCode;
          // V4-P0: one fresh Idempotency-Key PER UNIT ORDER — a network
          // retry or double-click of this exact unit replays the cached
          // server response instead of charging the wallet twice, while
          // different units (and a NEW confirm click) stay distinct.
          // Round-4: raw fetch("/api/orders") replaced by the orval-generated
          // createOrder() — per-call RequestInit carries the per-unit
          // Idempotency-Key, and the typed Order response kills the local
          // CreatedOrder interface. Auth rides the shared customFetch wiring
          // (cookie session + global bearer-token getter from main.tsx).
          try {
            const order = await createOrder(body, {
              headers: { "Idempotency-Key": generateIdempotencyKey() },
            });
            created.push(order);
            unitsOrdered++;
            if (!firstOrderCode) firstOrderCode = order.order_code;
          } catch (e) {
            if (!isHttpApiError(e)) {
              // Network-level failure: this unit's server state is UNKNOWN
              // (it may have been charged). Rethrow to the outer catch —
              // it shows the error WITHOUT the cart-sync step, so a manual
              // retry can't double-buy units that actually succeeded.
              throw e;
            }
            // HTTP-level failure: the backend error envelope arrives as
            // ApiError.data = {error, code} — NEVER `.message` (P0-2).
            // 93-C5 / F-15: prefer the envelope's specific Arabic sentence
            // over the code map (coupon failures map to INVALID_DATA →
            // "بيانات غير صالحة", which reads like a money error).
            failureMessage = apiErrorData(e)?.error || getErrorMessage(e) || "فشل في إنشاء الطلب";
            couponFailure = isCouponFailureMessage(failureMessage ?? undefined);
            break;
          }
        }
        if (unitsOrdered > 0) orderedUnitsByProduct.set(it.productId, unitsOrdered);
        if (failureMessage) break;
      }

      // 93-C5 / F-15 (A4 #9): coupon-family failures get explicit recovery
      // guidance — a single-use coupon that died mid-loop (its first unit
      // consumed the last slot) leaves the dead code in the input, and a
      // plain retry would re-fail on the same units forever. Clear it so
      // the retry completes the remainder at full price (never silently:
      // the confirm button shows the undiscounted total, and the banner
      // explains exactly what happened).
      if (couponFailure && failureMessage) {
        if (created.length > 0) {
          setCoupon("");
          setAppliedCoupon(null);
          failureMessage = `${failureMessage} — أُزيل الكوبون من الحقل؛ أعد المحاولة لإكمال الوحدات المتبقية بالسعر الكامل.`;
        } else {
          failureMessage = `${failureMessage} — أزل الكوبون من الحقل ثم أعد المحاولة.`;
        }
      }

      // Sync the cart to exactly what was charged — remove full lines,
      // shrink partial lines to the un-bought remainder.
      orderedUnitsByProduct.forEach((unitsOrdered, productId) => {
        const line = items.find((i) => i.productId === productId);
        if (!line) return;
        if (unitsOrdered >= line.quantity) removeItem(productId);
        else updateQuantity(productId, line.quantity - unitsOrdered);
      });

      // Every unit that was charged moved the wallet balance — refresh the
      // me cache with an HTTP-cache-bypassing fetch (see refreshMeBalance)
      // and the other money caches so they don't stay stale for up to
      // 60 s (staleTime with refetchOnWindowFocus/reconnect disabled).
      // product.tsx does the same after its single-unit purchase.
      if (created.length > 0) {
        await refreshMeBalance();
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        // 93-C5 (A4 #20): the orders list (home's "آخر الطلبات" strip + the
        // /orders page) must reflect the purchase immediately, not ≤60 s
        // later. No-arg form invalidates every list param variant.
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      }

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
          description: `تم إنشاء ${formatCount(created.length, {
            one: "طلب",
            two: "طلبين",
            few: "طلبات",
            many: "طلباً",
            other: "طلب",
          })} بنجاح`,
        });
        if (firstOrderCode) navigate(`/orders/${firstOrderCode}`);
      }
    } catch (e) {
      // Network-level abort (rethrown from the unit loop). If any unit
      // was already charged, the wallet moved too — refresh the same
      // caches even though the cart-sync was (deliberately) skipped.
      if (created.length > 0) {
        await refreshMeBalance();
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      }
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
      {seoBlock}
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
                    {/* 93-C5 / F-15 (A4 #8): a failed probe used to render a
                        fabricated "0.00 د.ل" here (formatBalance(null) →
                        formatCurrency(0)) while the banner below honestly
                        said "تعذّر التحقق من رصيدك" — contradictory money
                        UI. Render an explicit unknown marker instead. */}
                    {balanceLoading ? "…" : balance === null ? "—" : formatBalance(balance)}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              سيُخصم ثمن طلباتك من رصيد المحفظة فوراً، وتُسلَّم بيانات الحسابات مباشرة بعد الدفع.
            </p>

            {balanceError && (
              <div
                role="alert"
                className="mt-3 p-3 rounded-xl bg-status-warning/10 border border-status-warning/22 text-status-warning text-xs font-bold flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span>
                  تعذّر التحقق من رصيدك. يمكن المتابعة وسيتم التحقق من الرصيد عند التأكيد.
                </span>
              </div>
            )}

            {insufficient && (
              <div
                role="alert"
                className="mt-3 p-3 rounded-xl bg-status-error/10 border border-status-error/22 text-status-error text-xs font-bold flex items-start gap-2"
              >
                <X className="w-4 h-4 shrink-0 mt-px" />
                <div className="flex-1">
                  <p>رصيد المحفظة غير كافٍ (الناقص {formatCurrency(comparisonTotal - (balance ?? 0))}).</p>
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
            <div className="flex gap-2">
              <Input
                value={coupon}
                onChange={(e) => {
                  setCoupon(e.target.value.toUpperCase());
                  // Any edit voids the stored pre-check result — the label
                  // must never show a total validated for a different code.
                  setAppliedCoupon(null);
                  setCouponNotice(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !appliedCoupon) {
                    e.preventDefault();
                    void applyCoupon();
                  }
                }}
                placeholder="أدخل رمز الكوبون"
                aria-label="رمز الكوبون"
                className="flex-1 font-mono uppercase"
                dir="ltr"
              />
              {appliedCoupon ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearAppliedCoupon}
                  aria-label="إزالة الكوبون"
                  className="shrink-0 font-bold"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void applyCoupon()}
                  disabled={!coupon.trim() || couponChecking || isEmpty}
                  className="shrink-0 font-bold"
                >
                  {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : "تحقق"}
                </Button>
              )}
            </div>
            {couponNotice && !appliedCoupon && (
              <p role="alert" className="text-xs font-bold text-status-error mt-2 leading-relaxed">
                {couponNotice}
              </p>
            )}
            {appliedCoupon && (
              <p
                role="status"
                className="text-xs font-bold text-status-success mt-2 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span dir="ltr" className="font-mono">
                  {appliedCoupon.code}
                </span>
                — خصم {formatCurrency(appliedCoupon.discount_amount)}
              </p>
            )}
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
                  {appliedCoupon && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">خصم الكوبون</span>
                      <span className="font-bold tabular-nums text-status-success">
                        −{formatCurrency(appliedCoupon.discount_amount)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-base font-black pt-1">
                    <span>{appliedCoupon ? "الإجمالي بعد الكوبون" : "الإجمالي"}</span>
                    <span className="tabular-nums text-primary-text">
                      {formatCurrency(comparisonTotal)}
                    </span>
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
                          <p>
                            تم إنشاء{" "}
                            {formatCount(partialCount, {
                              one: "طلب",
                              two: "طلبين",
                              few: "طلبات",
                              many: "طلباً",
                              other: "طلب",
                            })}{" "}
                            بنجاح قبل توقف العملية.
                          </p>
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
                      جارٍ المعالجة… ({formatCurrency(comparisonTotal)})
                    </>
                  ) : appliedCoupon ? (
                    <>تأكيد الطلب — الإجمالي بعد الكوبون ({formatCurrency(comparisonTotal)})</>
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
