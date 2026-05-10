import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import { logger } from "./logger";

let io: SocketServer | null = null;

export function initSocket(server: HttpServer) {
  io = new SocketServer(server, {
    cors: {
      origin: "*", // Adjust in production
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket client connected");

    socket.on("join-user", (userId: string | number) => {
      const room = `user:${userId}`;
      socket.join(room);
      logger.debug({ socketId: socket.id, room }, "Socket joined user room");
    });

    socket.on("join-admin", () => {
      socket.join("admin-room");
      logger.debug({ socketId: socket.id }, "Socket joined admin room");
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Socket client disconnected");
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    logger.warn("Socket.io not initialized");
  }
  return io;
}

/** Emit event to a specific user */
export function emitToUser(userId: string | number, event: string, data: any) {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
}

/** Emit event to all admins */
export function emitToAdmins(event: string, data: any) {
  if (io) {
    io.to("admin-room").emit(event, data);
  }
}
