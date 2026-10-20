import { Button } from "@/components/ui/button";
// R167 (F12 — the order-detail extract family): wave 1 moved the
// StatusSteps tracker + the R165/R166 group chip; wave 2 (R167-A2)
// moved the delivery/credentials region (the receipt card + the
// decrypt-failure + prep fallbacks + RECEIPT_ROW) and the
// failed/refunded terminal card verbatim to components/orders/ — the
// three source-scan suites that owned their markup at the PAGE
// address now read the page ∪ family surface (semantics-depth /
// account-surfaces / contrast-hardening + storefront-r125).
import { OrderCredentialsCard } from "@/components/orders/OrderCredentialsCard";
import { OrderGroupChip } from "@/components/orders/OrderGroupChip";
import { OrderTerminalCard } from "@/components/orders/OrderTerminalCard";
import { StatusSteps } from "@/components/orders/StatusSteps";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/lib/auth";
import {
  copyToClipboard,
  formatCurrency,
  formatDate,
  formatRelativeTime,
  statusLabel,
} from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import {
  getGetMeQueryKey,
  getGetOrderQueryKey,
  useGetMe,
  useGetOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "@/hooks/useSocket";
import { useSeo } from "@/hooks/useSeo";
import { productArtUrl } from "@/lib/product-art";
import {
  ArrowRight,
  Clock,
  Copy,
  ExternalLink,
  Package,
  ShoppingCart,
  Sparkles,
  Tag,
  XCircle,
} from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";

export default function OrderDetailPage() {
  const { orderCode } = useParams<{ orderCode: string }>();
  // R146 (audit-frontend-pages F4): RouteAnnouncer announces SPA
  // navigations by reading document.title — this page set none, so a
  // orders→detail hop was silent for screen-reader users (the announcer
  // skips same-title navigations). notifications.tsx's shape; the
  // canonical rides the live order URL.
  const seoBlock = useSeo({
    title: "تفاصيل الطلب — SubNation",
    description:
      "تفاصيل طلبك في SubNation — الحالة، المبلغ، وبيانات الحساب المسلّمة بعد اكتمال الشراء.",
    path: `/orders/${orderCode ?? ""}`,
    robots: "noindex,follow",
  });
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
    // R122 (A11-F3): preserve the return path (order deep links are the
    // URLs support shares back over WhatsApp — the dominant channel);
    // the commerce flows' `?redirect=` idiom, honored by login.tsx. The
    // path is read INSIDE the effect (not from the useLocation
    // subscription) so the redirect itself can't re-fire the effect and
    // eat the order code (checkout.tsx:548 idiom, generalized).
    if (!token) {
      const { pathname, search } = window.location;
      navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
    }
  }, [token, navigate]);

  // R122 (A1-P2): guests get the order-shaped RouteSkeleton instead of a
  // bare null — checkout.tsx's R115-I1 guard (the white frame between
  // the lazy-skeleton swap-out and the redirect tick read as a blank
  // page on slow links). Same "order" shape ROUTE_SHAPES maps
  // /orders/:code to, so the swap-in is a content-fill, not a jump.
  if (!token) return <RouteSkeleton shape="order" />;

  if (isLoading)
    return (
      /* R136 (UX-1): per-block Skeletons — the section trio's heights
         differ (180/140/80px), so no uniform-row shape fits; each
         block's geometry rides className verbatim and each gains the
         role="status" + sr-only pair (the in-page loading swap was
         silent — the !token phase above already announces via
         RouteSkeleton's aria-label). */
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Skeleton className="h-4 w-24 rounded mb-6" />
        <div className="space-y-3">
          <Skeleton className="h-[180px] rounded-2xl border border-border/60" />
          <Skeleton className="h-[140px] rounded-2xl border border-border/60" />
          <Skeleton className="h-[80px] rounded-2xl border border-border/60" />
        </div>
      </div>
    );

  if (isError && !isNotFoundError)
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-status-error/8 border border-status-error/22 mx-auto mb-4 flex items-center justify-center">
          <XCircle className="w-7 h-7 text-status-error" />
        </div>
        {/* R-140-l (semantics): the connection-error view carries its
            own h1 — every rendered view of this route names itself
            (the family invariant: category.tsx's error branch and
            not-found.tsx ride h1; a view with no heading left screen
            readers inside an unnamed region after the routes' route
            announcement). Classes verbatim — the h1 merely picks up
            the family's h1–h4 1.3 Arabic-safe leading floor
            (index.css, the R128-A4 rule every heading rides). */}
        <h1 className="font-bold text-lg mb-1">تعذّر تحميل الطلب</h1>
        <p className="text-sm text-muted-foreground mb-5">
          حدث خطأ في الاتصال — تحقّق من اتصالك ثم أعد المحاولة. إن استمرت المشكلة تواصل مع الدعم.
        </p>
        <div className="flex items-center justify-center gap-2.5">
          {/* R125-I7 (A7 B-4): both recovery buttons ride the 44px tap
              floor (min-h-11; Button's default size is min-h-9 = 36px).
              The two-button row stays bespoke per the R124-I8 ledger. */}
          <Button
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderCode ?? "") })
            }
            className="gap-1.5 rounded-xl min-h-11"
          >
            <Clock className="w-4 h-4" />
            إعادة المحاولة
          </Button>
          <Button
            onClick={() => navigate("/orders")}
            variant="outline"
            className="gap-2 rounded-xl min-h-11"
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
        <div className="w-16 h-16 rounded-2xl bg-muted/60 border border-border/40 mx-auto mb-4 flex items-center justify-center">
          <Package className="w-7 h-7 text-muted-foreground" />
        </div>
        {/* R-140-l (semantics): same h1-once-per-view contract as the
            connection-error branch above — the unknown/foreign order
            code view names itself. */}
        <h1 className="font-bold text-lg mb-1">الطلب غير موجود</h1>
        <p className="text-sm text-muted-foreground mb-5">تأكد من رقم الطلب أو عُد لقائمة طلباتك</p>
        <Button
          onClick={() => navigate("/orders")}
          variant="outline"
          className="gap-2 rounded-xl min-h-11"
        >
          <ArrowRight className="w-4 h-4" />
          العودة للطلبات
        </Button>
      </div>
    );

  // R167 (F12, wave 2 — R167-A2): the delivery gates (hasDelivery +
  // decryptFailed) moved WITH the delivery/credentials region into
  // components/orders/OrderCredentialsCard — they read only the order
  // fields that region renders. The header card's derived amounts stay.
  const discountAmount = (order as { discount_amount?: number }).discount_amount;
  const couponCode = (order as { coupon_code?: string }).coupon_code;
  const originalAmount = discountAmount ? (order.amount ?? 0) + discountAmount : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-7 page-in">
      {seoBlock}
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
        {/* R139 (precision): the page's prominent card joins the r138
            two-layer calm elevation (the neutral black recipe — the old
            shadow-lg shadow-black/10 single drop read as a floating
            panel) + the /60 family resting edge. */}
        <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-calm float-in">
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
                  <div className="w-12 h-12 rounded-xl bg-muted/60 border border-border/40 overflow-hidden shrink-0">
                    <img
                      src={productArtUrl(
                        (order as { product_image_url?: string }).product_image_url,
                      )}
                      alt={order.product_name || "صورة المنتج"}
                      loading="lazy"
                      decoding="async"
                      /* R-140-a (image discipline): alt — the old
                         `?? ""` fallback could render an EMPTY alt on
                         a content image when a legacy order ships a
                         blank name; || gives it the honest «صورة
                         المنتج» floor instead. width/height mirror
                         the catalog art's measured 1024×1024 intrinsic
                         (all 45 /products/*.webp, the R132 L4-F9
                         census re-probed this round) — the fixed
                         w-12 h-12 well already pins CLS at zero. */
                      width={1024}
                      height={1024}
                      className="w-full h-full object-contain p-1.5"
                    />
                  </div>
                ) : (
                  /* R125-I7 (A7 B-6 class, computed): sibling of the cart
                     fallback — text-primary/45 measured 1.62:1 dark /
                     2.11:1 light on the old primary/8 tile; full
                     --muted-foreground: 7.69:1 / 5.90:1.
                     R139 (precision): the fallback tile joins the shelf
                     register too (muted/60 + /40 — the orders-list
                     letter tile). */
                  <div className="w-12 h-12 rounded-xl bg-muted/60 border border-border/40 flex items-center justify-center shrink-0">
                    <span className="text-xl font-bold text-muted-foreground select-none">
                      {(order.product_name ?? "؟")[0]}
                    </span>
                  </div>
                )}
                <div className="min-w-0">
                  {/* R128-A4 (F-3): leading-tight removed — the base h1–h4
                      1.3 Arabic-safe floor (index.css) owns the leading. */}
                  <h1 className="font-bold text-base mb-0.5 break-words">{order.product_name}</h1>
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
                    /* R124-I4 (A3 #8): hover tint on 12px text —
                        text-primary-text (raw text-primary hover is
                        3.76:1, sub-AA at this size). */
                    className="flex items-center gap-1 min-h-11 px-3 -my-3 text-muted-foreground hover:text-primary-text text-2xs font-mono transition-colors group/code"
                  >
                    <span>{order.order_code}</span>
                    {/* 96-F4 (R96 A6 #9 / A2 P2-10): the copy affordance is
                        ALWAYS faintly visible on touch (opacity-60 base —
                        hover doesn't exist on phones, so the old
                        opacity-0/group-hover reveal made the code look like
                        plain text); hover only strengthens it on md+. */}
                    <Copy className="w-2.5 h-2.5 opacity-60 md:group-hover/code:opacity-100 transition-opacity" />
                  </button>
                  {/* R167 (F12): the chip is a verbatim extract
                      (components/orders/OrderGroupChip) — the gate
                      stays with the order data it reads; the copy
                      honesty + RTL forward-arrow rationale moved
                      with the chip. */}
                  {order.order_group_id && <OrderGroupChip />}
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
                {/* R124-I4 (A5 #1) + R139 (precision): the money value
                    drops the brand tint for plain foreground — the r138
                    receipt-terminal decision (CartSummaryAside's own
                    «الإجمالي» row: weight 700 + the text-xl size step
                    carry the emphasis, never color; the old comment's
                    "checkout totals idiom" predates that round). */}
                <div className="font-bold text-xl tabular-nums text-foreground">
                  {formatCurrency(order.amount)}
                </div>
              </div>
            </div>

            {/* Coupon badge — R139 (precision): the coupon line's seam
                joins the /20 receipt hairline value; the «وفّرت» chip
                gains tabular-nums (money). The success ink stays — the
                discount-reads-positive exception (documented register). */}
            {couponCode && discountAmount && (
              <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border/20 text-xs text-status-success">
                <Tag className="w-3 h-3 shrink-0" />
                <span>
                  كوبون{" "}
                  <span dir="ltr" className="font-mono font-bold">
                    {couponCode}
                  </span>
                </span>
                <span className="mr-auto font-bold bg-status-success/10 border border-status-success/22 px-2 py-0.5 rounded-full tabular-nums">
                  وفّرت {formatCurrency(discountAmount)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Delivery credentials ────────────────────────────────── */}
        {/* R167 (F12, wave 2 — R167-A2): the delivery/credentials region
            — the receipt card, the decrypt-failure alert and the prep
            card, with their hasDelivery/decryptFailed gates — moved
            verbatim to components/orders/OrderCredentialsCard. */}
        <OrderCredentialsCard order={order} />

        {/* ── Failed / Refunded ──────────────────────────────────── */}
        {/* R167 (F12, wave 2 — R167-A2): the failed/refunded terminal
            card moved verbatim to components/orders/OrderTerminalCard —
            it returns null on every other status (the StatusSteps
            null-branch idiom). */}
        <OrderTerminalCard order={order} />

        {/* ── Actions ───────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 float-in stagger-2">
          {/* R120-B7 (reviewer finding — A4-F1 sweep completion): asChild
              composition — one anchor, one tab stop. */}
          <Button
            asChild
            /* R139 (precision): the page-primary pair canonicalizes —
               size="lg" (the R116-S1 recipe; the hand-rolled
               bg-primary/hover:bg-primary/90 + shadow-md
               shadow-primary/22 overrides die) and BOTH twins ride it
               so the 2-col grid stays height-matched; the outline twin
               keeps its variant. */
            size="lg"
            className="w-full font-bold gap-1.5"
          >
            <Link href="/">
              <Sparkles className="w-4 h-4" />
              تصفح المزيد
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/orders")}
            size="lg"
            className="w-full font-bold gap-1.5"
          >
            <ShoppingCart className="w-4 h-4" />
            كل طلباتي
          </Button>
        </div>

        {/* Support */}
        <div className="text-center py-1 pb-2">
          {/* R122 (A1-P1): the Link wears the text-CTA classes directly —
              was a native button nested inside a Link (invalid interactive
              nesting + a doubled tab stop), the exact A4-F1 class the
              R120-B7 sweep missed because its regex only matched the
              capitalized Button component. */}
          <Link
            href={`/support?ref=${encodeURIComponent(order.order_code ?? "")}`}
            /* R124-I4 (A5 #1): hover:text-primary/80 is sub-AA on the
                hover state — the text-safe twin. */
            className="text-xs text-muted-foreground hover:text-primary-text transition-colors inline-flex items-center gap-1.5 press-spring min-h-6"
          >
            <ExternalLink className="w-3 h-3" />
            مشكلة في هذا الطلب؟ تواصل مع الدعم
          </Link>
        </div>
      </div>

      <div className="h-4 md:h-0" />
    </div>
  );
}
