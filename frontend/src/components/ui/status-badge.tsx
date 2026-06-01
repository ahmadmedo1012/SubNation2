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
        success:
          "bg-status-success/12 text-status-success border-status-success/28",
        warning:
          "bg-status-warning/12 text-status-warning border-status-warning/30",
        error: "bg-status-error/12 text-status-error border-status-error/28",
        info: "bg-status-info/12 text-status-info border-status-info/28",
        "low-stock":
          "bg-status-low-stock/12 text-status-low-stock border-status-low-stock/28",
        neutral:
          "bg-muted/45 text-muted-foreground border-border/50",
        primary:
          "bg-primary/12 text-primary-text border-primary/28",
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
