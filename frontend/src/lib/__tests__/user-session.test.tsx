/**
 * 96-F3 (R96 A4 §3.1) — storefront session-expiry + 401 router tests.
 *
 * lib/user-session is the user-side twin of lib/admin-session: on the
 * first non-auth, non-admin 401 while a user session is believed
 * active it must toast once (Arabic), clear the token, disconnect the
 * user socket and soft-redirect to /login?redirect=<current>. These
 * tests pin:
 *
 *   1. the happy path (toast + clear + disconnect + redirect),
 *   2. the 15 s dedupe (parallel query burst → one toast),
 *   3. /api/auth/* exemption (login/probe 401s are the forms'),
 *   4. the router's admin delegation (admin URLs keep admin-session's
 *      behavior EXACTLY — admin toast + /admin/login redirect; no
 *      admin session → not our business),
 *   5. logged-out inactivity,
 *   6. <UserSessionWatcher> wiring (mirror + additive registration).
 *
 * Module-level handler tests need no React (mirrors admin-session's
 * test harness); the watcher test renders the real AuthProvider.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock, disconnectMock, addHandlerMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  disconnectMock: vi.fn(),
  addHandlerMock: vi.fn(() => vi.fn()),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@/lib/socket", () => ({
  // user-session only consumes disconnectSocket; the rest are stubs
  // for other importers of the mocked module in this graph.
  disconnectSocket: disconnectMock,
  reviveSocket: vi.fn(),
  connectSocket: vi.fn(async () => null),
  connectAdminSocket: vi.fn(async () => null),
  getSocket: vi.fn(async () => null),
  SOCKET_RESYNC_EVENT: "subnation:socket-resync",
  __resetSocketStateForTests: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  // Only addUnauthorizedHandler is consumed by user-session; the
  // query-key helpers are stubs for auth.tsx's imports.
  addUnauthorizedHandler: addHandlerMock,
  getGetMeQueryKey: () => ["/api/auth/me"],
  useGetMe: () => ({ data: undefined, error: null }),
}));

import { AuthProvider, useAuth } from "@/lib/auth";
import {
  __resetAdminSessionForTests,
  setAdminSessionMirror,
} from "@/lib/admin-session";
import {
  USER_SESSION_EXPIRED_MESSAGE,
  UserSessionWatcher,
  __resetUserSessionForTests,
  handleUserUnauthorized,
  setUserSessionMirror,
} from "../user-session";

function simulateUserSession(clear: () => void = vi.fn()) {
  setUserSessionMirror(true, clear);
}

describe("handleUserUnauthorized — storefront 401 router (96-F3 §3.1)", () => {
  beforeEach(() => {
    __resetUserSessionForTests();
    __resetAdminSessionForTests();
    toastMock.mockClear();
    disconnectMock.mockClear();
    window.history.pushState({}, "", "/checkout?coupon=NETFLIX");
  });

  it("toasts once (Arabic), clears the token, disconnects the socket, soft-redirects with ?redirect=", () => {
    const clear = vi.fn();
    simulateUserSession(clear);

    const handled = handleUserUnauthorized("/api/orders");

    expect(handled).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: USER_SESSION_EXPIRED_MESSAGE,
      variant: "destructive",
    });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    // Soft SPA navigation: URL moved to the login page carrying the
    // page the buyer was on for a post-login return trip.
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toContain(
      `redirect=${encodeURIComponent("/checkout?coupon=NETFLIX")}`,
    );
  });

  it("dedupes the 401 burst from parallel queries: one toast + one redirect", () => {
    simulateUserSession(vi.fn());

    const first = handleUserUnauthorized("/api/orders");
    const second = handleUserUnauthorized("/api/wallet");
    const third = handleUserUnauthorized("/api/wallet/topups");

    expect(first).toBe(true);
    // Handled (caller skips its own generic error toast)…
    expect(second).toBe(true);
    expect(third).toBe(true);
    // …but no additional side effects.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it("ignores /api/auth/* 401s (login/OTP/probe flows own those)", () => {
    simulateUserSession(vi.fn());

    expect(handleUserUnauthorized("/api/auth/whatsapp/start")).toBe(false);
    expect(handleUserUnauthorized("/api/auth/whatsapp/verify")).toBe(false);
    expect(handleUserUnauthorized("/api/auth/me")).toBe(false);
    expect(handleUserUnauthorized("/api/auth/probe")).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/checkout");
  });

  it("routes /api/admin/* URLs to admin-session's handler exactly (admin toast + /admin/login)", () => {
    // Admin session mirrored (as useAdminHeaders does) — the admin
    // branch must behave identically to calling it directly.
    setAdminSessionMirror(true, vi.fn());

    const handled = handleUserUnauthorized("/api/admin/topups");

    expect(handled).toBe(true);
    // Admin toast — the SAME shared toast mock admin-session uses.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: "انتهت الجلسة — سجّل دخولك مجددًا",
      variant: "destructive",
    });
    expect(window.location.pathname).toBe("/admin/login");
    // The USER side must stay silent for admin URLs.
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("admin URL with NO admin session is not the user's business (no user logout)", () => {
    simulateUserSession(vi.fn());

    expect(handleUserUnauthorized("/api/admin/orders")).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/checkout");
  });

  it("ignores 401s while no user session is believed active (guests)", () => {
    setUserSessionMirror(false, null);

    expect(handleUserUnauthorized("/api/orders")).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/checkout");
  });

  it("treats absolute API origins as user URLs too (base-URL deployments)", () => {
    simulateUserSession(vi.fn());

    expect(handleUserUnauthorized("https://api.example.com/api/wallet")).toBe(true);
    expect(window.location.pathname).toBe("/login");
  });

  it("does not re-navigate when the session dies while already on /login", () => {
    window.history.pushState({}, "", "/login");
    simulateUserSession(vi.fn());

    expect(handleUserUnauthorized("/api/orders")).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    // Still on /login — no self-referencing redirect param.
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("");
  });

  it("a throwing clear callback must not break the redirect", () => {
    simulateUserSession(() => {
      throw new Error("cleanup exploded");
    });

    expect(() => handleUserUnauthorized("/api/orders")).not.toThrow();
    expect(window.location.pathname).toBe("/login");
  });
});

describe("UserSessionWatcher — AuthProvider wiring (96-F3 §3.1)", () => {
  let unsubscribeMock: ReturnType<typeof vi.fn>;

  function Harness() {
    const { token, setToken } = useAuth();
    return (
      <div>
        <span data-testid="token-state">{token ?? "signed-out"}</span>
        <button type="button" onClick={() => setToken("jwt-test-token")}>
          تسجيل الدخول
        </button>
      </div>
    );
  }

  beforeEach(() => {
    __resetUserSessionForTests();
    __resetAdminSessionForTests();
    toastMock.mockClear();
    disconnectMock.mockClear();
    addHandlerMock.mockReset();
    unsubscribeMock = vi.fn();
    addHandlerMock.mockReturnValue(unsubscribeMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers the additive 401 observer once and unsubscribes on unmount", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <UserSessionWatcher />
          <Harness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("token-state")).toHaveTextContent("signed-out");
    });
    expect(addHandlerMock).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("mirrors the auth token: login arms the 401 handler, a 401 then fires it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <UserSessionWatcher />
          <Harness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    // Before login: no session believed active → storefront 401 ignored.
    expect(handleUserUnauthorized("/api/orders")).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("token-state")).toHaveTextContent("jwt-test-token");
    });

    // The watcher's mirror effect has run: the 401 router is armed.
    // (act-wrapped: the handler's clear callback flips AuthProvider
    // state — setToken(null).)
    let handled = false;
    await act(async () => {
      handled = handleUserUnauthorized("/api/orders");
    });
    expect(handled).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: USER_SESSION_EXPIRED_MESSAGE,
    });
  });
});
