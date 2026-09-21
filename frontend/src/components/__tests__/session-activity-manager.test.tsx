/**
 * R104 (free-tier sleep economics) — SessionActivityManager.
 *
 * SessionActivityManager owns presence-driven socket lifecycle and the
 * transactional money/identity resync that the old always-on socket
 * used to provide. These tests pin:
 *
 *   1. visibilitychange → visible invalidates the transactional
 *      families (orders predicate sweep, wallet, topups, me) once per
 *      30 s throttle — only for authed sessions;
 *   2. hidden → no resync (a backgrounded tab must not burn data);
 *   3. guests: no resync invalidations at all;
 *   4. `online` and visible revive the socket; pointer/keyboard
 *      interaction also revives (real presence);
 *   5. the socket PARKS after 15 min hidden / 30 min foreground idle
 *      — the core anti-keepalive guarantee;
 *   6. interaction re-arms the park timer (no park while the user is
 *      actively present);
 *   7. listeners are cleaned up on unmount.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  token: null as string | null,
  adminToken: null as string | null,
}));

const socketFns = vi.hoisted(() => ({
  reviveMock: vi.fn(),
  parkMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    token: authState.token,
    adminToken: authState.adminToken,
    setToken: vi.fn(),
    setAdminToken: vi.fn(),
    setAdminPermissions: vi.fn(),
  }),
}));

vi.mock("@/lib/socket", () => ({
  reviveSocket: socketFns.reviveMock,
  parkSocketIfConnected: socketFns.parkMock,
  SOCKET_RESYNC_EVENT: "subnation:socket-resync",
}));

import { SessionActivityManager } from "../SessionActivityManager";

function renderManager() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <SessionActivityManager />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

function setVisible(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

async function fireVisible() {
  setVisible("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function fireHidden() {
  setVisible("hidden");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("SessionActivityManager — visibility resync (R104)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    authState.token = "__cookie_session__";
    authState.adminToken = null;
    socketFns.reviveMock.mockClear();
    socketFns.parkMock.mockClear();
    setVisible("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("visible → invalidates transactional families once, throttled within 30 s", async () => {
    const { invalidateSpy } = renderManager();

    let now = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    await fireVisible();
    expect(invalidateSpy).toHaveBeenCalledTimes(4);

    const keys = invalidateSpy.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is { queryKey: unknown[] } => Boolean(arg?.queryKey))
      .map((arg) => JSON.stringify(arg.queryKey));
    expect(keys).toContain(JSON.stringify(["/api/wallet"]));
    expect(keys).toContain(JSON.stringify(["/api/wallet/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/auth/me"]));

    // The orders leg is a PREDICATE sweep (list variants + details).
    const predicateCalls = invalidateSpy.mock.calls
      .map((call) => call[0])
      .filter((arg) => typeof arg?.predicate === "function");
    expect(predicateCalls).toHaveLength(1);
    const predicate = predicateCalls[0].predicate;
    const queryLike = (key: unknown[]) => ({ queryKey: key }) as never;
    expect(predicate(queryLike(["/api/orders"]))).toBe(true);
    expect(predicate(queryLike(["/api/orders/SNDB-1234"]))).toBe(true);
    expect(predicate(queryLike(["/api/products", {}]))).toBe(false);

    // Rapid re-focus — throttled.
    now += 1_000;
    await fireVisible();
    expect(invalidateSpy).toHaveBeenCalledTimes(4);

    // 31 s later — fresh resync allowed.
    now += 30_000;
    await fireVisible();
    expect(invalidateSpy).toHaveBeenCalledTimes(8);

    dateNowSpy.mockRestore();
  });

  it("hidden → no resync", async () => {
    const { invalidateSpy } = renderManager();
    await fireHidden();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("guests: no resync invalidations", async () => {
    authState.token = null;
    authState.adminToken = null;
    const { invalidateSpy } = renderManager();
    await fireVisible();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("SessionActivityManager — revival + parking (R104)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    authState.token = "__cookie_session__";
    authState.adminToken = null;
    socketFns.reviveMock.mockClear();
    socketFns.parkMock.mockClear();
    setVisible("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("online → revives; visible → revives; pointerdown → revives", async () => {
    renderManager();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(socketFns.reviveMock).toHaveBeenCalledTimes(1);

    await fireVisible();
    expect(socketFns.reviveMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      document.dispatchEvent(new Event("pointerdown"));
    });
    expect(socketFns.reviveMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      document.dispatchEvent(new Event("keydown"));
    });
    expect(socketFns.reviveMock).toHaveBeenCalledTimes(4);
  });

  it("parks the socket after 15 min hidden", async () => {
    renderManager();

    await fireHidden();
    expect(socketFns.parkMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(socketFns.parkMock).toHaveBeenCalledTimes(1);
  });

  it("parks the socket after 30 min foreground idle (anti-keepalive core)", async () => {
    renderManager();

    // Visible + active initially — no park.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(socketFns.parkMock).not.toHaveBeenCalled();

    // Interaction re-arms the idle timer.
    await act(async () => {
      document.dispatchEvent(new Event("pointerdown"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
    });
    expect(socketFns.parkMock).not.toHaveBeenCalled();

    // Full 30 min without interaction → park.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    });
    expect(socketFns.parkMock).toHaveBeenCalledTimes(1);
  });

  it("interaction during the hidden window cancels the hidden park deadline", async () => {
    renderManager();

    await fireHidden();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    // A pointerdown while hidden re-arms (foreground-length) the timer.
    await act(async () => {
      document.dispatchEvent(new Event("pointerdown"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(socketFns.parkMock).not.toHaveBeenCalled();
  });

  it("cleans listeners up on unmount — no stray parks or revives", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <SessionActivityManager />
      </QueryClientProvider>,
    );
    unmount();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("pointerdown"));
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(socketFns.reviveMock).not.toHaveBeenCalled();
    expect(socketFns.parkMock).not.toHaveBeenCalled();
  });
});
