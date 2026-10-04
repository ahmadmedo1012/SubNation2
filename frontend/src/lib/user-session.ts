/**
 * 96-F3 (R96 M1/M3/M5 + A4 §2.1/§3.1): storefront session-expiry
 * handler — the user-side twin of lib/admin-session.
 *
 * Problem (A4 §3.1, P1): the server-side user session can die
 * MID-JOURNEY (30-day cookie expiry, logout-all-devices from another
 * device, admin deletion) while the client `token` state stays
 * truthy — it only refreshes at boot. Every subsequent storefront API
 * call then 401s and pages render generic error banners ("تعذّر تحميل
 * الطلب") with retry buttons that can never succeed. The 401 observer
 * hook existed in the shared client; only the admin side ever
 * registered a handler for it.
 *
 * Registration semantics (the coordination choke point):
 * `setUnauthorizedHandler` is a SINGLE-slot, last-registration-wins
 * API owned by useAdminHeaders (every admin page re-registers the
 * admin handler on mount). A user handler living in that slot would be
 * clobbered the first time any admin page mounts. This module instead
 * registers via the additive `addUnauthorizedHandler` registry
 * (96-F3, shared/api-client-react): every 401 notifies BOTH the
 * additive list and the admin single slot, and each handler decides by
 * URL prefix — effectively a router:
 *
 *   /api/admin/* → handleAdminUnauthorized() — admin behavior exactly
 *                  as before (its own session mirror + 15 s dedupe
 *                  make the delegation idempotent even when the admin
 *                  single-slot handler fires for the same response).
 *   /api/auth/*  → ignored — login/register/probe 401s belong to the
 *                  auth forms that triggered them.
 *   anything else → user behavior (below), only while a user session
 *                  is believed active.
 *
 * On the FIRST non-auth, non-admin 401 while a user session is
 * believed active it:
 *   1. toasts «انتهت الجلسة — سجّل دخولك مجددًا» once (15 s dedupe —
 *      parallel queries fail together on expiry; one toast, not six),
 *   2. clears the in-memory token via the auth-context callback
 *      (mounted pages with `enabled: !!token` stop refetching → no
 *      401 storm). 97-F5 (R97-A4 §2 / F-01 — P1): that callback is
 *      AuthProvider's `setToken(null)`, which now ALSO clears the
 *      ENTIRE TanStack cache (exactly like logout()) — the previous
 *      user's wallet/topups/orders data must not survive into the
 *      next sign-in on this same tab (shared-device money leak: a
 *      still-fresh <60 s cache entry is served with NO refetch at
 *      all). The catalog refetch that follows is the accepted cost
 *      of that guarantee (it used to be kept for guest browsing),
 *   3. disconnects the user socket (leave the room immediately
 *      instead of waiting for the server's 5-minute liveness sweep —
 *      setToken now performs this teardown itself; the explicit call
 *      below stays as belt-and-braces),
 *   4. soft-navigates to /login?redirect=<current> — the wouter v3
 *      SPA path (history.pushState + popstate), so the Sonner toast
 *      survives the navigation and the cart/checkout form state in
 *      localStorage is left untouched.
 */

import { addUnauthorizedHandler } from "@workspace/api-client-react";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { disconnectSocket } from "@/lib/socket";

/** Arabic toast copy for the session-expired redirect. */
export const USER_SESSION_EXPIRED_MESSAGE = "انتهت الجلسة — سجّل دخولك مجددًا";

/**
 * Suppress repeated handling within this window. On expiry, every
 * active storefront query fails with 401 in a burst; the first one
 * redirects and the rest must be no-ops (they still return `true` so
 * callers know the failure was "handled").
 */
const DEDUPE_WINDOW_MS = 15_000;

function isAdminApiUrl(url: string): boolean {
  if (url.includes("://")) {
    // Absolute URL (Expo base-URL deployments): the path segment still
    // decides. Cheap containment check — mirrors admin-session.
    return url.includes("/api/admin/");
  }
  return url.startsWith("/api/admin/");
}

function isAuthApiUrl(url: string): boolean {
  if (url.includes("://")) {
    return url.includes("/api/auth/");
  }
  return url.startsWith("/api/auth/");
}

// ── Module state (mirrored from React by <UserSessionWatcher>) ──────────────
let userSessionActive = false;
let clearUserSession: (() => void) | null = null;
let lastHandledAt = 0;

/**
 * A5-12 (R116): cached handleAdminUnauthorized, filled on the FIRST
 * admin-URL 401 by the dynamic import below. Every subsequent admin
 * 401 runs through it synchronously — byte-identical behavior to the
 * old static delegation.
 */
let handleAdminUnauthorizedRef: ((url: string) => boolean) | null = null;

/**
 * A5-12 (R116): admin-session (169 lines + its toast dependency chain)
 * used to be STATICALLY imported here — and this module hangs off the
 * entry graph via App.tsx's <UserSessionWatcher>, so every guest
 * downloaded it. It now loads on the admin-401 error path only, once
 * (module cache): admin URLs reaching this router before any admin
 * page mounted is the rare path, and any admin page mount loads the
 * module anyway (useAdminHeaders imports it statically), making the
 * dynamic resolution a cache hit.
 */
function loadAdminSessionHandler(): Promise<(url: string) => boolean> {
  return import("./admin-session").then((m) => {
    handleAdminUnauthorizedRef = m.handleAdminUnauthorized;
    return m.handleAdminUnauthorized;
  });
}

/**
 * Keep the module's view of "a user session exists" in sync with the
 * AuthProvider. Called from <UserSessionWatcher>'s effect — the tiny
 * component App mounts inside the AuthProvider tree.
 */
export function setUserSessionMirror(active: boolean, clear: (() => void) | null): void {
  userSessionActive = active;
  clearUserSession = active ? clear : null;
}

/**
 * SPA navigation to the login page carrying the current location for a
 * post-login return trip. Mirrors admin-session's navigate (wouter v3
 * monkey-patches history.pushState to dispatch a `pushState` event its
 * <Router/> subscribes to; the extra popstate dispatch is
 * belt-and-braces; the hard-assign fallback covers exotic embedding
 * contexts).
 */
function navigateToLogin(): void {
  const current = window.location.pathname + window.location.search;
  // Already on /login (e.g. a stale query refetching after the session
  // died while the user was mid-login): re-navigating would point the
  // post-login redirect at the login page itself.
  if (window.location.pathname === "/login") return;
  const target = `/login?redirect=${encodeURIComponent(current)}`;
  try {
    window.history.pushState(window.history.state, "", target);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  } catch {
    window.location.assign(target);
  }
}

/**
 * Central storefront 401 router. Returns `true` when the failure was
 * handled (toast + redirect in flight — callers should skip their own
 * generic error toast), `false` when it is not our business.
 */
export function handleUserUnauthorized(url: string): boolean {
  // Router: admin URLs keep admin-session's behavior EXACTLY — same
  // exemption list (login/probe/session), same mirror, same dedupe.
  if (isAdminApiUrl(url)) {
    const handle = handleAdminUnauthorizedRef;
    if (handle) return handle(url);
    // A5-12: admin-session not loaded yet (no admin page has mounted
    // this session — otherwise useAdminHeaders' static import would
    // have it in the module map). Load it once and run the admin
    // handling on the resolved microtask: the toast + /admin/login
    // redirect still fire (the shared client ignores this return
    // value; only the rare first call is deferred, every later one
    // is synchronous through the cached ref).
    void loadAdminSessionHandler().then((handleAdmin) => {
      handleAdmin(url);
    });
    return false;
  }
  // Auth-flow 401s (wrong OTP code, unauthenticated probe, login) are
  // the owning form's business — not mid-journey expiry.
  if (isAuthApiUrl(url)) return false;

  const now = Date.now();
  // Inside the dedupe window the burst of parallel failures that
  // follows an expiry must stay "handled" even though the session
  // flag below already flipped — otherwise each caller layers its own
  // generic error toast on top of the session-expired toast.
  if (now - lastHandledAt < DEDUPE_WINDOW_MS) return true;
  if (!userSessionActive) return false;
  lastHandledAt = now;
  userSessionActive = false;

  // A5-12 (R116): the toast shim statically imports sonner — keeping
  // it eager here pinned sonner to the ENTRY graph for every guest.
  // The 401 path is the error path (runs at most once per 15 s dedupe
  // window); the dynamic import resolves from the module cache after
  // the first call. The toast fires a microtask later — imperceptible
  // next to the navigation below, which stays synchronous.
  void import("@/hooks/use-toast")
    .then(({ toast }) => {
      toast({
        title: USER_SESSION_EXPIRED_MESSAGE,
        variant: "destructive",
        duration: 6000,
      });
    })
    .catch(() => {
      // A failed toast chunk must never block the redirect below.
    });
  try {
    clearUserSession?.();
  } catch {
    // Never let a consumer's cleanup throw break the redirect.
  }
  // Leave the (dead) user socket room immediately instead of waiting
  // for the server's mid-session liveness re-verify.
  try {
    disconnectSocket();
  } catch {
    // Best-effort — a broken socket teardown must not block login.
  }
  navigateToLogin();
  return true;
}

/**
 * Register the storefront 401 router on the shared client's ADDITIVE
 * observer registry (cannot be clobbered by the admin single-slot
 * registration). Returns the unsubscribe function.
 */
export function installUserUnauthorizedHandler(): () => void {
  return addUnauthorizedHandler(({ url }) => {
    handleUserUnauthorized(url);
  });
}

/**
 * 96-F3 (R96 A4 §3.1): the tiny mount App places inside the
 * AuthProvider tree. Mirrors the auth token into this module and
 * installs the 401 router once. Renders nothing.
 */
export function UserSessionWatcher(): null {
  const { token, setToken } = useAuth();

  // Mirror the session state + install the clear callback (stable —
  // setToken is a useCallback inside AuthProvider). 97-F5 (F-01): the
  // clear callback is the full identity-switch teardown — token null +
  // ENTIRE query-cache clear + socket disconnect — so the 401 path
  // inherits the cache purge automatically.
  useEffect(() => {
    setUserSessionMirror(!!token, token ? () => setToken(null) : null);
  }, [token, setToken]);

  // Install the additive 401 observer once per app load.
  useEffect(() => installUserUnauthorizedHandler(), []);

  return null;
}

/** Test-only: reset module state between cases. */
export function __resetUserSessionForTests(): void {
  userSessionActive = false;
  clearUserSession = null;
  lastHandledAt = 0;
  // A5-12: drop the cached admin handler too, so each case exercises
  // the same first-call path production sees after a fresh boot.
  handleAdminUnauthorizedRef = null;
}
