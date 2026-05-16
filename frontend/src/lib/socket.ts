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
