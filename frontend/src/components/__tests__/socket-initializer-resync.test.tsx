/**
 * 96-F3 (R96 M1 + M5 + A4 §2.1) — SocketInitializer resync/revival tests.
 *
 * SocketInitializer is the App-root mount that owns the network
 * resilience glue: it listens for the `subnation:socket-resync` window
 * event (dispatched by lib/socket.ts after a documented disconnect →
 * reconnect) and invalidates the TRANSACTIONAL query families exactly
 * once per event, plus a throttled visibilitychange resync and socket
 * revival on online/visibility. These tests pin:
 *
 *   1. the resync event invalidates orders (predicate sweep covering
 *      list + every open detail), wallet, topups and /api/auth/me —
 *      using the REAL generated-client key shapes;
 *   2. catalog/product queries are NEVER touched (the intentional
 *      anti-refetch-storm decision);
 *   3. visibilitychange → visible triggers the same set ONCE per 30 s
 *      (throttle), hidden triggers nothing;
 *   4. `online` + visibility revive a dead socket (reviveSocket);
 *   5. listeners are cleaned up on unmount (no leaks across mounts).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reviveMock } = vi.hoisted(() => ({ reviveMock: vi.fn() }));

vi.mock("@/hooks/use-socket", () => ({
  useSocket: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    token: "__cookie_session__",
    adminToken: null,
    setToken: vi.fn(),
    setAdminToken: vi.fn(),
    setAdminPermissions: vi.fn(),
  }),
}));

vi.mock("@/lib/socket", () => ({
  connectAdminSocket: vi.fn(async () => null),
  reviveSocket: reviveMock,
  SOCKET_RESYNC_EVENT: "subnation:socket-resync",
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: undefined, error: null }),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListTopupsQueryKey: () => ["/api/wallet/topups"],
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

describe("SocketInitializer — resync event invalidation (96-F3 M5 + A4 §2.1)", () => {
  beforeEach(() => {
    reviveMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("invalidates the transactional families exactly once per resync event — never the catalog", async () => {
    const { invalidateSpy } = renderInitializer();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(4);

    const keys = invalidatedKeys(invalidateSpy);
    expect(keys).toContain(JSON.stringify(["/api/wallet"]));
    expect(keys).toContain(JSON.stringify(["/api/wallet/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/auth/me"]));

    // The orders leg is a PREDICATE sweep (covers the list's params
    // variants + every open /api/orders/:orderCode detail page), not a
    // plain key — mirror of use-socket.ts' order-updated handler.
    const predicateCalls = invalidateSpy.mock.calls
      .map((call) => call[0])
      .filter((arg) => typeof arg?.predicate === "function");
    expect(predicateCalls).toHaveLength(1);
    const predicate = predicateCalls[0].predicate;
    // Real usage passes full Query objects; the predicate only reads
    // queryKey — feed it minimal stand-ins.
    const queryLike = (key: unknown[]) => ({ queryKey: key }) as never;
    expect(predicate(queryLike(["/api/orders"]))).toBe(true);
    expect(predicate(queryLike(["/api/orders", { limit: 4 }]))).toBe(true);
    expect(predicate(queryLike(["/api/orders/SNDB-1234"]))).toBe(true);
    expect(predicate(queryLike(["/api/wallet"]))).toBe(false);
    // Catalog is deliberately excluded (anti-refetch-storm decision).
    expect(predicate(queryLike(["/api/products", {}]))).toBe(false);

    // Exactly once per event: a second event fires the set again (new
    // reconnect cycle → new missed events), still never the catalog.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(RESYNC_EVENT));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(8);
    expect(invalidatedKeys(invalidateSpy)).not.toContain(JSON.stringify(["/api/products", {}]));
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

describe("SocketInitializer — visibilitychange resync + revival (96-F3 A4 §2.1)", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reviveMock.mockClear();
    // jsdom defaults to "visible".
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    if (dateNowSpy) dateNowSpy.mockRestore();
    cleanup();
  });

  it("visible → invalidates the same transactional set once, throttled within 30 s", async () => {
    const { invalidateSpy } = renderInitializer();

    let now = 1_000_000;
    dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(4);

    // Rapid re-focus (notification shade toggles etc.) — throttled.
    now += 1_000;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(4);

    // 31 s later — fresh resync allowed.
    now += 30_000;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(8);
  });

  it("hidden → no resync (a backgrounded tab must not burn mobile data)", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const { invalidateSpy } = renderInitializer();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("revives the socket on `online` and on visible", async () => {
    const { unmount } = renderInitializer();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(reviveMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(reviveMock).toHaveBeenCalledTimes(2);

    unmount();

    // Post-unmount: listener gone — no stray revives.
    window.dispatchEvent(new Event("online"));
    expect(reviveMock).toHaveBeenCalledTimes(2);
  });
});

describe("SocketInitializer — admin socket wiring stays intact", () => {
  beforeEach(() => {
    reviveMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders without touching the admin socket when adminToken is null", async () => {
    // The auth mock returns adminToken: null — connectAdminSocket must
    // not be called (imported lazily through the mocked module).
    const { connectAdminSocket } = await import("@/lib/socket");
    const { invalidateSpy } = renderInitializer();

    await waitFor(() => {
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
    expect(connectAdminSocket).not.toHaveBeenCalled();
  });
});
