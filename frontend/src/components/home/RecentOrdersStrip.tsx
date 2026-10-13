import { OrderStatusIcon } from "@/components/home/primitives";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { formatCurrency, statusLabel } from "@/lib/utils";
import type { Order } from "@workspace/api-client-react";
import { ChevronLeft, Clock, Package, WifiOff } from "lucide-react";
import { Link } from "wouter";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the authenticated «آخر الطلبات» strip with its R111-F1 G3 tri-state
// (4-row mini-skeleton while pending / honest compact error row with
// retry on failure / the plain empty when there are no orders). The
// page owns the useListOrders query and the latestOrders slice; this
// extract takes the query's status + rows + refetch as props. DOM,
// classes, aria and the retry's min-h-11 tap-floor geometry are
// byte-identical.

export function RecentOrdersStrip({
  pending,
  error,
  orders,
  refetch,
}: {
  pending: boolean;
  error: boolean;
  orders: Order[];
  refetch: () => void;
}) {
  return pending ? (
    <div
      aria-hidden="true"
      className="bg-card border border-border/45 rounded-2xl overflow-hidden shadow-sm"
    >
      {/* R140 central: the band separator joins the /20 hairline family. */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/20">
        <div className="w-3.5 h-3.5 rounded-full skeleton-shimmer" />
        <div className="h-3 w-20 skeleton-shimmer rounded" />
      </div>
      {/* R140 central: skeleton rows join the receipt-rhythm /20 grade. */}
      <div className="divide-y divide-border/20">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
            <div className="w-8 h-8 rounded-xl bg-muted/50 skeleton-shimmer shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 skeleton-shimmer rounded w-1/3" />
              <div className="h-2.5 skeleton-shimmer rounded w-1/4" />
            </div>
            <div className="h-3 w-12 skeleton-shimmer rounded" />
          </div>
        ))}
      </div>
    </div>
  ) : error ? (
    <div className="bg-card border border-status-error/18 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 float-in">
      <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
        <WifiOff className="w-4 h-4 text-status-error/60 shrink-0" />
        تعذّر تحميل آخر الطلبات
      </div>
      {/* B13 F-2 (R127): the strip's retry measured ~34px
          (text-xs + py-1.5 + border) — the last inline recovery
          control under the 44px floor its page-level siblings
          got in the R124/R125 sweeps. min-h-11 + -my-2 (the
          recent-searches «مسح» idiom, :1037) reaches the floor;
          the −16px of margins keep the row's footprint at 28px
          (vs the old 34px), so the 44px box bleeds into the
          strip's py-3 padding instead of growing the strip. */}
      <button
        onClick={() => refetch()}
        className="text-xs font-bold text-primary-text border border-primary/25 px-3.5 min-h-11 -my-2 rounded-lg hover:bg-primary/8 transition-colors press-spring shrink-0"
      >
        إعادة المحاولة
      </button>
    </div>
  ) : (
    orders.length > 0 && (
      <div className="bg-card border border-border/45 rounded-2xl overflow-hidden float-in stagger-1 shadow-sm">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/20">
          {/* R140 central: the loaded band separator joins the /20 hairline family. */}
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            آخر الطلبات
          </div>
          <Link
            href="/orders"
            className="flex items-center gap-0.5 text-xs text-primary-text hover:text-primary-text/75 font-bold transition-colors press-spring"
          >
            {/* R120-B1 (A4-F1): Link wears the button classes
                directly — was a Button nested inside a Link
                (nested interactive elements, doubled tab stop).
                R122 (A1-P1): comment reworded — the nesting
                sweep's regex now matches lowercase button markup
                too, and the old literal quoted the defect shape. */}
            عرض الكل
            <ChevronLeft className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
        {/* R140 central: the loaded rows join the receipt-rhythm /20 grade. */}
        <div className="divide-y divide-border/20">
          {orders.map((order) => (
            <Link key={order.id} href={`/orders/${order.order_code}`}>
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/15 active:bg-muted/25 transition-colors cursor-pointer group min-h-[52px]">
                <div className="w-8 h-8 rounded-xl bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden border border-border/25">
                  {order.product_image_url ? (
                    <img
                      src={order.product_image_url}
                      alt={order.product_name}
                      loading="lazy"
                      decoding="async"
                      /* R-140-a (image discipline): width/height mirror
                         the catalog art's measured 450×450 intrinsic
                         (all 45 /products/*.webp, the R132 L4-F9
                         census re-probed this round) — the fixed w-8
                         h-8 well already pins CLS at zero; the attrs
                         keep the aspect-ratio reserve honest pre-CSS. */
                      width={450}
                      height={450}
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate group-hover:text-primary-text transition-colors duration-150">
                    {order.product_name}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <OrderStatusIcon status={order.status} />
                    {/* R116-S1: shared StatusBadge (STATUS_TONE)
                        replaces the deprecated statusColor()
                        string-slicing — same tokens, same pill
                        shape as the rest of the app. */}
                    <StatusBadge
                      variant={
                        STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE
                      }
                      size="xs"
                    >
                      {statusLabel(order.status)}
                    </StatusBadge>
                  </div>
                </div>
                <div className="text-xs font-bold tabular-nums shrink-0">
                  {formatCurrency(order.amount)}
                </div>
                <ChevronLeft className="w-3 h-3 text-muted-foreground group-hover:text-primary-text transition-colors shrink-0" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    )
  );
}
