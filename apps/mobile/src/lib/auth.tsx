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
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getMe,
  logout,
  probeAuth,
  type User,
} from "@workspace/api-client-native";

import { addSessionExpiredHandler, bootstrapApiClient } from "./api";
import { clearStoredToken, getStoredToken } from "./auth-store";

export type AuthStatus = "hydrating" | "authenticated" | "guest";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Store a freshly minted token and load the user. */
  signIn: (token: string) => Promise<void>;
  /** Re-run the boot probe (e.g. after a deep-link login). */
  refresh: () => Promise<void>;
  /** Server-side logout (revokes the session row) + local teardown. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider — the native session lifecycle.
 *
 * Hydration gate (expo-data-fetching skill): the boot probe runs before
 * any auth-dependent screen decides anything; `status` stays "hydrating"
 * until SecureStore + the server probe settle, so cold starts never flash
 * the wrong screen and pre-hydration deep links route correctly.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("hydrating");
  const [user, setUser] = useState<User | null>(null);
  const queryClient = useQueryClient();
  const booted = useRef(false);

  const teardownLocal = useCallback(() => {
    setUser(null);
    setStatus("guest");
    void clearStoredToken();
    // Identity switch clears the ENTIRE cache (the web's contract) so no
    // authorized data from the previous identity survives.
    queryClient.clear();
  }, [queryClient]);

  const probe = useCallback(async () => {
    const token = await getStoredToken();
    if (!token) {
      setStatus("guest");
      setUser(null);
      return;
    }
    try {
      const result = await probeAuth();
      if (result.authenticated && result.user) {
        queryClient.setQueryData(getGetMeQueryKey(), result.user);
        setUser(result.user);
        setStatus("authenticated");
      } else {
        // Dead/expired token — clean local state, user re-signs-in.
        teardownLocal();
      }
    } catch {
      // Network failure at boot: keep the token (it may still be valid),
      // mark guest-shaped state but retry lazily on next focus/refetch.
      setStatus("guest");
      setUser(null);
    }
  }, [queryClient, teardownLocal]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    bootstrapApiClient();
    void probe();
  }, [probe]);

  // Server-side 401s (revoked session, expired token) route here.
  useEffect(() => {
    return addSessionExpiredHandler(() => {
      teardownLocal();
    });
  }, [teardownLocal]);

  const signIn = useCallback(
    async (_token: string) => {
      // Token is already stored by the mint helper; verify + load profile.
      try {
        const me = await getMe();
        queryClient.setQueryData(getGetMeQueryKey(), me);
        setUser(me);
        setStatus("authenticated");
      } catch {
        // getMe failure right after a mint is almost certainly transient;
        // the probe path will reconcile on the next launch. The stored
        // token IS the session — treat as authenticated.
        setStatus("authenticated");
        setUser(null);
      }
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // Server unreachable: local teardown still removes the credential;
      // the session row expires server-side (30d) or via logout-all.
    }
    teardownLocal();
  }, [teardownLocal]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, signOut, refresh: probe }),
    [status, user, signIn, signOut, probe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
