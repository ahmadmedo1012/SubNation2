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
 *
 * R138 (visual) audit: the compact shape already carries the round's
 * shelf language — the icon's bg-muted/60 well is the SAME family
 * ProductCard's image plane adopted this round, and the card chrome
 * rests at border-border/60 with the round's card family. Proportions
 * verified internally consistent (mb-3 under the w-12 tile = mb-5
 * under EmptyHero's w-20 — one 0.25 stage ratio across the family);
 * the single re-tune is the action row's breathing room (mt-4 → mt-5).
 * ambient-wash deliberately NOT applied: every consumer renders this
 * inside a page layout (grep: orders/cart/notifications/support —
 * in-card list empties), never full-bleed; atmosphere belongs to the
 * surfaces that own the whole viewport (not-found does), not a small
 * inline empty.
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
      {/* R138 (visual): the bg-muted/60 well is the shelf family
          ProductCard's image plane adopted this round — emptiness reads
          as a deliberate stage, not an absence. Decorative tile —
          aria-hidden keeps the svg out of the live region's
          announcement; the title below carries the meaning. */}
      <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto mb-3 flex items-center justify-center">
        <Icon className="w-5 h-5 opacity-35" aria-hidden="true" />
      </div>
      <p className="font-bold text-sm text-foreground/85 mb-1">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
          {description}
        </p>
      )}
      {/* R138 (visual): mt-4 → mt-5 — the exit CTA gets its own act
          of breathing room below the description block (EmptyHero
          gives its CTA mb-7 for the same reason); a caption-tight 16px
          read as a continuation of the hint line, not the way forward. */}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

interface EmptyHeroProps {
  /**
   * Lucide icon component. Optional — renders the hero tile
   * (`w-9 h-9 opacity-25` inside a `w-20 h-20` rounded tile with the
   * `bg-primary/6 blur-xl` glow behind it) only when passed; every
   * first-run hero in the family carries one.
   */
  icon?: LucideIcon;
  title: string;
  /**
   * Optional second line, `text-sm text-muted-foreground mb-7` — the
   * mb-7 is part of the family's rhythm (it holds whether or not an
   * action follows; notifications ships without a CTA and keeps it).
   */
  description?: ReactNode;
  /**
   * Optional CTA below the description, rendered BARE (no wrapper div)
   * — the family's CTAs sit flush under the mb-7 description, so an
   * extra wrapper would change the DOM the adopted sites render.
   * Caller-owned, like EmptyState's action slot.
   */
  action?: ReactNode;
  /**
   * Extra classes appended to the outer card (entrance animations /
   * spacing overrides). Same sparing-use rule as EmptyState.
   */
  className?: string;
}

/**
 * R136 (UX-1): the first-run hero variant — the FIRST exclusion
 * EmptyState's own docblock lists ("page-level zero-data heroes … a
 * bigger, first-run moment"). That family was hand-rolled four times
 * (orders «لا توجد طلبات بعد», notifications «لا توجد إشعارات», cart
 * «سلتك فارغة», flash-sales) with byte-identical geometry: py-20
 * padding, the w-20 glow tile (bg-primary/6 blur-xl behind a
 * bg-muted/70 bordered tile, w-9 icon at opacity-25), text-lg title at
 * text-foreground/80, text-sm description at mb-7. This is that shape
 * as a component — geometry verbatim from the four sites, so each
 * adoption is a pure swap.
 *
 * Like EmptyState: role="status" is net-new at adoption (the family
 * was silent — the loading→empty swap now announces, R125 A6-B8), the
 * icon is decorative (aria-hidden; the title carries the meaning), and
 * the RTL story is text-center + mx-auto (direction-agnostic). The
 * compact EmptyState stays the default for in-card empties; this is
 * ONLY the page-level "you have nothing yet" moment.
 *
 * R138 (visual): two alphas re-tuned onto the empty family's own
 * values — the card edge /50 → /60 (the compact twin + the round's
 * card chrome — ProductCard, FetchErrorCard — all rest at /60; the
 * lone /50 was pre-R135 hand-rolled drift) and the tile fill
 * bg-muted/70 → bg-muted/60 (ONE well family with the compact tile
 * and ProductCard's image shelf). Geometry (py-20, the w-20 glow
 * tile, w-9/opacity-25 icon, mb-7 rhythm) is untouched — pinned by
 * skeleton-primitives.test.tsx. ambient-wash NOT applied: this is a
 * page-level CARD, not a full-bleed surface — its atmosphere is the
 * bg-primary/6 blur-xl glow behind the tile (the family's own).
 */
export function EmptyHero({ icon: Icon, title, description, action, className }: EmptyHeroProps) {
  return (
    <div
      role="status"
      // R138 (visual): /50 → /60 — the empty family's card edge. The
      // compact twin, ProductCard and the shared error card all rest
      // at /60 this round; the hand-rolled /50 was the lone outlier.
      className={`text-center py-20 text-muted-foreground bg-card border border-border/60 rounded-2xl reveal-up ${className ?? ""}`}
    >
      {Icon && (
        /* Decorative glow tile — aria-hidden on the svg keeps the live
           region's announcement to the title (the EmptyState decision). */
        <div className="relative w-20 h-20 mx-auto mb-5">
          <div className="absolute inset-0 rounded-2xl bg-primary/6 blur-xl" />
          {/* R138 (visual): /70 → /60 — one well family with the compact
              twin's tile and ProductCard's image shelf. */}
          <div className="relative w-20 h-20 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center">
            <Icon className="w-9 h-9 opacity-25" aria-hidden="true" />
          </div>
        </div>
      )}
      <p className="font-bold text-lg mb-1.5 text-foreground/80">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mb-7 max-w-xs mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
