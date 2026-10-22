import { RefreshCw, ShoppingBag, WifiOff, Zap } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { getErrorMessage, NETWORK_ERROR_DESCRIPTION } from "@/lib/errors";
import { formatCurrency, formatDate, statusLabel } from "@/lib/utils";
import type { AdminOrder } from "@workspace/api-client-react";

// R137 (FE admin decomposition): the recent-orders stream card moved
// verbatim from pages/admin/dashboard.tsx — the useListAdminOrders query,
// its error/loading values and the refetch mutation stay in the page; the
// rows, the error detail and the retry callback flow down as values.

export function RecentOrdersStream({
  showChartsColumn,
  orders,
  loading,
  error,
  errorDetail,
  onRetry,
  scopeBlocked = false,
}: {
  showChartsColumn: boolean;
  orders: AdminOrder[];
  loading: boolean;
  error: boolean;
  errorDetail: unknown;
  onRetry: () => void;
  /** R182 (Lane-B defect 2): true when the admin lacks the orders scope —
   * the query never fires, so the honest surface is the scope-note banner
   * (the KPI tiles' !canSeeMoney idiom), NOT the outage error card. */
  scopeBlocked?: boolean;
}) {
  return (
    /* Recent orders stream */
    <div
      className={`${showChartsColumn ? "xl:col-span-2" : "xl:col-span-5"} bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col`}
    >
      {/* R139 (precision): the stream's sticky mini-header retires the
          LAST glass surface in the dashboard — bg-card/80 +
          supports-[backdrop-filter]:bg-card/60 + backdrop-blur-md →
          solid bg-card (r138's "glass retired everywhere" rule). Rows
          scrolling under the header now hide instead of blurring
          through it; the divider drops to border-border/60 to match
          the card frame's resting edge (the inner row rhythm below
          keeps its /40). Sticky/z-10 geometry untouched. */}
      <div className="sticky top-0 z-10 px-4 py-3.5 border-b border-border/60 flex items-center justify-between bg-card">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-primary" />
          <h2 className="font-bold text-sm">آخر الطلبات</h2>
        </div>
        <Link href="/admin/orders">
          <span className="text-xs text-muted-foreground hover:text-primary-text transition-colors cursor-pointer">
            عرض الكل
          </span>
        </Link>
      </div>
      <div className="flex-1 divide-y divide-border/40 overflow-y-auto">
        {scopeBlocked ? (
          /* R182 (Lane-B defect 2): orders-less scope — the stream is
             hidden for the account's scope, not "failed" and not
             "empty". Same sentence shape + warning token pair as the
             KPI tiles' !canSeeMoney note (dashboard.tsx). */
          <p className="m-3 text-sm text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2">
            آخر الطلبات تتطلب صلاحية الطلبات — تواصل مع مسؤول النظام
          </p>
        ) : loading ? (
          /* Skeleton rows — the "no orders yet" empty state used to
             flash before the first fetch resolved. */
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-muted skeleton-shimmer shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-muted skeleton-shimmer rounded w-2/5" />
                  <div className="h-2.5 bg-muted skeleton-shimmer rounded w-1/4" />
                </div>
                <div className="h-4 bg-muted skeleton-shimmer rounded w-14" />
              </div>
            ))}
          </div>
        ) : error ? (
          /* R122 (A2-P1): a failed load (403 for an orders-less
             scope, or a 5xx outage) is NOT "no orders" — the false
             «لا توجد طلبات بعد» empty state rendered while the
             same screen's stats showed real order counts. Same
             triad discipline as the page's chart section and every
             admin list page: error card + retry. getErrorMessage
             surfaces the backend's Arabic 403 body («ليست لديك
             صلاحية…») when that's what failed. */
          <div
            role="alert"
            className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
              <WifiOff className="w-6 h-6 text-status-error" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground/80">تعذّر تحميل الطلبات</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {getErrorMessage(errorDetail) || NETWORK_ERROR_DESCRIPTION}
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onRetry}>
              <RefreshCw className="w-3 h-3" />
              إعادة المحاولة
            </Button>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <ShoppingBag className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-sm">لا توجد طلبات بعد</p>
          </div>
        ) : (
          orders.slice(0, 8).map((order) => (
            <div
              key={order.id}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-xs truncate">{order.product_name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono text-3xs text-muted-foreground">
                    {displayUserName(
                      userFromRow(order as unknown as Parameters<typeof userFromRow>[0]),
                    )}
                  </span>
                  {order.created_at && (
                    <span className="text-3xs text-muted-foreground">
                      {formatDate(order.created_at)}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-start">
                {/* R125-I2 (A6-B6): raw --primary on a dark card is
                    3.76:1 — under the 4.5:1 text floor (dark is the
                    admin default). --primary-text (348 80% 65%) is
                    the text-safe variant (5.75:1 dark / 5.30 light —
                    button.tsx:35-37 documents raw text-primary as
                    surface-only). */}
                <div className="font-bold text-xs text-primary-text tabular-nums">
                  {formatCurrency(order.amount)}
                </div>
                <div className="mt-0.5">
                  {/* R116: shared StatusBadge (STATUS_TONE) replaces
                      the deprecated statusColor() — 93-C7 follow-up. */}
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
