import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RouteLoading } from "@/components/RouteLoading";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useDocumentDirection } from "@/lib/direction";
import { ThemeProvider } from "@/lib/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

// HelmetProvider is mounted once at the very top of the tree in main.tsx.
// Mounting it again here would create a second context and silently break
// the merging react-helmet-async does across nested components.

// Critical layout
import { Navbar } from "@/components/layout/Navbar";
import NotFound from "@/pages/not-found";

// Non-critical layout deferred
const FlashSaleBanner = lazy(() =>
  import("@/components/layout/FlashSaleBanner").then((m) => ({ default: m.FlashSaleBanner })),
);
const Footer = lazy(() =>
  import("@/components/layout/Footer").then((m) => ({ default: m.Footer })),
);
const MobileNav = lazy(() =>
  import("@/components/layout/MobileNav").then((m) => ({ default: m.MobileNav })),
);

// All pages are lazily code-split to minimize initial bundle weight.
// The HTML shell + vendor-react chunk are the only critical-path resources.
const HomePage = lazy(() => import("@/pages/home"));

const AuthCallbackPage = lazy(() => import("@/pages/auth-callback"));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password"));
const LoginPage = lazy(() => import("@/pages/login"));
const LoyaltyPage = lazy(() => import("@/pages/loyalty"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const OrderDetailPage = lazy(() => import("@/pages/order-detail"));
const OrdersPage = lazy(() => import("@/pages/orders"));
const ProductPage = lazy(() => import("@/pages/product"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const ReferralsPage = lazy(() => import("@/pages/referrals"));
const RegisterPage = lazy(() => import("@/pages/register"));
const SupportPage = lazy(() => import("@/pages/support"));
const TermsPage = lazy(() => import("@/pages/terms"));
const WalletPage = lazy(() => import("@/pages/wallet"));

// Admin pages — lazy loaded so customer bundles stay small.
const AdminLoginPage = lazy(() => import("@/pages/admin/login"));
const AdminDashboardPage = lazy(() => import("@/pages/admin/dashboard"));
const AdminTopupsPage = lazy(() => import("@/pages/admin/topups"));
const AdminOrdersPage = lazy(() => import("@/pages/admin/orders"));
const AdminProductsPage = lazy(() => import("@/pages/admin/products"));
const AdminUsersPage = lazy(() => import("@/pages/admin/users"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/settings"));
const AdminSecurityPage = lazy(() => import("@/pages/admin/security"));
const AdminTicketsPage = lazy(() => import("@/pages/admin/tickets"));
const AdminReferralsPage = lazy(() => import("@/pages/admin/referrals"));
const AdminCouponsPage = lazy(() => import("@/pages/admin/coupons"));
const AdminAlertsPage = lazy(() => import("@/pages/admin/alerts"));

// Sentry verification surface — kept lazy so it costs nothing on the critical
// path; reachable at /__sentry-test for operators to confirm SDK delivery.
const SentryTestPage = lazy(() =>
  import("@/components/SentryTest").then((m) => ({ default: m.SentryTest })),
);

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
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <Switch>
        <Route path="/admin" component={AdminDashboardPage} />
        <Route path="/admin/topups" component={AdminTopupsPage} />
        <Route path="/admin/orders" component={AdminOrdersPage} />
        <Route path="/admin/products" component={AdminProductsPage} />
        <Route path="/admin/users" component={AdminUsersPage} />
        <Route path="/admin/settings" component={AdminSettingsPage} />
        <Route path="/admin/security" component={AdminSecurityPage} />
        <Route path="/admin/tickets" component={AdminTicketsPage} />
        <Route path="/admin/referrals" component={AdminReferralsPage} />
        <Route path="/admin/coupons" component={AdminCouponsPage} />
        <Route path="/admin/alerts" component={AdminAlertsPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppRoutes() {
  const [location] = useLocation();
  const { token } = useAuth();
  const isAdmin = location.startsWith("/admin");
  const isAuth = location === "/login" || location === "/register";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <RouteLoading />
      {!isAdmin && <Navbar />}
      {!isAdmin && (
        <Suspense fallback={null}>
          <FlashSaleBanner />
        </Suspense>
      )}
      <main className={!isAdmin && !isAuth && token ? "mobile-nav-safe-pad md:pb-0" : ""}>
        <ErrorBoundary>
          <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/login" component={LoginPage} />
              <Route path="/register" component={RegisterPage} />
              <Route path="/onboarding" component={OnboardingPage} />
              <Route path="/product/:id" component={ProductPage} />
              <Route path="/wallet" component={WalletPage} />
              <Route path="/orders" component={OrdersPage} />
              <Route path="/orders/:orderCode" component={OrderDetailPage} />
              <Route path="/loyalty" component={LoyaltyPage} />
              <Route path="/referrals" component={ReferralsPage} />
              <Route path="/support" component={SupportPage} />
              <Route path="/terms" component={TermsPage} />
              <Route path="/forgot-password" component={ForgotPasswordPage} />
              <Route path="/profile" component={ProfilePage} />
              <Route path="/auth/callback" component={AuthCallbackPage} />
              <Route path="/__sentry-test" component={SentryTestPage} />

              <Route path="/admin/login" component={AdminLoginPage} />
              <Route path="/admin" component={AdminProtectedRoutes} />
              <Route path="/admin/:rest*" component={AdminProtectedRoutes} />

              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!isAdmin && (
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      )}
      {!isAdmin && (
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
      )}
    </div>
  );
}

const SocketInitializer = lazy(() =>
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
          <DeferredSocketInitializer />
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AppRoutes />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
