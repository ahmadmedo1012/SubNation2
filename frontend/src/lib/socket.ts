import type { Socket } from "socket.io-client";
import { getSocketUrl } from "./api-config";

let socket: Socket | null = null;

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

// The CURRENT authenticated user at connect time. The shared "connect"
// handler below reads this when the event fires (initial connect AND
// every auto-reconnect), so after an account switch the room re-join
// always uses the new identity — never a stale closure over an old
// userId.
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
  // Server-side authorizeJoinUser strictly verifies that this
  // userId matches the verified identity from the auth_token
  // cookie. Forged values are silently dropped.
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
    try {
      const { io } = await import("socket.io-client");
      const socketUrl = getSocketUrl();
      socket = io(socketUrl || undefined, {
        autoConnect: false,
        // 96-F3 (R96 M1): the old hard cap of 5 attempts meant ~31 s
        // of tunnel/elevator/handoff silence killed the realtime
        // channel for the REST of the session (a backgrounded phone
        // or WiFi→cellular switch exhausts it silently). The manager
        // now never surrenders on its own; revival listeners
        // (SocketInitializer: online + visibilitychange) cover the
        // cases where socket.io does not auto-reconnect by itself
        // (notably server-initiated disconnects).
        reconnectionAttempts: Infinity,
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

  currentUserId = userId;

  // Dedup: named module-level handlers make `.off()` before `.on()` a
  // no-op on repeat calls, so repeated connectSocket() invocations
  // (remounts, account switches) never stack duplicate "connect"
  // listeners that would each emit join-user under stale ids.
  s.off("connect", handleUserConnect);
  s.on("connect", handleUserConnect);

  if (!s.connected) {
    s.connect();
  } else {
    // Already connected (e.g. switching accounts mid-session): join
    // under the current userId right away instead of waiting for a
    // reconnect to fire the handler.
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

export function disconnectSocket() {
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
}
