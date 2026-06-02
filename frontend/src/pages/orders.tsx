import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDateShort, statusColor, statusLabel } from "@/lib/utils";
import { getListOrdersQueryKey, useListOrders } from "@workspace/api-client-react";
import {
  CheckCircle,
  ChevronLeft,
  Clock,
  Layers,
  Package,
  ShoppingBag,
  Sparkles,
  Tag,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

type OrderFilter = "all" | "pending" | "completed" | "failed";

const STAGGER = [
  "",
  "stagger-1",
  "stagger-2",
  "stagger-3",
  "stagger-4",
  "stagger-5",
  "stagger-6",
  "stagger-7",
  "stagger-8",
  "stagger-9",
  "stagger-10",
  "stagger-11",
  "stagger-12",
];

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle className="w-3.5 h-3.5 text-status-success" />;
  if (status === "failed" || status === "refunded")
    return <XCircle className="w-3.5 h-3.5 text-status-error" />;
  return <Clock className="w-3.5 h-3.5 text-status-warning" />;
}

function statusLeftBorder(status: string): string {
  if (status === "completed") return "border-l-status-success/55";
  if (status === "failed" || status === "refunded") return "border-l-status-error/55";
  return "border-l-status-warning/45";
}

const FILTER_TONES: Record<
  "neutral" | "warning" | "success" | "error",
  { active: string; idle: string }
> = {
  neutral: {
    active: "bg-foreground text-background border-foreground shadow-sm shadow-black/20",
    idle: "bg-muted/40 border-border/55 text-muted-foreground hover:text-foreground hover:bg-muted/60",
  },
  warning: {
    active:
      "bg-status-warning/15 border-status-warning/45 text-status-warning shadow-sm shadow-status-warning/20",
    idle: "bg-card border-border/55 text-muted-foreground hover:text-status-warning hover:border-status-warning/35",
  },
  success: {
    active:
      "bg-status-success/15 border-status-success/45 text-status-success shadow-sm shadow-status-success/20",
    idle: "bg-card border-border/55 text-muted-foreground hover:text-status-success hover:border-status-success/35",
  },
  error: {
    active:
      "bg-status-error/15 border-status-error/45 text-status-error shadow-sm shadow-status-error/20",
    idle: "bg-card border-border/55 text-muted-foreground hover:text-status-error hover:border-status-error/35",
  },
};

function FilterChip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Clock;
  label: string;
  count: number;
  tone: "neutral" | "warning" | "success" | "error";
}) {
  const styles = FILTER_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 text-xs font-bold border px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 transition-all duration-150 press-spring ${
        active ? styles.active : styles.idle
      }`}
    >
      <Icon className="w-3 h-3" />
      <span>{label}</span>
      <span className={`tabular-nums font-black ${active ? "" : "opacity-60"}`}>{count}</span>
    </button>
  );
}

function OrderCardSkeleton() {
  return (
    <div className="bg-card border border-border border-l-2 border-l-border/30 rounded-xl p-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-muted skeleton-shimmer shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-2/5" />
          <div className="flex gap-2">
            <div className="h-3 bg-muted skeleton-shimmer rounded w-24" />
            <div className="h-3 bg-muted skeleton-shimmer rounded w-20" />
          </div>
        </div>
        <div className="shrink-0 space-y-1.5 text-right">
          <div className="h-4 bg-muted skeleton-shimmer rounded w-16" />
          <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14" />
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<OrderFilter>("all");

  const { data: orders = [], isLoading } = useListOrders({
    query: { enabled: !!token, queryKey: getListOrdersQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  if (!token) {
    navigate("/login");
    return null;
  }

  const pending = orders.filter((o) => o.status === "pending");
  const completed = orders.filter((o) => o.status === "completed");
  const failed = orders.filter((o) => o.status === "failed" || o.status === "refunded");

  // Apply the active filter chip. The "all" chip preserves the
  // existing default behaviour (every order, sorted by the API).
  const visibleOrders = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "pending") return pending;
    if (filter === "completed") return completed;
    return failed;
  }, [filter, orders, pending, completed, failed]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-7 page-in flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
            <ShoppingBag className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black leading-tight">طلباتي</h1>
            <p className="text-sm text-muted-foreground">سجل مشترياتك ومتابعة حالتها</p>
          </div>
        </div>
        {!isLoading && orders.length > 0 && (
          <div className="text-sm font-bold text-muted-foreground bg-card border border-border/60 px-3 py-1.5 rounded-full shadow-sm shrink-0">
            {orders.length} طلب
          </div>
        )}
      </div>

      {/* Filter chips. The "all" chip acts as a reset — only shown
          once there are at least two non-empty buckets, so a fresh
          user with one pending order doesn't see redundant filtering
          UI. Each tone-specific chip lights up when active using its
          status token; inactive chips are muted and unclickable when
          their bucket is empty. */}
      {!isLoading && orders.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap slide-up overflow-x-auto scrollbar-none">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            icon={Layers}
            label="الكل"
            count={orders.length}
            tone="neutral"
          />
          {pending.length > 0 && (
            <FilterChip
              active={filter === "pending"}
              onClick={() => setFilter("pending")}
              icon={Clock}
              label="قيد الانتظار"
              count={pending.length}
              tone="warning"
            />
          )}
          {completed.length > 0 && (
            <FilterChip
              active={filter === "completed"}
              onClick={() => setFilter("completed")}
              icon={CheckCircle}
              label="مكتمل"
              count={completed.length}
              tone="success"
            />
          )}
          {failed.length > 0 && (
            <FilterChip
              active={filter === "failed"}
              onClick={() => setFilter("failed")}
              icon={XCircle}
              label="فشل / مسترجع"
              count={failed.length}
              tone="error"
            />
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <OrderCardSkeleton key={i} />
          ))}
        </div>
      ) : /* Empty state */
      orders.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
          <div className="relative w-20 h-20 mx-auto mb-5">
            <div className="absolute inset-0 rounded-2xl bg-primary/6 blur-xl" />
            <div className="relative w-20 h-20 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center">
              <Package className="w-9 h-9 opacity-25" />
            </div>
          </div>
          <p className="font-black text-lg mb-1.5 text-foreground/80">لا توجد طلبات بعد</p>
          <p className="text-sm text-muted-foreground mb-7 max-w-xs mx-auto leading-relaxed">
            ابدأ بتصفح الكتالوج واشترِ أول اشتراك رقمي
          </p>
          <Link href="/">
            <Button className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold">
              <Sparkles className="w-4 h-4" />
              تصفح الكتالوج
            </Button>
          </Link>
        </div>
      ) : visibleOrders.length === 0 ? (
        // Filter is active but matched nothing. Distinct from the
        // "no orders at all" empty state above — here the user has
        // orders, just none in the chosen bucket. Surface a quick
        // way to drop the filter without forcing them to find the
        // "all" chip again.
        <div className="text-center py-12 text-muted-foreground bg-card border border-border/50 rounded-2xl reveal-up">
          <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto mb-3 flex items-center justify-center">
            <Package className="w-5 h-5 opacity-35" />
          </div>
          <p className="font-bold text-sm mb-3 text-foreground/85">لا توجد طلبات في هذه الفئة</p>
          <button
            onClick={() => setFilter("all")}
            className="text-xs font-bold text-primary-text hover:text-primary border border-primary/22 px-4 py-1.5 rounded-xl hover:bg-primary/8 transition-colors press-spring"
          >
            عرض كل الطلبات
          </button>
        </div>
      ) : (
        /* Orders list */
        <div className="space-y-2.5">
          {visibleOrders.map((order, i: number) => {
            const staggerClass = STAGGER[Math.min(i, 12)] ?? "";
            return (
              <Link key={order.id} href={`/orders/${order.order_code}`}>
                <div
                  className={`
                  float-in ${staggerClass}
                  bg-card border border-border/60 border-l-[3px] ${statusLeftBorder(order.status)}
                  rounded-xl p-4
                  hover:border-border hover:border-l-[3px] hover:shadow-xl hover:shadow-black/20 hover:-translate-y-0.5
                  transition-all duration-200 cursor-pointer group active:scale-[0.995] active:translate-y-0
                `}
                >
                  <div className="flex items-center gap-3.5">
                    {/* Product image */}
                    <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border/40 group-hover:border-border/70 transition-colors">
                      {order.product_image_url ? (
                        <img
                          src={order.product_image_url}
                          alt={order.product_name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain p-1.5 group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <span className="text-xl font-black text-primary/50 select-none">
                          {(order.product_name ?? "؟")[0]}
                        </span>
                      )}
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm leading-snug truncate group-hover:text-primary transition-colors duration-150">
                        {order.product_name}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="font-mono text-[11px] bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded border border-border/30">
                          {order.order_code}
                        </span>
                        {order.created_at && (
                          <span className="text-[11px] text-muted-foreground">
                            {formatDateShort(order.created_at)}
                          </span>
                        )}
                        {(order as { coupon_code?: string }).coupon_code && (
                          <span className="flex items-center gap-0.5 text-[10px] font-bold text-status-success bg-status-success/10 border border-status-success/22 px-1.5 py-0.5 rounded-full">
                            <Tag className="w-2.5 h-2.5" />
                            {(order as { coupon_code?: string }).coupon_code}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right side */}
                    <div className="flex items-center gap-2 shrink-0 max-w-[42%] sm:max-w-none">
                      <div className="text-right min-w-0">
                        {((order as { discount_amount?: number }).discount_amount ?? 0) > 0 && (
                          <div className="text-[10px] text-muted-foreground line-through tabular-nums">
                            {formatCurrency(
                              (order.amount ?? 0) +
                                ((order as { discount_amount?: number }).discount_amount ?? 0),
                            )}
                          </div>
                        )}
                        <div className="font-black text-sm tabular-nums">
                          {formatCurrency(order.amount)}
                        </div>
                        <div
                          className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border mt-1 justify-end whitespace-nowrap ${statusColor(order.status)}`}
                        >
                          <StatusIcon status={order.status} />
                          <span>{statusLabel(order.status)}</span>
                        </div>
                      </div>
                      <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-[-2px] transition-all duration-150 shrink-0" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
