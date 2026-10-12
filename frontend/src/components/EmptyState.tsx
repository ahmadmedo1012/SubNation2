import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

interface EmptyStateProps {
  /**
   * Lucide icon component. Rendered at `w-5 h-5 opacity-35` inside a
   * `w-12 h-12` rounded muted tile — the compact-tile idiom orders.tsx
   * already converged on (R120-B7 filter-bucket empties), which this
   * component promotes to the storefront-wide default.
   */
  icon: LucideIcon;
  title: string;
  /**
   * Optional second line, `text-xs text-muted-foreground` directly below
   * the title. ReactNode (93-C7 / C-UX6, same call as the admin variant):
   * some storefront hints embed inline-LTR `<code>` fragments.
   */
  description?: ReactNode;
  /**
   * Optional CTA row below the description (Button, asChild-Link or a
   * native button — caller-owned, so adoption never rewrites an Arabic
   * label or a CTA target).
   */
  action?: ReactNode;
  /**
   * Extra classes appended to the outer card (entrance animations like
   * `reveal-up`/`float-in`, page-level spacing overrides). Use sparingly
   * — the point of this component is consistency, not flexibility.
   */
  className?: string;
}

/**
 * Canonical STOREFRONT empty-state (R135 FE-2). The admin console has
 * had one since A6 #6 (components/admin/EmptyState.tsx) while the
 * storefront's ~92 hand-rolled blocks drifted — py-10~20 paddings,
 * w-12~20 icon tiles, /70~/85 title inks and text-sm~lg weights per
 * page. This is the customer-side twin: same prop contract, storefront
 * card idiom (bg-card, border-border/60, rounded-2xl, compact w-12
 * tile, title at text-foreground/85 — the orders.tsx ink, the most
 * recent convergence of the shape).
 *
 * Adoption rule (quality over coverage — a wrong consolidation is worse
 * than a skipped one): ONLY icon+title(+description)(+action) blocks
 * that stand on their own card. Deliberately NOT used for:
 *   • page-level zero-data heroes (orders/notifications' py-20 + w-20
 *     glow illustration + text-lg title — a bigger, first-run moment);
 *   • empties embedded INSIDE an existing card section (loyalty/
 *     referrals ledgers) — this component carries its own card surface,
 *     nesting would double-border;
 *   • icon-less minimal variants (category) and composite multi-CTA
 *     recovery surfaces (home's filtered grid + R132 category-escape
 *     panel).
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    // R135 (FE-2): role="status" — the loading→empty swap announces to
    // screen readers (WCAG 4.1.3), the same decision the admin variant
    // made in R125 (A6 B-8). Every hand-rolled block this replaces was
    // silent, so each adoption is an a11y win on top of the visual
    // convergence. RTL-safe by construction: text-center + mx-auto are
    // direction-agnostic (no physical left/right assumptions).
    <div
      role="status"
      className={`text-center py-12 text-muted-foreground bg-card border border-border/60 rounded-2xl ${className ?? ""}`}
    >
      {/* Decorative tile — aria-hidden keeps the svg out of the live
          region's announcement; the title below carries the meaning. */}
      <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto mb-3 flex items-center justify-center">
        <Icon className="w-5 h-5 opacity-35" aria-hidden="true" />
      </div>
      <p className="font-bold text-sm text-foreground/85 mb-1">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
