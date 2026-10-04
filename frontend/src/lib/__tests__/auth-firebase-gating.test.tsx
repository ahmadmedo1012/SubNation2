/**
 * A5-1 + A5-2 (R116) — AuthProvider boot probe regressions.
 *
 * A5-1 (Firebase init gating): the background token refresher
 * (setupFirebaseTokenRefresh) used to arm on EVERY boot 2 s after load,
 * importing the whole Firebase SDK even for guests and WhatsApp /
 * Telegram users — for a listener that fires once with a null user and
 * then idles forever. It now arms ONLY when the boot probe reports a
 * Firebase-backed identity (auth_provider starting with "firebase", or
 * a linked firebase.com/google.com identity). The Google sign-in
 * BUTTON path is unaffected (it imports firebase/auth on click).
 *
 * A5-2 (probe timeouts): both raw boot fetches carry
 * AbortSignal.timeout(10 s) so a stalled network can no longer hold
 * the splash screen hostage — an abort lands in the same
 * unauthenticated path as a 401 and the app always boots.
 *
 * These tests pin:
 *   1. isFirebaseBackedUser's truth table (the probe field contract),
 *   2. guests / WhatsApp / Telegram users never arm the refresher,
 *   3. Google users arm it exactly once (2 s deferral, silent setter),
 *   4. a linked firebase.com identity also arms it,
 *   5. both probes carry an abort signal (A5-2),
 *   6. a hung probe that later rejects (timeout abort shape) still
 *      dismisses the splash — the app NEVER hangs on the boot screen.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setupFirebaseTokenRefreshMock, unsubscribeMock } = vi.hoisted(() => ({
  setupFirebaseTokenRefreshMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("@/lib/firebase-auth", () => ({
  setupFirebaseTokenRefresh: setupFirebaseTokenRefreshMock,
}));

vi.mock("@/lib/socket", () => ({
  // auth.tsx consumes disconnectSocket only; the rest are stubs for
  // other importers of the mocked module in this graph.
  disconnectSocket: vi.fn(),
  reviveSocket: vi.fn(),
  connectSocket: vi.fn(async () => null),
  connectAdminSocket: vi.fn(async () => null),
  getSocket: vi.fn(async () => null),
  SOCKET_RESYNC_EVENT: "subnation:socket-resync",
  __resetSocketStateForTests: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["/api/auth/me"],
}));

import { AuthProvider, isFirebaseBackedUser, useAuth } from "@/lib/auth";

function BootHarness() {
  const { initializing, token } = useAuth();
  return (
    <div>
      <span data-testid="boot-state">{initializing ? "initializing" : "booted"}</span>
      <span data-testid="token-state">{token ?? "signed-out"}</span>
    </div>
  );
}

function renderAuth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BootHarness />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function probeResponse(body: Record<string, unknown>) {
  return { ok: true, json: async () => body } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isFirebaseBackedUser — probe identity truth table (A5-1)", () => {
  it("accepts every Firebase-prefixed auth_provider", () => {
    expect(isFirebaseBackedUser({ auth_provider: "firebase_google" })).toBe(true);
    expect(isFirebaseBackedUser({ auth_provider: "firebase" })).toBe(true);
    expect(isFirebaseBackedUser({ auth_provider: "firebase_phone" })).toBe(true);
  });

  it("rejects cookie-native providers, guests and malformed payloads", () => {
    expect(isFirebaseBackedUser({ auth_provider: "whatsapp_phone" })).toBe(false);
    expect(isFirebaseBackedUser({ auth_provider: "telegram" })).toBe(false);
    expect(isFirebaseBackedUser({})).toBe(false);
    expect(isFirebaseBackedUser(null)).toBe(false);
    expect(isFirebaseBackedUser("firebase_google")).toBe(false);
  });

  it("accepts a linked firebase.com / google.com identity even when the primary tag is cookie-native", () => {
    expect(
      isFirebaseBackedUser({
        auth_provider: "whatsapp_phone",
        linked_identities: [{ provider: "firebase.com" }],
      }),
    ).toBe(true);
    expect(
      isFirebaseBackedUser({
        auth_provider: "whatsapp_phone",
        linked_identities: [{ provider: "google.com" }, { provider: "telegram" }],
      }),
    ).toBe(true);
    // Only non-Firebase links → still gated out.
    expect(
      isFirebaseBackedUser({
        auth_provider: "whatsapp_phone",
        linked_identities: [{ provider: "telegram" }],
      }),
    ).toBe(false);
  });
});

describe("AuthProvider — Firebase refresher gating (A5-1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupFirebaseTokenRefreshMock.mockReset();
    setupFirebaseTokenRefreshMock.mockResolvedValue(unsubscribeMock);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(probeResponse({ authenticated: false })),
    );
  });

  /**
   * Flush the probe promise chain under fake timers. waitFor is fake-
   * timer-hostile (its own timeout never fires), so drain microtasks
   * explicitly and assert the boot state directly.
   */
  async function flushBoot() {
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
    }
    expect(screen.getByTestId("boot-state")).toHaveTextContent("booted");
  }

  it("a guest boot (unauthenticated probe) never arms the refresher", async () => {
    renderAuth();
    await flushBoot();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(setupFirebaseTokenRefreshMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("token-state")).toHaveTextContent("signed-out");
  });

  it("a WhatsApp user never arms the refresher (the dominant authenticated path)", async () => {
    vi.mocked(fetch)!.mockResolvedValue(
      probeResponse({
        authenticated: true,
        user: { id: 1, phone: "0910000000", auth_provider: "whatsapp_phone" },
      }),
    );
    renderAuth();
    await flushBoot();

    expect(screen.getByTestId("token-state")).toHaveTextContent("__cookie_session__");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(setupFirebaseTokenRefreshMock).not.toHaveBeenCalled();
  });

  it("a Telegram user never arms the refresher", async () => {
    vi.mocked(fetch)!.mockResolvedValue(
      probeResponse({
        authenticated: true,
        user: { id: 2, phone: "0910000001", auth_provider: "telegram" },
      }),
    );
    renderAuth();
    await flushBoot();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(setupFirebaseTokenRefreshMock).not.toHaveBeenCalled();
  });

  it("a Google user arms the refresher once, after the 2 s deferral", async () => {
    vi.mocked(fetch)!.mockResolvedValue(
      probeResponse({
        authenticated: true,
        user: { id: 3, phone: "0910000002", auth_provider: "firebase_google" },
      }),
    );
    renderAuth();
    await flushBoot();
    expect(screen.getByTestId("token-state")).toHaveTextContent("__cookie_session__");

    // Before the 2 s deferral: not armed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(setupFirebaseTokenRefreshMock).not.toHaveBeenCalled();

    // After: armed exactly once, with the rotation callback.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(setupFirebaseTokenRefreshMock).toHaveBeenCalledTimes(1);
    expect(setupFirebaseTokenRefreshMock.mock.calls[0][0]).toBeTypeOf("function");
  });

  it("a cookie-native user with a LINKED firebase.com identity still arms", async () => {
    vi.mocked(fetch)!.mockResolvedValue(
      probeResponse({
        authenticated: true,
        user: {
          id: 4,
          phone: "0910000003",
          auth_provider: "whatsapp_phone",
          linked_identities: [{ provider: "firebase.com", provider_uid: "g-1" }],
        },
      }),
    );
    renderAuth();
    await flushBoot();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(setupFirebaseTokenRefreshMock).toHaveBeenCalledTimes(1);
  });
});

describe("AuthProvider — boot probe timeouts (A5-2)", () => {
  beforeEach(() => {
    setupFirebaseTokenRefreshMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("both probes carry an abort signal", async () => {
    window.history.pushState({}, "", "/admin");
    vi.mocked(fetch)!.mockResolvedValue(probeResponse({ authenticated: false }));
    renderAuth();

    await waitFor(() => {
      expect(screen.getByTestId("boot-state")).toHaveTextContent("booted");
    });
    const calls = vi.mocked(fetch)!.mock.calls as unknown as Array<
      [string, RequestInit | undefined]
    >;
    const probeCalls = calls.filter(([url]) => String(url).includes("/probe"));
    expect(probeCalls.length).toBeGreaterThanOrEqual(2); // user + admin probe
    for (const [, init] of probeCalls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    window.history.pushState({}, "", "/");
  });

  it("a probe that rejects (timeout abort / network error) still dismisses the splash", async () => {
    vi.mocked(fetch)!.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );
    renderAuth();

    // The allSettled gate settles on the rejection → the app boots as
    // unauthenticated instead of hanging on the splash forever.
    await waitFor(() => {
      expect(screen.getByTestId("boot-state")).toHaveTextContent("booted");
    });
    expect(screen.getByTestId("token-state")).toHaveTextContent("signed-out");
  });
});
