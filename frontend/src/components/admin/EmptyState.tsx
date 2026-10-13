import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

interface EmptyStateProps {
  /**
   * Lucide icon component. Rendered at `w-5 h-5 opacity-35` inside
   * a `w-12 h-12 rounded-2xl bg-muted/60 border-border/35` well tile —
   * the r139 icon-stage register (the storefront EmptyState family,
   * the canonical admin pattern).
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
 *
 * R139 (precision): the tile/title/description/action micro-proportions
 * align with the storefront EmptyState's r138-h register so both sides
 * of the app share ONE empty-state vocabulary — the well tile
 * (bg-muted/60 + border-border/35), the /35 icon ghost, the
 * text-foreground/85 title ink, the leading-relaxed max-w-xs hint and
 * the mt-5 action breathing room. The page-scale pad stays py-16 (the
 * ADMIN density dialect — FetchErrorCard's admin "page" scale rides the
 * same value; the storefront's py-12 is its own density, not part of
 * this alignment). Six r139 domain agents consume this primitive —
 * their surfaces inherit the register automatically.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    // R125 (A6 B-8): role="status" — the loading→empty swap was silent
    // to screen readers (4.1.3). Pure addition, no visual change.
    <div
      role="status"
      className={`text-center py-16 text-muted-foreground bg-card border border-border/60 rounded-2xl ${className ?? ""}`}
    >
      {/* R139 (precision): bg-muted → bg-muted/60 + border-border/35 —
          the muted-well family (ProductCard's image shelf, the compact
          storefront tile): emptiness reads as a deliberate stage. */}
      <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto mb-3 flex items-center justify-center">
        {/* R139 (precision): opacity-30 → /35 — the storefront tile's
            ghost value (one icon-ghost register). */}
        <Icon className="w-5 h-5 opacity-35" />
      </div>
      {/* R139 (precision): + text-foreground/85 — the shared register's
          title ink (plain muted-foreground inherited before; the empty
          headline is the block's ONE prominent line). */}
      <p className="font-bold text-sm text-foreground/85 mb-1">{title}</p>
      {/* R139 (precision): + leading-relaxed max-w-xs mx-auto — the
          register's hint shape (long Arabic hints wrap readably instead
          of running the full card width). */}
      {description && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-xs mx-auto">
          {description}
        </p>
      )}
      {/* R139 (precision): mt-2 → mt-5 — the exit CTA gets its own
          breathing room below the hint (the r138-h decision; a
          caption-tight 8px read as a continuation of the hint line). */}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
