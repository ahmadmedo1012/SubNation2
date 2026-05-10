import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";

interface AuthContextType {
  token: string | null;
  adminToken: string | null;
  setToken: (token: string | null) => void;
  setAdminToken: (token: string | null) => void;
  logout: () => void;
  adminLogout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function readStoredToken(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredToken(key: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch {
    // Keep the in-memory session usable when browser storage is unavailable.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => readStoredToken("auth_token"));
  const [adminToken, setAdminTokenState] = useState<string | null>(() =>
    readStoredToken("admin_token"),
  );
  const queryClient = useQueryClient();

  const setToken = useCallback(
    (t: string | null) => {
      writeStoredToken("auth_token", t);
      setTokenState(t);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    },
    [queryClient],
  );

  const setAdminToken = useCallback((t: string | null) => {
    writeStoredToken("admin_token", t);
    setAdminTokenState(t);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    queryClient.clear();
  }, [queryClient, setToken]);

  const adminLogout = useCallback(() => {
    setAdminToken(null);
  }, [setAdminToken]);

  const value = useMemo(
    () => ({ token, adminToken, setToken, setAdminToken, logout, adminLogout }),
    [token, adminToken, setToken, setAdminToken, logout, adminLogout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
