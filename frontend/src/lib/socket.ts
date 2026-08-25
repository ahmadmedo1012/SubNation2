import type { Socket } from "socket.io-client";

let socket: Socket | null = null;

// The CURRENT authenticated user at connect time. The shared "connect"
// handler below reads this when the event fires (initial connect AND
// every auto-reconnect), so after an account switch the room re-join
// always uses the new identity — never a stale closure over an old
// userId.
let currentUserId: number | string | undefined;

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

export async function getSocket() {
  if (!socket) {
    try {
      const { io } = await import("socket.io-client");
      const socketUrl = (import.meta.env.VITE_API_URL ?? "").trim();
      socket = io(socketUrl || undefined, {
        autoConnect: false,
        reconnectionAttempts: 5,
        // Required: the server gates EVERY connection on the
        // `auth_token` (and/or `admin_token`) httpOnly cookie. Without
        // `withCredentials: true`, browsers omit cookies on the
        // WebSocket handshake whenever the API origin differs from
        // the SPA origin (e.g. split deployments). For same-origin
        // (subnation.ly), cookies travel anyway, but we set the flag
        // so behavior is identical across deployments.
        withCredentials: true,
      });
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

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentUserId = undefined;
  }
}
