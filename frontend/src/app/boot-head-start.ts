/**
 * R137 (2-b — the App.tsx route-registry decomposition): the 96-F3 boot
 * head-start (home-chunk warm-up + home-route-gated catalog prefetch +
 * R127-L10 card-image warming) and its R111-F4-F3 / R127-L10 pure
 * predicates, extracted VERBATIM from App.tsx. React-free module; the
 * module-scope gate keeps firing at entry-chunk evaluation time (now
 * when THIS module evaluates — still before React renders), gated off
 * under MODE === "test" exactly as before. bootCardImageWarmUrls and
 * isHomeBootPath are re-exported through App.tsx for their regression
 * suites.
 */
import { getListProductsQueryKey } from "@workspace/api-client-react";
import type { ProductListItem } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-config";
import { queryClient } from "@/app/query-client";
import { productArtUrl } from "@/lib/product-art";

// ── 96-F3 (R96 F-1 / mobile-performance-pwa §5): boot parallelization ──────
//
// App.tsx's AuthGate (the consumer of this module since the R137
// decomposition — there is no AuthGate in THIS file) blocks the ENTIRE
// route tree until the /api/auth/probe resolves (measured live at
// 210–650 ms at R96, through the since-RETIRED Vercel→Render proxy
// hop — see lib/api-config.ts; today's single-origin equivalent is
// App.tsx's full-origin-RTT 0.6–0.9 s note). Only AFTER it did the
// home route's lazy import() and useListProducts fire — three SERIAL
// round-trips (probe → home chunk → /api/products) before a single
// product painted, ~+0.6–1.2 s of LCP on 3G/4G.
//
// The gate itself stays (it is what prevents the logout flicker); the
// waterfall around it goes: while the probe is in flight we
//   (a) warm the home route chunk — the SAME dynamic import
//       `lazyWithRetry(() => import("@/pages/home"))` resolves against,
//       so the later lazy mount finds the module already in the module
//       map (zero-RTT swap-in), and
//   (b) head-start the public /api/products request and seed the
//       query cache under the SAME key home's useListProducts uses,
//       mirroring how the auth probe pre-seeds the /me query
//       (auth.tsx) — prefetchQuery additionally de-duplicates against
//       home's own useQuery when the gate opens before the response
//       lands (one request, never two).
//
// Failure of either leg must never break boot: the dynamic import is
// .catch-ed (stale-chunk 404s after a deploy are the known case) and
// prefetchQuery swallows query errors internally — a failed
// head-start just means home fetches on mount exactly as before.
//
// ── R111-F4-F3 (P3): the catalog prefetch is HOME-ROUTE-ONLY ────────
//
// The `{ fields: "list" }` key the head-start seeds (the A2-F3 grid
// projection — see the NOTE at the prefetch site below) is consumed by
// the home route alone — every other entry path (WhatsApp product
// deep-links, the dominant storefront traffic; category pages with
// their own params keys; /cart, /wallet, /login…) paid the full-catalog
// fetch (~4.7KB gz + ~53KB JSON.parse on the main thread) for a cache
// entry it would never read, contending with the actually-needed route
// chunk + data. The prefetch now fires only when the INITIAL path at
// module-eval time is the home route; every other boot skips leg (b)
// entirely (leg (a), the tiny home chunk warm-up, stays for any
// non-admin boot — deep-linked visitors tapping the logo get the
// warm chunk, and the home page itself fetches on mount exactly as it
// did before the 96-F3 head-start existed).
// ── R127-L10 (B4 D5): boot card-image warming ─────────────────────────────
//
// Live (B4 home-mobile observed trace): the LCP card image request
// only STARTED at 2,214 ms — doc 620 ms → entry eval → /api/products
// JSON at 2,062 ms → a React render hop → only then the <img> fetch →
// paint 2,499 ms. resourceLoadDelay (1,537–3,739 ms) dominated EVERY
// image-LCP run: the bytes were cheap, discovery was the cost. The
// fields=list payload this head-start already fetches carries
// image_url per row, so warming the first-4 card images AT PREFETCH
// RESOLVE removes the render hop from the image's critical path —
// the bytes land in the HTTP cache while React is still mounting.

/** Card-image warm count — matches ProductCard's eager window (index < 4). */
const BOOT_CARD_IMAGE_WARM_COUNT = 4;

/**
 * R127-L10 (B4 D5): the image URLs the boot head-start warms — the
 * first 4 catalog rows' image_url values, in render order. Pure
 * slice+filter, exported for the regression suite (same pattern as
 * isHomeBootPath / shapeForRoute) so the warmed set can neither
 * silently widen (warming the whole catalog) nor narrow (losing the
 * LCP cards). Rows with a missing/empty image_url are skipped WITHOUT
 * pulling later rows forward — the report's literal directive
 * (list.slice(0,4)); all 45 live products carry images, so the
 * distinction is theoretical today.
 */
export function bootCardImageWarmUrls(list: ProductListItem[] | undefined | null): string[] {
  if (!Array.isArray(list)) return [];
  const urls: string[] = [];
  for (const product of list.slice(0, BOOT_CARD_IMAGE_WARM_COUNT)) {
    const url = product?.image_url;
    if (typeof url === "string" && url.length > 0) {
      // R174: warmed URLs carry the same ?v= as the rendered <img> (see
      // lib/product-art.ts) — an unversioned warm would fetch a cache
      // entry the renderer never reads (a double download).
      urls.push(productArtUrl(url) ?? url);
    }
  }
  return urls;
}

/**
 * R127-L10 (B4 D5): prime the HTTP cache for the first-4 card images
 * (Image() never touches the DOM — no layout, no decode race with
 * React's own <img>; the browser dedupes against ProductCard's fetch).
 */
function warmBootCardImages(list: ProductListItem[] | undefined): void {
  if (typeof window === "undefined") return;
  for (const url of bootCardImageWarmUrls(list)) {
    const img = new Image();
    img.src = url;
  }
}

function startBootHeadStart(): void {
  if (typeof window === "undefined") return;

  // Admin boots never mount a storefront surface without a full
  // navigation (mirrors the admin probe gate in AuthProvider) — the
  // head-start would be pure cellular waste there.
  const routerBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const bootPath = window.location.pathname;
  if (bootPath === `${routerBase}/admin` || bootPath.startsWith(`${routerBase}/admin/`)) {
    return;
  }

  // (a) home route chunk warm-up (same specifier the lazy route uses).
  void import("@/pages/home").catch(() => {
    // Stale-chunk / offline — the lazyWithRetry route handles its own
    // recovery when it actually mounts.
  });

  // R111-F4-F3: leg (b) is gated to home-route boots (see
  // isHomeBootPath). Everything past this point — the seeded key, the
  // raw fetch, the staleTime — is byte-identical to the pre-gate
  // head-start.
  if (!isHomeBootPath(bootPath, routerBase)) return;

  // (b) products head-start. NOTE the `{ fields: "list" }` argument:
  // home always builds its params as an object with the A2-F3 grid
  // projection (`const params: Record<string, string> = { fields: "list" }`),
  // so its unfiltered key is ["/api/products", {fields:"list"}] — a key
  // built with `{}` or without the projection would hash to a DIFFERENT
  // key and seed nothing.
  //
  // Raw fetch + apiUrl (not the generated client): this fires at
  // module-eval time, BEFORE main.tsx installs the API fetch bridge
  // and setBaseUrl — apiUrl() is self-contained (env → absolute URL
  // for split deployments) so the request lands on the API origin in
  // every deployment shape.
  void queryClient
    .prefetchQuery({
      queryKey: getListProductsQueryKey({ fields: "list" }),
      queryFn: async (): Promise<ProductListItem[]> => {
        const res = await fetch(apiUrl("/api/products?fields=list"), {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ProductListItem[];
      },
      // Match home's products staleTime (3 min) so the seeded entry
      // is treated as fresh when home mounts.
      staleTime: 3 * 60 * 1000,
    })
    .then(() => {
      // R127-L10 (B4 D5): the catalog payload just landed — warm the
      // first-4 card images NOW so their bytes flow while React mounts
      // (see the R127-L10 warming block above startBootHeadStart).
      // prefetchQuery resolves void, so the payload is read back from
      // the just-seeded cache entry (same key); a failed prefetch
      // seeds nothing and the warm is an inert no-op.
      warmBootCardImages(
        queryClient.getQueryData<ProductListItem[]>(getListProductsQueryKey({ fields: "list" })),
      );
    })
    .catch(() => {
      // prefetchQuery already swallows query failures; this guards
      // against any unexpected synchronous/rejection path.
    });
}

// Module scope: fires during entry-chunk evaluation — BEFORE React
// renders, so the products request is in flight while AuthProvider
// is still mounting and the probe has not even started. Gated out of
// tests (MODE === "test") so module imports in vitest stay inert.
if (typeof window !== "undefined" && import.meta.env.MODE !== "test") {
  startBootHeadStart();
}

/**
 * R111-F4-F3 (P3): pure predicate for the head-start home-route gate.
 * TRUE only when the module-eval pathname is the home route — the sole
 * consumer of the `{ fields: "list" }` products key the catalog
 * prefetch seeds. Exported for the gating regression test (same
 * pattern as shapeForRoute above): every non-home entry path (WhatsApp
 * product deep-links — the dominant storefront traffic; category/cart/
 * wallet/login boots) must skip the full-catalog prefetch (~4.7KB gz +
 * ~53KB parse) it would never read.
 *
 * `routerBase` is BASE_URL with its trailing slash stripped (the same
 * normalization WouterRouter uses), so the home route is
 * `${routerBase}/`; the bare "/" comparison covers the default
 * deployment (BASE_URL = "/" → routerBase = "" → both clauses are
 * "/") and any bare-path edge.
 */
export function isHomeBootPath(pathname: string, routerBase: string): boolean {
  return pathname === `${routerBase}/` || pathname === "/";
}
