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
import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

// Customer-facing pages — eagerly loaded for the primary user journey.
import AuthCallbackPage from "@/pages/auth-callback";
import ForgotPasswordPage from "@/pages/forgot-password";
import HomePage from "@/pages/home";
import LoginPage from "@/pages/login";
import LoyaltyPage from "@/pages/loyalty";
import NotFound from "@/pages/not-found";
import OrderDetailPage from "@/pages/order-detail";
import OrdersPage from "@/pages/orders";
import ProductPage from "@/pages/product";
import ProfilePage from "@/pages/profile";
import ReferralsPage from "@/pages/referrals";
import RegisterPage from "@/pages/register";
import SupportPage from "@/pages/support";
import TermsPage from "@/pages/terms";
import WalletPage from "@/pages/wallet";

// Admin pages — lazy loaded so customer bundles stay small.
const AdminLoginPage = lazy(() => import("@/pages/admin/login"));
const AdminDashboardPage = lazy(() => import("@/pages/admin/dashboard"));
const AdminTopupsPage = lazy(() => import("@/pages/admin/topups"));
const AdminOrdersPage = lazy(() => import("@/pages/admin/orders"));
const AdminProductsPage = lazy(() => import("@/pages/admin/products"));
const AdminUsersPage = lazy(() => import("@/pages/admin/users"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/settings"));
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
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/login" component={LoginPage} />
            <Route path="/register" component={RegisterPage} />
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
        </ErrorBoundary>
      </main>
      {!isAdmin && <Footer />}
      {!isAdmin && <MobileNav />}
    </div>
  );
}

import { SocketInitializer } from "@/components/SocketInitializer";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <SocketInitializer />
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
