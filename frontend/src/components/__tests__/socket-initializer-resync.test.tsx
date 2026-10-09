/**
 * R104 (free-tier sleep economics) — SocketInitializer (admin channel).
 *
 * SocketInitializer is now the ADMIN realtime channel only: it connects
 * the admin room (live topup/order approvals + alert toasts) and
 * listens for the `subnation:socket-resync` window event to invalidate
 * the ADMIN query families after a documented disconnect → reconnect.
 * The user-level transactional resync + visibility/online revival +
 * socket parking moved to SessionActivityManager (tested separately —
 * R127-B6-3 also gave SAM the storefront branch of the resync event).
 *
 * These tests pin:
 *   1. with an adminToken: the resync event invalidates the admin
 *      families (stats/orders/topups/users + the R126-L3 tickets/risk
 *      keys + the R127-B6-6 products key — 8 keys) exactly once per
 *      event;
 *   2. a user-only session (adminToken null): this component is a
 *      no-op on the resync event — the storefront set is
 *      SessionActivityManager's branch (pinned in its own suite);
 *   3. listeners are cleaned up on unmount (no leaks across mounts);
 *   4. renders without touching connectAdminSocket when adminToken is
 *      null;
 *   5. R126-L3 (A2-1/A4-B-5): the connected socket's
 *      `admin-stats-update` handler invalidates the SAME eight-key set
 *      — the tickets list + the two risk keys were the missing
 *      freshness path (no polling on those pages, focus refetch off);
 *   6. R127-B6-4: the admin branch registers the connection_limited
 *      toast + connect_error console.warn (previously the capped-
 *      operator scenario went fully silent), and unregisters BOTH with
 *      precise off(event, fn) so the storefront's own listeners on
 *      the shared singleton survive an adminToken flip.
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

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  // R127-B6-4: SocketInitializer's connection_limited handler routes
  // through the same Sonner shim use-socket.ts uses.
  toast: toastMock,
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
    toastMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("adminToken present: resync invalidates the admin families exactly once per event", async () => {
    const { invalidateSpy } = renderInitializer();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });

    // R126-L3 (A2-1) + R127-B6-6: the resync key-set grew to eight —
    // the parked socket window can carry ticket reply/status + risk
    // label + product writes (the backend emits admin-stats-update
    // for all of those families), and the tickets/risk lists have no
    // polling fallback of their own (products has the 60 s poll as
    // its dropout fallback).
    expect(invalidateSpy).toHaveBeenCalledTimes(8);
    const keys = invalidatedKeys(invalidateSpy);
    expect(keys).toContain(JSON.stringify(["/api/admin/stats"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/orders"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/users"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/tickets"]));
    expect(keys).toContain(JSON.stringify(["admin-risk-events"]));
    expect(keys).toContain(JSON.stringify(["admin-risk-dashboard"]));
    expect(keys).toContain(JSON.stringify(["/api/admin/products"]));

    // A second event (new reconnect cycle) fires the set again.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(16);
  });

  it("user-only session (adminToken null): this component stays a no-op on the resync event (the storefront set is SAM's branch — R127-B6-3)", async () => {
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

  it("an admin-stats-update push invalidates all eight families (incl. tickets + risk + products)", async () => {
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

    expect(invalidateSpy).toHaveBeenCalledTimes(8);
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
    // R127-B6-6: the products list key — products.tsx's base-key
    // invalidation comment always claimed socket coverage.
    expect(keys).toContain(JSON.stringify(["/api/admin/products"]));
  });
});

// R127-B6-4 (B6 sockets audit): the admin socket branch now registers
// the connection_limited toast + connect_error console.warn — the
// capped-operator scenario (CGNAT primary market: the 6th connection
// behind a carrier IP is politely capped, hard-disconnected, retried,
// re-capped…) previously went dark with zero feedback on the admin
// side. Also pins the PRECISE off(event, fn) cleanup: a blanket
// off("connection_limited") would strip the storefront's own listener
// on the shared singleton (use-socket.ts registers both events too).
describe("SocketInitializer — connection_limited / connect_error on the admin branch (R127-B6-4)", () => {
  beforeEach(() => {
    authState.adminToken = "__cookie_admin__";
    connectAdminSocketMock.mockReset();
    toastMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers both handlers; connection_limited fires ONE stable-id toast; connect_error only warns", async () => {
    const onMock = vi.fn();
    const fakeSocket = { on: onMock, off: vi.fn() };
    connectAdminSocketMock.mockResolvedValue(fakeSocket);

    renderInitializer();

    await waitFor(() => expect(onMock).toHaveBeenCalled());
    const limitedReg = onMock.mock.calls.find(([event]) => event === "connection_limited");
    const errorReg = onMock.mock.calls.find(([event]) => event === "connect_error");
    expect(limitedReg).toBeTruthy();
    expect(errorReg).toBeTruthy();

    const limitedHandler = limitedReg![1] as (data: { reason?: string; message?: string }) => void;
    const errorHandler = errorReg![1] as (error: Error) => void;

    await act(async () => {
      limitedHandler({ reason: "per_ip_cap", message: "server copy" });
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "socket-connection-limited", description: "server copy" }),
    );

    // Repeats refresh the same toast id (sonner stable-id dedupe) — no
    // per-reconnect-attempt spam.
    await act(async () => {
      limitedHandler({ reason: "per_ip_cap" });
    });
    expect(toastMock).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "socket-connection-limited" }),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await act(async () => {
      errorHandler(new Error("websocket error"));
    });
    expect(warnSpy).toHaveBeenCalledWith("[admin-socket] connect_error:", "websocket error");
    expect(toastMock).toHaveBeenCalledTimes(2); // connect_error never toasts
    warnSpy.mockRestore();
  });

  it("unmount unregisters BOTH with precise off(event, fn) — never a blanket off that would strip the storefront's listeners", async () => {
    const onMock = vi.fn();
    const offMock = vi.fn();
    const fakeSocket = { on: onMock, off: offMock };
    connectAdminSocketMock.mockResolvedValue(fakeSocket);

    const { unmount } = renderInitializer();
    await waitFor(() => expect(onMock).toHaveBeenCalled());
    unmount();

    // The shared-with-use-socket events come off with their exact fn…
    expect(offMock).toHaveBeenCalledWith("connection_limited", expect.any(Function));
    expect(offMock).toHaveBeenCalledWith("connect_error", expect.any(Function));
    // …while the admin-only events keep the pre-existing blanket form.
    expect(offMock).toHaveBeenCalledWith("admin-stats-update");
    expect(offMock).toHaveBeenCalledWith("admin-alert-new");
  });
});
