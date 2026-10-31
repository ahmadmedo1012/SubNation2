/**
 * R137 (2-b — the App.tsx route-registry decomposition): the deferred
 * app chrome — the lazy FlashSaleBanner/Footer/MobileNav/Toaster/
 * SocketInitializer chunks and their mount components
 * (DeferredSocketInitializer, IdleToaster), extracted VERBATIM from
 * App.tsx (only `export` keywords added on the three layout chunks:
 * app/routes.tsx consumes them; Toaster + SocketInitializer stay
 * module-private to this file). Each mount component is a
 * self-contained deferral wrapper (its own local mount atom + timer
 * effect — the R104/R116 contracts); App.tsx re-exports both names for
 * the gating regression suites.
 */
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/lib/auth";
import { Suspense, useEffect, useState } from "react";

// Non-critical layout deferred
export const FlashSaleBanner = lazyWithRetry(() =>
  import("@/components/layout/FlashSaleBanner").then((m) => ({ default: m.FlashSaleBanner })),
);
export const Footer = lazyWithRetry(() =>
  import("@/components/layout/Footer").then((m) => ({ default: m.Footer })),
);
export const MobileNav = lazyWithRetry(() =>
  import("@/components/layout/MobileNav").then((m) => ({ default: m.MobileNav })),
);

// A5-5 (R116 — lazy Toaster): sonner + the wrapper's five lucide icons
// used to ride the ENTRY graph for every visitor, yet toasts are an
// error/feedback surface, never first-paint content. The Toaster now
// mounts on idle via the same dynamic-import pattern main.tsx uses
// for use-toast (see IdleToaster below); ui/sonner.tsx carries a
// replay bridge that flushes toasts fired before the chunk mounted.
const Toaster = lazyWithRetry(() =>
  import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })),
);

const SocketInitializer = lazyWithRetry(() =>
  import("@/components/SocketInitializer").then((m) => ({ default: m.SocketInitializer })),
);

// R192 (T2-1): the global connectivity cue — lazy like every other
// chrome piece (never first-paint content; a first-paint-offline boot is
// covered by the PWA offline shell, and the pill appears on idle).
const ConnectivityBanner = lazyWithRetry(() =>
  import("@/components/layout/ConnectivityBanner").then((m) => ({
    default: m.ConnectivityBanner,
  })),
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
    /* R-140-f (r140 error lane): the socket initializer was the LAST
       defer-mounted chrome block without a boundary. It mounts ABOVE the
       app route boundary (it renders INSIDE App.tsx's AuthGate, beside
       the router — outside AppRoutes),
       so a render throw here — or a lazyWithRetry SECOND chunk failure
       (the first reloads; the second rethrows) — had NO boundary between
       it and the React root: React 19 unmounts the ENTIRE tree for an
       invisible block. The Toaster got this exact guard in R130 (A5-F5);
       the socket block follows the same convention — fallback={null},
       the app keeps rendering, the operator merely loses live updates
       until the next reload. */
    <ErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <SocketInitializer />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * A5-5 (R116): mounts the lazy Toaster once the main thread goes idle.
 * requestIdleCallback keeps the sonner chunk fetch + render off the
 * first-paint critical path; the 2 s timeout guarantee bounds the
 * window in which toasts queue in the sonner store instead of
 * rendering (the replay bridge in ui/sonner flushes them on mount,
 * so nothing is lost).
 *
 * Exported for the gating regression test (same pattern as
 * DeferredSocketInitializer above).
 */
export function IdleToaster() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setMounted(true), { timeout: 2_000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(() => setMounted(true), 2_000);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  return (
    /* R130 (A5-F5): the Toaster was the one defer-mounted chrome block
       with no boundary — a sonner render throw became an uncaught ROOT
       error and React 19 unmounted the whole tree. Every other chrome
       block got its fallback={null} boundary in R118-B2; the toaster
       follows the same convention (toasts are ephemeral — losing one
       render must never cost the app). */
    <ErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * R192 (T2-1): idle-mounted ConnectivityBanner — the same deferral
 * contract as IdleToaster above (requestIdleCallback with a 2 s
 * timeout fallback; an ErrorBoundary so a render throw can never
 * unmount the tree; null until mounted). Renders null while
 * online-and-stable — the chunk load is its only steady-state cost.
 */
export function DeferredConnectivityBanner() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setMounted(true), { timeout: 2_000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(() => setMounted(true), 2_000);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  return (
    <ErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <ConnectivityBanner />
      </Suspense>
    </ErrorBoundary>
  );
}
