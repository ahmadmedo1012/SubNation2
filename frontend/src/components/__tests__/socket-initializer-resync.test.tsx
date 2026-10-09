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
 *      families (stats/orders/topups/users + the R126-L3 tickets/risk
 *      keys) exactly once per event;
 *   2. a user-only session (adminToken null): the resync event is a
 *      no-op — no invalidation storms from socket-less sessions;
 *   3. listeners are cleaned up on unmount (no leaks across mounts);
 *   4. renders without touching connectAdminSocket when adminToken is
 *      null;
 *   5. R126-L3 (A2-1/A4-B-5): the connected socket's
 *      `admin-stats-update` handler invalidates the SAME seven-key set
 *      — the tickets list + the two risk keys were the missing
 *      freshness path (no polling on those pages, focus refetch off).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  adminToken: null as string | null,
}));

const { connectAdminSocketMock } = vi.hoisted(() => ({
  // The real connectAdminSocket resolves Socket | null; the mock is
  // widened to Promise<unknown> so per-suite fake sockets (the R126-L3
  // connected-handler test) can be mockResolvedValue'd without an
  // as-cast against the inferred Promise<null>.
  connectAdminSocketMock: vi.fn(async (): Promise<unknown> => null),
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

/** The typed spy renderInitializer hands out (keeps mock.calls
 * element types inferred — no implicit-any callbacks in the reader). */
type InvalidateSpy = ReturnType<typeof renderInitializer>["invalidateSpy"];

/** Invalidate call arguments shaped as { queryKey: [...] }. */
function invalidatedKeys(invalidateSpy: InvalidateSpy) {
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

    // R126-L3 (A2-1): the resync key-set grew to seven — the parked
    // socket window can carry ticket reply/status + risk label writes
    // (the backend emits admin-stats-update for both families), and
    // the tickets/risk lists have no polling fallback of their own.
    expect(invalidateSpy).toHaveBeenCalledTimes(7);
    const keys = invalidatedKeys(invalidateSpy);
    expect(keys).toContain(JSON.stringify(["/api/admin/stats"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/orders"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/users"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/tickets"]));
    expect(keys).toContain(JSON.stringify(["admin-risk-events"]));
    expect(keys).toContain(JSON.stringify(["admin-risk-dashboard"]));

    // A second event (new reconnect cycle) fires the set again.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(14);
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

// R126-L3 (A2-1 / A4-B-5): the CONNECTED socket path — the A4 audit
// noted this handler was entirely untested (only the resync window
// event was). A fake socket captures the .on registrations; firing
// the captured `admin-stats-update` handler must invalidate the full
// seven-key set (stats/orders/topups/users + tickets + the two risk
// keys) — the tickets list key is the one with no polling fallback,
// so a regression here resurrects the stale-queue-vs-badge bug.
describe("SocketInitializer — connected admin-stats-update handler (R126-L3)", () => {
  beforeEach(() => {
    authState.adminToken = "__cookie_admin__";
    connectAdminSocketMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("an admin-stats-update push invalidates all seven families (incl. tickets + risk)", async () => {
    // A minimal fake socket: capture the .on(event, handler) pairs so
    // the test can invoke the real registered handler.
    const onMock = vi.fn();
    const fakeSocket = { on: onMock, off: vi.fn() };
    connectAdminSocketMock.mockResolvedValue(fakeSocket);

    const { invalidateSpy } = renderInitializer();

    await waitFor(() => expect(onMock).toHaveBeenCalled());
    // Mount itself invalidates nothing — only pushes do.
    expect(invalidateSpy).not.toHaveBeenCalled();

    const statsRegistration = onMock.mock.calls.find(([event]) => event === "admin-stats-update");
    expect(statsRegistration).toBeTruthy();
    const handler = statsRegistration![1] as () => void;

    await act(async () => {
      handler();
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(7);
    const keys = invalidatedKeys(invalidateSpy);
    expect(keys).toContain(JSON.stringify(["/api/admin/stats"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/orders"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/users"]));
    // The three R126-L3 additions — the keys the tickets page
    // ("/api/admin/tickets" prefix, tickets.tsx queryKey) and the risk
    // pages ("admin-risk-events"/"admin-risk-dashboard") actually use.
    expect(keys).toContain(JSON.stringify(["/api/admin/tickets"]));
    expect(keys).toContain(JSON.stringify(["admin-risk-events"]));
    expect(keys).toContain(JSON.stringify(["admin-risk-dashboard"]));
  });
});
