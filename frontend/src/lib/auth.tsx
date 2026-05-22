import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { setupFirebaseTokenRefresh } from "./firebase-auth";

interface AuthContextType {
  token: string | null;
  adminToken: string | null;
  /**
   * `true` during the brief boot window while we probe `/api/auth/me`
   * to determine whether the httpOnly auth_token cookie carries a
   * valid backend session. The app shell renders `<AppSplashScreen />`
   * during this window so users never see a flash of unauthenticated
   * UI on refresh / cold start / PWA resume.
   *
   * Always becomes `false` within ~50-300 ms of mount (one same-origin
   * /api/auth/me round-trip), regardless of authentication outcome.
   */
  initializing: boolean;
  setToken: (token: string | null) => void;
  setAdminToken: (token: string | null) => void;
  logout: () => void;
  adminLogout: () => void;
  logoutAllDevices: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Sentinel value placed in `token` state when the user is authenticated
 * via the httpOnly `auth_token` cookie but the actual JWT is not
 * accessible to JavaScript (which is the desired security property).
 *
 * Effects:
 *   - `!!token` checks across the codebase resolve truthy (so
 *     `enabled: !!token`, `if (token) ...`, etc. work unchanged).
 *   - `Authorization: Bearer ${token}` headers send a useless string,
 *     but the backend's `requireUser` middleware reads `req.cookies.
 *     auth_token` FIRST and ignores invalid Authorization headers, so
 *     this is harmless. (verified in middlewares/requireUser.ts)
 *   - On real sign-in (Telegram, Google, Phone OTP), `setToken(realJwt)`
 *     replaces the sentinel with the actual JWT so subsequent requests
 *     send a valid Authorization header.
 */
const COOKIE_AUTH_SENTINEL = "__cookie_session__";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [adminToken, setAdminTokenState] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const queryClient = useQueryClient();

  /**
   * Sign-in / sign-out path. Invalidates the user-profile query so the
   * SPA picks up the new identity (or absence of one) immediately.
   */
  const setToken = useCallback(
    (t: string | null) => {
      setTokenState(t);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    },
    [queryClient],
  );

  /**
   * Background-refresh path. Used by `setupFirebaseTokenRefresh` when
   * Firebase rotates an ID token (~hourly) and the backend mints a
   * fresh JWT. The user's identity has NOT changed — only the
   * signing material — so we MUST NOT invalidate the user-profile
   * query: doing so triggers a loading state across every page that
   * watches `useGetMe`, producing the "logged out and back in" flicker
   * users were reporting on long-lived sessions.
   *
   * This setter only updates state. The Authorization header on
   * subsequent requests will read the fresh value naturally.
   */
  const setTokenSilently = useCallback((t: string | null) => {
    setTokenState(t);
  }, []);

  const setAdminToken = useCallback((t: string | null) => {
    setAdminTokenState(t);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    queryClient.clear();
  }, [queryClient, setToken]);

  const adminLogout = useCallback(() => {
    setAdminToken(null);
  }, [setAdminToken]);

  const logoutAllDevices = useCallback(async () => {
    try {
      await fetch("/api/auth/logout-all-devices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Best-effort — local logout still happens in the finally block.
      // Sentry's network instrumentation captures the actual error.
    } finally {
      logout();
    }
  }, [token, logout]);

  // ── Auth hydration probe ─────────────────────────────────────────────
  //
  // On every mount (cold boot, refresh, PWA resume), check whether the
  // httpOnly auth_token cookie carries a valid backend session. The
  // cookie is invisible to JavaScript by design, so the only way to
  // tell is to call /api/auth/me with credentials:"include". The
  // browser attaches the cookie automatically.
  //
  //   200 → user has a live session. Set `token` to the sentinel so
  //         every `!!token` check across the codebase resolves truthy,
  //         AND seed React Query's cache with the user data so
  //         useGetMe consumers (Navbar, profile, etc.) get instant
  //         results without a duplicate request.
  //
  //   401 → no session. Leave token null.
  //
  //   network error → leave token null. The app renders unauthenticated;
  //                   user can sign in normally.
  //
  // Either way we set `initializing = false` so the splash screen
  // dismisses and routes start rendering. Typical wall-clock duration
  // is 50-300 ms (one same-origin round-trip + 30 s browser cache from
  // /api/auth/me's `Cache-Control: private, max-age=30` header on hot
  // paths).
  useEffect(() => {
    let cancelled = false;
    // Use /api/auth/probe (200-always) instead of /api/auth/me. Both
    // endpoints have the same authenticated-response shape, so the
    // useGetMe queryKey pre-seed below is identical. The probe avoids
    // the cosmetic console-visible 401 on the unauthenticated path
    // that Lighthouse counts as a console error.
    fetch("/api/auth/probe", {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return; // network/5xx → unauthenticated path
        const body = await res.json().catch(() => null);
        if (!body || cancelled) return;
        if (body.authenticated && body.user) {
          setTokenState(COOKIE_AUTH_SENTINEL);
          queryClient.setQueryData(getGetMeQueryKey(), body.user);
        }
        // body.authenticated === false → leave token null, render unauthed.
      })
      .catch(() => {
        // Network error → unauthenticated. Real errors are reported
        // by Sentry's network instrumentation elsewhere.
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
    // Empty dep array: this effect intentionally runs ONCE per
    // AuthProvider lifetime. queryClient is stable across the
    // lifetime of the QueryClientProvider so omitting it is safe.
  }, []);

  // ── Firebase token-refresh listener ───────────────────────────────────
  //
  // Wired exactly once. The 2-second delay is intentional: it pushes the
  // Firebase SDK initialization off the critical-paint path. The cleanup
  // function unsubscribes on unmount AND if a remount races to install a
  // duplicate (the `installedRef` guard).
  const installedRef = useRef(false);
  useEffect(() => {
    if (installedRef.current) return;
    installedRef.current = true;

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const init = async () => {
      try {
        const sub = await setupFirebaseTokenRefresh((newToken) => {
          // Use the SILENT setter so the rotation does not invalidate
          // useGetMe — the user identity hasn't changed, only the JWT.
          setTokenSilently(newToken);
        });
        if (cancelled) {
          sub();
          return;
        }
        unsubscribe = sub;
      } catch {
        // setupFirebaseTokenRefresh has its own internal error handling
        // and Sentry instrumentation. A failure here just means we
        // won't auto-rotate the JWT (the user can still re-auth
        // manually); it is not a runtime crash.
      }
    };

    const timeout = setTimeout(init, 2000);

    return () => {
      cancelled = true;
      installedRef.current = false;
      clearTimeout(timeout);
      if (unsubscribe) unsubscribe();
    };
    // Empty dep array: this effect intentionally runs once for the
    // lifetime of the AuthProvider. Re-running on `setTokenSilently`
    // identity change would tear down and rebuild the listener on
    // every render where the function ref churned, causing duplicate
    // listeners and the very flicker we're trying to prevent.
  }, []);

  const value = useMemo(
    () => ({
      token,
      adminToken,
      initializing,
      setToken,
      setAdminToken,
      logout,
      adminLogout,
      logoutAllDevices,
    }),
    [
      token,
      adminToken,
      initializing,
      setToken,
      setAdminToken,
      logout,
      adminLogout,
      logoutAllDevices,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
