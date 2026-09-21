import type { Socket } from "socket.io-client";
import { getSocketUrl } from "./api-config";

let socket: Socket | null = null;

/**
 * 97-F5 (R97-A4 §7 / F-03): dispose generation — a monotonic counter
 * bumped by every disconnectSocket(). getSocket() captures it BEFORE
 * awaiting the socket.io-client dynamic import and re-checks AFTER:
 * a teardown that raced the import must WIN (return null, never
 * construct the socket), otherwise a connectSocket() started just
 * before logout/identity-switch would connect a zombie socket AFTER
 * the switch — authenticated under a stale/dead cookie, spinning in
 * connect_error forever (reconnectionAttempts: Infinity) while
 * reviveSocket() keeps resurrecting it. This hardens the F-12 race
 * the R97 inspection flagged, which the added setToken() disconnects
 * in auth.tsx would otherwise make easier to hit.
 */
let disposeGeneration = 0;

/**
 * 96-F3 (R96 M5 + A4 §2.1): window CustomEvent fired exactly ONCE per
 * documented disconnect → reconnect cycle. SocketInitializer listens
 * for it and invalidates the transactional query families (orders /
 * wallet / topups / me) so events that were emitted WHILE the phone
 * was offline (tunnel, WiFi↔cellular handoff, backgrounded tab)
 * become visible immediately instead of at the next 5-minute poll.
 *
 * Catalog/product queries are deliberately NOT part of the resync set.
 */
export const SOCKET_RESYNC_EVENT = "subnation:socket-resync";

// The user identity the socket was last bound to. NOTE (97-F5 / F-03):
// this is ONLY used to DETECT identity switches in connectSocket() —
// the room membership itself is decided SERVER-SIDE at handshake from
// the auth_token cookie (backend/src/lib/socket.ts "SERVER-DRIVEN room
// joining on connect"; the client-emitted "join-user" below is treated
// by the server as a defensive idempotent NO-OP). A still-connected
// socket therefore stays in the PREVIOUS user's room until it is
// reconnected with the fresh cookie — connectSocket() tears it down on
// a userId change, and auth.tsx's setToken() disconnects it outright on
// every identity switch.
let currentUserId: number | string | undefined;

/**
 * 96-F3 (R96 M1 + M5): armed on any NON-deliberate disconnect
 * (transport close/error, ping timeout, server-initiated drop) and
 * cleared on the next successful connect. While armed, the connect
 * handler dispatches {@link SOCKET_RESYNC_EVENT} once — the flag is
 * the "exactly once per reconnect" guarantee.
 */
let wasDisconnected = false;

const handleUserConnect = () => {
  const s = socket;
  if (!s || currentUserId === undefined) return;
  // Defensive NO-OP server-side: authorizeJoinUser re-validates this
  // userId against the verified cookie identity and forged values are
  // silently dropped. The REAL room join happened at handshake.
  s.emit("join-user", currentUserId);
};

const handleAdminConnect = () => {
  const s = socket;
  if (!s) return;
  // Server-side authorizeJoinAdmin requires socket.data.isAdmin
  // === true (admin_token cookie verified). A forged join-admin
  // from a non-admin socket is silently dropped.
  s.emit("join-admin");
};

/**
 * 96-F3 (R96 M1 + M5): transport-level disconnect bookkeeping.
 * "io client disconnect" is OUR OWN socket.disconnect() (logout /
 * account switch) — nothing was missed, so it must not arm the
 * resync flag. Every other reason (transport close, ping timeout,
 * "io server disconnect" from the server's 5-minute liveness
 * re-verify) potentially missed user-scoped events.
 */
const handleDisconnect = (reason: string) => {
  if (reason === "io client disconnect") return;
  wasDisconnected = true;
};

/**
 * 96-F3 (R96 M5 + A4 §2.1): after a documented disconnect, the next
 * successful connect dispatches ONE resync event, then re-arms for
 * the next cycle. Registered once at socket creation; runs alongside
 * the join handlers below (listener order is irrelevant — the room
 * join and the query invalidation are independent).
 */
const handleResyncOnConnect = () => {
  if (!wasDisconnected) return;
  wasDisconnected = false;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SOCKET_RESYNC_EVENT));
  }
};

export async function getSocket() {
  if (!socket) {
    // Captured BEFORE the await — see disposeGeneration above.
    const generationAtStart = disposeGeneration;
    try {
      const { io } = await import("socket.io-client");
      // A disconnectSocket() that fired while the import was in flight
      // invalidated this creation — never construct the zombie socket.
      if (generationAtStart !== disposeGeneration) return null;
      const socketUrl = getSocketUrl();
      socket = io(socketUrl || undefined, {
        autoConnect: false,
        // R104 (free-tier sleep economics): the manager makes at most
        // 10 reconnect attempts (~2 min at the capped 10 s backoff) and
        // then STOPS. The old `Infinity` turned every authenticated tab
        // into an accidental keep-alive pinger: after Render spun the
        // service down, retries every 5–15 s (foreground) / ~once a
        // minute (throttled background tab) kept re-waking it forever,
        // silently burning the shared 750 instance-hours/month budget.
        // SessionActivityManager (visibility/online/activity listeners)
        // now revives the socket when the user ACTUALLY returns — the
        // resync invalidation covers anything missed meanwhile.
        reconnectionAttempts: 10,
        // Cap the exponential backoff (default doubles up to 5 min in
        // v4) so a long outage still reconnects within ~10 s of the
        // network returning.
        reconnectionDelayMax: 10_000,
        // Required: the server gates EVERY connection on the
        // `auth_token` (and/or `admin_token`) httpOnly cookie. Without
        // `withCredentials: true`, browsers omit cookies on the
        // WebSocket handshake whenever the API origin differs from
        // the SPA origin (e.g. split deployments). For same-origin
        // (subnation.ly), cookies travel anyway, but we set the flag
        // so behavior is identical across deployments.
        withCredentials: true,
      });

      // 96-F3 (R96 M1/M5): persistent lifecycle listeners — attached
      // once at creation, never re-registered (the off-before-on
      // below is a no-op guard matching the join-handler pattern).
      socket.off("disconnect", handleDisconnect);
      socket.on("disconnect", handleDisconnect);
      socket.off("connect", handleResyncOnConnect);
      socket.on("connect", handleResyncOnConnect);
    } catch (err) {
      console.error("Failed to initialize socket.io-client:", err);
      return null;
    }
  }
  return socket;
}

export async function connectSocket(userId?: number | string) {
  const s = await getSocket();
  if (!s) return null;

  // 97-F5 (R97-A4 §7 / F-03 — P2): the socket's room membership is
  // bound at HANDSHAKE from the cookie, so a userId change on a live
  // connection cannot be fixed by emitting join-user (server no-op).
  // Tear the connection down and reconnect: the fresh handshake
  // carries the NEW cookie and the server immediately joins the new
  // user's room. "io client disconnect" below deliberately does not
  // arm the resync flag — nothing was missed; the identity switch in
  // auth.tsx already cleared + invalidated the user-scoped caches.
  const identitySwitch =
    s.connected && currentUserId !== undefined && userId !== undefined && currentUserId !== userId;

  currentUserId = userId;

  // Dedup: named module-level handlers make `.off()` before `.on()` a
  // no-op on repeat calls, so repeated connectSocket() invocations
  // (remounts) never stack duplicate "connect" listeners that would
  // each emit join-user under stale ids.
  s.off("connect", handleUserConnect);
  s.on("connect", handleUserConnect);

  if (identitySwitch) {
    // Fresh handshake → server auto-joins the new user's room.
    s.disconnect();
    s.connect();
    return s;
  }

  if (!s.connected) {
    s.connect();
  } else {
    // Already connected under the SAME identity: re-assert the (no-op)
    // join defensively instead of waiting for a reconnect.
    handleUserConnect();
  }

  return s;
}

export async function connectAdminSocket() {
  const s = await getSocket();
  if (!s) return null;

  s.off("connect", handleAdminConnect);
  s.on("connect", handleAdminConnect);

  if (!s.connected) {
    s.connect();
  }

  return s;
}

/**
 * 96-F3 (R96 M1): idempotent revival for the online/visibilitychange
 * listeners in SocketInitializer. `socket.connect()` on an
 * already-connected socket is a no-op, so this is safe to call from
 * any network-state transition. Only revives when the singleton
 * already exists — guests never pay the socket.io download, and this
 * function must not be the thing that changes that.
 */
export function reviveSocket(): void {
  const s = socket;
  if (s && !s.connected) {
    s.connect();
  }
}

/**
 * R104 (free-tier sleep economics): park a connected socket WITHOUT
 * destroying the singleton. The Socket.IO engine exchanges ping/pong
 * frames every 25 s (socket.ts server default) — inbound frames that
 * reset Render's 15-minute idle timer, so an open socket in a forgotten
 * tab keeps the free instance awake 24/7. Parking disconnects the
 * transport; listeners on the socket object survive (reviveSocket()
 * reconnects the SAME instance with them intact). Never creates a
 * socket — guests and socket-less sessions are a no-op.
 *
 * Disconnect reason is "io client disconnect", which deliberately does
 * NOT arm the resync flag — the catch-up invalidation on the next
 * visibilitychange(visible) (SessionActivityManager) covers events that
 * fired while parked.
 */
export function parkSocketIfConnected(): void {
  const s = socket;
  if (s && s.connected) {
    s.disconnect();
  }
}

export function disconnectSocket() {
  // Invalidate any getSocket() creation still racing the dynamic
  // import (see disposeGeneration above) BEFORE the teardown below.
  disposeGeneration += 1;
  if (socket) {
    socket.disconnect();
    socket = null;
    currentUserId = undefined;
  }
}

/** Test-only: reset module state (singleton + resync flag) between cases. */
export function __resetSocketStateForTests(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  socket = null;
  currentUserId = undefined;
  wasDisconnected = false;
  disposeGeneration = 0;
}
