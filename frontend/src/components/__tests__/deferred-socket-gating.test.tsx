/**
 * 96-F3 (R96 F-5 / mobile-performance-pwa §8-F5) — guest socket gating.
 *
 * DeferredSocketInitializer (App.tsx) must only warm the socket.io
 * stack (~16 KB gzip + engine.io parse) for visitors carrying an
 * authed token — the user sentinel OR the admin sentinel (operators on
 * /admin need the admin room). Anonymous visitors — the majority of
 * traffic — never download it, and login mid-session re-arms the 3.5 s
 * deferral timer. These tests pin:
 *
 *   1. guests never mount SocketInitializer (even after the timer);
 *   2. an authed user mounts it after the deferral window;
 *   3. an admin-only session (no user token) still mounts it;
 *   4. login mid-session re-arms the timer;
 *   5. logout after mount keeps the initializer mounted (the socket
 *      teardown is disconnectSocket()'s job — current semantics).
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

describe("DeferredSocketInitializer — token gating (96-F3 F-5)", () => {
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

  it("an authed user (cookie sentinel) mounts after the 3.5 s deferral window", async () => {
    setAuth("__cookie_session__", null);
    render(<DeferredSocketInitializer />);

    // Before the window: still deferred (first paint uncontended).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByTestId("socket-initializer")).not.toBeInTheDocument();

    await advanceDeferral();
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();
  });

  it("an admin-only session (operator on /admin, no user token) still mounts", async () => {
    setAuth(null, "__cookie_session__");
    render(<DeferredSocketInitializer />);

    await advanceDeferral();
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();
  });

  it("login mid-session re-arms the deferral timer for the now-authed user", async () => {
    setAuth(null, null);
    const { rerender } = render(<DeferredSocketInitializer />);

    await advanceDeferral();
    expect(screen.queryByTestId("socket-initializer")).not.toBeInTheDocument();

    // The user signs in — token flips truthy.
    setAuth("jwt-test-token", null);
    rerender(<DeferredSocketInitializer />);

    await advanceDeferral();
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();
  });

  it("logout after mount keeps the initializer mounted (socket teardown is disconnectSocket's job)", async () => {
    setAuth("__cookie_session__", null);
    const { rerender } = render(<DeferredSocketInitializer />);
    await advanceDeferral();
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();

    setAuth(null, null);
    rerender(<DeferredSocketInitializer />);
    // The 3.5 s timer re-arm is skipped (guest) but the mounted
    // component stays — matching the pre-gating semantics where the
    // socket lifecycle is owned by useSocket/disconnectSocket.
    expect(screen.getByTestId("socket-initializer")).toBeInTheDocument();
  });
});
