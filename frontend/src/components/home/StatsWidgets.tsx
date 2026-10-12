import { formatCount, formatCurrency } from "@/lib/utils";
import type { CatalogStats } from "@workspace/api-client-react";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the catalog-stats secondary widgets (R111-F1 G2): the guest hero's
// desktop side column + the standalone mobile strip. Both ride the same
// skeleton-while-pending / content-when-loaded / DELIBERATE hide-on-
// error contract (decorative secondary data — the catalog grid below
// carries the page's honest error + retry). The page owns the
// useGetCatalogStats query; these extracts take stats + statsPending
// as props. The mobile strip's !token gate stays in the page (pure
// guests see the strip; a failed /me probe renders the guest hero
// without it). DOM, classes and the count-aware labels are
// byte-identical.

/**
 * The guest hero's desktop-only stats column (≥sm). Folded here with
 * its full tri-state: stats → the inline figure rows; statsPending →
 * chip-shaped skeletons (no pop-in CLS); error → null (documented
 * deliberate degrade — see the query in pages/home.tsx).
 */
export function HeroStatsColumn({
  stats,
  statsPending,
}: {
  stats: CatalogStats | undefined;
  statsPending: boolean;
}) {
  return stats ? (
    /* R125-I7 (A7 B-12 / R124-A3 #14): the side column was
       three big-number/small-label accent CHIPS (the
       craft-floor REFUSE "hero-metric template") — the
       same figures now render as plain inline figure rows
       (value + count-aware label, no chip chrome), the
       inline form the mobile strip below already had. */
    <div className="hidden sm:flex flex-col gap-2.5 shrink-0">
      {[
        {
          // R94-A1 #11 (P3): count-aware Arabic labels
          // («منتجان متاحان / منتجات متاحة / منتجاً متاحاً»)
          // instead of a frozen singular after every count.
          label: formatCount(stats.available_products, {
            one: "منتج متاح",
            two: "منتجان متاحان",
            few: "منتجات متاحة",
            many: "منتجاً متاحاً",
            other: "منتج متاح",
          }),
          value: stats.available_products,
          color: "text-status-success",
        },
        {
          label: "أقل سعر",
          value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—",
          color: "text-primary-text",
        },
        {
          label: formatCount(stats.total_units, {
            one: "وحدة بالمخزون",
            two: "وحدتان بالمخزون",
            few: "وحدات بالمخزون",
            many: "وحدة بالمخزون",
            other: "وحدة بالمخزون",
          }),
          value: stats.total_units,
          color: "text-status-info",
        },
      ].map((s) => (
        <div key={s.label} className="flex items-baseline justify-end gap-1.5">
          <span className={`font-bold text-xl leading-none tabular-nums ${s.color}`}>
            {s.value}
          </span>
          <span className="text-2xs text-muted-foreground">{s.label}</span>
        </div>
      ))}
    </div>
  ) : statsPending ? (
    <div className="hidden sm:flex flex-col gap-2.5 shrink-0" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-end gap-1.5">
          <div className="h-6 w-14 skeleton-shimmer rounded" />
          <div className="h-3 w-24 skeleton-shimmer rounded" />
        </div>
      ))}
    </div>
  ) : null;
}

/**
 * The guest mobile stats strip (<sm) — identical geometry and tri-state
 * to the desktop column above (R111-F1 G2). Rendered by the page under
 * the !token gate, a sibling of the guest hero.
 */
export function MobileStatsStrip({
  stats,
  statsPending,
}: {
  stats: CatalogStats | undefined;
  statsPending: boolean;
}) {
  return stats ? (
    <div className="sm:hidden grid grid-cols-3 gap-1.5 mb-3 sm:mb-5">
      {[
        {
          label: formatCount(stats.available_products, {
            one: "منتج",
            two: "منتجان",
            few: "منتجات",
            many: "منتجاً",
            other: "منتج",
          }),
          value: stats.available_products,
          color: "text-status-success",
        },
        {
          label: "أقل سعر",
          value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—",
          color: "text-primary-text",
        },
        { label: "بالمخزون", value: stats.total_units, color: "text-status-info" },
      ].map((s) => (
        <div
          key={s.label}
          className="bg-card border border-border/45 rounded-2xl p-2 sm:p-3 text-center"
        >
          <div
            className={`font-bold text-sm sm:text-base leading-none mb-0.5 tabular-nums ${s.color}`}
          >
            {s.value}
          </div>
          <div className="text-3xs text-muted-foreground">{s.label}</div>
        </div>
      ))}
    </div>
  ) : statsPending ? (
    <div className="sm:hidden grid grid-cols-3 gap-1.5 mb-3 sm:mb-5" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="bg-card border border-border/45 rounded-2xl p-2 sm:p-3 text-center"
        >
          <div className="h-5 w-10 mx-auto skeleton-shimmer rounded mb-1" />
          <div className="h-2.5 w-14 mx-auto skeleton-shimmer rounded" />
        </div>
      ))}
    </div>
  ) : null;
}
