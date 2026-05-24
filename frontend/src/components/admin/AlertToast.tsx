
export type AlertType = "coupon_maxed" | "coupon_expiring" | "low_stock" | "no_stock" | "system";

export const ALERT_TYPE_META: Record<AlertType, { label: string; color: string }> = {
  coupon_maxed: { label: "كوبون استُنفد", color: "text-amber-400" },
  coupon_expiring: { label: "كوبون منتهٍ", color: "text-orange-400" },
  low_stock: { label: "مخزون منخفض", color: "text-yellow-400" },
  no_stock: { label: "نفاد مخزون", color: "text-red-400" },
  system: { label: "إشعار نظام", color: "text-blue-400" },
};
