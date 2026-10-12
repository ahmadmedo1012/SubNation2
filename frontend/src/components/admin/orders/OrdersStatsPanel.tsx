import {
  BadgePercent,
  BarChart2,
  ChevronDown,
  ChevronUp,
  Tag,
  Ticket,
  TrendingUp,
} from "lucide-react";
import { formatCount, formatCurrency } from "@/lib/utils";
import { ORDER_COUNT_FORMS } from "@/components/admin/orders/orders-meta";
import type { TopCoupon } from "@/components/admin/orders/orders-types";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the
// collapsible orders-and-coupons stats panel. Every aggregate
// (couponCount / totalDiscounts / totalRevenueAll / topCoupons /
// uniqueCouponCount / knownTotal) is a page-owned useMemo value flowing
// DOWN; the showStats STATE and its toggle stay in the page
// (onToggleStats). The move only changes the address; DOM, classes and
// the collapse semantics are byte-identical.

export function OrdersStatsPanel({
  showStats,
  onToggleStats,
  couponCount,
  totalDiscounts,
  totalRevenueAll,
  allOrdersCount,
  topCoupons,
  uniqueCouponCount,
  knownTotal,
}: {
  showStats: boolean;
  onToggleStats: () => void;
  couponCount: number;
  totalDiscounts: number;
  totalRevenueAll: number;
  allOrdersCount: number;
  topCoupons: TopCoupon[];
  uniqueCouponCount: number;
  knownTotal: boolean;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden float-in stagger-1">
      <button
        onClick={onToggleStats}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-bold">
          <BarChart2 className="w-4 h-4 text-primary" />
          إحصائيات الطلبات والكوبونات
        </div>
        <div className="flex items-center gap-3">
          {!showStats && (
            <span className="text-xs text-muted-foreground font-normal">
              {couponCount} طلب بكوبون · خصم {formatCurrency(totalDiscounts)}
            </span>
          )}
          {showStats ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {showStats && (
        <div className="border-t border-border/50 p-4 space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Total revenue */}
            <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
              <div className="flex items-center gap-1.5 text-2xs text-muted-foreground mb-1.5">
                <TrendingUp className="w-3 h-3" />
                إجمالي الإيرادات
              </div>
              <div className="font-bold text-base tabular-nums text-primary-text">
                {formatCurrency(totalRevenueAll)}
              </div>
              <div className="text-3xs text-muted-foreground mt-0.5">
                {formatCount(allOrdersCount, ORDER_COUNT_FORMS)}
              </div>
            </div>

            {/* Total discounts */}
            <div className="bg-status-success/5 rounded-2xl p-3 border border-status-success/15">
              <div className="flex items-center gap-1.5 text-2xs text-status-success mb-1.5">
                <BadgePercent className="w-3 h-3" />
                إجمالي الخصومات
              </div>
              <div className="font-bold text-base tabular-nums text-status-success">
                {formatCurrency(totalDiscounts)}
              </div>
              <div className="text-3xs text-muted-foreground mt-0.5">
                {totalRevenueAll + totalDiscounts > 0
                  ? `${(((totalDiscounts || 0) / ((totalRevenueAll || 0) + (totalDiscounts || 0))) * 100).toFixed(1)}% من المبيعات`
                  : "—"}
              </div>
            </div>

            {/* Orders with coupons */}
            <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
              <div className="flex items-center gap-1.5 text-2xs text-muted-foreground mb-1.5">
                <Ticket className="w-3 h-3" />
                طلبات بكوبون
              </div>
              <div className="font-bold text-base tabular-nums">{couponCount}</div>
              <div className="text-3xs text-muted-foreground mt-0.5">
                {allOrdersCount > 0
                  ? `${(((couponCount || 0) / allOrdersCount) * 100).toFixed(0)}% من الكل`
                  : "—"}
              </div>
            </div>

            {/* Unique coupons */}
            <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
              <div className="flex items-center gap-1.5 text-2xs text-muted-foreground mb-1.5">
                <Tag className="w-3 h-3" />
                كوبونات مستخدمة
              </div>
              <div className="font-bold text-base tabular-nums">{uniqueCouponCount}</div>
              <div className="text-3xs text-muted-foreground mt-0.5">كود فريد</div>
            </div>
          </div>

          {/* Top coupons table */}
          {topCoupons.length > 0 && (
            <div>
              <p className="text-2xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
                <Tag className="w-3 h-3" />
                أكثر الكوبونات استخداماً
              </p>
              <div className="space-y-1.5">
                {topCoupons.map((c, i) => {
                  const maxUses = topCoupons[0].uses;
                  const barWidth = maxUses > 0 ? (c.uses / maxUses) * 100 : 0;
                  return (
                    <div key={c.code} className="flex items-center gap-3 group">
                      <span className="text-3xs font-bold text-muted-foreground w-4 shrink-0 text-center">
                        {i + 1}
                      </span>
                      <span className="font-mono font-bold text-xs text-status-success bg-status-success/10 border border-status-success/20 px-2 py-0.5 rounded-md shrink-0 min-w-[80px] text-center">
                        {c.code}
                      </span>
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-status-success/80 rounded-full transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold tabular-nums shrink-0">{c.uses}×</span>
                      </div>
                      <span className="text-xs font-bold text-status-success tabular-nums shrink-0 hidden sm:block">
                        -{formatCurrency(c.totalDiscount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {topCoupons.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              لم يُستخدم أي كوبون بعد
            </p>
          )}

          {/* 94-C2 (A2 P1-1): these aggregates are computed
              from the LOADED rows (accumulated pages); once the
              list is capped, say so instead of letting "إجمالي
              الإيرادات" silently describe a slice. The dashboard
              KPI reads /admin/stats — the server-side truth. */}
          {!knownTotal && (
            <p className="text-3xs text-muted-foreground pt-1 border-t border-border/30 mt-1">
              الإحصاءات تعكس الطلبات المعروضة ({formatCount(allOrdersCount, ORDER_COUNT_FORMS)}) —
              الإجماليات الكاملة في لوحة التحكم
            </p>
          )}
        </div>
      )}
    </div>
  );
}
