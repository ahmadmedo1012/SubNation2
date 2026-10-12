/**
 * R137 (2-b — the App.tsx route-registry decomposition): the lazy page
 * registry — every code-split route component, extracted VERBATIM from
 * App.tsx (only `export` keywords added: the consts were module-private
 * in the monolith; app/routes.tsx is their consumer now). React-free
 * module — the lazyWithRetry wrappers defer every page chunk, so the
 * entry graph stays exactly as light as before. The eager critical
 * layout (Navbar + NotFound) stays with the route tree in
 * app/routes.tsx; the deferred chrome (banner/footer/mobile-nav/
 * toaster/socket) lives in app/app-shell.tsx.
 */
import { lazyWithRetry } from "@/lib/lazy-with-retry";

// All pages are lazily code-split to minimize initial bundle weight.
// The HTML shell + vendor-react chunk are the only critical-path resources.
export const HomePage = lazyWithRetry(() => import("@/pages/home"));

export const AuthCallbackPage = lazyWithRetry(() => import("@/pages/auth-callback"));
export const TelegramCallbackPage = lazyWithRetry(() => import("@/pages/telegram-callback"));
export const LoginPage = lazyWithRetry(() => import("@/pages/login"));
export const LoyaltyPage = lazyWithRetry(() => import("@/pages/loyalty"));
export const OnboardingPage = lazyWithRetry(() => import("@/pages/onboarding"));
export const OrderDetailPage = lazyWithRetry(() => import("@/pages/order-detail"));
export const OrdersPage = lazyWithRetry(() => import("@/pages/orders"));
export const ProductPage = lazyWithRetry(() => import("@/pages/product"));
export const CategoryPage = lazyWithRetry(() => import("@/pages/category"));
export const ProfilePage = lazyWithRetry(() => import("@/pages/profile"));
export const ReferralsPage = lazyWithRetry(() => import("@/pages/referrals"));
// A9-F2 (R128-IMP-5): the full notifications page — the paged (/?page=/)
// consumer that rides past the bell's 40-row window.
export const NotificationsPage = lazyWithRetry(() => import("@/pages/notifications"));
export const RegisterPage = lazyWithRetry(() => import("@/pages/register"));
export const SupportPage = lazyWithRetry(() => import("@/pages/support"));
export const TermsPage = lazyWithRetry(() => import("@/pages/terms"));
export const WalletPage = lazyWithRetry(() => import("@/pages/wallet"));
export const CartPage = lazyWithRetry(() => import("@/pages/cart"));
export const CheckoutPage = lazyWithRetry(() => import("@/pages/checkout"));
export const FlashSalesPage = lazyWithRetry(() => import("@/pages/flash-sales"));

// Admin pages — lazy loaded so customer bundles stay small.
export const AdminLoginPage = lazyWithRetry(() => import("@/pages/admin/login"));
export const AdminDashboardPage = lazyWithRetry(() => import("@/pages/admin/dashboard"));
export const AdminTopupsPage = lazyWithRetry(() => import("@/pages/admin/topups"));
export const AdminOrdersPage = lazyWithRetry(() => import("@/pages/admin/orders"));
export const AdminProductsPage = lazyWithRetry(() => import("@/pages/admin/products"));
export const AdminPricingPage = lazyWithRetry(() => import("@/pages/admin/pricing"));
export const AdminUsersPage = lazyWithRetry(() => import("@/pages/admin/users"));
export const AdminSettingsPage = lazyWithRetry(() => import("@/pages/admin/settings"));
export const AdminSecurityPage = lazyWithRetry(() => import("@/pages/admin/security"));
export const AdminTicketsPage = lazyWithRetry(() => import("@/pages/admin/tickets"));
export const AdminReferralsPage = lazyWithRetry(() => import("@/pages/admin/referrals"));
export const AdminCouponsPage = lazyWithRetry(() => import("@/pages/admin/coupons"));
export const AdminPromotionsPage = lazyWithRetry(() => import("@/pages/admin/promotions"));
export const AdminAlertsPage = lazyWithRetry(() => import("@/pages/admin/alerts"));
export const AdminSystemPage = lazyWithRetry(() => import("@/pages/admin/system"));
export const AdminAdminsPage = lazyWithRetry(() => import("@/pages/admin/admins"));
export const AdminRiskPage = lazyWithRetry(() => import("@/pages/admin/risk"));
export const AdminRiskEventPage = lazyWithRetry(() => import("@/pages/admin/risk-event"));
export const AdminEnrichmentPage = lazyWithRetry(() => import("@/pages/admin/enrichment"));
export const AdminWhatsAppPage = lazyWithRetry(() => import("@/pages/admin/whatsapp"));

// Public pages without customer chrome
export const StatusPage = lazyWithRetry(() => import("@/pages/status"));
