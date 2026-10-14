/**
 * R146 (components audit F6) — use-socket's order-updated +
 * connection_limited legs.
 *
 * The order-updated handler is the 93-C5/F-15 fix: the toast said
 * "تم تحديث حالة طلبك" while the orders list AND any open order-detail
 * page kept the stale status until a manual reload. The invalidation
 * rides a predicate sweep (queryKey[0] starts with "/api/orders")
 * because the detail page's key is built from the orderCode STRING
 * ([`/api/orders/${orderCode}`]) — a key-prefix matcher cannot reach
 * it. If a refactor narrows that predicate (or changes how the orders
 * keys are built), invalidation silently stops and the old defect
 * returns with nothing failing — pinned here against the REAL
 * generated key functions.
 *
 * connection_limited (R123-E4b P3-m): the backend connection caps emit
 * it then hard-disconnect ~250ms later; nothing listened, so a capped
 * session's realtime surface went dark. One toast per occurrence, keyed
 * by a stable id.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  getGetOrderQueryKey,
  getGetWalletQueryKey,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connectSocketMock } = vi.hoisted(() => ({ connectSocketMock: vi.fn() }));
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

// use-socket imports connectSocket from "../lib/socket"; the mock key
// "@/lib/socket" resolves to the same module (vitest mocks by resolved
// id) — the topup-dedupe suite's idiom.
vi.mock("@/lib/socket", () => ({
  connectSocket: connectSocketMock,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

import { useSocket } from "../use-socket";

/** Minimal socket stand-in: capture .on(event, handler) registrations. */
function fakeSocket() {
  const handlers = new Map<string, (arg?: unknown) => void>();
  return {
    on: vi.fn((event: string, fn: (arg?: unknown) => void) => {
      handlers.set(event, fn);
    }),
    off: vi.fn(),
    fire: (event: string, arg?: unknown) => {
      handlers.get(event)?.(arg);
    },
  };
}

function Harness() {
  useSocket(42);
  return null;
}

/** The captured invalidateQueries argument, cast to the shape the
 *  sweep reads (the predicate only touches queryKey). */
type SweepArg = { predicate?: (query: { queryKey: unknown }) => boolean };

function renderHook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return invalidateSpy;
}

/** The one invalidateQueries call that carries a predicate (the orders
 *  sweep — the topup/me/ledger invalidations ride queryKey instead). */
function ordersSweep(invalidateSpy: ReturnType<typeof renderHook>): SweepArg {
  const arg = invalidateSpy.mock.calls
    .map((call) => call[0] as unknown as SweepArg)
    .find((a) => typeof a?.predicate === "function");
  expect(arg, "an order-updated predicate sweep was issued").toBeDefined();
  return arg!;
}

describe("useSocket — order-updated invalidates every /api/orders* key and toasts the order_code", () => {
  beforeEach(() => {
    connectSocketMock.mockReset();
    toastMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("the predicate accepts the generated list + orderCode detail keys and rejects a non-orders key", async () => {
    const socket = fakeSocket();
    connectSocketMock.mockResolvedValue(socket);
    const invalidateSpy = renderHook();

    await waitFor(() => expect(socket.on).toHaveBeenCalled());
    socket.fire("order-updated", { id: 77, status: "completed", order_code: "SNDB2026X" });

    const sweep = ordersSweep(invalidateSpy);
    // The list key, bare AND with its params variant (the storefront's
    // real shapes — home's 4-card strip and the orders page default).
    expect(sweep.predicate!({ queryKey: getListOrdersQueryKey() })).toBe(true);
    expect(sweep.predicate!({ queryKey: getListOrdersQueryKey({ limit: 4 }) })).toBe(true);
    // The detail page's orderCode key — the case a key-prefix matcher
    // misses (93-C5 / F-15: the open detail page kept the old status).
    expect(sweep.predicate!({ queryKey: getGetOrderQueryKey("SNDB2026X") })).toBe(true);
    // …and a sibling money key stays untouched.
    expect(sweep.predicate!({ queryKey: getGetWalletQueryKey() })).toBe(false);
  });

  it("the toast names the order_code when present, falling back to the numeric id", async () => {
    const socket = fakeSocket();
    connectSocketMock.mockResolvedValue(socket);
    renderHook();

    await waitFor(() => expect(socket.on).toHaveBeenCalled());

    socket.fire("order-updated", { id: 77, status: "completed", order_code: "SNDB2026X" });
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "تم تحديث حالة طلبك SNDB2026X",
        description: "الحالة الجديدة: مكتمل",
        id: "order-77-completed",
      }),
    );

    // Forward-compat fallback: no order_code in the payload → the plain
    // numeric id (R94-A1 #15 — every storefront surface speaks order_code).
    socket.fire("order-updated", { id: 42, status: "processing" });
    expect(toastMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: "تم تحديث حالة طلبك رقم #42",
        id: "order-42-processing",
      }),
    );
  });
});

describe("useSocket — connection_limited surfaces the capped-connection toast (R123-E4b P3-m)", () => {
  beforeEach(() => {
    connectSocketMock.mockReset();
    toastMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("toasts once per occurrence with the stable capped-connection id — backend message first, default copy otherwise", async () => {
    const socket = fakeSocket();
    connectSocketMock.mockResolvedValue(socket);
    renderHook();

    await waitFor(() => expect(socket.on).toHaveBeenCalled());

    socket.fire("connection_limited", { reason: "per_ip", message: "تم تجاوز الحد المسموح" });
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "عدد الاتصالات مرتفع",
        description: "تم تجاوز الحد المسموح",
        // One toast per occurrence — the stable id refreshes instead of
        // stacking per reconnect attempt that re-hits the cap.
        id: "socket-connection-limited",
      }),
    );

    socket.fire("connection_limited", {});
    expect(toastMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: "عدد الاتصالات مرتفع",
        description: "سنحاول إعادة الاتصال تلقائياً — أغلق التبويبات الأخرى وحاول مجدداً",
        id: "socket-connection-limited",
      }),
    );
  });
});
