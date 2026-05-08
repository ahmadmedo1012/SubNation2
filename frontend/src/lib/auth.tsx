import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem("auth_token"));
  const [adminToken, setAdminTokenState] = useState<string | null>(() => localStorage.getItem("admin_token"));
  const queryClient = useQueryClient();

  const setToken = (t: string | null) => {
    if (t) localStorage.setItem("auth_token", t);
    else localStorage.removeItem("auth_token");
    setTokenState(t);
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const setAdminToken = (t: string | null) => {
    if (t) localStorage.setItem("admin_token", t);
    else localStorage.removeItem("admin_token");
    setAdminTokenState(t);
  };

  const logout = () => {
    setToken(null);
    queryClient.clear();
  };

  const adminLogout = () => {
    setAdminToken(null);
  };

  return (
    <AuthContext.Provider value={{ token, adminToken, setToken, setAdminToken, logout, adminLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
