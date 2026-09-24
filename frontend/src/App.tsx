import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppSplashScreen } from "@/components/AppSplashScreen";
import { NavigationProgress } from "@/components/NavigationProgress";
import { MetaTags } from "@/components/seo/MetaTags";
import { RouteSkeleton, type RouteSkeletonShape } from "@/components/ui/route-skeleton";
import { Toaster } from "@/components/ui/sonner";
import { SessionActivityManager } from "@/components/SessionActivityManager";
import { AuthProvider, useAuth } from "@/lib/auth";
import { UserSessionWatcher } from "@/lib/user-session";
import { apiUrl } from "@/lib/api-config";
import { useTelegramWebAppAutoLogin } from "@/hooks/use-telegram-webapp-auto-login";
import { useDocumentDirection } from "@/lib/direction";
import { ThemeProvider } from "@/lib/theme";
import { getListProductsQueryKey } from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
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
  [/^\/wallet/, "list"],
  [/^\/loyalty/, "detail"],
  [/^\/referrals/, "list"],
  [/^\/support/, "list"],
  [/^\/profile/, "form"],
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
  [/^\/flash-sales/, "catalog"],
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

function AdminProtectedRoutes() {
  const { adminToken, setAdminToken } = useAuth();
  const [location, navigate] = useLocation();
  const [isCheckingSession, setIsCheckingSession] = useState(false);

  useEffect(() => {
    if (!adminToken) {
      setIsCheckingSession(false);
      navigate("/admin/login");
      return;
    }

    const controller = new AbortController();
    setIsCheckingSession(true);

    fetch("/api/admin/session", {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (response.ok) return;

        if (response.status === 401 || response.status === 403) {
          setAdminToken(null);
          navigate("/admin/login");
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          // Let the admin pages surface transient API failures instead of
          // trapping a valid local session on a blank guard screen.
          console.warn("Admin session validation failed", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsCheckingSession(false);
        }
      });

    return () => controller.abort();
  }, [adminToken, navigate, setAdminToken]);

  if (!adminToken) return null;
  if (isCheckingSession) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
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
 */
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ScrollToTop />
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
        description="سوق الاشتراكات الرقمية في ليبيا. اشترك في Netflix وSpotify وPS Plus وDisney+ وأكثر بالدينار الليبي."
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
      {!isAdmin && !isChromeless && <Navbar />}
      {!isAdmin && !isChromeless && (
        <Suspense fallback={null}>
          <FlashSaleBanner />
        </Suspense>
      )}
      <main
        id="main-content"
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
              <Route path="/admin/:rest*" component={AdminProtectedRoutes} />

              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!isAdmin && !isChromeless && (
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      )}
      {!isAdmin && !isChromeless && (
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
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
            <Toaster />
          </AuthGate>
        </AuthProvider>
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
