import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppSplashScreen } from "@/components/AppSplashScreen";
import { NavigationProgress } from "@/components/NavigationProgress";
import { MetaTags } from "@/components/seo/MetaTags";
import { RouteSkeleton, type RouteSkeletonShape } from "@/components/ui/route-skeleton";
import { SessionActivityManager } from "@/components/SessionActivityManager";
import { AuthProvider, useAuth } from "@/lib/auth";
import { UserSessionWatcher } from "@/lib/user-session";
import { apiUrl } from "@/lib/api-config";
import { useTelegramWebAppAutoLogin } from "@/hooks/use-telegram-webapp-auto-login";
import { useDocumentDirection } from "@/lib/direction";
import { consumeQuietScrollToTopReset } from "@/lib/navigation-quiet";
import { ThemeProvider } from "@/lib/theme";
import { getListProductsQueryKey } from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

// Critical layout
import { Navbar } from "@/components/layout/Navbar";
import NotFound from "@/pages/not-found";

// Non-critical layout deferred
const FlashSaleBanner = lazyWithRetry(() =>
  import("@/components/layout/FlashSaleBanner").then((m) => ({ default: m.FlashSaleBanner })),
);
const Footer = lazyWithRetry(() =>
  import("@/components/layout/Footer").then((m) => ({ default: m.Footer })),
);
const MobileNav = lazyWithRetry(() =>
  import("@/components/layout/MobileNav").then((m) => ({ default: m.MobileNav })),
);

// All pages are lazily code-split to minimize initial bundle weight.
// The HTML shell + vendor-react chunk are the only critical-path resources.
const HomePage = lazyWithRetry(() => import("@/pages/home"));

const AuthCallbackPage = lazyWithRetry(() => import("@/pages/auth-callback"));
const TelegramCallbackPage = lazyWithRetry(() => import("@/pages/telegram-callback"));
const LoginPage = lazyWithRetry(() => import("@/pages/login"));
const LoyaltyPage = lazyWithRetry(() => import("@/pages/loyalty"));
const OnboardingPage = lazyWithRetry(() => import("@/pages/onboarding"));
const OrderDetailPage = lazyWithRetry(() => import("@/pages/order-detail"));
const OrdersPage = lazyWithRetry(() => import("@/pages/orders"));
const ProductPage = lazyWithRetry(() => import("@/pages/product"));
const CategoryPage = lazyWithRetry(() => import("@/pages/category"));
const ProfilePage = lazyWithRetry(() => import("@/pages/profile"));
const ReferralsPage = lazyWithRetry(() => import("@/pages/referrals"));
const RegisterPage = lazyWithRetry(() => import("@/pages/register"));
const SupportPage = lazyWithRetry(() => import("@/pages/support"));
const TermsPage = lazyWithRetry(() => import("@/pages/terms"));
const WalletPage = lazyWithRetry(() => import("@/pages/wallet"));
const CartPage = lazyWithRetry(() => import("@/pages/cart"));
const CheckoutPage = lazyWithRetry(() => import("@/pages/checkout"));
const FlashSalesPage = lazyWithRetry(() => import("@/pages/flash-sales"));

// Admin pages — lazy loaded so customer bundles stay small.
const AdminLoginPage = lazyWithRetry(() => import("@/pages/admin/login"));
const AdminDashboardPage = lazyWithRetry(() => import("@/pages/admin/dashboard"));
const AdminTopupsPage = lazyWithRetry(() => import("@/pages/admin/topups"));
const AdminOrdersPage = lazyWithRetry(() => import("@/pages/admin/orders"));
const AdminProductsPage = lazyWithRetry(() => import("@/pages/admin/products"));
const AdminPricingPage = lazyWithRetry(() => import("@/pages/admin/pricing"));
const AdminUsersPage = lazyWithRetry(() => import("@/pages/admin/users"));
const AdminSettingsPage = lazyWithRetry(() => import("@/pages/admin/settings"));
const AdminSecurityPage = lazyWithRetry(() => import("@/pages/admin/security"));
const AdminTicketsPage = lazyWithRetry(() => import("@/pages/admin/tickets"));
const AdminReferralsPage = lazyWithRetry(() => import("@/pages/admin/referrals"));
const AdminCouponsPage = lazyWithRetry(() => import("@/pages/admin/coupons"));
const AdminPromotionsPage = lazyWithRetry(() => import("@/pages/admin/promotions"));
const AdminAlertsPage = lazyWithRetry(() => import("@/pages/admin/alerts"));
const AdminSystemPage = lazyWithRetry(() => import("@/pages/admin/system"));
const AdminAdminsPage = lazyWithRetry(() => import("@/pages/admin/admins"));
const AdminRiskPage = lazyWithRetry(() => import("@/pages/admin/risk"));
const AdminRiskEventPage = lazyWithRetry(() => import("@/pages/admin/risk-event"));
const AdminEnrichmentPage = lazyWithRetry(() => import("@/pages/admin/enrichment"));
const AdminWhatsAppPage = lazyWithRetry(() => import("@/pages/admin/whatsapp"));

// Public pages without customer chrome
const StatusPage = lazyWithRetry(() => import("@/pages/status"));

// A5-5 (R116 — lazy Toaster): sonner + the wrapper's five lucide icons
// used to ride the ENTRY graph for every visitor, yet toasts are an
// error/feedback surface, never first-paint content. The Toaster now
// mounts on idle via the same dynamic-import pattern main.tsx uses
// for use-toast (see IdleToaster below); ui/sonner.tsx carries a
// replay bridge that flushes toasts fired before the chunk mounted.
const Toaster = lazyWithRetry(() =>
  import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })),
);

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
 * Suspense fallback that picks a skeleton shape based on the route
 * the user just navigated to. By the time Suspense suspends on a
 * lazy chunk, `useLocation` already reflects the destination path —
 * so we render the destination's skeleton, not the source's.
 */
function RouteSuspenseFallback({ adminOnly = false }: { adminOnly?: boolean }) {
  const [location] = useLocation();
  return <RouteSkeleton shape={adminOnly ? "admin" : shapeForRoute(location)} />;
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
  /^\/admin/,
  /^\/status/,
];

function robotsForPath(path: string | undefined): string {
  const p = path ?? "/";
  if (NOINDEX_ROUTES.some((re) => re.test(p))) return "noindex,follow";
  return "index,follow";
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 60 seconds stale time to reduce redundant requests on route changes
      staleTime: 60_000,
      // Keep unused data for 5 min before GC to support quick back-navigation
      gcTime: 5 * 60_000,
      // 98-F7 (r97 F-13): retry ONLY on retryable failures — network errors
      // and HTTP 5xx. The previous `retry: 1` re-fired 4xx requests too:
      // every 404 (expired product link), 400 (validation) and 401
      // (expired session — the admin 401 handler already toasts +
      // redirects; the extra retry just doubled the failure latency and
      // the 401 noise). One retry max, same budget as before.
      retry: (failureCount: number, error: unknown) =>
        failureCount < 1 && isRetryableQueryError(error),
      // Don't refetch on window focus for mobile UX (reduces spinner flashes)
      refetchOnWindowFocus: false,
      // Don't refetch on network reconnect either. Default is "always",
      // which means a single network blip (mobile WiFi → cellular
      // handoff, brief offline) triggers ALL active queries to refetch
      // simultaneously across every connected client — a textbook DB
      // pool storm under any non-trivial concurrency. The existing
      // staleTime + on-mount + on-event refetch logic is sufficient
      // for freshness; reconnect storms are pure waste.
      refetchOnReconnect: false,
    },
  },
});

/**
 * 98-F7 (r97 F-13): should this query failure be retried?
 *
 *   - TypeError ⇒ retryable. customFetch maps both its request timeouts
 *     and the browser's offline/DNS failures onto the canonical
 *     network-error TypeError ("Failed to fetch" — see
 *     toNetworkErrorShape in shared/api-client-react/custom-fetch.ts);
 *     raw-fetch queryFns reject with the same browser TypeError.
 *   - An error carrying a numeric `status` (customFetch wraps every
 *     non-2xx HTTP response in ApiError with `status`) ⇒ retryable only
 *     for 5xx (500/502/503/504 — transient server-side). 4xx is a
 *     client-side contract verdict (404/400/401/403/409…) — retrying
 *     the identical request can never succeed.
 *   - Anything else (a thrown Error from a hand-rolled queryFn, an
 *     AbortError from unmount cancellation) ⇒ not retried; component
 *     error paths own the surfacing.
 *
 * ApiError is TYPE-exported from @workspace/api-client-react (no runtime
 * export), so the check duck-types the `status` field instead of
 * instanceof — same contract, no import-boundary coupling.
 *
 * Exported for the query-retry regression test (same pattern as
 * DeferredSocketInitializer below).
 */
export function isRetryableQueryError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" && status >= 500 && status <= 599;
}

// ── 96-F3 (R96 F-1 / mobile-performance-pwa §5): boot parallelization ──────
//
// The AuthGate below blocks the ENTIRE route tree until the
// /api/auth/probe resolves (measured live at 210–650 ms through the
// Vercel→Render proxy hop). Only AFTER it did the home route's lazy
// import() and useListProducts fire — three SERIAL round-trips
// (probe → home chunk → /api/products) before a single product
// painted, ~+0.6–1.2 s of LCP on 3G/4G.
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
// The {}-params key the head-start seeds is consumed by the home
// route alone — every other entry path (WhatsApp product deep-links,
// the dominant storefront traffic; category pages with their own
// params keys; /cart, /wallet, /login…) paid the full-catalog fetch
// (~4.7KB gz + ~53KB JSON.parse on the main thread) for a cache entry
// it would never read, contending with the actually-needed route
// chunk + data. The prefetch now fires only when the INITIAL path at
// module-eval time is the home route; every other boot skips leg (b)
// entirely (leg (a), the tiny home chunk warm-up, stays for any
// non-admin boot — deep-linked visitors tapping the logo get the
// warm chunk, and the home page itself fetches on mount exactly as it
// did before the 96-F3 head-start existed).
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

  // (b) products head-start. NOTE the `{}` argument: home always
  // builds its params as an object (`const params: Record<string,
  // string> = {}`), so its unfiltered key is ["/api/products", {}] —
  // `getListProductsQueryKey()` (no argument) would hash to a
  // DIFFERENT key and seed nothing.
  //
  // Raw fetch + apiUrl (not the generated client): this fires at
  // module-eval time, BEFORE main.tsx installs the API fetch bridge
  // and setBaseUrl — apiUrl() is self-contained (env → absolute URL
  // for split deployments) so the request lands on the API origin in
  // every deployment shape.
  void queryClient
    .prefetchQuery({
      queryKey: getListProductsQueryKey({}),
      queryFn: async (): Promise<Product[]> => {
        const res = await fetch(apiUrl("/api/products"), {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Product[];
      },
      // Match home's products staleTime (3 min) so the seeded entry
      // is treated as fresh when home mounts.
      staleTime: 3 * 60 * 1000,
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
 * consumer of the {}-params products key the catalog prefetch seeds.
 * Exported for the gating regression test (same pattern as
 * shapeForRoute above): every non-home entry path (WhatsApp product
 * deep-links — the dominant storefront traffic; category/cart/wallet/
 * login boots) must skip the full-catalog prefetch (~4.7KB gz +
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

/**
 * A5-3 (R116): TanStack cache key for the admin session guard. Lives
 * under the "admin" root so AuthProvider.setAdminToken(null) — the
 * admin identity-switch choke point — removes it together with every
 * other admin-scoped query (see the predicate in lib/auth.tsx): a
 * stale "session valid" verdict from the previous admin must never
 * admit the next one without a fresh round-trip.
 */
const ADMIN_SESSION_GUARD_QUERY_KEY = ["admin", "session", "guard"] as const;

function AdminProtectedRoutes() {
  const { adminToken, setAdminToken } = useAuth();
  const [location, navigate] = useLocation();

  // A5-3 (R116 — admin guard refetch storm): the guard used to
  // raw-fetch /api/admin/session on EVERY mount — and the /admin vs
  // /admin/:rest* route split below remounts this component on every
  // admin navigation, so each hop re-paid the round-trip behind a
  // blank min-h-screen div. TanStack Query now owns the fetch:
  // remounts read the cached verdict (staleTime 5 min) and only the
  // first mount — or a >5 min stale verdict — talks to the network,
  // rendering the admin route skeleton (not a blank div) while
  // pending. The 401/403 behavior is byte-identical: clear the admin
  // token + soft-redirect to the admin login. The admin-session 401
  // interceptor (useAdminHeaders → lib/admin-session) is untouched and
  // keeps covering page-level queries. Transient failures (network /
  // 5xx) still surface to the admin pages themselves instead of
  // trapping a valid session on a blank guard screen (retry: false —
  // the old raw fetch never retried either).
  const sessionQuery = useQuery({
    queryKey: ADMIN_SESSION_GUARD_QUERY_KEY,
    enabled: !!adminToken,
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        const response = await fetch("/api/admin/session", {
          headers: { Authorization: `Bearer ${adminToken}` },
          signal,
        });
        if (response.ok) return { valid: true };

        if (response.status === 401 || response.status === 403) {
          setAdminToken(null);
          navigate("/admin/login");
          return { valid: false };
        }

        // Non-401/403 failure (5xx, offline): keep the locally-valid
        // session and let the admin pages surface transient API
        // failures instead of trapping a valid local session on a
        // blank guard screen — the same posture as the raw fetch this
        // replaces (which logged and rendered the children).
        throw new Error(`admin session check failed: HTTP ${response.status}`);
      } catch (error) {
        if ((error as { name?: string } | null | undefined)?.name !== "AbortError") {
          console.warn("Admin session validation failed", error);
        }
        throw error;
      }
    },
  });

  // No local admin token → nothing to guard. Mirrors the old effect:
  // bounce to the admin login (effect, not render-phase, so wouter
  // navigation stays side-effect free during render).
  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  if (!adminToken) return null;
  if (sessionQuery.isPending) {
    // A5-3: the guard previously rendered a BLANK div here — a
    // full-screen flash of nothing on every admin navigation while
    // the guard re-fetched. The admin route skeleton (the same shape
    // the lazy page Suspense fallback renders below) fills the space
    // instead: a content-fill, not a blank jump.
    return <RouteSuspenseFallback adminOnly />;
  }

  return (
    <Suspense fallback={<RouteSuspenseFallback adminOnly />}>
      {/* Round-3 (8-f §7): a render crash in any of the 900-1500-line
          admin pages previously took out the WHOLE app shell (the only
          ErrorBoundary wrapped the public Switch). Admin pages keep the
          admin nav (layout renders inside each page) and get their own
          blast radius — the storefront keeps working while the admin
          page shows its error screen. */}
      {/* 98-F7 (r97 F-14): resetKey = the admin route — a crashed
          /admin/orders resets when the operator navigates to
          /admin/users instead of trapping every admin route behind the
          error screen until a full reload (children identity alone was
          the old, accidental reset trigger). */}
      <ErrorBoundary resetKey={location}>
        <Switch>
          <Route path="/admin" component={AdminDashboardPage} />
          <Route path="/admin/topups" component={AdminTopupsPage} />
          <Route path="/admin/orders" component={AdminOrdersPage} />
          <Route path="/admin/products" component={AdminProductsPage} />
          <Route path="/admin/pricing" component={AdminPricingPage} />
          <Route path="/admin/users" component={AdminUsersPage} />
          <Route path="/admin/settings" component={AdminSettingsPage} />
          <Route path="/admin/security" component={AdminSecurityPage} />
          <Route path="/admin/tickets" component={AdminTicketsPage} />
          <Route path="/admin/referrals" component={AdminReferralsPage} />
          <Route path="/admin/coupons" component={AdminCouponsPage} />
          <Route path="/admin/promotions" component={AdminPromotionsPage} />
          <Route path="/admin/alerts" component={AdminAlertsPage} />
          <Route path="/admin/system" component={AdminSystemPage} />
          <Route path="/admin/admins" component={AdminAdminsPage} />
          <Route path="/admin/risk" component={AdminRiskPage} />
          <Route path="/admin/risk/events/:id" component={AdminRiskEventPage} />
          <Route path="/admin/products/enrichment" component={AdminEnrichmentPage} />
          <Route path="/admin/whatsapp" component={AdminWhatsAppPage} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </Suspense>
  );
}

/**
 * Round-3 (8-f §4 — scroll restoration): wouter doesn't restore scroll
 * on navigation, and nothing else did — navigating from a 4000px-scrolled
 * home landed you MID-PAGE on /wallet. Scroll to top on every location
 * change.
 *
 * F3-07 (R116 — route-change focus management): the location change now
 * ALSO moves keyboard/screen-reader focus to the main content container.
 * SPA navigations leave focus wherever the activating element was —
 * for screen-reader users the "page" never changed (no page-load
 * announcement, the URL silently swapped), and keyboard users restart
 * their Tab walk from wherever they happened to be, often deep in the
 * footer of the PREVIOUS route. Focusing <main> (tabIndex={-1}, see the
 * <main> element in AppRoutes) makes the new page's content the
 * reading/cursor start point — the same contract a full page load gives.
 * preventScroll: the window.scrollTo above already reset the scroll
 * position; letting focus() scroll too would double-scroll and fight
 * the reset.
 *
 * Covers storefront AND admin navigations — <main id="main-content">
 * wraps both route trees (the admin Switch renders inside the same
 * <main>). Exported for the focus-on-navigate regression test (same
 * pattern as shapeForRoute / DeferredSocketInitializer).
 */
export function ScrollToTop() {
  const [location] = useLocation();
  const isFirstRunRef = useRef(true);
  useEffect(() => {
    // R117 (F-4): programmatic URL rewrites (product.tsx's legacy
    // numeric-id → slug replaceState) arrive here as location changes —
    // they must not scroll-to-top or steal focus mid-read. The flag is
    // one-shot and armed only when the rewrite actually changes the
    // path, so every REAL navigation keeps its full reset.
    if (consumeQuietScrollToTopReset()) return;
    window.scrollTo(0, 0);
    // First run is the app BOOT, not a route change — the browser's
    // own page-load focus/announcement already covers it, and a late
    // programmatic focus jump (the auth gate holds the tree for the
    // probe's 50-300 ms) could interrupt a screen reader mid-cue.
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      return;
    }
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [location]);
  return null;
}

/**
 * F3-07 (R116): delay before the announcer first reads the new title.
 * Warm navigations (chunk cached) usually have MetaTags flushed by the
 * time this fires; cold ones are covered by the <title> observer below.
 */
const ROUTE_ANNOUNCE_DELAY_MS = 150;

/**
 * F3-07 (R116): sr-only polite live region announcing the new page's
 * document.title after every SPA navigation. Sighted users get a full
 * page-load cue (spinner flash, scroll reset); screen-reader users got
 * NOTHING — the route swapped silently. Every route maintains its
 * <title> via its useSeo / MetaTags block, so the announced text is the
 * page's real name (e.g. «SubNation — المحفظة»).
 *
 * Timing: routes are lazily code-split and the destination route writes
 * its title only when its chunk swaps in — reading document.title
 * synchronously on the location change would announce the PREVIOUS
 * page's title on cold navigations. The announcer therefore (a) reads
 * the title after a short delay (covers warm chunks) and (b) observes
 * <title> mutations so the announcement tracks the final title
 * whenever it lands. The very first mount is deliberately silent —
 * the browser's own page-load announcement already covers it.
 *
 * Styled with the sr-only utility (Tailwind core class) — visually
 * hidden, screen-reader exposed. Rendered for storefront AND admin
 * routes (AppRoutes mounts it outside the isAdmin conditionals).
 *
 * Exported for the announcement regression test (same pattern as
 * ScrollToTop above).
 */
export function RouteAnnouncer() {
  const [location] = useLocation();
  const [announcement, setAnnouncement] = useState("");
  const isFirstRunRef = useRef(true);

  useEffect(() => {
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      return;
    }
    // Wipe the previous route's text first: navigating between two
    // routes that share a title must still fire an SR utterance (a
    // live region whose text did not change is not announced).
    setAnnouncement("");

    // R117 (F-5): the pre-navigation title. The old 150 ms timer
    // frequently beat the destination chunk's MetaTags on COLD
    // navigations — it announced the PREVIOUS page's title, then the
    // MutationObserver announced the real one when it landed: a
    // stale + fresh double utterance. Both paths now skip any value
    // equal to the pre-navigation title: the timer only announces
    // titles that already CHANGED (warm chunks), the observer only
    // announces real mutations (cold chunks), and `announced` makes
    // the win exactly once even when MetaTags upserts several times.
    // Same-title navigations (rare, zero new information) are silent
    // by design under this rule.
    const titleAtNavStart = (document.title || "").trim();
    let announced = false;
    const announce = () => {
      if (announced) return;
      const title = (document.title || "").trim();
      if (!title || title === titleAtNavStart) return;
      announced = true;
      setAnnouncement(title);
    };

    const timer = setTimeout(announce, ROUTE_ANNOUNCE_DELAY_MS);
    const observer = new MutationObserver(announce);
    const titleEl = document.head.querySelector("title");
    if (titleEl) {
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [location]);

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {announcement}
    </div>
  );
}

function AppRoutes() {
  const [location] = useLocation();
  const { token } = useAuth();
  useTelegramWebAppAutoLogin();
  const isAdmin = location.startsWith("/admin");
  // /status is a public chromeless page (no Navbar/Footer/MobileNav)
  // — meant to be a quick "is the platform up?" view that loads even
  // when most of the SPA's state is broken. /auth/telegram-callback
  // is also chromeless: a transient fragment-handling page that just
  // POSTs the auth payload and redirects to / on success.
  const isChromeless = location === "/status" || location === "/auth/telegram-callback";

  // R120-B3 (A3-F7): min-h-screen → the codebase's min-h-[100dvh]
  // convention (login/register/home pattern) — 100vh overscrolls on
  // mobile dynamic-toolbar viewports.
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <ScrollToTop />
      {/* F3-07 (R116): sr-only polite announcement of the new page's
          title on every SPA navigation — storefront AND admin. */}
      <RouteAnnouncer />
      <NavigationProgress />
      {/* ── Default SEO tags ────────────────────────────────────────────
          FALLBACK instance (V3-A1): applies only when no page-level
          useSeo() block owns the head, and re-applies when one unmounts.
          Page values always win (child effects run before this one);
          head writes are direct DOM upserts — react-helmet-async could
          not apply page-level tags under React 19 and tripled <title>.

          A7 (round-94): the fallback used to stamp index,follow + a
          canonical on EVERY route — including /wallet, /orders/:code,
          /admin/* that robots.txt Disallows. Mixed signals (a canonical
          pointing at a disallowed URL) and private pages nominally
          "indexable". The robots directive is now derived from the SAME
          allow-list robots.txt serves (backend/src/routes/seo.ts):
          private funnels get noindex,follow; the public surface keeps
          index,follow. */}
      <MetaTags
        fallback
        title="SubNation — سوق الاشتراكات الرقمية"
        description="اشترِ Netflix والبث المباشر واشتراكات VPN وتراخيص Windows والبرامج وأدوات الذكاء الاصطناعي بالدينار الليبي (د.ل) — تسليم فوري في ليبيا."
        path={location || "/"}
        robots={robotsForPath(location)}
      />
      {/* Skip-to-content (V2-H1, WCAG 2.4.1): keyboard users otherwise
          Tab through Navbar + banner + search on EVERY page before the
          content. Visible only on focus. */}
      {!isAdmin && !isChromeless && (
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:inset-x-2 focus:z-[100] focus:h-11 focus:flex focus:items-center focus:justify-center focus:bg-primary focus:text-primary-foreground focus:text-sm focus:font-bold focus:rounded-xl focus:shadow-lg"
        >
          تخطّى إلى المحتوى الرئيسي
        </a>
      )}
      {/* R118-B2 (A2 F-5): chrome isolation. Every storefront chrome
          block previously rendered ABOVE the route boundary (:703) with
          no guard of its own — a render throw in Navbar (the most
          data-driven chrome: auth chip, balance, search, cart badge,
          NotificationBell polling) took the WHOLE tree down to a white
          screen on every route, since main.tsx's onUncaughtError only
          forwards to Sentry. Each block now rides its own slim boundary
          whose fallback is null: a crashed chrome block degrades to
          boundary-less navigation while route content keeps rendering.
          Boundary-outside-Suspense order: chunk-load failures AND render
          throws both reach the boundary. resetKey = location, same
          recovery contract as the route boundary. */}
      {!isAdmin && !isChromeless && (
        <ErrorBoundary resetKey={location} fallback={null}>
          <Navbar />
        </ErrorBoundary>
      )}
      {!isAdmin && !isChromeless && (
        <ErrorBoundary resetKey={location} fallback={null}>
          <Suspense fallback={null}>
            <FlashSaleBanner />
          </Suspense>
        </ErrorBoundary>
      )}
      <main
        id="main-content"
        tabIndex={-1}
        className={!isAdmin && !isChromeless && token ? "mobile-nav-safe-pad md:pb-0" : ""}
      >
        {/* 98-F7 (r97 F-14): resetKey = the route path — the boundary
            wraps the whole Switch, so a crashed /wallet used to stay on
            its error screen for EVERY subsequent route (children identity
            reset fired only on unrelated parent re-renders). Navigation
            itself now resets it. */}
        <ErrorBoundary resetKey={location}>
          <Suspense fallback={<RouteSuspenseFallback />}>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/login" component={LoginPage} />
              <Route path="/register" component={RegisterPage} />
              <Route path="/onboarding" component={OnboardingPage} />
              <Route path="/product/:slug" component={ProductPage} />
              <Route path="/category/:slug" component={CategoryPage} />
              <Route path="/wallet" component={WalletPage} />
              <Route path="/orders" component={OrdersPage} />
              <Route path="/orders/:orderCode" component={OrderDetailPage} />
              <Route path="/loyalty" component={LoyaltyPage} />
              <Route path="/referrals" component={ReferralsPage} />
              <Route path="/support" component={SupportPage} />
              <Route path="/status" component={StatusPage} />
              <Route path="/terms" component={TermsPage} />
              <Route path="/profile" component={ProfilePage} />
              <Route path="/cart" component={CartPage} />
              <Route path="/checkout" component={CheckoutPage} />
              <Route path="/flash-sales" component={FlashSalesPage} />
              <Route path="/auth/callback" component={AuthCallbackPage} />
              <Route path="/auth/telegram-callback" component={TelegramCallbackPage} />

              <Route path="/admin/login" component={AdminLoginPage} />
              <Route path="/admin" component={AdminProtectedRoutes} />
              {/* regexparam 3 parses `:rest*` as a SINGLE segment (`[^/]+?`), so
                  nested paths like /admin/products/enrichment and
                  /admin/risk/events/:id fell through to the public 404. A bare
                  `*` is the true multi-segment splat. */}
              <Route path="/admin/*" component={AdminProtectedRoutes} />

              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!isAdmin && !isChromeless && (
        <ErrorBoundary resetKey={location} fallback={null}>
          <Suspense fallback={null}>
            <Footer />
          </Suspense>
        </ErrorBoundary>
      )}
      {!isAdmin && !isChromeless && (
        <ErrorBoundary resetKey={location} fallback={null}>
          <Suspense fallback={null}>
            <MobileNav />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

const SocketInitializer = lazyWithRetry(() =>
  import("@/components/SocketInitializer").then((m) => ({ default: m.SocketInitializer })),
);

/**
 * R104 (free-tier sleep economics): the deferral mount is now
 * ADMIN-ONLY. Anonymous visitors AND regular authenticated users
 * never download the socket.io stack (~16 KB gzip + engine.io
 * parse/TBT) — storefront realtime is page-scoped (order-detail) and
 * every other surface already runs on polls/resync that cannot defeat
 * Render's 15-minute idle sleep. Operators on /admin need the admin
 * room for live approvals, so an admin sentinel keeps the 3.5 s
 * deferral timer (first paint stays uncontended).
 *
 * SessionActivityManager (visibility/idle socket parking + money-data
 * resync) is mounted separately for every session — see App().
 *
 * Exported for the gating regression test (same pattern as
 * shapeForRoute above).
 */
export function DeferredSocketInitializer() {
  const { adminToken } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // R104: users and guests never warm the socket chunk. An admin
    // login mid-session re-arms the timer (adminToken flips truthy →
    // effect re-runs).
    if (!adminToken) return;

    // Wait for initial hydration and paint to settle
    const timeout = setTimeout(() => setMounted(true), 3500);
    return () => clearTimeout(timeout);
  }, [adminToken]);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <SocketInitializer />
    </Suspense>
  );
}

/**
 * A5-5 (R116): mounts the lazy Toaster once the main thread goes idle.
 * requestIdleCallback keeps the sonner chunk fetch + render off the
 * first-paint critical path; the 2 s timeout guarantee bounds the
 * window in which toasts queue in the sonner store instead of
 * rendering (the replay bridge in ui/sonner flushes them on mount,
 * so nothing is lost).
 *
 * Exported for the gating regression test (same pattern as
 * DeferredSocketInitializer above).
 */
export function IdleToaster() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setMounted(true), { timeout: 2_000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(() => setMounted(true), 2_000);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
  );
}

function App() {
  // Lock document direction once at boot. Defends against any descendant
  // (e.g. a route-level Helmet block flushing on unmount) that might
  // otherwise clear `<html dir>` and cause a momentary RTL→LTR flip.
  useDocumentDirection("ar");

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          {/* 96-F3 (R96 A4 §3.1): storefront 401 router — mirrors the */}
          {/* auth token into lib/user-session and registers its additive */}
          {/* observer on the shared client. Renders nothing. */}
          <UserSessionWatcher />
          <AuthGate>
            {/* R104 (free-tier sleep economics): visibility/idle socket
                parking + transactional money/identity resync for every
                session — socket-agnostic, renders nothing. */}
            <SessionActivityManager />
            <DeferredSocketInitializer />
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AppRoutes />
            </WouterRouter>
          </AuthGate>
        </AuthProvider>
        {/* A5-5 (R116): the Toaster is mounted OUTSIDE the auth gate so
            boot-window toasts (session-expired, SW updates) can render
            even while the splash screen holds the route tree — the
            replay bridge in ui/sonner flushes anything fired before
            the idle mount. Needs ThemeProvider (useTheme), nothing
            from auth. */}
        <IdleToaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Auth hydration gate. Holds the entire app tree (including the
 * router, the socket initializer, and every lazy-imported page)
 * behind the splash screen until `AuthProvider` finishes its
 * `/api/auth/me` cookie probe.
 *
 * This prevents the "logout flicker" sequence:
 *   1. App mounts with token=null
 *   2. Routes render unauthenticated UI
 *   3. /api/auth/me probe completes
 *   4. Token state flips to authenticated
 *   5. Routes re-render — visible flash
 *
 * With this gate, steps 2-5 collapse into a single transition: the
 * splash holds, the probe resolves, the routes render with the
 * correct auth state immediately.
 *
 * ── Splash threshold ───────────────────────────────────────────────
 * The probe finishes in 50-300ms on a normal connection. Showing the
 * branded splash for that brief window produces a visible flash of
 * "logo + dots → real UI" that users perceive as the app stalling
 * even though it's just rendering. We delay the splash by 250ms so:
 *   • Fast probe (<250ms): the user sees a flat background that
 *     matches `bg-background`, then the real UI. No logo flash.
 *   • Slow probe (≥250ms): the user sees the splash and KNOWS the
 *     app is loading. This is the case where the splash is useful.
 * The flat background during the pre-threshold window is identical
 * in color to both the splash and the eventual route layout, so
 * there is no perceived flicker — only a continuous surface that
 * fills with real content when ready.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { initializing } = useAuth();
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    if (!initializing) return;
    const timer = setTimeout(() => setShowSplash(true), 250);
    return () => clearTimeout(timer);
  }, [initializing]);

  if (initializing) {
    return showSplash ? (
      <AppSplashScreen />
    ) : (
      // Flat background matching --background. Same color as the
      // splash AND every route layout, so the swap-in of real UI
      // is a single fade rather than splash → route flash.
      <div className="min-h-[100dvh] bg-background" aria-hidden="true" />
    );
  }
  return <>{children}</>;
}

export default App;
