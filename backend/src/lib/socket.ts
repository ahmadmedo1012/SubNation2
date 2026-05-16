import { createAdapter } from "@socket.io/redis-adapter";
import { Server as HttpServer } from "http";
import { createClient } from "redis";
import { Server as SocketServer } from "socket.io";
import { logger } from "./logger";
import {
  safeGaugeDec,
  safeGaugeInc,
  safeInc,
  socketConnectedClients,
  socketEventsTotal,
} from "./metrics";

let io: SocketServer | null = null;

function getAllowedOrigins(): string[] {
  return (process.env.APP_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function initSocket(server: HttpServer) {
  const allowedOrigins = getAllowedOrigins();
  io = new SocketServer(server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      methods: ["GET", "POST"],
    },
  });

  if (process.env.REDIS_URL) {
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        io!.adapter(createAdapter(pubClient, subClient));
        logger.info("Socket.IO Redis adapter configured");
      })
      .catch((err) => logger.error({ err }, "Redis adapter connection failed"));
  }

  io.on("connection", (socket) => {
    safeGaugeInc(socketConnectedClients);
    safeInc(socketEventsTotal, { event: "connection", direction: "inbound" });
    logger.info({ socketId: socket.id }, "Socket client connected");

    socket.on("join-user", (userId: string | number) => {
      const room = `user:${userId}`;
      socket.join(room);
      safeInc(socketEventsTotal, { event: "join-user", direction: "inbound" });
      logger.debug({ socketId: socket.id, room }, "Socket joined user room");
    });

    socket.on("join-admin", () => {
      socket.join("admin-room");
      safeInc(socketEventsTotal, { event: "join-admin", direction: "inbound" });
      logger.debug({ socketId: socket.id }, "Socket joined admin room");
    });

    socket.on("disconnect", () => {
      safeGaugeDec(socketConnectedClients);
      safeInc(socketEventsTotal, { event: "disconnect", direction: "inbound" });
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
export function emitToUser(userId: string | number, event: string, data: unknown) {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
    safeInc(socketEventsTotal, { event, direction: "outbound" });
  }
}

/** Emit event to all admins */
export function emitToAdmins(event: string, data: unknown) {
  if (io) {
    io.to("admin-room").emit(event, data);
    safeInc(socketEventsTotal, { event, direction: "outbound" });
  }
}
