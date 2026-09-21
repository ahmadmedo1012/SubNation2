/**
 * 96-F3 (R96 F-5 / mobile-performance-pwa §8-F5) → R104 (free-tier
 * sleep economics) — socket gating.
 *
 * DeferredSocketInitializer (App.tsx) must only warm the socket.io
 * stack (~16 KB gzip + engine.io parse) for ADMIN sessions — operators
 * on /admin need the admin room for live approvals. Anonymous visitors
 * AND regular authenticated users never download it: the old
 * every-authed-user socket (25 s pings, reconnectionAttempts Infinity)
 * kept the Render free instance awake 24/7 from any open tab, voiding
 * the accepted sleep design (see R104 AG3 audit). Storefront realtime
 * is page-scoped now (order-detail) and everything else runs on
 * polls/resync that cannot defeat the 15-minute idle sleep.
 *
 * These tests pin:
 *
 *   1. guests never mount SocketInitializer (even after the timer);
 *   2. a regular authed USER never mounts it either (R104 change);
 *   3. an admin session mounts it after the deferral window;
 *   4. admin login mid-session re-arms the timer;
 *   5. admin logout after mount keeps the initializer mounted (the
 *      socket teardown is disconnectSocket()'s job — current
 *      semantics).
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  token: null as string | null,
  adminToken: null as string | null,
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

vi.mock("@/components/SocketInitializer", () => ({
  SocketInitializer: () => <div data-testid="socket-initializer" />,
}));

import { DeferredSocketInitializer } from "@/App";

function setAuth(token: string | null, adminToken: string | null = null) {
  authState.token = token;
  authState.adminToken = adminToken;
}

async function advanceDeferral() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_500);
  });
}

describe("DeferredSocketInitializer — admin-only gating (96-F3 F-5 → R104)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAuth(null, null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("guests never mount SocketInitializer, even long after the timer", async () => {
    setAuth(null, null);
    render(<DeferredSocketInitializer />);

    await advanceDeferral();
    // Well past the deferral window — still nothing for a guest.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.queryByTestId("socket-initializer")).not.toBeInTheDocument();
  });

  it("R104: a regular authed USER never mounts it (storefront socket is page-scoped)", async () => {
    setAuth("__cookie_session__", null);
    render(<DeferredSocketInitializer />);

    await advanceDeferral();
    // Well past the deferral window — a user-only session must stay
    // socket-less so an open tab cannot keep the free instance awake.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.queryByTestId("socket-initializer")).not.toBeInTheDocument();
  });

  it("an admin session mounts after the 3.5 s deferral window", async () => {
    setAuth(null, "__cookie_admin__");
    render(<DeferredSocketInitializer />);

    // Before the window: still deferred (first paint uncontended).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByTestId("socket-initializer")).not.toBeInTheDocument();

    await advanceDeferral();
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();
  });

  it("an admin WITH a user token (operator browsing the storefront) still mounts", async () => {
    setAuth("__cookie_session__", "__cookie_admin__");
    render(<DeferredSocketInitializer />);

    await advanceDeferral();
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();
  });

  it("admin login mid-session re-arms the deferral timer", async () => {
    setAuth(null, null);
    const { rerender } = render(<DeferredSocketInitializer />);

    await advanceDeferral();
    expect(screen.queryByTestId("socket-initializer")).not.toBeInTheDocument();

    // The operator signs in — adminToken flips truthy.
    setAuth(null, "__cookie_admin__");
    rerender(<DeferredSocketInitializer />);

    await advanceDeferral();
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();
  });

  it("logout after mount keeps the initializer mounted (socket teardown is disconnectSocket's job)", async () => {
    setAuth(null, "__cookie_admin__");
    const { rerender } = render(<DeferredSocketInitializer />);
    await advanceDeferral();
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();

    setAuth(null, null);
    rerender(<DeferredSocketInitializer />);
    // The 3.5 s timer re-arm is skipped (guest) but the mounted
    // component stays — matching the pre-gating semantics where the
    // socket lifecycle is owned by disconnectSocket.
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();
  });
});
