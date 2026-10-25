import { AlertTriangle, Info, Package, ShieldAlert, Tag, Wifi, Zap } from "lucide-react";
import type { AlertType } from "@/components/admin/alerts/alerts-inbox-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/alerts.tsx —
// the row-type map. It lives in its own .tsx meta module (the
// system-meta.tsx precedent) because its values carry lucide icon
// COMPONENTS, so the React-free bar of alerts-inbox-meta.ts doesn't apply
// — the module is still hook-free and renders nothing. The page imports
// it for the delete-confirm's type label; the chips + grouped list
// extracts import it for the row icon/tone tuples. Byte-identical map;
// ZERO behavior change.
//
// R187E-F2: the map now covers the backend's FULL writer set — the
// 11-member AlertType union (jobs/alertLogger.ts) plus "risk"
// (risk-alerts.service.ts inserts it directly). The five types that
// used to fall through to the generic «نظام» info chip carry their own
// honest severity + label, mirroring layout.tsx's ALERT_LABELS so the
// inbox chip and the live toast name one concept one way. Key order is
// the chip bar's render order (AlertsTypeChips derives from
// Object.keys(TYPE_META)); system stays LAST as before.
export const TYPE_META: Record<
  AlertType,
  { icon: React.ElementType; color: string; bg: string; border: string; label: string }
> = {
  no_stock: {
    icon: AlertTriangle,
    color: "text-status-error",
    bg: "bg-status-error/10",
    border: "border-status-error/20",
    label: "نفاد المخزون",
  },
  low_stock: {
    icon: Package,
    // R126-L5 (A3 item-10 / mandate 7): the low_stock cluster rides the
    // --status-warning ink+tint pair — yellow-400 passes the dark theme
    // (8.79:1 on the /10 tint) but fails the shipped light theme at
    // 1.43:1 (A3's measured figures); --status-warning is AA both themes
    // (6.04:1 on white / 5.09:1 on the /12 tint light, index.css F3-06).
    color: "text-status-warning",
    bg: "bg-status-warning/10",
    border: "border-status-warning/20",
    label: "مخزون منخفض",
  },
  forecast_stockout: {
    icon: AlertTriangle,
    color: "text-status-low-stock",
    bg: "bg-status-low-stock/10",
    border: "border-status-low-stock/20",
    label: "نفاد متوقع",
  },
  inventory_corrupt: {
    icon: AlertTriangle,
    color: "text-status-error",
    bg: "bg-status-error/10",
    border: "border-status-error/20",
    label: "بيانات مخزون غير متسقة",
  },
  coupon_maxed: {
    icon: Tag,
    color: "text-status-warning",
    bg: "bg-status-warning/10",
    border: "border-status-warning/20",
    label: "كوبون استُنفد",
  },
  coupon_expiring: {
    icon: Tag,
    color: "text-status-low-stock",
    bg: "bg-status-low-stock/10",
    border: "border-status-low-stock/20",
    label: "كوبون منتهٍ قريباً",
  },
  coupon_expired: {
    icon: Tag,
    color: "text-status-warning",
    bg: "bg-status-warning/10",
    border: "border-status-warning/20",
    label: "كوبون منتهي",
  },
  flash_sale_expired: {
    icon: Zap,
    color: "text-status-info",
    bg: "bg-status-info/10",
    border: "border-status-info/20",
    label: "عرض محدود منتهي",
  },
  refunded_live_credentials: {
    icon: AlertTriangle,
    color: "text-status-error",
    bg: "bg-status-error/10",
    border: "border-status-error/20",
    label: "بيانات وصول حيّة مُستردة",
  },
  whatsapp_channel: {
    icon: Wifi,
    color: "text-status-warning",
    bg: "bg-status-warning/10",
    border: "border-status-warning/20",
    label: "قناة واتساب",
  },
  risk: {
    // Not in layout.tsx's ALERT_LABELS (the toast falls back to «تنبيه»)
    // — the honest label for the risk service's direct inserts: its
    // rows are CRITICAL-score events (risk-alerts.service.ts).
    icon: ShieldAlert,
    color: "text-status-error",
    bg: "bg-status-error/10",
    border: "border-status-error/20",
    label: "مخاطرة حرجة",
  },
  system: {
    icon: Info,
    color: "text-status-info",
    bg: "bg-status-info/10",
    border: "border-status-info/20",
    label: "نظام",
  },
};
