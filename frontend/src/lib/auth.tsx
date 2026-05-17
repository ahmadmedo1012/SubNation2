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
  setToken: (token: string | null) => void;
  setAdminToken: (token: string | null) => void;
  logout: () => void;
  adminLogout: () => void;
  logoutAllDevices: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function readStoredToken(_key: string): string | null {
  // Tokens are now in HttpOnly cookies; this is a placeholder for the
  // initial-render value. The Authorization header value used by the
  // typed clients is set when /api/auth/login etc. responds.
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => readStoredToken("auth_token"));
  const [adminToken, setAdminTokenState] = useState<string | null>(() =>
    readStoredToken("admin_token"),
  );
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
    } catch (err) {
      console.error("Failed to logout from all devices:", err);
    } finally {
      logout();
    }
  }, [token, logout]);

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
      } catch (err) {
        console.error("Failed to setup Firebase token refresh:", err);
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
    () => ({ token, adminToken, setToken, setAdminToken, logout, adminLogout, logoutAllDevices }),
    [token, adminToken, setToken, setAdminToken, logout, adminLogout, logoutAllDevices],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
