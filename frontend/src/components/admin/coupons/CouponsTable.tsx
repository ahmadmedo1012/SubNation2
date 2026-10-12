import {
  AlertCircle,
  CheckCircle,
  Clock,
  Infinity as InfinityIcon,
  Percent,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Trash2,
  XCircle,
} from "lucide-react";
// 93-C7 / C-UX2 (A12 §11.1): status pills ride the canonical
// StatusBadge + --status-* tokens instead of raw emerald/yellow hues.
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { type Coupon } from "@/components/admin/coupons/coupons-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/coupons.tsx —
// the money-discount table: the md header row, the responsive rows (code /
// value / min order / usage / expiry / canonical StatusBadge / toggle +
// archive actions) and the honest count footer. The toggle PATCH and the
// confirm-gated archive DELETE stay in the page — this shell takes the
// rows + the per-row busy ids down and reports taps through
// onToggle/onDelete (page-owned handlers); the isExpired/isMaxed/
// effectivelyActive derivations are row-local and ride along verbatim.
// The move only changes its address; DOM, classes, aria and Arabic copy
// are byte-identical.

export function CouponsTable({
  coupons,
  activeCount,
  toggling,
  archiving,
  onToggle,
  onDelete,
}: {
  coupons: Coupon[];
  activeCount: number;
  toggling: number | null;
  archiving: number | null;
  onToggle: (coupon: Coupon) => void;
  /** R125-I3 (A2-16): the soft-archive DELETE — confirm-gated in the page. */
  onDelete: (coupon: Coupon) => void;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="hidden md:grid grid-cols-[1fr_90px_80px_70px_110px_80px_90px] gap-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-bold text-muted-foreground">
        <span>الكوبون</span>
        <span>الخصم</span>
        <span>الحد الأدنى</span>
        <span>الاستخدام</span>
        <span>الانتهاء</span>
        <span>الحالة</span>
        <span>إجراءات</span>
      </div>

      <div className="divide-y divide-border/30">
        {coupons.map((coupon, i) => {
          const isExpired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
          const isMaxed = coupon.max_uses !== null && coupon.used_count >= coupon.max_uses;
          const effectivelyActive = coupon.is_active && !isExpired && !isMaxed;
          return (
            <div
              key={coupon.id}
              className={`flex flex-col md:grid md:grid-cols-[1fr_90px_80px_70px_110px_80px_90px] gap-2 md:gap-4 items-start md:items-center px-4 py-3 hover:bg-muted/20 transition-colors ${i % 2 !== 0 ? "bg-muted/5" : ""}`}
            >
              {/* Code + description */}
              <div>
                <div className="font-mono font-bold text-sm tracking-wider text-foreground">
                  {coupon.code}
                </div>
                {coupon.description && (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[180px]">
                    {coupon.description}
                  </div>
                )}
              </div>

              {/* Value */}
              <div>
                {/* R125-I3 (A2-17): the header row is hidden below
                    md — a bare stacked "5.00 د.ل" cell was
                    indistinguishable from الحد الأدنى. Each cell
                    gains a text-3xs field label visible ONLY on
                    the mobile flex-col layout. */}
                <span className="md:hidden text-3xs font-bold text-muted-foreground/85 block mb-0.5">
                  الخصم
                </span>
                <div className="flex items-center gap-1 font-bold text-primary text-sm">
                  {coupon.type === "percentage" ? (
                    <>
                      <Percent className="w-3 h-3" />
                      {coupon.value}%
                    </>
                  ) : (
                    <>
                      {/* 93-C7 / C-UX5 (A5 C-3): formatCurrency instead
                     of the raw `{value} د.ل` — fixed-value coupons
                     now read "5.00 د.ل" like every other money
                     surface in the app. */}
                      <>{formatCurrency(coupon.value)}</>
                    </>
                  )}
                </div>
              </div>

              {/* Min order */}
              <div className="text-xs text-muted-foreground tabular-nums">
                <span className="md:hidden text-3xs font-bold text-muted-foreground/85 block mb-0.5">
                  الحد الأدنى
                </span>
                {coupon.min_order_amount > 0 ? formatCurrency(coupon.min_order_amount) : "—"}
              </div>

              {/* Usage */}
              <div className="text-xs tabular-nums font-bold">
                <span className="md:hidden text-3xs font-bold text-muted-foreground/85 block mb-0.5">
                  الاستخدام
                </span>
                <span className="text-foreground">{coupon.used_count}</span>
                {coupon.max_uses !== null && (
                  <span className="text-muted-foreground">/{coupon.max_uses}</span>
                )}
                {coupon.max_uses === null && (
                  <InfinityIcon className="w-3 h-3 text-muted-foreground inline mr-1" />
                )}
              </div>

              {/* Expiry */}
              <div className="text-xs text-muted-foreground">
                <span className="md:hidden text-3xs font-bold text-muted-foreground/85 block mb-0.5">
                  الانتهاء
                </span>
                {coupon.expires_at ? (
                  <span className={isExpired ? "text-destructive" : ""}>
                    {formatDate(coupon.expires_at)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <InfinityIcon className="w-3 h-3" /> بلا حد
                  </span>
                )}
              </div>

              {/* Status — 93-C7 / C-UX2 (A12 B8): canonical
                  StatusBadge (success/warning/neutral tones on
                  the --status-* tokens) replaces the four
                  raw-hue pills. */}
              <div>
                <span className="md:hidden text-3xs font-bold text-muted-foreground/85 block mb-0.5">
                  الحالة
                </span>
                {effectivelyActive ? (
                  <StatusBadge variant="success" icon={CheckCircle}>
                    نشط
                  </StatusBadge>
                ) : isExpired ? (
                  <StatusBadge variant="warning" icon={Clock}>
                    منتهي
                  </StatusBadge>
                ) : isMaxed ? (
                  <StatusBadge variant="warning" icon={AlertCircle}>
                    استُنفد
                  </StatusBadge>
                ) : (
                  <StatusBadge variant="neutral" icon={XCircle}>
                    معطل
                  </StatusBadge>
                )}
              </div>

              {/* Actions */}
              <div>
                <span className="md:hidden text-3xs font-bold text-muted-foreground/85 block mb-0.5">
                  إجراءات
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onToggle(coupon)}
                    disabled={toggling === coupon.id}
                    title={coupon.is_active ? "تعطيل" : "تفعيل"}
                    aria-label={
                      coupon.is_active
                        ? `تعطيل الكوبون ${coupon.code}`
                        : `تفعيل الكوبون ${coupon.code}`
                    }
                    aria-pressed={coupon.is_active}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {toggling === coupon.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : coupon.is_active ? (
                      <ToggleRight className="w-4 h-4 text-status-success" />
                    ) : (
                      <ToggleLeft className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => onDelete(coupon)}
                    /* R125-I3 (A2-16): «أرشفة» — the DELETE is a
                       soft archive (isActive:false), not a hard
                       delete; the old «حذف» label over-promised
                       destruction the API never performs. */
                    disabled={archiving === coupon.id}
                    title="أرشفة"
                    aria-label={`أرشفة الكوبون ${coupon.code}`}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                  >
                    {archiving === coupon.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 border-t border-border/40 bg-muted/10 text-xs text-muted-foreground">
        {coupons.length} كوبون · {activeCount} نشط
      </div>
    </div>
  );
}
