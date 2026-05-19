/**
 * Socket.IO server bootstrap with mandatory authentication.
 *
 * SECURITY MODEL:
 *
 *   Every connection MUST present a valid token at handshake time:
 *     - `auth_token` cookie OR `auth.userToken` handshake field
 *       → verifies via the user JWT secret (signUserToken)
 *       → attaches socket.data.userId
 *     - `admin_token` cookie OR `auth.adminToken` handshake field
 *       → verifies via the admin JWT secret (signAdminToken)
 *       → attaches socket.data.{ adminId, role, isAdmin: true }
 *
 *   A connection that presents NEITHER valid token is rejected by the
 *   `io.use(authMiddleware)` gate. The error is "unauthorized" — a
 *   stable string that frontend can match without leaking diagnostic
 *   detail to attackers.
 *
 *   Room-join handlers are then bound STRICTLY to the verified
 *   identity:
 *     - `join-user` — only accepts the userId that matches
 *       socket.data.userId. Any other value is logged and silently
 *       dropped. (Silent because echoing "rejected" tells an attacker
 *       which user IDs exist; silently ignoring is identical to
 *       success from their viewport, which is the desired property.)
 *     - `join-admin` — requires socket.data.isAdmin === true. Same
 *       silent-drop policy.
 *
 *   Outbound emitters (emitToUser, emitToAdmins) are unchanged — they
 *   target rooms by name, and now those rooms can only be entered by
 *   the right principals.
 *
 * THE PURE-FUNCTION SHAPE:
 *
 *   `authenticateSocketHandshake` and `authorizeJoinUser` /
 *   `authorizeJoinAdmin` are exported as pure functions so tests can
 *   feed them fixture data without spinning up a real socket.io
 *   server. The middleware and event handlers are thin wrappers that
 *   call into these helpers.
 */

import { createAdapter } from "@socket.io/redis-adapter";
import { Server as HttpServer } from "http";
import { createClient } from "redis";
import { Server as SocketServer, type Socket } from "socket.io";
import { verifyAdminTokenDetailed, verifyUserTokenDetailed } from "./jwt";
import { logger } from "./logger";
import {
  getRegistry,
  safeGaugeDec,
  safeGaugeInc,
  safeInc,
  socketConnectedClients,
  socketEventsTotal,
} from "./metrics";

let io: SocketServer | null = null;

/** Verified identity attached to every authenticated socket. */
export interface SocketIdentity {
  /** User JWT subject. Present when auth_token verifies. */
  userId?: number;
  /** Admin JWT subject. Present when admin_token verifies. */
  adminId?: number;
  /** Admin role string. Present when adminId is present. */
  role?: string;
  /** True when admin_token verified. False/undefined otherwise. */
  isAdmin: boolean;
}

function getAllowedOrigins(): string[] {
  return (process.env.APP_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Lightweight cookie-header parser — no `cookie` package dep needed
 * because we only ever look up `auth_token` and `admin_token`.
 *
 * Tolerates:
 *   - missing/empty header
 *   - URL-encoded values (rare for our cookies but RFC-compliant)
 *   - trailing semicolons, extra whitespace
 *
 * Does NOT validate signatures or attributes. Verification of the
 * cookie VALUE happens via verifyUserTokenDetailed /
 * verifyAdminTokenDetailed downstream.
 */
export function parseCookieHeader(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header || typeof header !== "string") return out;
  for (const piece of header.split(/;\s*/)) {
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    const name = piece.slice(0, eq).trim();
    if (!name) continue;
    const raw = piece.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * Verify the handshake's tokens (cookies first, handshake.auth field
 * second). Returns the verified identity, OR null when nothing
 * verified. Caller is responsible for rejecting the connection on
 * null.
 *
 * Both tokens are checked independently so a connection that presents
 * BOTH (e.g. an admin who is also a regular user in another tab,
 * cookies are origin-scoped not tab-scoped) gets BOTH capabilities.
 */
export interface SocketHandshakeLike {
  headers?: { cookie?: string };
  auth?: { userToken?: string; adminToken?: string };
}

export function authenticateSocketHandshake(
  handshake: SocketHandshakeLike,
): SocketIdentity | null {
  const cookies = parseCookieHeader(handshake.headers?.cookie);
  const identity: SocketIdentity = { isAdmin: false };

  // ── User token ─────────────────────────────────────────────────────
  const userToken = cookies.auth_token ?? handshake.auth?.userToken;
  if (typeof userToken === "string" && userToken.length > 0) {
    const result = verifyUserTokenDetailed(userToken);
    if (result.ok) {
      identity.userId = result.payload.userId;
    }
  }

  // ── Admin token ────────────────────────────────────────────────────
  const adminToken = cookies.admin_token ?? handshake.auth?.adminToken;
  if (typeof adminToken === "string" && adminToken.length > 0) {
    const result = verifyAdminTokenDetailed(adminToken);
    if (result.ok) {
      identity.adminId = result.payload.adminId;
      identity.role = result.payload.role;
      identity.isAdmin = true;
    }
  }

  // ── Decision ───────────────────────────────────────────────────────
  // Reject if NEITHER token verified. (We never accept anonymous
  // sockets — every payload that flows through this server is
  // user-targeted or admin-targeted.)
  if (identity.userId == null && !identity.isAdmin) {
    return null;
  }
  return identity;
}

/**
 * Decide whether a `join-user` request is honored.
 *
 * The only valid join is the user's OWN id. A socket holding only an
 * admin token has no user identity, so it cannot join arbitrary user
 * rooms either — admin event delivery flows through the `admin-room`
 * channel, not user rooms.
 */
export function authorizeJoinUser(
  identity: SocketIdentity | undefined,
  requestedUserId: unknown,
): number | null {
  if (!identity || identity.userId == null) return null;
  // Strict type gate. We only accept primitive number or numeric
  // string. Single-element arrays coerce via Number() to their
  // contents (e.g. Number([42]) === 42), so we reject objects + arrays
  // explicitly to defeat a payload-shape forgery attempt.
  if (typeof requestedUserId !== "number" && typeof requestedUserId !== "string") {
    return null;
  }
  const requested = Number(requestedUserId);
  if (!Number.isInteger(requested) || requested <= 0) return null;
  if (requested !== identity.userId) return null;
  return identity.userId;
}

/**
 * Decide whether a `join-admin` request is honored.
 * Strictly requires admin token verification.
 */
export function authorizeJoinAdmin(identity: SocketIdentity | undefined): boolean {
  return identity?.isAdmin === true;
}

/**
 * Lazily-registered counter so a forged-room-join attempt is visible
 * in /api/metrics without a separate file edit.
 */
function getAuthRejectedCounter() {
  const reg = getRegistry();
  const name = "socket_auth_rejected_total";
  let counter = reg.getSingleMetric(name) as
    | import("prom-client").Counter<string>
    | undefined;
  if (!counter) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const promClient = require("prom-client") as typeof import("prom-client");
    counter = new promClient.Counter({
      name,
      help: "Socket.IO connection or room-join attempts rejected by auth gate",
      labelNames: ["reason"],
      registers: [reg],
    });
  }
  return counter;
}

function recordAuthRejection(reason: "no_token" | "forged_user" | "forged_admin"): void {
  try {
    getAuthRejectedCounter().inc({ reason });
  } catch {
    // best-effort metric — never block the security path
  }
}

export function initSocket(server: HttpServer) {
  const allowedOrigins = getAllowedOrigins();
  io = new SocketServer(server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      methods: ["GET", "POST"],
      // Required for the browser to attach `auth_token` / `admin_token`
      // cookies to the WebSocket handshake when the API origin differs
      // from the SPA origin. Same-origin (subnation.ly → wss://...) is
      // unaffected; this only matters for cross-origin deployments.
      credentials: true,
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

  // ── Auth gate ────────────────────────────────────────────────────────
  // EVERY connection passes through here. If neither cookie holds a
  // valid token, the handshake fails before `connection` is emitted.
  io.use((socket, next) => {
    const identity = authenticateSocketHandshake(socket.handshake);
    if (!identity) {
      recordAuthRejection("no_token");
      logger.info(
        {
          socketId: socket.id,
          remoteAddress:
            (socket.handshake.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ??
            socket.handshake.address,
        },
        "Socket connection rejected — no valid token",
      );
      // The error message is intentionally generic. Clients should
      // re-authenticate via HTTP and reconnect.
      return next(new Error("unauthorized"));
    }
    socket.data.identity = identity;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const identity = socket.data.identity as SocketIdentity | undefined;
    safeGaugeInc(socketConnectedClients);
    safeInc(socketEventsTotal, { event: "connection", direction: "inbound" });
    logger.info(
      {
        socketId: socket.id,
        userId: identity?.userId,
        isAdmin: identity?.isAdmin === true,
      },
      "Socket client connected",
    );

    // ── join-user — strictly bound to verified userId ──────────────────
    socket.on("join-user", (requestedUserId: unknown) => {
      const verifiedId = authorizeJoinUser(identity, requestedUserId);
      if (verifiedId == null) {
        recordAuthRejection("forged_user");
        logger.warn(
          {
            socketId: socket.id,
            verifiedUserId: identity?.userId,
            requestedUserId: String(requestedUserId).slice(0, 32),
          },
          "Socket join-user rejected — identity mismatch",
        );
        return; // silent drop — do not echo failure to attacker
      }
      const room = `user:${verifiedId}`;
      socket.join(room);
      safeInc(socketEventsTotal, { event: "join-user", direction: "inbound" });
      logger.debug({ socketId: socket.id, room }, "Socket joined user room");
    });

    // ── join-admin — strictly requires admin identity ──────────────────
    socket.on("join-admin", () => {
      if (!authorizeJoinAdmin(identity)) {
        recordAuthRejection("forged_admin");
        logger.warn(
          {
            socketId: socket.id,
            userId: identity?.userId,
            isAdmin: identity?.isAdmin === true,
          },
          "Socket join-admin rejected — not an admin",
        );
        return; // silent drop
      }
      socket.join("admin-room");
      safeInc(socketEventsTotal, { event: "join-admin", direction: "inbound" });
      logger.debug({ socketId: socket.id, adminId: identity?.adminId }, "Socket joined admin room");
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
