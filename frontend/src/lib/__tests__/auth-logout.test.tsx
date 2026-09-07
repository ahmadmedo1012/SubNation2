/**
 * Logout integrity test — 93-C5 / F-05 (A4 P1 #1, A10 spec (d)).
 *
 * `logout()` used to be cosmetic: it cleared local state but never called
 * the backend's POST /api/auth/logout (backend/src/routes/auth.ts —
 * deletes the session row, revokes Firebase tokens and clears the
 * httpOnly cookie), so any page refresh (or a new tab on a shared
 * device) silently re-authenticated the still-valid cookie — wallet
 * balance and paid credentials all came back. This test pins the
 * contract: logging out fires the server call with cookie credentials
 * AND clears the local token, and a network failure of that call still
 * signs the user out locally (fire-and-forget, like adminLogout).
 *
 * The harness renders the REAL AuthProvider (not a mock) — the fix
 * lives in the provider itself.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/auth";

function Harness() {
  const { token, setToken, logout } = useAuth();
  return (
    <div>
      <span data-testid="token-state">{token ?? "signed-out"}</span>
      <button type="button" onClick={() => setToken("jwt-test-token")}>
        تسجيل الدخول
      </button>
      <button type="button" onClick={logout}>
        تسجيل الخروج
      </button>
    </div>
  );
}

const fetchMock = vi.fn();

function renderAuth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthProvider.logout — the server session must be revoked (93-C5 F-05)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Boot probes (/api/auth/probe + /api/admin/probe) — unauthenticated
    // Response-likes (ok:false short-circuits the .json() path).
    fetchMock.mockResolvedValue({ ok: false } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls POST /api/auth/logout with cookie credentials when logging out", async () => {
    renderAuth();

    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    await waitFor(() => {
      expect(screen.getByTestId("token-state")).toHaveTextContent("jwt-test-token");
    });

    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));

    // The server call — deletes the session row + clears the httpOnly
    // cookie so a refresh can no longer silently re-authenticate.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    });
    // Local state cleared too — the SPA signs out immediately.
    await waitFor(() => {
      expect(screen.getByTestId("token-state")).toHaveTextContent("signed-out");
    });
  });

  it("still signs out locally when the logout request fails (fire-and-forget)", async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/auth/logout") {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve({ ok: false } as unknown as Response);
    });

    renderAuth();

    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    await waitFor(() => {
      expect(screen.getByTestId("token-state")).toHaveTextContent("jwt-test-token");
    });

    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));

    await waitFor(() => {
      expect(screen.getByTestId("token-state")).toHaveTextContent("signed-out");
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  });
});
