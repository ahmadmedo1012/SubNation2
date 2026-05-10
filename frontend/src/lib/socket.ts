import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) {
    const socketUrl = (import.meta.env.VITE_API_URL ?? "").trim();
    socket = io(socketUrl || undefined, {
      autoConnect: false,
      reconnectionAttempts: 5,
    });
  }
  return socket;
}

export function connectSocket(userId?: number | string) {
  const s = getSocket();
  if (s.connected) return s;

  s.connect();

  s.on("connect", () => {
    console.log("Connected to WebSocket");
    if (userId) {
      s.emit("join-user", userId);
    }
  });

  return s;
}

export function connectAdminSocket() {
  const s = getSocket();
  if (s.connected) return s;

  s.connect();

  s.on("connect", () => {
    console.log("Connected to Admin WebSocket");
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
