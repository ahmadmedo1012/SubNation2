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
 * 97-F5 (R97-A4 §2/§6/§7 — F-01/F-03/F-04): setToken is now the
 * identity-switch teardown choke point — every setToken call must clear
 * the ENTIRE TanStack cache (the 401-then-new-login flow on a shared
 * device must never serve the previous user's fresh wallet/orders
 * cache) and disconnect the user socket; setAdminToken must REMOVE the
 * admin-scoped queries (PII isolation between operators) while leaving
 * storefront queries alone.
 *
 * The harness renders the REAL AuthProvider (not a mock) — the fix
 * lives in the provider itself.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/auth";

const { disconnectMock } = vi.hoisted(() => ({ disconnectMock: vi.fn() }));

vi.mock("@/lib/socket", () => ({
  // auth.tsx consumes disconnectSocket only; the rest are stubs for
  // other importers of the mocked module in this graph.
  disconnectSocket: disconnectMock,
  reviveSocket: vi.fn(),
  connectSocket: vi.fn(async () => null),
  connectAdminSocket: vi.fn(async () => null),
  getSocket: vi.fn(async () => null),
  SOCKET_RESYNC_EVENT: "subnation:socket-resync",
  __resetSocketStateForTests: vi.fn(),
}));

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
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("AuthProvider.logout — the server session must be revoked (93-C5 F-05)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    disconnectMock.mockClear();
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

// ─────────────────────────────────────────────────────────────────────────────
// 97-F5 (R97-A4 §2/§6/§7) — identity-switch teardown on the auth context
// ─────────────────────────────────────────────────────────────────────────────

function IdentityHarness() {
  const { token, adminToken, setToken, setAdminToken } = useAuth();
  return (
    <div>
      <span data-testid="token-state">{token ?? "signed-out"}</span>
      <span data-testid="admin-token-state">{adminToken ?? "admin-signed-out"}</span>
      <button type="button" onClick={() => setToken("jwt-user-B")}>
        دخول مستخدم ب
      </button>
      <button type="button" onClick={() => setAdminToken("jwt-admin-B")}>
        دخول أدمن ب
      </button>
    </div>
  );
}

describe("AuthProvider.setToken — identity-switch teardown (97-F5 F-01 + F-03)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    disconnectMock.mockClear();
    fetchMock.mockResolvedValue({ ok: false } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the ENTIRE query cache on a sign-in (previous user's data must not survive)", async () => {
    const { client } = renderAuthIdentity();

    // Seed the previous user's (still-fresh) money + identity caches —
    // exactly what /wallet, /orders and the navbar hold mid-session.
    client.setQueryData(["/api/auth/me"], { id: 1, wallet_balance: 500 });
    client.setQueryData(["/api/wallet"], { balance: 500 });
    client.setQueryData(["/api/wallet/topups"], [{ id: 9 }]);
    client.setQueryData(["/api/orders"], [{ id: 3 }]);
    client.setQueryData(["/api/products", {}], [{ id: 5 }]);
    expect(client.getQueryCache().getAll()).toHaveLength(5);

    // User B signs in on the same tab (login page — no logout happened).
    fireEvent.click(screen.getByRole("button", { name: "دخول مستخدم ب" }));
    await waitFor(() => {
      expect(screen.getByTestId("token-state")).toHaveTextContent("jwt-user-B");
    });

    // F-01: the whole cache is gone — B can never be served A's fresh
    // wallet/orders entries (staleTime 60 s + refetchOnWindowFocus off
    // meant no refetch would ever fire for them).
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getQueryData(["/api/wallet"])).toBeUndefined();
  });

  it("disconnects the user socket on every identity switch (F-03 — room binding follows the cookie)", async () => {
    renderAuthIdentity();

    fireEvent.click(screen.getByRole("button", { name: "دخول مستخدم ب" }));
    await waitFor(() => {
      expect(screen.getByTestId("token-state")).toHaveTextContent("jwt-user-B");
    });

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});

describe("AuthProvider.setAdminToken — admin PII isolation (97-F5 F-04)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    disconnectMock.mockClear();
    fetchMock.mockResolvedValue({ ok: false } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("REMOVES /api/admin* + admin-alerts* queries and keeps storefront queries", async () => {
    const { client } = renderAuthIdentity();

    // Admin A's cached lists (PII: user phone numbers, order buyers) +
    // the alert drawer keys + a live storefront user session.
    client.setQueryData(["/api/admin/orders", { page: 1 }], [{ id: 1 }]);
    client.setQueryData(["/api/admin/users", { search: "" }], [{ id: 2, phone: "091…" }]);
    client.setQueryData(["admin-alerts", { limit: 20 }], [{ id: 4 }]);
    client.setQueryData(["admin-alerts-unread-count"], 3);
    client.setQueryData(["/api/wallet"], { balance: 500 });
    client.setQueryData(["/api/products", {}], [{ id: 5 }]);

    // Admin B logs in on the same browser (also covers adminLogout + the
    // admin 401 redirect — both route through this same setter).
    fireEvent.click(screen.getByRole("button", { name: "دخول أدمن ب" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("jwt-admin-B");
    });

    // Admin-scoped families REMOVED (not invalidated — no flash of A's data).
    expect(client.getQueryData(["/api/admin/orders", { page: 1 }])).toBeUndefined();
    expect(client.getQueryData(["/api/admin/users", { search: "" }])).toBeUndefined();
    expect(client.getQueryData(["admin-alerts", { limit: 20 }])).toBeUndefined();
    expect(client.getQueryData(["admin-alerts-unread-count"])).toBeUndefined();
    // Storefront queries survive — a user session is independent of the
    // admin identity in the same tab.
    expect(client.getQueryData(["/api/wallet"])).toEqual({ balance: 500 });
    expect(client.getQueryData(["/api/products", {}])).toEqual([{ id: 5 }]);
  });
});

function renderAuthIdentity() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <IdentityHarness />
        </AuthProvider>
      </QueryClientProvider>,
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 98-F7 (R98-07) — adminLogout clears the sn_last_alert_id toast cursor
// ─────────────────────────────────────────────────────────────────────────────

function AdminLogoutHarness() {
  const { adminToken, setAdminToken, adminLogout } = useAuth();
  return (
    <div>
      <span data-testid="admin-token-state">{adminToken ?? "admin-signed-out"}</span>
      <button type="button" onClick={() => setAdminToken("jwt-admin-A")}>
        دخول أدمن أ
      </button>
      <button type="button" onClick={() => setAdminToken(null)}>
        مسح الجلسة (401)
      </button>
      <button type="button" onClick={() => void adminLogout()}>
        خروج الأدمن
      </button>
    </div>
  );
}

describe("AuthProvider.adminLogout — alert cursor reset (98-F7 R98-07)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    disconnectMock.mockClear();
    // Boot probes + the admin logout POST — all generic non-OK/OK bodies.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("adminLogout removes sn_last_alert_id (a shared-device admin B must not inherit A's cursor)", async () => {
    // Admin A's session wrote the alert-cursor while working (AdminLayout's
    // alert poller keeps it at the last-seen alert id).
    localStorage.setItem("sn_last_alert_id", "412");

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <AdminLogoutHarness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "دخول أدمن أ" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("jwt-admin-A");
    });
    // Simulate the poller advancing the cursor mid-session.
    localStorage.setItem("sn_last_alert_id", "417");

    fireEvent.click(screen.getByRole("button", { name: "خروج الأدمن" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("admin-signed-out");
    });

    // R98-07: the cursor is GONE — the next admin's poll starts from 0 and
    // toasts everything that fired in the gap instead of swallowing it.
    expect(localStorage.getItem("sn_last_alert_id")).toBeNull();
  });

  it("a plain setAdminToken(null) (the 401-expiry mirror path) clears it too", async () => {
    localStorage.setItem("sn_last_alert_id", "99");

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <AdminLogoutHarness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "دخول أدمن أ" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("jwt-admin-A");
    });

    // The 401-expiry path routes through useAdminHeaders' mirror →
    // setAdminToken(null) — the same choke point, no server call.
    fireEvent.click(screen.getByRole("button", { name: "مسح الجلسة (401)" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("admin-signed-out");
    });
    expect(localStorage.getItem("sn_last_alert_id")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R127-B6-5 (B6 sockets audit) — setAdminToken(null) must tear the socket
// down, mirroring the user path's F-03 rule in setToken. Previously the
// admin 401-expiry / adminLogout / session-guard paths cleared state and
// removed admin queries but left the singleton CONNECTED: the server's
// 5-minute liveness sweep was the only thing stripping the dead
// adminSessionId from admin-room / admin-alerts-room, so a logged-out
// browser kept receiving admin-room payloads (live order/topup PII) on
// the transport for 0–5 minutes.
// ─────────────────────────────────────────────────────────────────────────────

describe("AuthProvider.setAdminToken — socket teardown on admin session end (R127-B6-5)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    disconnectMock.mockClear();
    // Boot probes + the admin logout POST — all generic non-OK/OK bodies.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("setAdminToken(null) (the 401-expiry mirror path) disconnects the socket", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <AdminLogoutHarness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "دخول أدمن أ" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("jwt-admin-A");
    });
    // Admin LOGIN is not a teardown — a coexisting storefront user
    // session in the same tab keeps its socket (documented asymmetry:
    // setAdminToken(non-null) deliberately does NOT disconnect).
    expect(disconnectMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "مسح الجلسة (401)" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("admin-signed-out");
    });

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it("adminLogout (the explicit logout path) disconnects the socket too — same choke point", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <AdminLogoutHarness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "دخول أدمن أ" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("jwt-admin-A");
    });

    fireEvent.click(screen.getByRole("button", { name: "خروج الأدمن" }));
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent("admin-signed-out");
    });

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
