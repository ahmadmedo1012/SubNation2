import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { Navbar } from "@/components/layout/Navbar";
import { MobileNav } from "@/components/layout/MobileNav";
import { Footer } from "@/components/layout/Footer";
import { FlashSaleBanner } from "@/components/layout/FlashSaleBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import HomePage from "@/pages/home";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import ProductPage from "@/pages/product";
import WalletPage from "@/pages/wallet";
import OrdersPage from "@/pages/orders";
import OrderDetailPage from "@/pages/order-detail";
import LoyaltyPage from "@/pages/loyalty";
import ReferralsPage from "@/pages/referrals";
import SupportPage from "@/pages/support";
import TermsPage from "@/pages/terms";
import ForgotPasswordPage from "@/pages/forgot-password";
import ProfilePage from "@/pages/profile";
import AdminLoginPage from "@/pages/admin/login";
import AdminDashboardPage from "@/pages/admin/dashboard";
import AdminTopupsPage from "@/pages/admin/topups";
import AdminOrdersPage from "@/pages/admin/orders";
import AdminProductsPage from "@/pages/admin/products";
import AdminUsersPage from "@/pages/admin/users";
import AdminSettingsPage from "@/pages/admin/settings";
import AdminTicketsPage from "@/pages/admin/tickets";
import AdminReferralsPage from "@/pages/admin/referrals";
import AdminCouponsPage from "@/pages/admin/coupons";
import AdminAlertsPage from "@/pages/admin/alerts";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

function AppRoutes() {
  const [location] = useLocation();
  const isAdmin = location.startsWith("/admin");
  const isAuth = location === "/login" || location === "/register";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!isAdmin && <Navbar />}
      {!isAdmin && <FlashSaleBanner />}
      <main className={!isAdmin && !isAuth ? "pb-16 md:pb-0" : ""}>
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
            <Route path="/admin/login" component={AdminLoginPage} />
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
        </ErrorBoundary>
      </main>
      {!isAdmin && <Footer />}
      {!isAdmin && <MobileNav />}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
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
