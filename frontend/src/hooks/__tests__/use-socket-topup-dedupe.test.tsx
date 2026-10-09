/**
 * R127-B6-7 (B6 sockets audit) — topup-updated toast dedupe keyed on the
 * topup ID, not the amount.
 *
 * The backend payload carries {id, status, amount}
 * (services/topup.service.ts) but the handler used to key sonner's
 * stable toast id on `topup-${data.amount}-${data.status}`. A user with
 * two pending 50-LYD topups (MAX_PENDING=3 makes the pair legitimate)
 * who gets both approved saw ONE toast — the second was silently
 * deduped by the identical amount-keyed id. The balance/list
 * invalidations ran regardless, so this is pure notification loss —
 * pinned here so the id contract (per-topup) cannot silently regress.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connectSocketMock } = vi.hoisted(() => ({ connectSocketMock: vi.fn() }));
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

// use-socket imports connectSocket from "../lib/socket"; the mock key
// "@/lib/socket" resolves to the same module (vitest mocks by resolved
// id), keeping the factory in the canonical alias form the other socket
// suites use.
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

function renderHook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("useSocket — topup-updated toast dedupe keys on the topup ID (R127-B6-7)", () => {
  beforeEach(() => {
    connectSocketMock.mockReset();
    toastMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("two same-amount approvals produce TWO toasts with distinct ids (the second is no longer swallowed)", async () => {
    const socket = fakeSocket();
    connectSocketMock.mockResolvedValue(socket);
    renderHook();

    await waitFor(() => expect(socket.on).toHaveBeenCalled());
    expect(toastMock).not.toHaveBeenCalled();

    // Both pending topups approved in the same instant — identical
    // amount + status, DIFFERENT ids. The old amount-keyed ids
    // ("topup-50-approved" for both) collapsed into one toast.
    socket.fire("topup-updated", { id: 101, amount: 50, status: "approved" });
    socket.fire("topup-updated", { id: 102, amount: 50, status: "approved" });

    expect(toastMock).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "topup-101-approved" }),
    );
    expect(toastMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "topup-102-approved" }),
    );
  });

  it("same topup re-notified keeps a stable id (sonner refreshes instead of stacking)", async () => {
    const socket = fakeSocket();
    connectSocketMock.mockResolvedValue(socket);
    renderHook();

    await waitFor(() => expect(socket.on).toHaveBeenCalled());

    socket.fire("topup-updated", { id: 205, amount: 75, status: "approved" });
    socket.fire("topup-updated", { id: 205, amount: 75, status: "approved" });

    expect(toastMock).toHaveBeenCalledTimes(2);
    const first = toastMock.mock.calls[0]![0] as { id?: string };
    const second = toastMock.mock.calls[1]![0] as { id?: string };
    expect(first.id).toBe("topup-205-approved");
    expect(second.id).toBe(first.id);
  });

  it("the rejected branch keys on the id too", async () => {
    const socket = fakeSocket();
    connectSocketMock.mockResolvedValue(socket);
    renderHook();

    await waitFor(() => expect(socket.on).toHaveBeenCalled());

    socket.fire("topup-updated", { id: 303, amount: 50, status: "rejected" });

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "topup-303-rejected", variant: "destructive" }),
    );
  });
});
