import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Compact status pill used across the storefront — order status,
 * stock state, popularity flag, low-stock warning, generic info.
 *
 * Replaces ~7 hand-rolled variants that previously hard-coded
 * `bg-emerald-500/15 text-emerald-300 border-emerald-500/25` style
 * tuples in ProductCard / orders / order-detail / wallet pages.
 *
 * Each variant maps to a `--status-*` CSS variable, so light + dark
 * themes get tonally-correct colors automatically. The size scale
 * matches the dominant in-place sizes (xs = 10px legend chip, sm =
 * 11px row badge).
 */
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1 font-bold whitespace-nowrap rounded-full border transition-colors",
  {
    variants: {
      variant: {
        success: "bg-status-success/12 text-status-success border-status-success/28",
        warning: "bg-status-warning/12 text-status-warning border-status-warning/30",
        error: "bg-status-error/12 text-status-error border-status-error/28",
        info: "bg-status-info/12 text-status-info border-status-info/28",
        "low-stock": "bg-status-low-stock/12 text-status-low-stock border-status-low-stock/28",
        neutral: "bg-muted/45 text-muted-foreground border-border/50",
        primary: "bg-primary/12 text-primary-text border-primary/28",
        // 93-C7 / C-UX2 (A12 §11.1): the --status-purple token has
        // existed since round-92 (NotificationBell TYPE_CONFIG) but the
        // badge variant was never added — purple-tinted statuses had to
        // fall back to hand-rolled raw-hue pills.
        purple: "bg-status-purple/12 text-status-purple border-status-purple/28",
      },
      size: {
        xs: "text-[10px] px-1.5 py-0.5 [&_svg]:w-2.5 [&_svg]:h-2.5",
        sm: "text-[11px] px-2 py-0.5 [&_svg]:w-3 [&_svg]:h-3",
        md: "text-xs px-2.5 py-1 [&_svg]:w-3.5 [&_svg]:h-3.5",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "sm",
    },
  },
);

export type StatusBadgeVariant = NonNullable<VariantProps<typeof statusBadgeVariants>["variant"]>;

/**
 * 93-C7 / C-UX2 (A12 §11.1): canonical semantic-status → tone mapper.
 *
 * Single source of truth for "which StatusBadge variant does status X
 * get" — replaces the ~18 per-page raw-hue maps (A12 census B1-B18)
 * and the string-concat `statusColor()` shape. Pages render:
 *
 *   <StatusBadge variant={STATUS_TONE[s]} size="sm">
 *     {statusLabel(s)}
 *   </StatusBadge>
 *
 * Labels come from `statusLabel()` (lib/utils.ts) so a status can
 * never show two different Arabic words on two pages. Statuses that
 * are domain levels (risk low/medium/high, whatsapp session phases…)
 * rather than canonical semantic statuses keep a LOCAL
 * Record<Domain, StatusBadgeVariant> — tone from this file's variant
 * union, never raw Tailwind hues.
 */
export type SemanticStatus =
  | "pending"
  | "processing"
  | "completed"
  | "delivered"
  | "failed"
  | "refunded"
  | "approved"
  | "rejected"
  | "open"
  | "in_progress"
  | "closed"
  | "credited"
  | "active"
  | "expired"
  | "scheduled"
  | "archived"
  | "inactive"
  | "ready"
  | "qr_ready"
  | "connecting"
  | "disconnected"
  | "new"
  | "reviewing"
  | "resolved"
  | "confirmed_fraud"
  | "false_positive"
  | "escalated";

export const STATUS_TONE: Record<SemanticStatus, StatusBadgeVariant> = {
  pending: "warning",
  qr_ready: "warning",
  connecting: "warning",
  in_progress: "warning",
  scheduled: "warning",
  new: "info",
  reviewing: "info",
  processing: "info",
  open: "info",
  refunded: "info",
  expired: "warning",
  completed: "success",
  delivered: "success",
  approved: "success",
  credited: "success",
  active: "success",
  ready: "success",
  resolved: "success",
  false_positive: "success",
  failed: "error",
  rejected: "error",
  confirmed_fraud: "error",
  disconnected: "error",
  escalated: "warning",
  closed: "neutral",
  archived: "neutral",
  inactive: "neutral",
  // fallback below — exported so callers can mirror the shim behavior.
};

/** Neutral fallback for unknown statuses (mirrors the old statusColor default). */
export const UNKNOWN_STATUS_TONE: StatusBadgeVariant = "neutral";

/**
 * 93-C7 / C-UX2 (A12 §11.1 B1+B2): the shared ticket-status list.
 *
 * admin/tickets.tsx and storefront support.tsx previously carried two
 * duplicate hand-rolled maps for the same three statuses (different
 * colors, different sizes). Admin now derives from STATUS_TONE +
 * statusLabel; support.tsx (storefront owner) is a documented
 * follow-up to consume this export.
 */
export const TICKET_STATUSES = ["open", "in_progress", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusBadgeVariants> {
  icon?: LucideIcon;
}

export function StatusBadge({
  className,
  variant,
  size,
  icon: Icon,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ variant, size }), className)} {...props}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export { statusBadgeVariants };
