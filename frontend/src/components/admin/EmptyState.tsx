import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

interface EmptyStateProps {
  /**
   * Lucide icon component. Rendered at `w-5 h-5 opacity-30` inside
   * a `w-12 h-12` rounded muted square — the canonical admin pattern.
   */
  icon: LucideIcon;
  title: string;
  /**
   * Optional second line. Rendered in `text-xs text-muted-foreground`
   * directly below the title. ReactNode (93-C7 / C-UX6): some pages
   * embed inline-LTR `<code>` fragments in the hint.
   */
  description?: ReactNode;
  /**
   * Optional CTA below the description. Typically a Link/button to
   * either clear filters or create the first record.
   */
  action?: ReactNode;
  /**
   * Extra classes appended to the outer card. Use sparingly — the
   * point of this component is consistency, not flexibility.
   */
  className?: string;
}

/**
 * Canonical admin empty-state. Replaces hand-rolled blocks across
 * orders/topups/products/users/coupons/referrals so the visual
 * weight (icon size, font weight, padding, colours) stays uniform.
 *
 * NOT used in pages whose empty state is genuinely shaped differently
 * (e.g. admin/alerts has a larger floating icon, admin/promotions
 * uses a flat icon variant).
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    // R125 (A6 B-8): role="status" — the loading→empty swap was silent
    // to screen readers (4.1.3). Pure addition, no visual change.
    <div
      role="status"
      className={`text-center py-16 text-muted-foreground bg-card border border-border/60 rounded-2xl ${className ?? ""}`}
    >
      <div className="w-12 h-12 rounded-2xl bg-muted mx-auto mb-3 flex items-center justify-center">
        <Icon className="w-5 h-5 opacity-30" />
      </div>
      <p className="font-bold text-sm mb-1">{title}</p>
      {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
