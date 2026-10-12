import { cn } from "@/lib/utils";

/**
 * R136 (UX-1): the general-purpose loading-skeleton layer.
 *
 * Before this file the repo carried ~95 hand-rolled `skeleton-shimmer`
 * blocks across ~25 files with exactly two shared shapes — TableSkeleton
 * (9 admin tables) and RouteSkeleton (10 route fallbacks) — while every
 * other surface re-derived its block geometry AND its a11y pair by hand.
 * The pair (role="status" + sr-only «جارٍ التحميل…», the R125 A6-B8
 * decision TableSkeleton canonized) existed at only three hand-applied
 * sites (admin security/alerts/whatsapp); the storefront loading swaps
 * were silent. These three primitives are the missing general layer:
 *
 *   • Skeleton      — ONE block. Geometry (h/w/rounded/border/tint,
 *                    plus utility passthroughs like mb-6/shrink-0)
 *                    rides `className` verbatim from the swept site;
 *                    the shimmer utility and the live-region pair are
 *                    baked in and cannot leak away.
 *   • SkeletonText  — the lines stack (n rows, last row shorter — the
 *                    common list shape). With geometry overrides it
 *                    also absorbs the two families that share its
 *                    "announcing root + plain rows" DOM: uniform
 *                    card-row stacks and grid-of-tiles placeholders
 *                    (`lastShorter={false}` + the site's grid classes
 *                    on the root — one announcing wrapper, N plain
 *                    children, byte-equal visuals).
 *   • SkeletonCard  — the card-row shell: orders.tsx's
 *                    OrderCardSkeleton geometry MOVED VERBATIM (tile +
 *                    title line + chip pair per row), `count` rows
 *                    under one announcing root.
 *
 * `skeleton-shimmer` (index.css) is self-contained — it carries both
 * the muted base fill and the ::after sweep (direction-mirrored for
 * RTL since R128 A5-4), so there is no separate animate-* class to
 * pass; `bg-muted` at some sites is a redundant same-value tint that
 * rides along through className unchanged.
 *
 * The a11y pair is the point of the extraction: a hand-rolled block is
 * silent by default, so every adoption converts a silent loading→loaded
 * swap into an announced one — the same net win EmptyState's R135
 * adoption made for empty states (and the reason the pair is hardcoded
 * rather than a prop: a prop is a drift vector).
 *
 * Adoption rule (EmptyState's quality-over-coverage call — a wrong
 * consolidation is worse than a skipped one): convert only blocks whose
 * geometry moves verbatim into className. Deliberately NOT absorbed:
 *   • TableSkeleton / RouteSkeleton / ProductCardShell — specialized
 *     mirrors (table shells, whole-route layouts, the product card);
 *     they stay the canonical owners of their shapes.
 *   • children of an ALREADY-announcing wrapper (security.tsx's
 *     first-load tree): nested live regions double-announce and would
 *     break the getByRole("status") pins that guard the announcing
 *     wrapper.
 *   • deliberately aria-hidden subtrees (risk-event's page skeleton,
 *     system's sparkline Suspense slot) — hidden placeholders must not
 *     become live regions.
 *   • composite skeletons whose inner layout is page structure, not
 *     repeating geometry: cart's CartSkeleton rows, referrals'
 *     SkeletonRow, loyalty's ledger rows, dashboard's recent-orders
 *     rows, support's chat-bubble transcript, topups' TopupCardSkeleton
 *     (the card-shaped exception TableSkeleton's docblock already
 *     documents).
 *   • mixed-height stacks that fit no uniform-row shape render as
 *     per-block <Skeleton/>s instead (order-detail's 180/140/80px
 *     section trio, the account-tab form fields).
 */

/** The sr-only loading label — the dominant string at every site that
 *  had the pair (TableSkeleton, admin security/alerts/whatsapp), with
 *  the U+2026 ellipsis those sites render. */
const SR_LOADING_LABEL = "جارٍ التحميل…";

export interface SkeletonProps {
  /**
   * Geometry classes for the block — height/width/rounded/border/tint
   * and utility passthroughs, moved VERBATIM from the hand-rolled site
   * (twMerge resolves conflicts against the shimmer base, which carries
   * none of its own beyond the utility itself).
   */
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    // R136 (UX-1): role="status" + sr-only label — the R125 A6-B8 pair,
    // hardcoded (see the file docblock). The sr-only span is absolutely
    // positioned and clipped, so it never affects the block's geometry;
    // as the only child it can never join a space-y sibling chain.
    <div role="status" className={cn("skeleton-shimmer", className)}>
      <span className="sr-only">{SR_LOADING_LABEL}</span>
    </div>
  );
}

export interface SkeletonTextProps {
  /** Row count (default 3 — the common list length). */
  count?: number;
  /**
   * Row geometry, appended OVER the text-line defaults (`h-4 rounded`
   * full-width lines): twMerge resolves conflicts, so
   * "h-20 rounded-2xl border border-border/35" swaps height/radius
   * while the rows stay full-width lines. Tints (bg-muted) and utility
   * passthroughs ride along the same way.
   */
  className?: string;
  /**
   * Root classes — the site's exact wrapper (`space-y-2/2.5/3` stack or
   * the grid classes of a tile grid). NO default, deliberately: the
   * swept sites drifted on spacing, and a default space-y would fight
   * a caller's grid (tailwind-merge does not know display:grid makes
   * space-y margins wrong — it would keep both).
   */
  wrapperClassName?: string;
  /**
   * Shorten the last row to w-4/5 (default true — the text-stack
   * idiom: full lines with a shorter tail). Uniform card-row stacks
   * and grid-of-tiles placeholders pass false.
   */
  lastShorter?: boolean;
}

export function SkeletonText({
  count = 3,
  className,
  wrapperClassName,
  lastShorter = true,
}: SkeletonTextProps) {
  return (
    <div role="status" className={wrapperClassName}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "skeleton-shimmer h-4 rounded",
            i === count - 1 ? (lastShorter ? "w-4/5" : "w-full") : "w-full",
            className,
          )}
        />
      ))}
      {/* The sr-only label rides LAST, not first: a first-child span
          joins the wrapper's space-y sibling chain (`~` counts it) and
          would push the first row down by the gap. Trailing, it costs
          nothing — it is absolutely positioned out of flow. */}
      <span className="sr-only">{SR_LOADING_LABEL}</span>
    </div>
  );
}

export interface SkeletonCardProps {
  /** Card-row count (default 3). */
  count?: number;
  /**
   * Root classes — the stack wrapper around the rows (e.g. the site's
   * `space-y-2.5`). Same no-default rationale as SkeletonText.
   */
  wrapperClassName?: string;
  /**
   * Per-row appended classes, for sites that drifted off the orders
   * card geometry (border tone / padding) — conflicts resolve through
   * twMerge, extras ride along.
   */
  className?: string;
}

export function SkeletonCard({ count = 3, wrapperClassName, className }: SkeletonCardProps) {
  return (
    <div role="status" className={wrapperClassName}>
      {Array.from({ length: count }).map((_, i) => (
        // R125-I7 (A7 B-12 / R124-A3 #12, carried over from
        // orders.tsx's OrderCardSkeleton): the skeleton row rode a 2px
        // border-r accent stripe — the craft-floor cap for colored side
        // stripes is 1px (the plain border already provides the edge).
        // Geometry moved VERBATIM from the orders card skeleton.
        <div key={i} className={cn("bg-card border border-border rounded-xl p-4", className)}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-muted skeleton-shimmer shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-2/5" />
              <div className="flex gap-2">
                <div className="h-3 bg-muted skeleton-shimmer rounded w-24" />
                <div className="h-3 bg-muted skeleton-shimmer rounded w-20" />
              </div>
            </div>
            <div className="shrink-0 space-y-1.5 text-right">
              <div className="h-4 bg-muted skeleton-shimmer rounded w-16" />
              <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14" />
            </div>
          </div>
        </div>
      ))}
      {/* Trailing sr-only label — same space-y safety as SkeletonText. */}
      <span className="sr-only">{SR_LOADING_LABEL}</span>
    </div>
  );
}
