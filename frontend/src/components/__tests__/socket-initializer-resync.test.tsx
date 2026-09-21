/**
 * R104 (free-tier sleep economics) — SocketInitializer (admin channel).
 *
 * SocketInitializer is now the ADMIN realtime channel only: it connects
 * the admin room (live topup/order approvals + alert toasts) and
 * listens for the `subnation:socket-resync` window event to invalidate
 * the ADMIN query families after a documented disconnect → reconnect.
 * The user-level transactional resync + visibility/online revival +
 * socket parking moved to SessionActivityManager (tested separately).
 *
 * These tests pin:
 *   1. with an adminToken: the resync event invalidates the admin
 *      families (stats/orders/topups/users) exactly once per event;
 *   2. a user-only session (adminToken null): the resync event is a
 *      no-op — no invalidation storms from socket-less sessions;
 *   3. listeners are cleaned up on unmount (no leaks across mounts);
 *   4. renders without touching connectAdminSocket when adminToken is
 *      null.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  adminToken: null as string | null,
}));

const { connectAdminSocketMock } = vi.hoisted(() => ({
  connectAdminSocketMock: vi.fn(async () => null),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    token: "__cookie_session__",
    adminToken: authState.adminToken,
    setToken: vi.fn(),
    setAdminToken: vi.fn(),
    setAdminPermissions: vi.fn(),
  }),
}));

vi.mock("@/lib/socket", () => ({
  connectAdminSocket: connectAdminSocketMock,
  reviveSocket: vi.fn(),
  parkSocketIfConnected: vi.fn(),
  SOCKET_RESYNC_EVENT: "subnation:socket-resync",
}));

import { SocketInitializer } from "../SocketInitializer";

const RESYNC_EVENT = "subnation:socket-resync";

function renderInitializer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <SocketInitializer />
    </QueryClientProvider>,
  );
  return { client, invalidateSpy, ...view };
}

/** Invalidate call arguments shaped as { queryKey: [...] }. */
function invalidatedKeys(invalidateSpy: ReturnType<typeof vi.spyOn>) {
  return invalidateSpy.mock.calls
    .map((call) => call[0])
    .filter((arg): arg is { queryKey: unknown[] } => Boolean(arg?.queryKey))
    .map((arg) => JSON.stringify(arg.queryKey));
}

describe("SocketInitializer — admin resync event (R104)", () => {
  beforeEach(() => {
    authState.adminToken = "__cookie_admin__";
    connectAdminSocketMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("adminToken present: resync invalidates the admin families exactly once per event", async () => {
    const { invalidateSpy } = renderInitializer();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(4);
    const keys = invalidatedKeys(invalidateSpy);
    expect(keys).toContain(JSON.stringify(["/api/admin/stats"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/orders"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/users"]));

    // A second event (new reconnect cycle) fires the set again.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(8);
  });

  it("user-only session (adminToken null): resync event is a no-op", async () => {
    authState.adminToken = null;
    const { invalidateSpy } = renderInitializer();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("cleans its listeners up on unmount (a later event must not invalidate)", async () => {
    const { invalidateSpy, unmount } = renderInitializer();
    unmount();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("SocketInitializer — admin socket wiring stays intact", () => {
  beforeEach(() => {
    authState.adminToken = null;
    connectAdminSocketMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders without touching the admin socket when adminToken is null", async () => {
    const { invalidateSpy } = renderInitializer();

    await waitFor(() => {
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
    expect(connectAdminSocketMock).not.toHaveBeenCalled();
  });
});
