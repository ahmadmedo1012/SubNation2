import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  copyToClipboard,
  formatCurrency,
  formatDate,
  formatRelativeTime,
  statusLabel,
} from "@/lib/utils";
import {
  STATUS_TONE,
  StatusBadge,
  UNKNOWN_STATUS_TONE,
} from "@/components/ui/status-badge";
import {
  getGetMeQueryKey,
  getGetOrderQueryKey,
  useGetMe,
  useGetOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "@/hooks/use-socket";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Info,
  Package,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tag,
  Undo2,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";

function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  /** Mask the value until explicitly revealed (passwords). */
  secret?: boolean;
}) {
  const [revealed, setRevealed] = useState(!secret);
  return (
    <div className="group flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-muted/15 transition-colors">
      <div className="min-w-0 flex-1">
        {/* 96-F4 (R96 A6 #1): uppercase/tracking-wider removed from the
            Arabic credential labels («البريد الإلكتروني»/«كلمة المرور») —
            letter-spacing tears the cursive joins (ج/ح/خ disconnect). */}
        <div className="text-3xs text-muted-foreground font-bold mb-0.5">{label}</div>
        {/* dir="ltr": credentials are LTR runs — without it the bidi
            algorithm visually scrambles values ending in digits/symbols
            even though the copied text is correct.
            96-F4 (R96 A2 P1-4/P1-5): the value stays in a NON-button
            selectable element (select-text + break-all) — the paid data
            remains long-press-selectable as the fallback when copy fails. */}
        <div
          dir="ltr"
          className="font-mono font-bold text-sm break-all leading-snug text-left select-text"
        >
          {revealed ? value : "•".repeat(Math.min(value.length, 12))}
        </div>
        {secret && (
          /* 96-F4 (R96 A2 P1-4): reveal is its own 44px control on the
              LABEL side — visually separated from the copy affordance on
              the opposite side (they used to be twin ~28px pills and a
              mis-tap hit the neighbor's identical pill). */
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            className="mt-2 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-xs font-bold transition-all duration-180 border press-spring bg-muted/40 text-muted-foreground border-border/35 hover:bg-primary/10 hover:text-primary hover:border-primary/22"
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {revealed ? "إخفاء" : "إظهار"}
          </button>
        )}
      </div>
      {/* 96-F4 (R96 A2 P1-3): the shared CopyButton (size="md", min-h-11)
          replaces the local reimplementation — copy failure now announces
          itself («تعذّر النسخ») instead of silently keeping the «نسخ» label. */}
      <CopyButton text={value} size="md" />
    </div>
  );
}

function StatusSteps({ status }: { status: string }) {
  if (status === "failed" || status === "refunded") return null;
  const done = status === "completed";
  return (
    <div className="flex items-center gap-0 my-4">
      {/* Step 1 */}
      <div className="flex flex-col items-center gap-1.5 shrink-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-status-success/15 border-2 border-status-success/45 text-status-success">
          <CheckCircle className="w-3.5 h-3.5" />
        </div>
        <span className="text-3xs font-bold text-status-success whitespace-nowrap">
          استُلم الطلب
        </span>
      </div>

      {/* Connector */}
      <div
        className={`flex-1 h-[2.5px] mb-4 mx-2 rounded-full transition-all duration-700 ${done ? "bg-status-success/40" : "bg-border/35"}`}
      />

      {/* Step 2 */}
      <div className="flex flex-col items-center gap-1.5 shrink-0">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
            done
              ? "bg-status-success/15 border-status-success/45 text-status-success"
              : "bg-muted/40 border-border/40 text-muted-foreground"
          }`}
        >
          {done ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
        </div>
        <span
          className={`text-3xs font-bold whitespace-nowrap ${done ? "text-status-success" : "text-muted-foreground"}`}
        >
          تم التسليم
        </span>
      </div>
    </div>
  );
}

export default function OrderDetailPage() {
  const { orderCode } = useParams<{ orderCode: string }>();
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: order,
    isLoading,
    isError,
    error,
  } = useGetOrder(orderCode ?? "", {
    query: { queryKey: getGetOrderQueryKey(orderCode ?? ""), enabled: !!orderCode && !!token },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  // R104 (free-tier sleep economics): page-scoped realtime. This is
  // the one storefront surface with a genuine realtime need — watching
  // a fresh purchase flip to «تم التسليم». The /api/auth/me query is
  // the SHARED key Navbar/home already populate (60 s staleTime →
  // cache hit, no extra request); `me?.id` arms the socket once the
  // identity is known. Leaving the page keeps the socket only while
  // the session is active (SessionActivityManager parks it when the
  // tab is hidden ≥ 15 min or idle ≥ 30 min; logout/identity switch
  // tears it down in auth.tsx as before).
  const { data: me } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: !!token, staleTime: 60_000 },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });
  useSocket(me?.id);

  // R94-A1 #4 (P2): a 404 (ORDER_NOT_FOUND — unknown code / another
  // user's order / stale link) used to render the «خطأ اتصال» card with
  // a retry button that can never succeed. customFetch throws ApiError
  // with .status — the same idiom product.tsx already uses for its 404.
  const isNotFoundError = isError && (error as { status?: number } | null)?.status === 404;

  const copyOrderCode = async () => {
    if (!order?.order_code) return;
    const ok = await copyToClipboard(order.order_code);
    toast({
      title: ok ? "تم نسخ رقم الطلب" : "تعذّر نسخ رقم الطلب",
      variant: ok ? "default" : "destructive",
    });
  };

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token, navigate]);

  if (!token) return null;

  if (isLoading)
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="h-4 skeleton-shimmer rounded w-24 mb-6" />
        <div className="space-y-3">
          <div className="h-[180px] skeleton-shimmer rounded-2xl border border-border/35" />
          <div className="h-[140px] skeleton-shimmer rounded-2xl border border-border/35" />
          <div className="h-[80px] skeleton-shimmer rounded-2xl border border-border/35" />
        </div>
      </div>
    );

  if (isError && !isNotFoundError)
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-status-error/8 border border-status-error/22 mx-auto mb-4 flex items-center justify-center">
          <XCircle className="w-7 h-7 text-status-error" />
        </div>
        <p className="font-bold text-lg mb-1">تعذّر تحميل الطلب</p>
        <p className="text-sm text-muted-foreground mb-5">
          حدث خطأ في الاتصال — تحقّق من اتصالك ثم أعد المحاولة. إن استمرت المشكلة تواصل مع الدعم.
        </p>
        <div className="flex items-center justify-center gap-2.5">
          <Button
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderCode ?? "") })
            }
            className="gap-1.5 rounded-xl"
          >
            <Clock className="w-4 h-4" />
            إعادة المحاولة
          </Button>
          <Button
            onClick={() => navigate("/orders")}
            variant="outline"
            className="gap-2 rounded-xl"
          >
            <ArrowRight className="w-4 h-4" />
            العودة للطلبات
          </Button>
        </div>
      </div>
    );

  if (!order)
    // Covers both a resolved empty response and the 404 branch above —
    // an unknown/expired/foreign order code is «الطلب غير موجود», never
    // a connection error with an infinite retry loop.
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/55 border border-border/35 mx-auto mb-4 flex items-center justify-center">
          <Package className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="font-bold text-lg mb-1">الطلب غير موجود</p>
        <p className="text-sm text-muted-foreground mb-5">تأكد من رقم الطلب أو عُد لقائمة طلباتك</p>
        <Button onClick={() => navigate("/orders")} variant="outline" className="gap-2 rounded-xl">
          <ArrowRight className="w-4 h-4" />
          العودة للطلبات
        </Button>
      </div>
    );

  const hasDelivery = !!(
    order.delivered_email ||
    order.delivered_password ||
    order.delivered_extra_details
  );
  const discountAmount = (order as { discount_amount?: number }).discount_amount;
  const couponCode = (order as { coupon_code?: string }).coupon_code;
  const originalAmount = discountAmount ? (order.amount ?? 0) + discountAmount : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-7 page-in">
      {/* Back */}
      <button
        onClick={() => navigate("/orders")}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors press-spring group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
        طلباتي
      </button>

      <div className="space-y-3">
        {/* ── Header card ───────────────────────────────────────── */}
        <div className="bg-card border border-border/55 rounded-2xl overflow-hidden shadow-lg shadow-black/10 float-in">
          {/* Top color bar — R115-I1 (A8 P2-3): refunded carries the
              status-info accent (matching the pill + the orders-list
              treatment): the money came back, not a failure. */}
          <div
            className={`h-[3px] ${
              order.status === "completed"
                ? "bg-gradient-to-l from-status-success/85 via-status-success/40 to-transparent"
                : order.status === "refunded"
                  ? "bg-gradient-to-l from-status-info/85 via-status-info/40 to-transparent"
                  : order.status === "failed"
                    ? "bg-gradient-to-l from-status-error/85 via-status-error/40 to-transparent"
                    : "bg-gradient-to-l from-status-warning/65 via-status-warning/30 to-transparent"
            }`}
          />

          <div className="p-5">
            {/* Product + status */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3.5 min-w-0">
                {(order as { product_image_url?: string }).product_image_url ? (
                  <div className="w-12 h-12 rounded-xl bg-muted/45 border border-border/35 overflow-hidden shrink-0">
                    <img
                      src={(order as { product_image_url?: string }).product_image_url}
                      alt={order.product_name ?? ""}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-contain p-1.5"
                    />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0">
                    <span className="text-xl font-bold text-primary/45 select-none">
                      {(order.product_name ?? "؟")[0]}
                    </span>
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="font-bold text-base leading-tight mb-0.5 break-words">
                    {order.product_name}
                  </h1>
                  {/* R116-S2 (P2): the purchased option as a chip under the
                      product name — the cart.tsx idiom (the API serves
                      variant_label on the order line; null for legacy
                      pre-variant orders). */}
                  {order.variant_label && (
                    <div className="text-2xs font-semibold text-muted-foreground bg-muted/40 border border-border/35 rounded-full px-2 py-0.5 mb-1 inline-block leading-tight">
                      {order.variant_label}
                    </div>
                  )}
                  <button
                    onClick={copyOrderCode}
                    dir="ltr"
                    /* R116-S2 (P2/P3): the 44px hit-area idiom with negative
                        vertical margins (checkout.tsx:1493's error-banner
                        close) — the tight header row keeps its rhythm
                        while the tap target clears the touch floor. */
                    className="flex items-center gap-1 min-h-11 px-3 -my-3 text-muted-foreground hover:text-primary text-2xs font-mono transition-colors group/code"
                  >
                    <span>{order.order_code}</span>
                    {/* 96-F4 (R96 A6 #9 / A2 P2-10): the copy affordance is
                        ALWAYS faintly visible on touch (opacity-60 base —
                        hover doesn't exist on phones, so the old
                        opacity-0/group-hover reveal made the code look like
                        plain text); hover only strengthens it on md+. */}
                    <Copy className="w-2.5 h-2.5 opacity-60 md:group-hover/code:opacity-100 transition-opacity" />
                  </button>
                </div>
              </div>
              {/* R116: shared StatusBadge (STATUS_TONE) replaces the
                  deprecated statusColor() — 93-C7 follow-up. */}
              <StatusBadge
                variant={
                  STATUS_TONE[(order.status ?? "") as keyof typeof STATUS_TONE] ??
                  UNKNOWN_STATUS_TONE
                }
                size="sm"
                className="shrink-0"
              >
                {statusLabel(order.status ?? "")}
              </StatusBadge>
            </div>

            {/* Progress tracker */}
            <StatusSteps status={order.status ?? ""} />

            {/* Amount row */}
            <div className="flex items-center justify-between pt-3 border-t border-border/20">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {order.created_at && (
                  <span title={formatDate(order.created_at)}>
                    {formatRelativeTime(order.created_at)}
                  </span>
                )}
              </div>
              <div className="text-right">
                {originalAmount && (
                  <div className="text-2xs text-muted-foreground line-through tabular-nums">
                    {formatCurrency(originalAmount)}
                  </div>
                )}
                <div className="font-bold text-xl tabular-nums text-primary">
                  {formatCurrency(order.amount ?? 0)}
                </div>
              </div>
            </div>

            {/* Coupon badge */}
            {couponCode && discountAmount && (
              <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border/15 text-xs text-status-success">
                <Tag className="w-3 h-3 shrink-0" />
                <span>
                  كوبون{" "}
                  <span dir="ltr" className="font-mono font-bold">
                    {couponCode}
                  </span>
                </span>
                <span className="mr-auto font-bold bg-status-success/10 border border-status-success/22 px-2 py-0.5 rounded-full">
                  وفّرت {formatCurrency(discountAmount)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Delivery credentials ────────────────────────────────── */}
        {hasDelivery ? (
          <div className="bg-card border border-status-success/22 rounded-2xl overflow-hidden float-in stagger-1">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-status-success/15 bg-status-success/5">
              <div className="w-7 h-7 rounded-lg bg-status-success/12 border border-status-success/22 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-status-success" />
              </div>
              <div>
                <div className="font-bold text-sm">بيانات الحساب</div>
                <div className="text-3xs text-muted-foreground">انسخ بياناتك بأمان</div>
              </div>
            </div>
            <div className="divide-y divide-border/15">
              {order.delivered_email && (
                <CopyField label="البريد الإلكتروني" value={order.delivered_email} />
              )}
              {order.delivered_password && (
                <CopyField label="كلمة المرور" value={order.delivered_password} secret />
              )}
              {order.delivered_extra_details && (
                /* 96-F4 (R96 A6 #7): free-text delivery details carry mixed-
                   direction runs (activation links / PIN codes inside Arabic
                   sentences) — dir="auto" + start alignment let the bidi
                   algorithm pick the base direction from the first strong
                   character instead of scrambling the visual order. */
                <div
                  dir="auto"
                  className="px-5 py-3.5 text-sm text-muted-foreground leading-relaxed text-start"
                >
                  {order.delivered_extra_details}
                </div>
              )}
            </div>
            {order.delivered_usage_terms && (
              <div className="mx-5 mb-5 flex gap-2.5 text-sm bg-status-warning/8 border border-status-warning/22 rounded-xl p-3.5">
                <Info className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
                <span className="text-status-warning leading-relaxed">
                  {order.delivered_usage_terms}
                </span>
              </div>
            )}
          </div>
        ) : (
          order.status !== "failed" &&
          order.status !== "refunded" && (
            <div className="bg-card border border-border/50 rounded-2xl p-7 text-center float-in stagger-1">
              <div className="w-12 h-12 rounded-2xl bg-muted/50 border border-border/35 mx-auto mb-3 flex items-center justify-center">
                <Clock className="w-5 h-5 text-muted-foreground pulse-dot" />
              </div>
              <p className="font-bold text-sm mb-1">قيد الإعداد</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
                سيتم تسليم بيانات الحساب فور اكتمال الطلب — عادةً خلال 5 إلى 15 دقيقة. ستصلك إشعار
                عند الجاهزية.
              </p>
            </div>
          )
        )}

        {/* ── Failed / Refunded ──────────────────────────────────── */}
        {(order.status === "failed" || order.status === "refunded") && (
          /* R115-I1 (A8 P2-3a): the refund branch gets a CALM info tone +
             the AMOUNT — RefundService credits the full orders.amount
             back to the wallet (terminal-state guarded, credited once),
             so the figure is available on the order itself. The old
             error-red card said «تم إعادة المبلغ…» while showing NO
             amount — an unreceipted money movement. */
          <div
            className={`bg-card border rounded-2xl p-6 text-center float-in stagger-1 ${
              order.status === "refunded" ? "border-status-info/22" : "border-status-error/22"
            }`}
          >
            <div
              className={`w-12 h-12 rounded-2xl border mx-auto mb-3 flex items-center justify-center ${
                order.status === "refunded"
                  ? "bg-status-info/8 border-status-info/22"
                  : "bg-status-error/8 border-status-error/22"
              }`}
            >
              {order.status === "refunded" ? (
                <Undo2 className="w-5 h-5 text-status-info" />
              ) : (
                <XCircle className="w-5 h-5 text-status-error" />
              )}
            </div>
            <p
              className={`font-bold text-sm mb-1 ${
                order.status === "refunded" ? "text-status-info" : "text-status-error"
              }`}
            >
              {order.status === "refunded" ? "تم الاسترداد" : "فشل الطلب"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed tabular-nums">
              {order.status === "refunded"
                ? `استُرد ${formatCurrency(order.amount ?? 0)} إلى محفظتك تلقائياً`
                : "يرجى التواصل مع الدعم الفني إن احتجت مساعدة"}
            </p>
            {order.status === "refunded" && (
              /* R115-I1 (A8 P2-3a, honest tail): the refund ALSO reverses
                 the purchase-award points for this order (refund.service
                 reclaims them, clamped at zero). The old copy said
                 nothing — points silently vanished from /loyalty with no
                 explanation on any page; this line closes that promise
                 gap («خُصمت نقاط الشراء المستردة»). */
              <p className="text-2xs text-muted-foreground/75 leading-relaxed mt-1 mb-4">
                كما خُصمت نقاط الشراء المستردة — نقاط هذا الطلب من رصيد نقاطك.
              </p>
            )}
            {order.status === "failed" && <div className="mb-4" />}
            {/*
              Promote the support link inside the failure card itself
              when the order failed. Failed/refunded is exactly the
              moment the user is most likely to need help, and burying
              the support link as a subtle text link at the very
              bottom of the page (below all other cards) means many
              users miss it.
            */}
            {order.status === "failed" && (
              <Link href={`/support?ref=${encodeURIComponent(order.order_code ?? "")}`}>
                <Button className="gap-1.5 rounded-xl h-10 px-5 bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 font-bold">
                  <ExternalLink className="w-3.5 h-3.5" />
                  تواصل مع الدعم
                </Button>
              </Link>
            )}
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 float-in stagger-2">
          <Link href="/">
            <Button className="w-full bg-primary hover:bg-primary/90 font-bold shadow-md shadow-primary/22 gap-1.5 rounded-xl">
              <Sparkles className="w-4 h-4" />
              تصفح المزيد
            </Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => navigate("/orders")}
            className="gap-1.5 rounded-xl"
          >
            <ShoppingCart className="w-4 h-4" />
            كل طلباتي
          </Button>
        </div>

        {/* Support */}
        <div className="text-center py-1 pb-2">
          <Link href="/support">
            <button className="text-xs text-muted-foreground hover:text-primary/80 transition-colors inline-flex items-center gap-1.5 press-spring">
              <ExternalLink className="w-3 h-3" />
              مشكلة في هذا الطلب؟ تواصل مع الدعم
            </button>
          </Link>
        </div>
      </div>

      <div className="h-4 md:h-0" />
    </div>
  );
}
