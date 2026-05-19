import type { Socket } from "socket.io-client";

let socket: Socket | null = null;

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
  if (s.connected) return s;

  s.connect();

  s.on("connect", () => {
    if (userId) {
      // Server-side authorizeJoinUser strictly verifies that this
      // userId matches the verified identity from the auth_token
      // cookie. Forged values are silently dropped.
      s.emit("join-user", userId);
    }
  });

  return s;
}

export async function connectAdminSocket() {
  const s = await getSocket();
  if (!s) return null;
  if (s.connected) return s;

  s.connect();

  s.on("connect", () => {
    // Server-side authorizeJoinAdmin requires socket.data.isAdmin
    // === true (admin_token cookie verified). A forged join-admin
    // from a non-admin socket is silently dropped.
    s.emit("join-admin");
  });

  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
