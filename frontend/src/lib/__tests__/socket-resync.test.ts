/**
 * 96-F3 (R96 M1 + M5 + A4 §2.1) — socket persistence/revival/resync tests.
 *
 * lib/socket.ts is the socket.io singleton owner. These tests (with a
 * fake socket.io-client) pin:
 *
 *   1. the manager NEVER surrenders: reconnectionAttempts: Infinity +
 *      reconnectionDelayMax: 10_000 (the old cap of 5 meant ~31 s of
 *      tunnel silence killed realtime for the whole session);
 *   2. the documented-disconnect → reconnect cycle dispatches exactly
 *      ONE `subnation:socket-resync` window event (SocketInitializer
 *      listens and invalidates the transactional queries);
 *   3. deliberate local disconnects (logout/account switch — reason
 *      "io client disconnect") do NOT arm the resync flag;
 *   4. reviveSocket() is the idempotent online/visibility revival hook
 *      (no-op when connected or when no socket exists — guests never
 *      pay for one).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ioMock } = vi.hoisted(() => ({ ioMock: vi.fn() }));
vi.mock("socket.io-client", () => ({ io: ioMock }));

import {
  SOCKET_RESYNC_EVENT,
  __resetSocketStateForTests,
  connectSocket,
  disconnectSocket,
  getSocket,
  reviveSocket,
} from "../socket";

/** Minimal socket.io Socket stand-in (the surface lib/socket.ts touches). */
class FakeSocket {
  connected = false;
  private listeners = new Map<string, Set<(arg?: unknown) => void>>();
  connectCalls = 0;
  emitCalls: Array<{ event: string; args: unknown[] }> = [];

  on(event: string, fn: (arg?: unknown) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn?: (arg?: unknown) => void) {
    if (!this.listeners.has(event)) return this;
    if (fn) this.listeners.get(event)!.delete(fn);
    else this.listeners.delete(event);
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  /** Simulate a server/lifecycle event arriving on the socket. */
  fire(event: string, arg?: unknown) {
    for (const fn of this.listeners.get(event) ?? []) fn(arg);
  }

  emit(event: string, ...args: unknown[]) {
    this.emitCalls.push({ event, args });
    return this;
  }

  connect() {
    this.connectCalls += 1;
    this.connected = true;
    return this;
  }

  disconnect() {
    this.connected = false;
    this.fire("disconnect", "io client disconnect");
    return this;
  }
}

function createFakeSocket(): FakeSocket {
  const fake = new FakeSocket();
  ioMock.mockReturnValue(fake);
  return fake;
}

function captureResyncEvents(): Array<{ type: string }> {
  const events: Array<{ type: string }> = [];
  const listener = (event: Event) => events.push({ type: event.type });
  window.addEventListener(SOCKET_RESYNC_EVENT, listener);
  return events;
}

describe("lib/socket — persistence options (96-F3 M1)", () => {
  beforeEach(() => {
    ioMock.mockReset();
    __resetSocketStateForTests();
  });

  afterEach(() => {
    __resetSocketStateForTests();
  });

  it("creates the manager with reconnectionAttempts: Infinity and reconnectionDelayMax: 10s", async () => {
    const fake = createFakeSocket();

    await getSocket();

    expect(ioMock).toHaveBeenCalledTimes(1);
    const options = ioMock.mock.calls[0][1] as Record<string, unknown>;
    expect(options).toMatchObject({
      autoConnect: false,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 10_000,
      withCredentials: true,
    });
    expect(fake.connectCalls).toBe(0); // getSocket alone does not connect
  });

  it("reuses the singleton across calls (one io() per session)", async () => {
    createFakeSocket();
    const first = await getSocket();
    const second = await getSocket();
    expect(first).toBe(second);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });
});

describe("lib/socket — resync event on documented disconnect → reconnect (96-F3 M5 + A4 §2.1)", () => {
  beforeEach(() => {
    ioMock.mockReset();
    __resetSocketStateForTests();
  });

  afterEach(() => {
    __resetSocketStateForTests();
  });

  it("dispatches exactly ONE resync event per disconnect→reconnect cycle", async () => {
    const fake = createFakeSocket();
    const events = captureResyncEvents();

    await connectSocket(42);

    // Initial connect (no prior disconnect) — no resync event.
    fake.fire("connect");
    expect(events).toHaveLength(0);

    // Network gap: transport-level disconnect…
    fake.fire("disconnect", "transport close");
    // …then recovery. ONE event, carrying the missed-events signal.
    fake.fire("connect");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(SOCKET_RESYNC_EVENT);

    // A subsequent connect WITHOUT an intervening disconnect (e.g. an
    // account switch on a live socket) must NOT re-fire.
    fake.fire("connect");
    expect(events).toHaveLength(1);

    // A full second cycle fires exactly once more.
    fake.fire("disconnect", "ping timeout");
    fake.fire("connect");
    expect(events).toHaveLength(2);
  });

  it("arms the flag for server-initiated disconnects (socket.io never auto-reconnects those)", async () => {
    const fake = createFakeSocket();
    const events = captureResyncEvents();

    await connectSocket(42);
    fake.fire("disconnect", "io server disconnect");
    fake.fire("connect");

    expect(events).toHaveLength(1);
  });

  it("deliberate local disconnects (logout / account switch) do NOT arm the resync flag", async () => {
    const fake = createFakeSocket();
    const events = captureResyncEvents();

    await connectSocket(42);
    // What disconnectSocket() does internally — reason "io client
    // disconnect" is OUR OWN choice, nothing was missed.
    fake.fire("disconnect", "io client disconnect");
    fake.fire("connect");

    expect(events).toHaveLength(0);
  });

  it("re-joins the user room on every connect (existing behavior preserved)", async () => {
    const fake = createFakeSocket();

    await connectSocket(42);
    fake.fire("connect");
    fake.fire("connect");

    const joins = fake.emitCalls.filter((c) => c.event === "join-user");
    expect(joins).toHaveLength(2);
    expect(joins[0].args).toEqual([42]);
  });
});

describe("lib/socket — reviveSocket (96-F3 M1 revival hook)", () => {
  beforeEach(() => {
    ioMock.mockReset();
    __resetSocketStateForTests();
  });

  afterEach(() => {
    __resetSocketStateForTests();
  });

  it("revives a disconnected socket via connect() (idempotent when already connected)", async () => {
    const fake = createFakeSocket();
    await connectSocket(42);
    expect(fake.connectCalls).toBe(1); // the initial connectSocket()

    // Simulate a dead socket (e.g. server-initiated disconnect).
    fake.connected = false;

    reviveSocket();
    expect(fake.connectCalls).toBe(2);
    expect(fake.connected).toBe(true);

    // Already connected → no-op.
    reviveSocket();
    expect(fake.connectCalls).toBe(2);
  });

  it("is a no-op when no socket exists (guests — the gating lives in App)", () => {
    expect(() => reviveSocket()).not.toThrow();
  });

  it("disconnectSocket() tears the singleton down (revive is then a no-op until reconnect)", async () => {
    const fake = createFakeSocket();
    await connectSocket(42);
    expect(fake.connected).toBe(true);

    disconnectSocket();
    expect(fake.connected).toBe(false);

    reviveSocket();
    expect(fake.connectCalls).toBe(1); // nothing revived — singleton gone
  });
});
