import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppSplashScreen } from "@/components/AppSplashScreen";
import { MetaTags } from "@/components/seo/MetaTags";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useTelegramWebAppAutoLogin } from "@/hooks/use-telegram-webapp-auto-login";
import { useDocumentDirection } from "@/lib/direction";
import { ThemeProvider } from "@/lib/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

// HelmetProvider is mounted once at the very top of the tree in main.tsx.
// Mounting it again here would create a second context and silently break
// the merging react-helmet-async does across nested components.

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

// Public pages without customer chrome
const StatusPage = lazyWithRetry(() => import("@/pages/status"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 60 seconds stale time to reduce redundant requests on route changes
      staleTime: 60_000,
      // Keep unused data for 5 min before GC to support quick back-navigation
      gcTime: 5 * 60_000,
      retry: 1,
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

function AdminProtectedRoutes() {
  const { adminToken, setAdminToken } = useAuth();
  const [, navigate] = useLocation();
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
    <Suspense
      fallback={
        <div
          className="flex min-h-[60vh] items-center justify-center"
          role="status"
          aria-busy="true"
        >
          <Spinner className="size-8 text-primary" />
        </div>
      }
    >
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
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppRoutes() {
  const [location] = useLocation();
  const { token } = useAuth();
  useTelegramWebAppAutoLogin();
  const isAdmin = location.startsWith("/admin");
  const isAuth = location === "/login" || location === "/register";
  // /status is a public chromeless page (no Navbar/Footer/MobileNav)
  // — meant to be a quick "is the platform up?" view that loads even
  // when most of the SPA's state is broken. /auth/telegram-callback
  // is also chromeless: a transient fragment-handling page that just
  // POSTs the auth payload and redirects to / on success.
  const isChromeless = location === "/status" || location === "/auth/telegram-callback";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Default SEO tags ────────────────────────────────────────────
          Mounted globally so every route — including admin and pages
          that don't call useSeo() — has exactly ONE title and ONE meta
          description in <head>. Pages that DO call useSeo() render
          their own <MetaTags>, which react-helmet-async dedupes against
          this default by tag-key (title, name="description", og:*),
          so the page-specific values win. The static tags in
          index.html are tagged with data-rh="true" so Helmet replaces
          them in place instead of appending — that's what fixes the
          "more than one title tag" SEO error. */}
      <MetaTags
        title="SubNation — سوق الاشتراكات الرقمية"
        description="سوق الاشتراكات الرقمية في ليبيا. اشترك في Netflix وSpotify وPS Plus وDisney+ وأكثر بالدينار الليبي."
        path={location || "/"}
      />
      {!isAdmin && !isChromeless && <Navbar />}
      {!isAdmin && !isChromeless && (
        <Suspense fallback={null}>
          <FlashSaleBanner />
        </Suspense>
      )}
      <main
        className={
          !isAdmin && !isAuth && !isChromeless && token ? "mobile-nav-safe-pad md:pb-0" : ""
        }
      >
        <ErrorBoundary>
          <Suspense
            fallback={
              <div
                className="flex min-h-[60vh] items-center justify-center"
                role="status"
                aria-busy="true"
              >
                <Spinner className="size-8 text-primary" />
              </div>
            }
          >
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

function DeferredSocketInitializer() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Wait for initial hydration and paint to settle
    const timeout = setTimeout(() => setMounted(true), 3500);
    return () => clearTimeout(timeout);
  }, []);

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
          <AuthGate>
            <DeferredSocketInitializer />
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <AppRoutes />
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
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
 * Cost: one ~50-300ms splash on cold boot / refresh / PWA resume.
 * Benefit: stable, consistent first paint regardless of auth state.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { initializing } = useAuth();
  if (initializing) {
    return <AppSplashScreen />;
  }
  return <>{children}</>;
}

export default App;
