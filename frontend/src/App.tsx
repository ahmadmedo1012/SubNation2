import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FlashSaleBanner } from "@/components/layout/FlashSaleBanner";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { Navbar } from "@/components/layout/Navbar";
import { RouteLoading } from "@/components/RouteLoading";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

// Home + NotFound are eagerly loaded for fastest first paint of the primary
// landing route; all other customer pages are lazily code-split so the initial
// critical bundle stays minimal.
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
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
      {!isAdmin && <FlashSaleBanner />}
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

              <Route path="/admin/login" component={AdminLoginPage} />
              <Route path="/admin" component={AdminProtectedRoutes} />
              <Route path="/admin/:rest*" component={AdminProtectedRoutes} />

              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!isAdmin && <Footer />}
      {!isAdmin && <MobileNav />}
    </div>
  );
}

const SocketInitializer = lazy(() =>
  import("@/components/SocketInitializer").then((m) => ({ default: m.SocketInitializer })),
);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Suspense fallback={null}>
            <SocketInitializer />
          </Suspense>
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
