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
    // TS2532/TS2722 guards: [0] access AND the predicate member must be
    // present + callable before the sweep assertions.
    const predicateCall = predicateCalls[0];
    if (!predicateCall || typeof predicateCall.predicate !== "function") {
      throw new Error("predicate sweep call not captured");
    }
    const predicate = predicateCall.predicate;
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

// ─────────────────────────────────────────────────────────────────────────────
// R127-B6-2 — admin-family visibility resync (park→revive window).
//
// A deliberate park ("io client disconnect") never arms the resync
// flag, so SOCKET_RESYNC_EVENT cannot cover the revive — this
// component's visibility resync is the ONLY catch-up an operator's
// parked console gets, and tickets/risk-event lists have NO polling
// fallback (refetchOnWindowFocus off app-wide). The R126-L3 seven-key
// admin set + products (R127-B6-6) join the storefront families on the
// same throttled visible cadence.
// ─────────────────────────────────────────────────────────────────────────────

describe("SessionActivityManager — admin-family visibility resync (R127-B6-2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    authState.token = null;
    authState.adminToken = "__cookie_admin__";
    socketFns.reviveMock.mockClear();
    socketFns.parkMock.mockClear();
    setVisible("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("admin session returning to the tab ALSO invalidates the admin realtime families (8 keys)", async () => {
    const { invalidateSpy } = renderManager();

    await fireVisible();

    // 4 storefront calls (orders predicate + wallet + topups + me — the
    // pre-existing behavior for every authed session) + the 8-key admin
    // set (stats/orders/topups/users/tickets/risk×2/products).
    expect(invalidateSpy).toHaveBeenCalledTimes(12);
    const keys = invalidateSpy.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is { queryKey: unknown[] } => Boolean(arg?.queryKey))
      .map((arg) => JSON.stringify(arg.queryKey));
    expect(keys).toContain(JSON.stringify(["/api/admin/stats"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/orders"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/users"]));
    // The no-polling queues — the core of B6-2.
    expect(keys).toContain(JSON.stringify(["/api/admin/tickets"]));
    expect(keys).toContain(JSON.stringify(["admin-risk-events"]));
    expect(keys).toContain(JSON.stringify(["admin-risk-dashboard"]));
    // R127-B6-6: the products list key (60 s poll stays as fallback).
    expect(keys).toContain(JSON.stringify(["/api/admin/products"]));
  });

  it("hidden → no admin invalidations either (a backgrounded tab must not burn data)", async () => {
    const { invalidateSpy } = renderManager();
    await fireHidden();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R127-B6-3 — storefront SOCKET_RESYNC_EVENT consumer (R96-M5 recovery
// restored). lib/socket.ts dispatches the event exactly once per
// documented disconnect → reconnect cycle; the money screens
// (wallet.tsx / order-detail.tsx) are poll-less, so this listener is
// their only active-tab network-blip recovery.
// ─────────────────────────────────────────────────────────────────────────────

describe("SessionActivityManager — SOCKET_RESYNC_EVENT storefront consumer (R127-B6-3)", () => {
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

  it("storefront session: the resync event invalidates the transactional money families", async () => {
    const { invalidateSpy } = renderManager();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("subnation:socket-resync"));
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(4);
    const keys = invalidateSpy.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is { queryKey: unknown[] } => Boolean(arg?.queryKey))
      .map((arg) => JSON.stringify(arg.queryKey));
    expect(keys).toContain(JSON.stringify(["/api/wallet"]));
    expect(keys).toContain(JSON.stringify(["/api/wallet/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/auth/me"]));
    const predicateCalls = invalidateSpy.mock.calls
      .map((call) => call[0])
      .filter((arg) => typeof arg?.predicate === "function");
    expect(predicateCalls).toHaveLength(1);
  });

  it("the event path is NOT throttled — each disconnect→reconnect cycle invalidates again", async () => {
    const { invalidateSpy } = renderManager();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("subnation:socket-resync"));
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("subnation:socket-resync"));
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(8);
  });

  it("admin-only session: SAM does NOT invalidate on the event (SocketInitializer owns the admin branch)", async () => {
    authState.token = null;
    authState.adminToken = "__cookie_admin__";
    const { invalidateSpy } = renderManager();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("subnation:socket-resync"));
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("guests: the resync event is a no-op", async () => {
    authState.token = null;
    authState.adminToken = null;
    const { invalidateSpy } = renderManager();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("subnation:socket-resync"));
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("cleans the resync listener up on unmount (a later event must not invalidate)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <SessionActivityManager />
      </QueryClientProvider>,
    );
    unmount();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("subnation:socket-resync"));
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
