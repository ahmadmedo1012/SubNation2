/**
 * R137 (2-b — the App.tsx route-registry decomposition): the route →
 * skeleton-shape map + the route → robots-directive map, extracted
 * VERBATIM from App.tsx. Pure route-metadata tables — React-free (the
 * RouteSkeletonShape import is type-only), imported by app/routes.tsx
 * (RouteSuspenseFallback + the SEO fallback MetaTags) and re-exported
 * through App.tsx for the route-shapes regression suite.
 */
import type { RouteSkeletonShape } from "@/components/ui/route-skeleton";

/**
 * Route → RouteSkeleton shape map. Used by the Suspense fallback to
 * render a layout-matching skeleton instead of a spinner-in-the-middle
 * fallback. The skeleton fills the same vertical space the real route
 * is about to occupy, so the swap-in is a content-fill, not a layout
 * jump.
 *
 * Order matters: `/orders/:code` must come before `/orders` so the
 * prefix match picks the more specific entry. The list is consulted
 * in iteration order; first hit wins.
 */
const ROUTE_SHAPES: Array<[RegExp, RouteSkeletonShape]> = [
  [/^\/$/, "catalog"],
  [/^\/category\//, "catalog"],
  [/^\/product\//, "product"],
  [/^\/orders\/[^/]+/, "order"],
  [/^\/orders$/, "list"],
  // R123-E4b (P3-c): width/archetype corrections measured against the
  // real page roots — wallet is max-w-5xl (list-wide), referrals and
  // profile are max-w-2xl (list-narrow; the old default list shell is
  // max-w-3xl — a 128px width jump on every swap), and flash-sales has
  // NO filter row (the "grid" shell drops the catalog's filter bar the
  // flash page never renders).
  [/^\/wallet/, "list-wide"],
  [/^\/loyalty/, "detail"],
  [/^\/referrals/, "list-narrow"],
  // A9-F2 (R128-IMP-5): max-w-3xl stacked rows — the orders list shell.
  [/^\/notifications/, "list"],
  [/^\/support/, "list"],
  [/^\/profile/, "list-narrow"],
  [/^\/login/, "form"],
  [/^\/register/, "form"],
  // B6 P2-17a: previously unmapped → blank flash before the lazy
  // chunk swapped in. A full-height centered welcome card — the same
  // archetype as login/register.
  [/^\/onboarding/, "form"],
  [/^\/cart/, "list"],
  // B4 P1-5: checkout is a max-w-5xl two-column page (form column +
  // 360px summary aside). The old "form" mapping put a 448px narrow
  // skeleton in front of a 1024px layout — a ~576px width jump on the
  // money-critical page. Round 92 (C7): a dedicated "checkout" shell
  // now exists in route-skeleton (same max-w-5xl + grid geometry) —
  // wired here for a zero-jump skeleton→content transition.
  [/^\/checkout/, "checkout"],
  // R123-E4b (P3-c): the flash page is a filter-less card grid — see
  // the comment block at the wallet entry above.
  [/^\/flash-sales/, "grid"],
  // B6 P2-17a: long content page — its max-w-2xl root is matched
  // exactly by the "order" shell (header + strip + stacked rows).
  [/^\/terms/, "order"],
  // B6 P2-17c: must precede /^\/admin/ — the admin login is a small
  // centered form, not the admin table shell.
  [/^\/admin\/login/, "form"],
  [/^\/admin/, "admin"],
];

/**
 * Route → shape lookup (first match wins, list order above matters).
 * Exported for the ROUTE_SHAPES regression tests.
 */
export function shapeForRoute(path: string): RouteSkeletonShape {
  for (const [pattern, shape] of ROUTE_SHAPES) {
    if (pattern.test(path)) return shape;
  }
  return "blank";
}

/**
 * A7 (round-94): mirrors the robots.txt Disallow list served by
 * backend/src/routes/seo.ts. Routes that are auth flows, transactional
 * funnels, user-private pages, or admin surfaces must never be indexed
 * — the old fallback stamped index,follow on all of them. Kept in sync
 * with robots.txt by construction (same path families, same intent).
 * `follow` (not none) so crawlers keep walking the page's outbound
 * links instead of treating them as dangling.
 */
const NOINDEX_ROUTES: RegExp[] = [
  /^\/login$/,
  /^\/register$/,
  // /forgot-password — route retired (no <Route> mounts it); kept as belt (R166 F7).
  /^\/forgot-password$/,
  /^\/onboarding/,
  /^\/auth\//,
  /^\/cart/,
  /^\/checkout/,
  /^\/wallet/,
  /^\/orders/,
  /^\/loyalty/,
  /^\/referrals/,
  /^\/profile/,
  // A9-F2 (R128-IMP-5): user-private — mirrors the robots.txt user-private
  // family (needs the backend seo.ts Disallow row — see the R128-IMP-5
  // diff-report).
  /^\/notifications/,
  /^\/admin/,
  /^\/status/,
];

export function robotsForPath(path: string | undefined): string {
  const p = path ?? "/";
  if (NOINDEX_ROUTES.some((re) => re.test(p))) return "noindex,follow";
  return "index,follow";
}
