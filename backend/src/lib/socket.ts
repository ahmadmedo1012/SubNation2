/**
 * Socket.IO server bootstrap with mandatory authentication +
 * defense-in-depth hardening (P0-1 + P0-2).
 *
 * SECURITY MODEL (in priority order):
 *
 *   1. Origin allowlist at handshake time (cheapest fail-fast).
 *      socket.handshake.headers.origin must be in APP_ORIGINS.
 *      In dev (no APP_ORIGINS set), all origins are accepted.
 *
 *   2. Token verification at handshake time.
 *      auth_token cookie OR auth.userToken handshake field
 *        → verifies via signUserToken's secret → socket.data.identity.userId
 *      admin_token cookie OR auth.adminToken handshake field
 *        → verifies via signAdminToken's secret
 *        → socket.data.identity.{adminId, role, isAdmin: true}
 *      A handshake that presents NEITHER valid token is rejected.
 *
 *   3. SERVER-DRIVEN room joining on connect.
 *      Once authenticated, the server immediately joins the socket
 *      to user:<verified-userId> AND/OR admin-room based on the
 *      verified identity. The client does NOT need to emit anything.
 *      Client-emitted `join-user` / `join-admin` payloads are
 *      treated as defensive idempotent NO-OPs that re-validate the
 *      identity match (a forged payload triggers a warn-log +
 *      Sentry breadcrumb but never affects room membership).
 *
 *   4. Outbound emitters target rooms by name. The room-membership
 *      gate above guarantees only the correct principal receives.
 *
 *   5. Observability — every rejection increments
 *      socket_auth_rejected_total{reason} and adds a Sentry
 *      breadcrumb tagged "socket-auth". No captureMessage spam from
 *      probe traffic.
 *
 * THE PURE-FUNCTION SHAPE:
 *
 *   parseCookieHeader, authenticateSocketHandshake,
 *   authorizeJoinUser, authorizeJoinAdmin, isOriginAllowed —
 *   all exported for unit testing without spinning up a server.
 *
 * NON-GOALS (deferred / tracked in SECURITY_FIXES.md):
 *
 *   - Token revocation list. A stolen valid token remains valid
 *     until JWT expiry (30d). Mitigation = periodic re-verify
 *     mid-session, tracked separately.
 *   - Admin namespace separation. Admin events flow over the
 *     default namespace's "admin-room". Migration to io.of("/admin")
 *     is tracked separately.
 */

import * as Sentry from "@sentry/node";
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
 * Decide whether an Origin header is allowed to open a Socket.IO
 * handshake.
 *
 * Policy:
 *   - allowedOrigins is the parsed APP_ORIGINS list (e.g.
 *     ["https://subnation.ly", "https://www.subnation.ly"]).
 *   - empty allowlist → "permissive" (dev mode). Returns true for
 *     any origin including `undefined`. Local server tools and
 *     curl probes have no Origin header, which is fine in dev.
 *   - non-empty allowlist → strict. The Origin header MUST match
 *     one of the entries exactly. Missing/empty Origin is rejected.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  // Permissive mode (dev) — empty allowlist accepts everything.
  if (allowedOrigins.length === 0) return true;
  if (!origin || typeof origin !== "string") return false;
  return allowedOrigins.includes(origin);
}

/**
 * Lightweight cookie-header parser — no `cookie` package dep needed
 * because we only ever look up `auth_token` and `admin_token`.
 *
 * Tolerates:
 *   - missing/empty header
 *   - URL-encoded values (rare for our cookies but RFC-compliant)
 *   - trailing semicolons, extra whitespace
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
  if (identity.userId == null && !identity.isAdmin) {
    return null;
  }
  return identity;
}

/**
 * Decide whether a `join-user` request from a legacy client matches
 * the verified identity. P0-2 makes this a defensive sanity check
 * only — the server has already auto-joined the correct room from
 * identity.userId on connect; this just validates that no malicious
 * payload is going through.
 */
export function authorizeJoinUser(
  identity: SocketIdentity | undefined,
  requestedUserId: unknown,
): number | null {
  if (!identity || identity.userId == null) return null;
  if (typeof requestedUserId !== "number" && typeof requestedUserId !== "string") {
    return null;
  }
  const requested = Number(requestedUserId);
  if (!Number.isInteger(requested) || requested <= 0) return null;
  if (requested !== identity.userId) return null;
  return identity.userId;
}

/**
 * Decide whether a `join-admin` request matches the verified
 * identity. Same defensive role as authorizeJoinUser.
 */
export function authorizeJoinAdmin(identity: SocketIdentity | undefined): boolean {
  return identity?.isAdmin === true;
}

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

type RejectionReason =
  | "no_token"
  | "bad_origin"
  | "forged_user"
  | "forged_admin"
  | "anon_join_user"
  | "anon_join_admin";

/**
 * Record a rejection with all the defensive observability layers:
 *   - Prom counter for dashboards
 *   - Sentry breadcrumb so the next captured exception in this
 *     session has the audit trail attached
 *   - Pino warn-log
 *
 * NOT done: Sentry.captureMessage — would generate noise from
 * automated probe traffic. The breadcrumb gives forensic context
 * without alert fatigue. If a real user reports an issue and Sentry
 * captures their session, the breadcrumb chain shows the rejection.
 */
function recordRejection(
  reason: RejectionReason,
  context: Record<string, unknown>,
): void {
  try {
    getAuthRejectedCounter().inc({ reason });
  } catch {
    // best-effort
  }
  try {
    Sentry.addBreadcrumb({
      category: "socket-auth",
      level: reason.startsWith("forged_") ? "warning" : "info",
      message: `socket rejected: ${reason}`,
      data: context,
    });
  } catch {
    // best-effort
  }
  logger.warn(
    {
      category: "security",
      socket_event: "auth_rejected",
      reason,
      ...context,
    },
    `[socket-auth] rejected: ${reason}`,
  );
}

function getRemoteAddr(socket: Socket): string {
  const xff = socket.handshake.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return socket.handshake.address || "unknown";
}

export function initSocket(server: HttpServer) {
  const allowedOrigins = getAllowedOrigins();

  io = new SocketServer(server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Explicit ping/timeout config — no library-default surprises.
    //
    // pingInterval (25s default): server pings client every N ms
    // pingTimeout  (20s default): if client doesn't ack within N ms
    //                              after a ping, socket is considered
    //                              dead and disconnect fires.
    // connectTimeout (45s default): how long the engine.io handshake
    //                                may stall before connection_error.
    //
    // We make these EXPLICIT so behavior under load doesn't change
    // silently if the upstream lib picks new defaults.
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectTimeout: 30_000,
    // Cap inbound payload at 64KB — defense against memory-exhaustion
    // via oversized join payloads or chat-event spam. Real events in
    // SubNation are tiny (notification IDs, order IDs).
    maxHttpBufferSize: 64 * 1024,
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
  io.use((socket, next) => {
    // Layer 1: origin allowlist (cheapest fail-fast).
    const origin = socket.handshake.headers.origin as string | undefined;
    if (!isOriginAllowed(origin, allowedOrigins)) {
      recordRejection("bad_origin", {
        socketId: socket.id,
        origin: origin ?? "<missing>",
        remoteAddress: getRemoteAddr(socket),
      });
      return next(new Error("unauthorized"));
    }

    // Layer 2: token verification.
    const identity = authenticateSocketHandshake(socket.handshake);
    if (!identity) {
      recordRejection("no_token", {
        socketId: socket.id,
        origin,
        remoteAddress: getRemoteAddr(socket),
      });
      return next(new Error("unauthorized"));
    }

    socket.data.identity = identity;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const identity = socket.data.identity as SocketIdentity | undefined;
    safeGaugeInc(socketConnectedClients);
    safeInc(socketEventsTotal, { event: "connection", direction: "inbound" });

    // ── Server-driven auto-join (P0-2) ─────────────────────────────────
    //
    // The server joins the socket to its rooms IMMEDIATELY based on the
    // verified identity. The client never has to emit anything. This
    // eliminates the entire "trust the client payload" attack class:
    // a malicious client could emit "join-user 999" but the server has
    // already joined them to their OWN room and never reads the
    // requested id. The legacy join-user / join-admin handlers below
    // are defensive idempotent NO-OPs.
    if (identity?.userId != null) {
      socket.join(`user:${identity.userId}`);
    }
    if (identity?.isAdmin === true) {
      socket.join("admin-room");
    }

    logger.info(
      {
        socketId: socket.id,
        userId: identity?.userId,
        isAdmin: identity?.isAdmin === true,
        autoJoined: {
          userRoom: identity?.userId != null,
          adminRoom: identity?.isAdmin === true,
        },
      },
      "Socket client connected",
    );

    // ── Legacy join-user (defensive, idempotent) ───────────────────────
    //
    // Older client builds emit join-user(userId) on connect. We
    // already joined the correct room above; this handler exists to:
    //   (a) be idempotent for backward compat
    //   (b) detect + log any payload that DOESN'T match the verified
    //       identity (= forgery attempt, even from a logged-in user)
    socket.on("join-user", (requestedUserId: unknown) => {
      const verifiedId = authorizeJoinUser(identity, requestedUserId);
      if (verifiedId == null) {
        recordRejection(identity?.userId == null ? "anon_join_user" : "forged_user", {
          socketId: socket.id,
          verifiedUserId: identity?.userId,
          requestedUserId: String(requestedUserId).slice(0, 32),
          remoteAddress: getRemoteAddr(socket),
        });
        return;
      }
      // No-op — the room was already joined on connect. Logging at
      // debug so the legacy path remains observable but quiet.
      safeInc(socketEventsTotal, { event: "join-user", direction: "inbound" });
      logger.debug(
        { socketId: socket.id, userId: verifiedId },
        "Socket join-user (idempotent — already auto-joined on connect)",
      );
    });

    // ── Legacy join-admin (defensive, idempotent) ──────────────────────
    socket.on("join-admin", () => {
      if (!authorizeJoinAdmin(identity)) {
        recordRejection(identity?.userId == null ? "anon_join_admin" : "forged_admin", {
          socketId: socket.id,
          userId: identity?.userId,
          isAdmin: identity?.isAdmin === true,
          remoteAddress: getRemoteAddr(socket),
        });
        return;
      }
      safeInc(socketEventsTotal, { event: "join-admin", direction: "inbound" });
      logger.debug(
        { socketId: socket.id, adminId: identity?.adminId },
        "Socket join-admin (idempotent — already auto-joined on connect)",
      );
    });

    socket.on("disconnect", (reason: string) => {
      safeGaugeDec(socketConnectedClients);
      safeInc(socketEventsTotal, { event: "disconnect", direction: "inbound" });
      logger.info(
        { socketId: socket.id, reason, userId: identity?.userId },
        "Socket client disconnected",
      );
    });

    socket.on("error", (err: Error) => {
      logger.warn(
        { socketId: socket.id, err: err.message, userId: identity?.userId },
        "Socket transport error",
      );
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
