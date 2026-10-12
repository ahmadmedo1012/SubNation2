/**
 * R137 (FE) — the App.tsx route-registry decomposition contract.
 *
 * The application root was a 1,221-line monolith: ~45 lazy page
 * imports, the ROUTE_SHAPES regexp map, the 96-F3 boot head-start, the
 * A2 F4 route-chunk warm-up listeners, the wouter route tree AND the
 * whole app shell (SEO fallback, chrome gating, splash gate) in ONE
 * module. The R136 checkout.tsx precedent applied to the root: App.tsx
 * is now the orchestration core (the provider stack, AuthGate, the
 * shell mount) and the route registry lives under src/app/* —
 *
 *   • app/route-shapes.ts        ROUTE_SHAPES + shapeForRoute + the
 *                                robots.txt-mirroring noindex map
 *   • app/page-registry.ts       every lazy code-split page chunk
 *   • app/routes.tsx             AppRoutes + AdminProtectedRoutes +
 *                                ScrollToTop/RouteAnnouncer/alias
 *   • app/app-shell.tsx          deferred chrome + its mount gates
 *   • app/query-client.ts        the app-wide QueryClient + retry
 *   • app/boot-head-start.ts     the 96-F3/R111-F4-F3/R127-L10 boot
 *   • app/route-chunk-warmup.ts  the A2 F4 hover/focus warm-up
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep /
 * checkout-decomposition-r136 idiom — structural invariants a render
 * test only covers incidentally). The RENDER/API contract is pinned by
 * the existing suites through the preserved @/App re-export surface
 * (route-shapes, route-chunk-warmup, head-start-gating,
 * boot-card-image-warmup, auth-gate-optimistic-login,
 * products-alias-r129, route-change-focus,
 * deferred-socket/idle-toaster gating, query-retry-predicate) plus
 * the source unions in admin-layout-shell-a11y /
 * mobile-nav-clearance / error-boundary-reset; this file guards the
 * STRUCTURE so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the root stays an orchestration core (it was
 *      1,221 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every new app/* module is still referenced
 *      (directly by App.tsx, or by its in-graph consumer), and the
 *      full route table stays registered;
 *   3. ownership/API pins — the pre-R137 public surface of @/App
 *      keeps resolving through the re-export block (shapeForRoute
 *      above all), the lazy warm-up calls keep their exact module
 *      specifiers, and the boot gates keep their MODE !== "test"
 *      guards so vitest imports stay inert;
 *   4. purity — the five React-free .ts modules stay React-free.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const app = read("src/App.tsx");
const routeShapes = read("src/app/route-shapes.ts");
const pageRegistry = read("src/app/page-registry.ts");
const routes = read("src/app/routes.tsx");
const appShell = read("src/app/app-shell.tsx");
const queryClientModule = read("src/app/query-client.ts");
const bootHeadStart = read("src/app/boot-head-start.ts");
const routeChunkWarmup = read("src/app/route-chunk-warmup.ts");

describe("R137 (FE) — App.tsx decomposition: the root stays an orchestration core", () => {
  it("src/App.tsx stays under the 1,000-line ceiling (was 1,221 at decomposition)", () => {
    expect(app.split("\n").length).toBeLessThan(1000);
  });

  it("App.tsx references every app module (deletion guard — a dropped reference is a vanished registry)", () => {
    // Six direct references (imports + the API-compat re-export
    // block). The seventh module — the page registry — is consumed by
    // the route tree (nested-consumer pin in the next test).
    for (const specifier of [
      "@/app/route-shapes",
      "@/app/routes",
      "@/app/app-shell",
      "@/app/query-client",
      "@/app/boot-head-start",
      "@/app/route-chunk-warmup",
    ]) {
      expect(app, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("app/routes.tsx consumes the page registry (the nested-consumer deletion guard)", () => {
    expect(routes).toContain('} from "@/app/page-registry";');
    // …and every registry name is referenced by the tree below.
    expect(routes).toContain("component={HomePage}");
    expect(routes).toContain("component={StatusPage}");
    expect(routes).toContain("component={AdminSystemPage}");
    expect(routes).toContain("component={AdminWhatsAppPage}");
  });

  it("the wouter route tree stays complete (every registration is a deletion surface)", () => {
    for (const registration of [
      '<Route path="/" component={HomePage} />',
      '<Route path="/products" component={ProductsAliasRedirect} />',
      '<Route path="/login" component={LoginPage} />',
      '<Route path="/register" component={RegisterPage} />',
      '<Route path="/onboarding" component={OnboardingPage} />',
      '<Route path="/product/:slug" component={ProductPage} />',
      '<Route path="/category/:slug" component={CategoryPage} />',
      '<Route path="/wallet" component={WalletPage} />',
      '<Route path="/orders" component={OrdersPage} />',
      '<Route path="/orders/:orderCode" component={OrderDetailPage} />',
      '<Route path="/loyalty" component={LoyaltyPage} />',
      '<Route path="/referrals" component={ReferralsPage} />',
      '<Route path="/notifications" component={NotificationsPage} />',
      '<Route path="/support" component={SupportPage} />',
      '<Route path="/status" component={StatusPage} />',
      '<Route path="/terms" component={TermsPage} />',
      '<Route path="/profile" component={ProfilePage} />',
      '<Route path="/cart" component={CartPage} />',
      '<Route path="/checkout" component={CheckoutPage} />',
      '<Route path="/flash-sales" component={FlashSalesPage} />',
      '<Route path="/auth/callback" component={AuthCallbackPage} />',
      '<Route path="/auth/telegram-callback" component={TelegramCallbackPage} />',
      '<Route path="/admin/login" component={AdminLoginPage} />',
      '<Route path="/admin" component={AdminProtectedRoutes} />',
      '<Route path="/admin/*" component={AdminProtectedRoutes} />',
      '<Route path="/admin/topups" component={AdminTopupsPage} />',
      '<Route path="/admin/orders" component={AdminOrdersPage} />',
      '<Route path="/admin/products" component={AdminProductsPage} />',
      '<Route path="/admin/products/enrichment" component={AdminEnrichmentPage} />',
      '<Route path="/admin/pricing" component={AdminPricingPage} />',
      '<Route path="/admin/users" component={AdminUsersPage} />',
      '<Route path="/admin/settings" component={AdminSettingsPage} />',
      '<Route path="/admin/security" component={AdminSecurityPage} />',
      '<Route path="/admin/tickets" component={AdminTicketsPage} />',
      '<Route path="/admin/referrals" component={AdminReferralsPage} />',
      '<Route path="/admin/coupons" component={AdminCouponsPage} />',
      '<Route path="/admin/promotions" component={AdminPromotionsPage} />',
      '<Route path="/admin/alerts" component={AdminAlertsPage} />',
      '<Route path="/admin/system" component={AdminSystemPage} />',
      '<Route path="/admin/admins" component={AdminAdminsPage} />',
      '<Route path="/admin/risk" component={AdminRiskPage} />',
      '<Route path="/admin/risk/events/:id" component={AdminRiskEventPage} />',
      '<Route path="/admin/whatsapp" component={AdminWhatsAppPage} />',
    ]) {
      expect(routes, registration).toContain(registration);
    }
    // Both 404 fallbacks (the admin subtree's + the public Switch's).
    expect((routes.match(/<Route component=\{NotFound\} \/>/g) ?? []).length).toBe(2);
  });

  it("the provider stack + boot gate stay IN App.tsx (the orchestration core)", () => {
    expect(app).toContain("<QueryClientProvider client={queryClient}>");
    expect(app).toContain('<WouterRouter base={import.meta.env.BASE_URL.replace(/\\/$/, "")}>');
    expect(app).toContain("<AppRoutes />");
    expect(app).toContain("<AuthGate>");
    expect(app).toContain("<AppSplashScreen />");
    expect(app).toContain("<IdleToaster />");
    expect(app).toContain("<DeferredSocketInitializer />");
    // The R127-L10 /login exception + its predicate stay with the gate.
    expect(app).toContain("export function isLoginBootPath(");
    expect(app).toContain("export function AuthGate({ children }: { children: React.ReactNode })");
  });

  it("App.tsx declares no registry of its own (the app modules own the moved halves)", () => {
    // No lazy chunk declarations, no route table, no shape map, no
    // boot/warm-up machinery — those live in the app/* modules.
    expect(app).not.toMatch(/lazyWithRetry\(/);
    expect(app).not.toMatch(/<Route\s/);
    expect(app).not.toContain("const ROUTE_SHAPES:");
    expect(app).not.toContain("startBootHeadStart");
    expect(app).not.toContain("installRouteWarmupListeners");
    expect(app).not.toContain("function AdminProtectedRoutes");
  });
});

describe("R137 (FE) — the pre-R137 public API keeps resolving (ownership/API pins)", () => {
  it("the App.tsx re-export block preserves every export-for-test name verbatim", () => {
    expect(app).toContain('export { shapeForRoute } from "@/app/route-shapes";');
    expect(app).toContain('export { isRetryableQueryError } from "@/app/query-client";');
    expect(app).toContain(
      'export { bootCardImageWarmUrls, isHomeBootPath } from "@/app/boot-head-start";',
    );
    expect(app).toContain('export { routeWarmupFamilyForPath } from "@/app/route-chunk-warmup";');
    expect(app).toContain(
      'export { ProductsAliasRedirect, ScrollToTop, RouteAnnouncer } from "@/app/routes";',
    );
    expect(app).toContain(
      'export { DeferredSocketInitializer, IdleToaster } from "@/app/app-shell";',
    );
    // …and the two halves that stayed local, plus the default export
    // main.tsx mounts.
    expect(app).toContain("export default App;");
  });

  it("ROUTE_SHAPES + shapeForRoute live in app/route-shapes (the route-shapes.test import path)", () => {
    expect(routeShapes).toContain("const ROUTE_SHAPES: Array<[RegExp, RouteSkeletonShape]> = [");
    expect(routeShapes).toContain(
      "export function shapeForRoute(path: string): RouteSkeletonShape {",
    );
    // Order-sensitivity (B6 P2-17c): the admin-login form entry stays
    // ahead of the bare admin shell; the order/:code entry ahead of
    // the list.
    expect(routeShapes).toContain('[/^\\/admin\\/login/, "form"],');
    expect(routeShapes).toContain('[/^\\/admin/, "admin"],');
    expect(routeShapes).toContain('[/^\\/orders\\/[^/]+/, "order"],');
    expect(routeShapes).toContain('[/^\\/orders$/, "list"],');
    // The robots.txt-mirroring noindex map rides along.
    expect(routeShapes).toContain(
      "export function robotsForPath(path: string | undefined): string {",
    );
  });

  it("the lazy page registry keeps its specifiers (the chunks the entry graph expects)", () => {
    for (const declaration of [
      'export const HomePage = lazyWithRetry(() => import("@/pages/home"));',
      'export const CheckoutPage = lazyWithRetry(() => import("@/pages/checkout"));',
      'export const ProductPage = lazyWithRetry(() => import("@/pages/product"));',
      'export const AdminLoginPage = lazyWithRetry(() => import("@/pages/admin/login"));',
      'export const AdminSystemPage = lazyWithRetry(() => import("@/pages/admin/system"));',
      'export const StatusPage = lazyWithRetry(() => import("@/pages/status"));',
    ]) {
      expect(pageRegistry, declaration).toContain(declaration);
    }
    // The registry is lazy-only — the eager critical layout stays with
    // the route tree in app/routes.tsx.
    expect(pageRegistry).not.toContain("@/pages/not-found");
    expect(pageRegistry).not.toContain("@/components/layout/Navbar");
  });

  it("the boot/warm-up specifiers keep their exact module IDs (zero-RTT warm contracts)", () => {
    // Leg (a) of the 96-F3 head-start: the SAME specifier the lazy
    // route resolves against.
    expect(bootHeadStart).toContain('void import("@/pages/home").catch(');
    // A2 F4: the five hover/focus families.
    expect(routeChunkWarmup).toContain(
      'product: [/^\\/product\\//, () => import("@/pages/product")],',
    );
    expect(routeChunkWarmup).toContain(
      'category: [/^\\/category\\//, () => import("@/pages/category")],',
    );
    expect(routeChunkWarmup).toContain('cart: [/^\\/cart/, () => import("@/pages/cart")],');
    expect(routeChunkWarmup).toContain(
      'checkout: [/^\\/checkout/, () => import("@/pages/checkout")],',
    );
    expect(routeChunkWarmup).toContain('wallet: [/^\\/wallet/, () => import("@/pages/wallet")],');
  });

  it('the module-scope boot gates keep their MODE !== "test" guards (vitest imports stay inert)', () => {
    expect(bootHeadStart).toContain('import.meta.env.MODE !== "test"');
    expect(bootHeadStart).toContain("startBootHeadStart();");
    expect(routeChunkWarmup).toContain('import.meta.env.MODE !== "test"');
    expect(routeChunkWarmup).toContain("installRouteWarmupListeners();");
  });

  it("the shell-gating contracts ride verbatim in app/routes.tsx (the source-union pins stay meaningful)", () => {
    // error-boundary-reset: the four chrome blocks + the route
    // boundary keep their exact shapes at the new address.
    expect(
      (routes.match(/<ErrorBoundary resetKey=\{location\} fallback=\{null\}>/g) ?? []).length,
    ).toBeGreaterThanOrEqual(4);
    expect(routes).toContain("<ErrorBoundary resetKey={location}>");
    expect(routes).toContain(
      "{!isAdmin && !isChromeless && (\n        <ErrorBoundary resetKey={location} fallback={null}>\n          <Navbar />",
    );
    // route-change-focus: the focusable <main> contract.
    expect(routes).toContain('<main\n        id="main-content"\n        tabIndex={-1}');
    // mobile-nav-clearance: the authed content clearance.
    expect(routes).toContain("mobile-nav-safe-pad");
    // admin-layout-shell-a11y: the skip link stays chromeless-gated
    // only (R125 A6 B-7) with its Arabic label intact.
    expect(routes).toContain('{!isChromeless && (\n        <a\n          href="#main-content"');
    expect(routes).toContain("focus:not-sr-only");
    expect(routes).toContain("تخطّى إلى المحتوى الرئيسي");
  });

  it("the deferred chrome keeps its chunk boundaries in app/app-shell.tsx", () => {
    expect(appShell).toContain(
      'import("@/components/layout/FlashSaleBanner").then((m) => ({ default: m.FlashSaleBanner }))',
    );
    expect(appShell).toContain(
      'import("@/components/layout/Footer").then((m) => ({ default: m.Footer }))',
    );
    expect(appShell).toContain(
      'import("@/components/layout/MobileNav").then((m) => ({ default: m.MobileNav }))',
    );
    expect(appShell).toContain(
      'import("@/components/ui/sonner").then((m) => ({ default: m.Toaster }))',
    );
    expect(appShell).toContain(
      'import("@/components/SocketInitializer").then((m) => ({ default: m.SocketInitializer }))',
    );
    // The R104 admin-only sentinel + the A5-5 idle mount stay intact.
    expect(appShell).toContain("export function DeferredSocketInitializer() {");
    expect(appShell).toContain("export function IdleToaster() {");
  });

  it("the QueryClient singleton + retry predicate live in app/query-client.ts", () => {
    expect(queryClientModule).toContain("export const queryClient = new QueryClient({");
    expect(queryClientModule).toContain(
      "export function isRetryableQueryError(error: unknown): boolean {",
    );
    // The 98-F7 retry policy rides with the client.
    expect(queryClientModule).toContain("retry: (failureCount: number, error: unknown) =>");
  });
});

describe("R137 (FE) — the React-free app modules stay React-free (purity pins)", () => {
  it("route-shapes / page-registry / query-client / boot-head-start / route-chunk-warmup import nothing from react", () => {
    for (const [name, src] of [
      ["route-shapes.ts", routeShapes],
      ["page-registry.ts", pageRegistry],
      ["query-client.ts", queryClientModule],
      ["boot-head-start.ts", bootHeadStart],
      ["route-chunk-warmup.ts", routeChunkWarmup],
    ] as const) {
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
  });

  it("route-chunk-warmup stays import-free (globals + dynamic imports only)", () => {
    expect(routeChunkWarmup).not.toMatch(/^import /m);
  });
});
