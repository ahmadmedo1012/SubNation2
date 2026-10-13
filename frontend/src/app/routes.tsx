/**
 * R137 (2-b — the App.tsx route-registry decomposition): the wouter
 * route tree + the route-level semantics components, extracted VERBATIM
 * from App.tsx — RouteSuspenseFallback (the shape-matched Suspense
 * fallback), ProductsAliasRedirect, AdminProtectedRoutes (the
 * TanStack-guarded admin subtree), ScrollToTop + RouteAnnouncer (the
 * F3-07 focus/announcement contracts) and AppRoutes (the app shell:
 * SEO fallback, skip link, chrome gating, <main>, both Switch trees).
 * AppRoutes is rendered by App.tsx inside the providers + WouterRouter;
 * the three exported names are re-exported through App.tsx for their
 * regression suites. All state here is component-local (refs, timers,
 * the guard query) — the shell coordination (providers, AuthGate,
 * splash) stays in App.tsx.
 */
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NavigationProgress } from "@/components/NavigationProgress";
import { MetaTags } from "@/components/seo/MetaTags";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { Route, Switch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useTelegramWebAppAutoLogin } from "@/hooks/use-telegram-webapp-auto-login";
import { consumeQuietScrollToTopReset } from "@/lib/navigation-quiet";
import { robotsForPath, shapeForRoute } from "@/app/route-shapes";
import {
  HomePage,
  AuthCallbackPage,
  TelegramCallbackPage,
  // R-140-f: the seven segment-guarded pages are imported under *Lazy
  // aliases and re-bound to their withRouteBoundary twins below — the
  // route table's registration lines stay byte-identical (they are the
  // r137 deletion surfaces pinned by app-decomposition-r137) while the
  // SAME public names now resolve to the guarded components.
  LoginPage as LoginPageLazy,
  LoyaltyPage as LoyaltyPageLazy,
  OnboardingPage,
  OrderDetailPage as OrderDetailPageLazy,
  OrdersPage,
  ProductPage,
  CategoryPage,
  ProfilePage,
  ReferralsPage,
  NotificationsPage,
  RegisterPage as RegisterPageLazy,
  SupportPage,
  TermsPage,
  WalletPage as WalletPageLazy,
  CartPage as CartPageLazy,
  CheckoutPage as CheckoutPageLazy,
  FlashSalesPage,
  AdminLoginPage,
  AdminDashboardPage,
  AdminTopupsPage,
  AdminOrdersPage,
  AdminProductsPage,
  AdminPricingPage,
  AdminUsersPage,
  AdminSettingsPage,
  AdminSecurityPage,
  AdminTicketsPage,
  AdminReferralsPage,
  AdminCouponsPage,
  AdminPromotionsPage,
  AdminAlertsPage,
  AdminSystemPage,
  AdminAdminsPage,
  AdminRiskPage,
  AdminRiskEventPage,
  AdminEnrichmentPage,
  AdminWhatsAppPage,
  StatusPage,
} from "@/app/page-registry";
import { FlashSaleBanner, Footer, MobileNav } from "@/app/app-shell";

// Critical layout
import { Navbar } from "@/components/layout/Navbar";
import NotFound from "@/pages/not-found";

/**
 * R-140-f (money/auth route-segment boundaries — the r140 error lane):
 * the ONLY per-route boundaries before this round were the admin subtree
 * (Round-3 8-f §7, inside AdminProtectedRoutes) and the storefront
 * chrome blocks (R118-B2's slim null fallbacks). Every storefront route
 * — checkout, wallet/topup, cart, order-detail, loyalty included — rode
 * the ONE app-level boundary around the whole public Switch. That
 * boundary does catch a money-page crash, but it is the LAST line
 * before a root unmount and its state is shared by every route; a
 * chunk or render failure on a money path swapped the entire route
 * area to the recovery screen and consumed the shared boundary.
 *
 * The money + auth funnels now get their OWN segment boundary (this one
 * wrapper, reused): a render throw — or a lazyWithRetry SECOND chunk
 * failure (the first reloads the page; the second rethrows, and the
 * nearest boundary is this segment guard sitting INSIDE the
 * Switch-level Suspense — React 19 surfaces a lazy-payload rejection to
 * the closest error boundary, which is this one, not the outer app
 * boundary) — is contained to the route the user is actually on, and
 * the app-level boundary stays pristine as the backstop for every
 * other route.
 *
 * 98-F7 contract at SEGMENT scope: resetKey = the live location (the
 * wrapper renders inside wouter's Router, so useLocation reads the
 * active path — including /orders/:orderCode param changes); an
 * unrelated parent re-render cannot flicker the boundary, navigation
 * resets it exactly, and leaving the route unmounts it entirely (the
 * Switch renders only the matching route).
 *
 * Scope is deliberately MINIMAL — money paths + the auth funnel
 * (login/register), nothing else: browsing surfaces keep the app-level
 * boundary alone; the /auth/* callback pages are one-shot redirect
 * handlers with their own inline hang/error states; and /admin keeps
 * its existing subtree boundary.
 */
// R140 central: <P extends object> instead of ComponentType<any> — the
// props-generic form keeps full inference (ComponentProps falls out of P)
// without the no-explicit-any warning; the lint baseline stays at the
// 49 pre-existing warnings.
function withRouteBoundary<P extends object>(Page: ComponentType<P>) {
  function GuardedPage(props: P) {
    const [location] = useLocation();
    return (
      <ErrorBoundary resetKey={location}>
        <Page {...props} />
      </ErrorBoundary>
    );
  }
  return GuardedPage;
}

// R-140-f: the guarded twins. The route table below keeps its
// byte-identical registrations (`component={CartPage}` etc.) — these
// consts re-bind the SAME names to the boundary-wrapped components, so
// no <Route> line changes (the r137 deletion surfaces stay pinned).
const LoginPage = withRouteBoundary(LoginPageLazy);
const RegisterPage = withRouteBoundary(RegisterPageLazy);
const WalletPage = withRouteBoundary(WalletPageLazy);
const CartPage = withRouteBoundary(CartPageLazy);
const CheckoutPage = withRouteBoundary(CheckoutPageLazy);
const OrderDetailPage = withRouteBoundary(OrderDetailPageLazy);
const LoyaltyPage = withRouteBoundary(LoyaltyPageLazy);

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
 * A5-3 (R116): TanStack cache key for the admin session guard. Lives
 * under the "admin" root so AuthProvider.setAdminToken(null) — the
 * admin identity-switch choke point — removes it together with every
 * other admin-scoped query (see the predicate in lib/auth.tsx): a
 * stale "session valid" verdict from the previous admin must never
 * admit the next one without a fresh round-trip.
 */
const ADMIN_SESSION_GUARD_QUERY_KEY = ["admin", "session", "guard"] as const;

/** R128 (A2-F3): /products — the conventional e-commerce catalog URL —
 * had NO route (home IS the catalog), so every typed/guessed link hit
 * the styled 404 while /flash-sales-style catalog routes existed (live
 * probe: 200 shell → client 404; sitemap honestly omits it). A tiny
 * client redirect to home replaces the dead end; `replace` keeps the
 * history stack clean (back skips the alias), and home's canonical
 * keeps owning the URL family — zero duplicate-content surface. The
 * backend keeps serving the shell at /products (R126-L6's no-301
 * contract is untouched — this runs AFTER hydration). */
/** R129-B1: exported for the products-alias route pin test. */
export function ProductsAliasRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);
  return null;
}

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

export function AppRoutes() {
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
          content. Visible only on focus.
          R125 (A6 B-7): the !isAdmin guard excluded the admin console —
          whose sidebar repeats 18 nav links + search + logout before the
          page content on EVERY route. The link targets #main-content,
          which wraps the admin Switch too (the same <main>), so admin
          now gets the same bypass. */}
      {!isChromeless && (
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
              {/* R128 (A2-F3): the guessed-catalog alias → home (the
                  catalog IS the home grid). See ProductsAliasRedirect. */}
              <Route path="/products" component={ProductsAliasRedirect} />
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
              <Route path="/notifications" component={NotificationsPage} />
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
