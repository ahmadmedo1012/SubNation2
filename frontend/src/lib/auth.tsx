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
import { setUserAuthToken } from "./auth-token-holder";
import { disconnectSocket } from "./socket";

interface AuthContextType {
  token: string | null;
  adminToken: string | null;
  /**
   * Permission scopes granted to the currently-logged-in admin.
   * Empty array when not logged in. Set on login/probe response;
   * `hasAdminPermission(scope)` is the canonical check (handles
   * the "all" wildcard).
   */
  adminPermissions: string[];
  /**
   * `true` during the brief boot window while we probe `/api/auth/me`
   * to determine whether the httpOnly auth_token cookie carries a
   * valid backend session. The app shell renders `<AppSplashScreen />`
   * during this window so users never see a flash of unauthenticated
   * UI on refresh / cold start / PWA resume.
   *
   * Always becomes `false` within one same-origin /api/auth/me
   * round-trip of mount (measured live 0.3–0.9 s on Libyan mobile
   * networks — R127-B4; exact-/login boots render optimistically
   * through the probe per R127-L10), regardless of outcome.
   */
  initializing: boolean;
  setToken: (token: string | null) => void;
  setAdminToken: (token: string | null) => void;
  setAdminPermissions: (permissions: string[]) => void;
  hasAdminPermission: (scope: string) => boolean;
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
 *   - 98-F3 (R98 backend round — mirror of R97-02): the session-mint
 *     routes (POST /api/auth/firebase/session, /firebase/refresh,
 *     /whatsapp/verify, /telegram, /telegram/webapp) no longer return
 *     the raw JWT in the body — they return THIS sentinel string in the
 *     `token` field (the httpOnly cookie is the sole session
 *     transport). Every real sign-in therefore ALSO lands here:
 *     WhatsAppPhoneSignIn / AuthProviders / telegram-callback /
 *     use-telegram-webapp-auto-login call `setToken(data.token)` and
 *     store the sentinel, exactly like the boot probe below. No raw
 *     user JWT is reachable from JS memory anymore (the admin surface
 *     closed the same gap in R97-02).
 */
export const COOKIE_AUTH_SENTINEL = "__cookie_session__";

/**
 * A5-2 (R116): hard ceiling for the boot probes. A hanging /api/auth/probe
 * (server stalled, proxy black-holing) used to hold the splash screen
 * FOREVER — Promise.allSettled only settles once both probes do. 10 s is
 * ~30× the normal 50-300 ms probe; past it the answer is "treat as
 * unauthenticated" (the same path as a 401) so the app always boots.
 */
const BOOT_PROBE_TIMEOUT_MS = 10_000;

/**
 * A5-2: AbortSignal.timeout, degrading to an unbounded probe on engines
 * that lack it (older Safari / embedded webviews) — a missing signal must
 * never throw at boot (that would break the effect before the .catch
 * chains and hang the splash permanently).
 */
function bootProbeSignal(): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(BOOT_PROBE_TIMEOUT_MS);
    }
  } catch {
    // Degrade to an unbounded probe.
  }
  return undefined;
}

/**
 * A5-1 (R116): does this boot identity carry a Firebase-backed
 * credential (Google sign-in / legacy Firebase-era users)?
 *
 * The background token refresher only does anything when the browser
 * holds a signed-in Firebase SDK user — i.e. identities minted through
 * Firebase. WhatsApp / Telegram users and guests never have one, so
 * arming the refresher for them imported the whole Firebase SDK
 * (~100 KB+ gz) 2 s after load for a listener that fires once with a
 * null user and then idles forever.
 *
 * Fields come straight off the /api/auth/probe (and /me) user payload:
 *   - `auth_provider`: "firebase_google" (Google), "firebase" (other
 *     Firebase), "firebase_phone" (legacy Firebase-era default) vs
 *     "whatsapp_phone" / "telegram" for the cookie-native providers.
 *   - `linked_identities[].provider`: "firebase.com" for linked
 *     Firebase identities (the account-link flow) — belt and braces
 *     for users whose primary tag is a cookie-native provider but who
 *     also carry a Google identity.
 *
 * Exported for the gating regression test (auth-firebase-gating).
 */
export function isFirebaseBackedUser(user: unknown): boolean {
  if (!user || typeof user !== "object") return false;
  const { auth_provider: authProvider, linked_identities: linked } = user as {
    auth_provider?: unknown;
    linked_identities?: unknown;
  };
  if (typeof authProvider === "string" && authProvider.startsWith("firebase")) {
    return true;
  }
  if (!Array.isArray(linked)) return false;
  return linked.some(
    (identity) =>
      identity !== null &&
      typeof identity === "object" &&
      typeof (identity as { provider?: unknown }).provider === "string" &&
      ["firebase.com", "google.com"].includes((identity as { provider: string }).provider),
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [adminToken, setAdminTokenState] = useState<string | null>(null);

  // Round-3 (8-f §1): mirror the session token into the module-level
  // holder consumed by customFetch's registered auth-token getter, so
  // every orval request gains a correct bearer (or none, when running
  // on cookie auth) without per-call-site header plumbing.
  useEffect(() => {
    setUserAuthToken(token);
  }, [token]);
  const [adminPermissions, setAdminPermissionsState] = useState<string[]>([]);
  const [initializing, setInitializing] = useState(true);
  /**
   * A5-1 (R116): set to true by the boot probe when (and only when) the
   * authenticated identity is Firebase-backed (Google sign-in / legacy
   * Firebase-era users). Gates the background token-refresher effect
   * below — see isFirebaseBackedUser for the field contract.
   */
  const [firebaseIdentity, setFirebaseIdentity] = useState(false);
  const queryClient = useQueryClient();

  /**
   * Sign-in / sign-out path — the IDENTITY-SWITCH choke point. Every
   * caller is a real identity event (login pages, logout, the 401
   * session-expiry handler in lib/user-session); silent JWT rotation
   * deliberately uses setTokenSilently below so a rotating token never
   * pays this teardown.
   *
   * 97-F5 (R97-A4 §2 / F-01 — P1): on an identity switch this now clears
   * the ENTIRE TanStack cache — exactly what logout() has always done —
   * instead of invalidating only /api/auth/me. On a shared device the
   * 401-then-new-sign-in flow used to serve the PREVIOUS user's still
   * fresh (<60 s staleTime) wallet/topups/orders cache to the next user
   * with no refetch ever firing (TanStack keeps last-good data on error,
   * and refetchOnWindowFocus/Reconnect are disabled app-wide).
   * Call order mirrors logout()'s proven sequence (state → invalidate me
   * → clear): the invalidate arms any still-mounted observer, clear()
   * removes every cached family (wallet, topups, orders, admin lists,
   * catalog), and the post-render observers rebuild their queries empty
   * under the new identity and refetch.
   *
   * 97-F5 (R97-A4 §7 / F-03 — P2): the user socket's room membership is
   * bound at handshake from the auth_token cookie (server-driven join;
   * client `join-user` is a defensive no-op), so an identity switch
   * MUST tear the socket down — leaving it connected would keep it in
   * the PREVIOUS user's room (their money events toasting on the next
   * user's screen). The next useSocket(userId) mount lazily reconnects
   * with the fresh cookie and the server auto-joins the new room.
   * logout() and the 401 handler already did this; setToken closing the
   * same gap also covers the login-without-logout path (login.tsx has
   * no guard for already-signed-in visitors).
   */
  const setToken = useCallback(
    (t: string | null) => {
      setTokenState(t);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      queryClient.clear();
      // Leave the (previous user's) socket room immediately.
      disconnectSocket();
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

  /**
   * Admin sign-in / sign-out path — the ADMIN identity-switch choke
   * point (login page, adminLogout, the 401 redirect handler via
   * useAdminHeaders' mirror callback, App.tsx's session guard).
   *
   * 97-F5 (R97-A4 §6 / F-04 — P2): on any admin identity switch the
   * admin-scoped query cache is REMOVED (not invalidated — removal
   * guarantees the next admin never even flashes the previous admin's
   * data while a refetch is in flight). Admin lists carry PII
   * (/api/admin/users phone numbers, orders buyer data); on a shared
   * machine an admin-B login used to see admin-A's fresh dashboard for
   * up to 60 s (staleTime) — or 300 s (the dashboard's poll fallback).
   * Storefront queries are deliberately untouched: a user session can
   * legitimately survive an admin switch in the same tab.
   */
  const setAdminToken = useCallback(
    (t: string | null) => {
      setAdminTokenState(t);
      // 98-F7 (R98-07): clearing the admin session ALSO clears the admin
      // alert toast cursor (sn_last_alert_id, written by AdminLayout's
      // alert poller). It used to survive every logout path forever: on a
      // shared machine, admin B logging in hours later inherited admin
      // A's cursor — every alert that fired during B's absence was
      // silently swallowed (poll uses ?since=<stale cursor>). Placed here
      // (the admin identity-switch choke point) rather than in
      // adminLogout alone so the 401-expiry path (useAdminHeaders'
      // clearAdminSession mirror) and App.tsx's session guard get the
      // same reset for free — every "admin session ends" route goes
      // through setAdminToken(null).
      if (t === null) {
        try {
          localStorage.removeItem("sn_last_alert_id");
        } catch {
          // Storage unavailable (private-mode edge) — nothing to clear.
        }
        // R127-B6-5 (B6 sockets audit): mirror the user path's F-03 rule
        // below — an admin identity switch MUST tear the socket down.
        // setAdminToken(null) previously left the singleton connected:
        // the server's 5-minute liveness sweep was the only thing
        // stripping the dead adminSessionId from admin-room /
        // admin-alerts-room, so a logged-out browser kept receiving
        // admin-room payloads (live order/topup PII) on the transport
        // for 0–5 minutes (SocketInitializer's listeners were already
        // off — but the PII still crossed the wire). The next
        // connectAdminSocket() lazily mints a fresh singleton after the
        // next admin login.
        disconnectSocket();
      }
      queryClient.removeQueries({
        predicate: (query) => {
          const first = query.queryKey[0];
          return (
            typeof first === "string" &&
            (first === "admin" ||
              // A5-3 (R116): the "admin" root carries the AdminProtectedRoutes
              // session guard (App.tsx). A stale "session valid" verdict from
              // the previous operator must never admit the next one without a
              // fresh /api/admin/session round-trip — every admin-session-END
              // path (logout, 401 expiry, App.tsx's guard) funnels through
              // setAdminToken(null), so the guard cache dies with the session.
              first.startsWith("/api/admin") ||
              first.startsWith("admin-alerts"))
          );
        },
      });
    },
    [queryClient],
  );

  const setAdminPermissions = useCallback((perms: string[]) => {
    setAdminPermissionsState(Array.isArray(perms) ? perms : []);
  }, []);

  const hasAdminPermission = useCallback(
    (scope: string): boolean => {
      if (!adminPermissions.length) return false;
      return adminPermissions.includes("all") || adminPermissions.includes(scope);
    },
    [adminPermissions],
  );

  const logout = useCallback(() => {
    // 93-C5 / F-05 (A4 P1 #1): logout was client-only — setToken(null) +
    // queryClient.clear() left the server session row AND the httpOnly
    // auth_token cookie alive, so any page refresh (or a new tab) silently
    // logged the user back in — a privacy hole on shared devices (wallet
    // balance + paid credentials with reveal buttons all came back).
    // The backend's POST /api/auth/logout deletes the session row, revokes
    // Firebase tokens and clears the cookie (routes/auth.ts /logout).
    // Fire-and-forget like adminLogout above: even if the network call
    // fails, the local state clear below still signs the user out of the
    // SPA; the next probe then re-detects the (still-valid) cookie — the
    // honest degraded outcome for an offline logout.
    fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => {
      // Best-effort — Sentry's network instrumentation captures the error.
    });
    // 97-F5 (F-01 + F-03): setToken(null) now performs the full identity
    // teardown — socket disconnect + ENTIRE query-cache clear (the exact
    // inline steps logout() used to run itself; one code path, identical
    // net behavior: leave the user's socket room immediately instead of
    // waiting for the server's 5-minute liveness sweep, and drop every
    // cached user-scoped family).
    setToken(null);
  }, [setToken]);

  const adminLogout = useCallback(async () => {
    try {
      // Server-side cookie clear. The admin_token is httpOnly so JS
      // can't clear it directly — we need the server to emit a
      // Set-Cookie with maxAge=0. Best-effort: even if the network
      // call fails, the local state clear below still kicks the user
      // back to the login page.
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Sentry's network instrumentation captures the actual error.
    } finally {
      setAdminToken(null);
      setAdminPermissionsState([]);
    }
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
    //
    // A5-2 (R116): both probes carry a 10 s abort signal — a stalled
    // network can no longer hold the splash screen hostage (the abort
    // rejection lands in the .catch → unauthenticated → the app boots).
    const userProbe = fetch("/api/auth/probe", {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: bootProbeSignal(),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return; // network/5xx → unauthenticated path
        const body = await res.json().catch(() => null);
        if (!body || cancelled) return;
        if (body.authenticated && body.user) {
          setTokenState(COOKIE_AUTH_SENTINEL);
          queryClient.setQueryData(getGetMeQueryKey(), body.user);
          // A5-1 (R116): arm the Firebase background refresher ONLY for
          // Firebase-backed identities. The probe response is the one
          // authoritative signal at boot — WhatsApp/Telegram users and
          // guests never pay the Firebase SDK download + init for a
          // listener that can never fire for them. Mid-session Google
          // sign-ins are unaffected (the button path imports firebase/auth
          // on click; the refresher arms on their next reload).
          if (isFirebaseBackedUser(body.user)) {
            setFirebaseIdentity(true);
          }
        }
        // body.authenticated === false → leave token null, render unauthed.
      })
      .catch(() => {
        // Network error / A5-2 probe timeout abort → unauthenticated.
        // Real errors are reported by Sentry's network instrumentation
        // elsewhere.
      });

    // Admin session probe — mirrors the user probe but for the
    // admin_token cookie. Lets the admin panel survive a page
    // refresh: instead of forcing re-login on every reload, the
    // SPA detects the existing cookie via this 200-always endpoint
    // and re-hydrates `adminToken` to the sentinel so the admin
    // routes render immediately. The actual JWT stays in the
    // httpOnly cookie — JS never sees it.
    //
    // R94-A1 (A7 P3 — /api/admin/probe for every anonymous visitor):
    // the probe used to fire on EVERY boot, including the ~100% of
    // storefront visitors who will never touch /admin. There is no
    // storefront → /admin client-side link (admins reach the panel by
    // direct URL, i.e. a full page load), so gating on the boot path
    // is sufficient: only /admin* boots pay the request.
    const routerBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const bootPath = window.location.pathname;
    const isAdminBoot =
      bootPath === `${routerBase}/admin` || bootPath.startsWith(`${routerBase}/admin/`);
    const adminProbe = isAdminBoot
      ? fetch("/api/admin/probe", {
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: bootProbeSignal(),
        })
          .then(async (res) => {
            if (cancelled) return;
            if (!res.ok) return;
            const body = await res.json().catch(() => null);
            if (!body || cancelled) return;
            if (body.authenticated && body.admin) {
              setAdminTokenState(COOKIE_AUTH_SENTINEL);
              setAdminPermissionsState(
                Array.isArray(body.admin.permissions) ? body.admin.permissions : [],
              );
            }
          })
          .catch(() => {
            /* admin-unauth path; Sentry already captures real network errors. */
          })
      : Promise.resolve();

    Promise.allSettled([userProbe, adminProbe]).finally(() => {
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
  // A5-1 (R116): wired only when the boot probe reports a Firebase-backed
  // identity. Previously this armed on EVERY boot (2 s after load) —
  // guests, WhatsApp and Telegram users paid the whole Firebase SDK
  // download + initialization for a listener that fires once with a
  // null user and then idles forever. The Google sign-in BUTTON path
  // imports firebase/auth dynamically on click, so this gate cannot
  // break Google login; Google users keep the identical refresh loop
  // (2 s deferral off the critical-paint path, silent rotation setter,
  // unsubscribe on unmount, installedRef double-arm guard).
  const installedRef = useRef(false);
  useEffect(() => {
    if (!firebaseIdentity) return;
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
    // A5-1: re-runs only when the probe flips the identity verdict
    // (false → true, once per boot). setTokenSilently is a stable
    // useCallback; the installedRef guard keeps double-arming
    // impossible even across the verdict-driven re-run.
  }, [firebaseIdentity, setTokenSilently]);

  const value = useMemo(
    () => ({
      token,
      adminToken,
      adminPermissions,
      initializing,
      setToken,
      setAdminToken,
      setAdminPermissions,
      hasAdminPermission,
      logout,
      adminLogout,
      logoutAllDevices,
    }),
    [
      token,
      adminToken,
      adminPermissions,
      initializing,
      setToken,
      setAdminToken,
      setAdminPermissions,
      hasAdminPermission,
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
