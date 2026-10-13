/**
 * R137 (2-b — the App.tsx route-registry decomposition): the A2 F4
 * (R124) pointer/focus route-chunk warm-up — the family table, the
 * pure pathname predicate and the delegated document listeners —
 * extracted VERBATIM from App.tsx. React-free and import-free module;
 * the module-scope gate keeps installing the listeners at entry-chunk
 * evaluation time (now when THIS module evaluates — still before React
 * renders), gated off under MODE === "test" exactly as before.
 * routeWarmupFamilyForPath is re-exported through App.tsx for the
 * route-chunk-warmup regression suite.
 */
// ── A2 F4 (R124): pointer/focus route-chunk warm-up ─────────────────────
//
// Every storefront navigation paid a cold chunk burst AT the tap: the
// product page alone pulls a 27-file fan-out (route chunk + its dep
// chunks — measured in the A2 report), all after the interaction, on a
// single-VPS origin with no CDN in front of it. Two delegated document
// listeners move that fetch one interaction-RTT earlier: when a pointer
// enters (or keyboard focus lands on) an in-app link, `import()` the
// target route's chunk using the SAME module specifier its
// lazyWithRetry route resolves against — the module map dedupes, so the
// subsequent navigation mount is zero-RTT (the head-start's leg (a)
// pattern, generalized beyond boot).
type RouteWarmupFamily = "product" | "category" | "cart" | "checkout" | "wallet";

const ROUTE_CHUNK_WARMUP: Readonly<
  Record<RouteWarmupFamily, readonly [RegExp, () => Promise<unknown>]>
> = {
  // The storefront's most-traveled link families (A2 F4): product cards,
  // category rails, cart, checkout, wallet.
  //
  // R140-c audit: the five families re-verified against
  // page-registry.ts — every specifier below is still a
  // lazyWithRetry route, so the module-map dedupe contract (the warm
  // import() and the lazy mount resolve against ONE module) holds.
  // Deliberately NOT warmed — each pinned null by
  // route-chunk-warmup.test.ts, the R124 anti-widening guard, so any
  // widening here is a product decision that must update that suite:
  // /flash-sales (Navbar + Footer + the per-page FlashSaleBanner —
  // the strongest future candidate, flagged for triage), /orders and
  // order detail (post-purchase receipts, RecentOrdersStrip links),
  // /notifications (the bell's view-all), login/register/support/
  // terms (non-money). New routes since R124 (notifications, status,
  // the admin risk/enrichment/whatsapp trio) are all non-money or
  // admin-guarded — none earned a family.
  product: [/^\/product\//, () => import("@/pages/product")],
  category: [/^\/category\//, () => import("@/pages/category")],
  cart: [/^\/cart/, () => import("@/pages/cart")],
  checkout: [/^\/checkout/, () => import("@/pages/checkout")],
  wallet: [/^\/wallet/, () => import("@/pages/wallet")],
};

const ROUTE_WARMUP_FAMILIES = Object.keys(ROUTE_CHUNK_WARMUP) as RouteWarmupFamily[];

/**
 * A2 F4 (R124): pure pathname → warm-up-family predicate. Exported for
 * the same export-for-test pattern as isHomeBootPath below (regression
 * suite: route-chunk-warmup.test.ts) so the warmed set can neither
 * silently widen (hover-eagering new chunks) nor silently narrow (losing
 * the measured navigation-latency win).
 */
export function routeWarmupFamilyForPath(pathname: string): RouteWarmupFamily | null {
  for (const family of ROUTE_WARMUP_FAMILIES) {
    if (ROUTE_CHUNK_WARMUP[family][0].test(pathname)) return family;
  }
  return null;
}

const warmedRouteChunks = new Set<RouteWarmupFamily>();

function warmRouteChunkForPath(pathname: string): void {
  const family = routeWarmupFamilyForPath(pathname);
  if (!family || warmedRouteChunks.has(family)) return;
  warmedRouteChunks.add(family);
  // Best-effort: a stale-chunk 404 right after a deploy is recovered
  // by lazyWithRetry when the route actually mounts.
  void ROUTE_CHUNK_WARMUP[family][1]().catch(() => {});
}

function installRouteWarmupListeners(): void {
  if (typeof document === "undefined") return;
  // A2 F4: respect data-saver sessions — speculative fetches are pure
  // waste there, so the whole mechanism stays off.
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;

  const warmFromEvent = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    // Skip absolute/protocol URLs, //hosts, fragments and empty hrefs —
    // only in-app path links are warmed.
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return;
    let pathname: string;
    try {
      pathname = new URL(href, window.location.origin).pathname;
    } catch {
      return;
    }
    const routerBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const normalized =
      routerBase && pathname.startsWith(`${routerBase}/`)
        ? pathname.slice(routerBase.length)
        : pathname;
    // Admin surfaces are behind a guard and pull 40-56 chunks per page —
    // warming them from storefront chrome on hover is waste, not speed.
    if (normalized === "/admin" || normalized.startsWith("/admin/")) return;
    warmRouteChunkForPath(normalized);
  };

  // pointerenter does NOT bubble — capture at the document level is the
  // only delegation point. Keyboard parity via focusin (bubbles).
  document.addEventListener("pointerenter", warmFromEvent, { capture: true });
  document.addEventListener("focusin", warmFromEvent);
}

// Same module-scope/test gate as the head-start above.
if (typeof window !== "undefined" && import.meta.env.MODE !== "test") {
  installRouteWarmupListeners();
}
