interface TableSkeletonProps {
  /** Number of body rows to render (default: 6). */
  rows?: number;
  /**
   * Per-cell tailwind class snippets. Each entry describes one cell's
   * shape and width — e.g. `"w-28"`, `"flex-1 w-24"`, `"rounded-full w-14"`.
   * Array length defines the column count.
   */
  cells: string[];
  /** Alternate-row tinting (default: true). */
  zebra?: boolean;
}

/**
 * Canonical table loading skeleton for admin pages. Replaces the
 * hand-rolled TableSkeleton blocks in orders/users/referrals/coupons
 * — they all shared the same outer shell (rounded-2xl card + h-11
 * header strip + bordered rows) and varied only in the per-row cell
 * shapes.
 *
 * NOT used by topups.tsx — its skeleton is card-shaped (stacked
 * payment cards), a different layout entirely.
 */
export function TableSkeleton({
  rows = 6,
  cells,
  zebra = true,
}: TableSkeletonProps) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      <div className="border-b border-border/60 bg-muted/30 h-11" />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center gap-4 px-4 py-3 border-b border-border/30 ${
            zebra && i % 2 !== 0 ? "bg-muted/5" : ""
          }`}
        >
          {cells.map((cls, j) => (
            <div
              key={j}
              className={`h-4 bg-muted skeleton-shimmer rounded ${cls}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
