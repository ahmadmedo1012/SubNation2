/**
 * App.tsx — the application root, now the orchestration core of the
 * R137 (2-b) route-registry decomposition (was a 1,221-line monolith:
 * ~45 lazy page imports, the ROUTE_SHAPES map, the boot head-start,
 * the route-chunk warm-up, the wouter route tree and the whole app
 * shell in one module).
 *
 * What STAYS here (the orchestration core): the provider stack
 * (QueryClient → Theme → Auth → the 401 router + session watchers),
 * the AuthGate boot gate (the R127-L10 /login exception + the splash
 * threshold) and the shell mount (DeferredSocketInitializer, the
 * router, IdleToaster). What MOVED (verbatim, byte-identical):
 *   • @/app/route-shapes        — ROUTE_SHAPES + shapeForRoute + the
 *                                 robots.txt-mirroring noindex map
 *   • @/app/page-registry       — every lazy code-split page chunk
 *   • @/app/routes              — AppRoutes + the admin subtree +
 *                                 ScrollToTop/RouteAnnouncer/alias
 *   • @/app/app-shell           — deferred chrome + its mount gates
 *   • @/app/query-client        — the app-wide QueryClient + retry
 *   • @/app/boot-head-start     — the 96-F3/R111-F4-F3/R127-L10 boot
 *   • @/app/route-chunk-warmup  — the A2 F4 hover/focus warm-up
 *
 * The pre-R137 public API of this module is preserved verbatim below
 * (re-export block): main.tsx's default import and every
 * export-for-test name keep resolving, so no importer changes.
 */
import { AppSplashScreen } from "@/components/AppSplashScreen";
import { SessionActivityManager } from "@/components/SessionActivityManager";
import { AuthProvider, useAuth } from "@/lib/auth";
import { UserSessionWatcher } from "@/lib/user-session";
import { useDocumentDirection } from "@/lib/direction";
import { ThemeProvider } from "@/lib/theme";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Router as WouterRouter } from "wouter";

import { queryClient } from "@/app/query-client";
import { AppRoutes } from "@/app/routes";
import { DeferredSocketInitializer, IdleToaster } from "@/app/app-shell";

// ── Pre-R137 public API — preserved verbatim (API compat) ────────────────
// The implementations moved to the src/app/* modules; every import of
// these names from "@/App" / "../App" (main.tsx + the export-for-test
// suites: route-shapes, route-chunk-warmup, head-start-gating,
// boot-card-image-warmup, products-alias-r129, route-change-focus,
// auth-gate-optimistic-login, deferred-socket-gating, idle-toaster-
// gating, query-retry-predicate) keeps resolving unchanged.
export { shapeForRoute } from "@/app/route-shapes";
export { isRetryableQueryError } from "@/app/query-client";
export { bootCardImageWarmUrls, isHomeBootPath } from "@/app/boot-head-start";
export { routeWarmupFamilyForPath } from "@/app/route-chunk-warmup";
export { ProductsAliasRedirect, ScrollToTop, RouteAnnouncer } from "@/app/routes";
export { DeferredSocketInitializer, IdleToaster } from "@/app/app-shell";

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
 * R127-L10 (B4 D3): pure boot-path predicate — is this boot the PUBLIC
 * login route? TRUE only for the exact /login path (query strings are
 * irrelevant — the login form is identical with ?redirect=/?error=/?ref=
 * and AuthErrorBanner's param-stripping uses replaceState, keeping the
 * pathname). Admin login (/admin/login) is a DIFFERENT surface (its own
 * page, its own probe) and must never pass. Exported for the regression
 * suite (same pattern as isHomeBootPath / routeWarmupFamilyForPath).
 */
export function isLoginBootPath(pathname: string, routerBase: string): boolean {
  return pathname === `${routerBase}/login`;
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
 * ── R127-L10 (B4 D3): the /login exception ────────────────────────
 * Live (B4 §B/§C) the login route was the worst run of the fleet
 * (mobile score 66, TBT 621 ms at the poor boundary, LCP 4,260 ms)
 * because its LCP element — the rendered «المتابعة عبر Telegram»
 * button — sat BEHIND this gate with elementRenderDelay 2,220 ms:
 * JS boot → probe (a full origin RTT, 0.6–0.9 s live — the
 * ~50-300 ms claim in auth.tsx's docclaim is stale) → login chunk →
 * /api/auth/providers → paint. The probe gated paint while carrying
 * ZERO information the login form needs: LoginPage and its
 * AuthProviders render no token-dependent content (verified —
 * AuthProviders reads useAuth() for setToken only), so the page is
 * byte-identical for guests and cookie-authed visitors.
 *
 * So: on a /login boot the gate renders `children` optimistically
 * while the probe is in flight. The login chunk + providers fetch
 * start immediately (parallel with the probe) and paint without
 * waiting for identity. Safety properties:
 *
 *   - Every OTHER route (the money pages checkout/wallet/orders
 *     included) keeps the exact splash contract below — no
 *     unauthenticated UI can flash anywhere identity matters.
 *   - On /login itself there is no flash-of-wrong-content by
 *     construction: the optimistic tree IS the post-probe tree
 *     (same children, same route match; the probe only flips
 *     Navbar's auth chip, and only for already-authed visitors on
 *     a page whose content is the same login form either way).
 *   - Auth-gate semantics are otherwise intact: no post-probe
 *     redirect was added (today /login renders the login form to
 *     authed users too — preserved verbatim), and when the probe
 *     lands the tree does not remount (children identity is
 *     unchanged; only the conditional branches disappear).
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
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { initializing } = useAuth();
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    if (!initializing) return;
    const timer = setTimeout(() => setShowSplash(true), 250);
    return () => clearTimeout(timer);
  }, [initializing]);

  // R127-L10 (B4 D3): the /login-boot verdict, computed ONCE per gate
  // lifetime from the boot URL. During `initializing` no SPA navigation
  // can have happened before the first render (the router is inside
  // `children` and has not mounted yet), so window.location.pathname IS
  // the boot path; the memo keeps the verdict stable for the whole
  // probe window even if an in-window navigation follows (the router is
  // then live inside the optimistic tree and handles it natively).
  const loginBoot = useMemo(() => {
    if (typeof window === "undefined") return false;
    const routerBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    return isLoginBootPath(window.location.pathname, routerBase);
  }, []);

  if (initializing && !loginBoot) {
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
