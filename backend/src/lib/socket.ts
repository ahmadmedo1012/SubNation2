/**
 * Socket.IO server bootstrap with mandatory authentication +
 * defense-in-depth hardening (P0-1 + P0-2).
 *
 * R136 (BE-2) decomposition: this module is now the FACADE of the
 * lib/socket/ package — it owns the io singleton, initSocket() (the
 * auth gate + connection handler wiring) and the outbound emitters,
 * and re-exports the unit-testable surface so existing importers
 * (server.ts, routes, services, the socket test suites) are untouched:
 *
 *   lib/socket/auth.ts           handshake + identity verification
 *                                (origin allowlist, JWT handshake, DB
 *                                liveness, mid-session re-verify)
 *   lib/socket/connection-caps.ts  per-IP / total connection accounting
 *                                (R97-06) + client-IP resolution
 *   lib/socket/rejections.ts     the shared rejection counter/breadcrumb/
 *                                warn-log funnel + remote-addr forensics
 *
 * SECURITY MODEL (in priority order — full detail in auth.ts):
 *
 *   1. Origin allowlist at handshake time (cheapest fail-fast).
 *
 *   2. Token verification at handshake time (auth_token / admin_token
 *      cookies or handshake.auth fields) — a handshake with NEITHER
 *      valid token is rejected.
 *
 *   2b. DB-backed liveness re-verification (93-A1 S1): revoked sessions
 *      / soft-disabled admins lose the socket at handshake, on the
 *      5-minute periodic re-verify and on legacy room-join events.
 *
 *   3. SERVER-DRIVEN room joining on connect.
 *      The server joins the socket to user:<verified-userId> AND/OR
 *      admin-room based on the verified identity. The client does NOT
 *      need to emit anything. Client-emitted `join-user` / `join-admin`
 *      payloads are treated as defensive idempotent NO-OPs that
 *      re-validate the identity match (a forged payload triggers a
 *      warn-log + Sentry breadcrumb but never affects room membership).
 *
 *   4. Outbound emitters target rooms by name. The room-membership
 *      gate above guarantees only the correct principal receives.
 *
 *   5. Observability — every rejection increments
 *      socket_auth_rejected_total{reason} and adds a Sentry
 *      breadcrumb tagged "socket-auth". No captureMessage spam from
 *      probe traffic.
 *
 *   6. Connection caps (R97-06, round-97 F2): /socket.io sits OUTSIDE
 *      apiLimiter/userLimiter (mounted on /api only), and every
 *      accepted socket costs a DB liveness probe at handshake + a
 *      5-minute re-verify timer + room membership. A holder of a
 *      VALID token could open thousands of concurrent connections
 *      (memory/FD/DB exhaustion). Every connection is now counted in
 *      a per-client-IP tracker (max 5 concurrent per IP) plus a total
 *      sanity cap (2000); a breaching socket is emitted a polite
 *      `connection_limited` event and hard-disconnected a beat later,
 *      and the rejection lands in the same Prometheus counter as the
 *      auth rejections (reason=ip_connection_cap / total_connection_cap).
 *      A periodic sweep drops stale ids so the tracker can never grow
 *      unboundedly. Single-instance by design (documented limitation —
 *      same posture as the in-memory rate-limit fallback).
 *
 * NON-GOALS (deferred / tracked in SECURITY_FIXES.md):
 *
 *   - Admin namespace separation. Admin events flow over the
 *     default namespace's "admin-room". Migration to io.of("/admin")
 *     is tracked separately.
 *
 *   [REVOKED] Token revocation list. A stolen valid token remained
 *     valid until JWT expiry (30d). CLOSED by 93-A1 S1 — see layer 2b:
 *     handshake + periodic (5 min) DB-backed re-verification.
 */

import { createAdapter } from "@socket.io/redis-adapter";
import { adminUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Server as HttpServer } from "http";
import { createClient } from "redis";
import { Server as SocketServer, type Socket } from "socket.io";
import { getConfiguredOrigins } from "./origins";
import {
  safeGaugeDec,
  safeGaugeInc,
  safeInc,
  socketConnectedClients,
  socketEventsTotal,
} from "./metrics";
import { logger } from "./logger";
import {
  ADMIN_ALERTS_ROOM,
  authenticateSocketHandshake,
  authorizeJoinAdmin,
  authorizeJoinUser,
  hasAlertScope,
  isOriginAllowed,
  reverifyAndEnforce,
  startIdentityReverification,
  stopIdentityReverification,
  stripIdentityForLiveness,
  verifySocketIdentityLive,
  type SocketIdentity,
} from "./socket/auth";
import {
  SOCKET_CAP_SWEEP_INTERVAL_MS,
  SocketConnectionTracker,
  resolveSocketClientIp,
} from "./socket/connection-caps";
import { getRemoteAddr, recordRejection } from "./socket/rejections";

// ── Re-export surface (decomposition contract) ───────────────────────────
// Every symbol the pre-R136 lib/socket.ts exported stays importable from
// this module — the 5 socket test suites, server.ts, routes/health.ts,
// routes/admin/diagnostics.ts, services/topup.service.ts and the ~20
// dynamic-import emit sites keep working unedited.
export {
  ADMIN_ALERTS_ROOM,
  hasAlertScope,
  SOCKET_REVERIFY_INTERVAL_MS,
  type SocketHandshakeLike,
  type SocketIdentity,
  type SocketLivenessFailure,
  type SocketLivenessResult,
  authenticateSocketHandshake,
  authorizeJoinAdmin,
  authorizeJoinUser,
  isOriginAllowed,
  parseCookieHeader,
  reverifyAndEnforce,
  stripIdentityForLiveness,
  verifySocketIdentityLive,
} from "./socket/auth";
export {
  MAX_SOCKET_CONNECTIONS_PER_IP,
  MAX_TOTAL_SOCKET_CONNECTIONS,
  SOCKET_CAP_SWEEP_INTERVAL_MS,
  SocketConnectionTracker,
  type SocketCapVerdict,
  resolveSocketClientIp,
} from "./socket/connection-caps";

let io: SocketServer | null = null;

function getAllowedOrigins(): string[] {
  return getConfiguredOrigins();
}

// ── R97-06 (round-97 F2): connection caps ────────────────────────────────
// (constants + the tracker class live in ./socket/connection-caps.ts; the
// per-initSocket tracker instance + its sweep timer are closure state of
// THIS facade, exactly as before the decomposition.)

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

    // I-F1 (R186-3): node-redis's reconnect loop reports failures as
    // 'error' EVENTS (not promise rejections), and an EventEmitter that
    // emits 'error' with ZERO listeners THROWS — with Redis down the
    // adapter clients would crash the process on the first reconnect
    // tick, contradicting the singleton's H12 stay-up posture. Attach
    // warn listeners BEFORE connect() so the window never opens; the
    // adapter's own later handlers are additional listeners, not
    // replacements.
    pubClient.on("error", (err) => logger.warn({ err }, "[socket] Redis adapter pub client error"));
    subClient.on("error", (err) => logger.warn({ err }, "[socket] Redis adapter sub client error"));

    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        io!.adapter(createAdapter(pubClient, subClient));
        logger.info("Socket.IO Redis adapter configured");
      })
      .catch((err) => logger.error({ err }, "Redis adapter connection failed"));
  }

  // ── R97-06 (round-97 F2): connection caps ───────────────────────────
  const connectionTracker = new SocketConnectionTracker();
  const capSweepTimer = setInterval(() => {
    // Drop ids whose socket is no longer connected on THIS instance —
    // bounds the tracker's memory to the live connection set and heals
    // any bookkeeping drift. Never keeps the process alive on its own.
    connectionTracker.sweep((id) => io?.sockets.sockets.has(id) ?? false);
  }, SOCKET_CAP_SWEEP_INTERVAL_MS);
  capSweepTimer.unref();

  // ── Auth gate ────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    // Layer 0 (R104 / AG3-4): per-IP connection-cap pre-check — BEFORE
    // origin/token/DB liveness. A capped client (e.g. many users behind
    // one CGNAT mobile IP) used to pay the full auth probe chain
    // (1-3 DB queries) on EVERY reconnect attempt before learning it
    // was over the cap in the connection handler. The admit() here is
    // provisional — the connection handler's authoritative admit()
    // below reconciles the slot (a handshake that never completes is
    // released by the 60s cap sweep).
    const preIp = resolveSocketClientIp(socket);
    const preVerdict = connectionTracker.peek(preIp);
    if (preVerdict !== "ok") {
      recordRejection(preVerdict === "per_ip_cap" ? "ip_connection_cap" : "total_connection_cap", {
        socketId: socket.id,
        capIp: preIp,
        verdict: preVerdict,
        tracker: connectionTracker.stats(),
      });
      return next(new Error("connection_limited"));
    }

    // Layer 1: origin allowlist (cheapest fail-fast).
    const origin = socket.handshake.headers.origin as string | undefined;
    const host = socket.handshake.headers.host as string | undefined;
    if (!isOriginAllowed(origin, allowedOrigins, host)) {
      recordRejection("bad_origin", {
        socketId: socket.id,
        origin: origin ?? "<missing>",
        host: host ?? "<missing>",
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

    // Layer 2b (93-A1 S1): DB-backed liveness — handshake parity with
    // requireUser (sessions row) + requireAdmin (admin_users.is_active).
    // A stolen-but-revoked JWT must not open a 30-day WS stream.
    const liveness = await verifySocketIdentityLive(identity);
    const admitted = stripIdentityForLiveness(identity, liveness);
    if (!admitted) {
      recordRejection(liveness.reason ?? "session_revoked", {
        socketId: socket.id,
        userId: identity.userId,
        adminId: identity.adminId,
        userRevoked: liveness.userRevoked === true,
        adminRevoked: liveness.adminRevoked === true,
        remoteAddress: getRemoteAddr(socket),
      });
      return next(new Error("unauthorized"));
    }
    // Mixed identity (user + admin on one browser) where only one
    // component died: admit the socket with the live component — the
    // revoked component simply never joins its room.
    if (admitted !== identity) {
      logger.warn(
        {
          socketId: socket.id,
          userId: identity.userId,
          adminId: identity.adminId,
          userRevoked: liveness.userRevoked === true,
          adminRevoked: liveness.adminRevoked === true,
          reason: liveness.reason,
        },
        "[socket-auth] handshake admitted with a stripped identity component (revoked)",
      );
    }

    socket.data.identity = admitted;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const identity = socket.data.identity as SocketIdentity | undefined;
    safeInc(socketEventsTotal, { event: "connection", direction: "inbound" });

    // ── R97-06: per-IP + total concurrent connection caps ─────────────
    //
    // Checked BEFORE the connected-clients gauge, room joins and the
    // re-verify timer: a capped socket gets the polite event + a hard
    // disconnect and must not cost any further server resources. Only
    // "ok" verdicts occupy a slot AND the gauge (no disconnect handler
    // is registered for a capped socket — its transport-level close is
    // accounted by socket.io itself, not our gauge); releasing a
    // never-admitted id is a no-op.
    const capIp = resolveSocketClientIp(socket);
    const capVerdict = connectionTracker.admit(capIp, socket.id);
    if (capVerdict !== "ok") {
      recordRejection(capVerdict === "per_ip_cap" ? "ip_connection_cap" : "total_connection_cap", {
        socketId: socket.id,
        capIp,
        verdict: capVerdict,
        tracker: connectionTracker.stats(),
      });
      // Polite reason first — a short grace beat so the client actually
      // receives the event before the transport closes underneath it.
      socket.emit("connection_limited", {
        reason: capVerdict,
        message: "تم تجاوز حد الاتصالات المتزامنة — أغلق التبويبات الأخرى وحاول مجدداً",
      });
      const grace = setTimeout(() => socket.disconnect(true), 250);
      grace.unref?.();
      return;
    }
    safeGaugeInc(socketConnectedClients);

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
      // AUD103-3-F2 (r103): the scope-gated alert room needs the admin's
      // LIVE permission scopes, which the JWT handshake does not carry —
      // fetch them async (best-effort: the HTTP RBAC remains the
      // enforcement truth; a failed read just means no live alert stream
      // until the next re-verify pass reconciles it).
      if (identity.adminId != null) {
        const adminId = identity.adminId;
        void (async () => {
          try {
            const [row] = await db
              .select({ permissions: adminUsersTable.permissions })
              .from(adminUsersTable)
              .where(eq(adminUsersTable.id, adminId))
              .limit(1);
            if (row && hasAlertScope(row.permissions)) {
              socket.join(ADMIN_ALERTS_ROOM);
            }
          } catch {
            // fail-open posture matches the liveness probes: never kick a
            // cryptographically-verified admin over a DB blip.
          }
        })();
      }
    }

    // ── Periodic identity re-verification (93-A1 S1) ──────────────────
    //
    // The handshake checked liveness once; a session revoked or an
    // admin soft-disabled AFTER connect would otherwise keep streaming
    // user:/admin-room events for the token's full life (the exact gap
    // the round-5 HTTP fix closed, now closed on the WS surface too).
    // Every SOCKET_REVERIFY_INTERVAL_MS the identity is re-probed; a
    // dead component leaves its room, a fully dead identity disconnects.
    startIdentityReverification(socket);

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
    //   (c) 93-A1 S1: treat the room-join event as a liveness signal —
    //       re-verify the identity before acknowledging it (cheap: the
    //       session probe is 60 s-cached; the admin probe is one indexed
    //       PK read, same as every requireAdmin request).
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
      // 93-A1 S1: sensitive room join → re-verify mid-session.
      void reverifyAndEnforce(socket);
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
      // 93-A1 S1: admin-room is the sensitive PII surface (live order /
      // topup payloads) — re-verify admin liveness on every join event.
      void reverifyAndEnforce(socket);
      safeInc(socketEventsTotal, { event: "join-admin", direction: "inbound" });
      logger.debug(
        { socketId: socket.id, adminId: identity?.adminId },
        "Socket join-admin (idempotent — already auto-joined on connect)",
      );
    });

    socket.on("disconnect", (reason: string) => {
      stopIdentityReverification(socket);
      connectionTracker.release(capIp, socket.id);
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

/** Emit event to all admins (every active admin — counter-only stats
 * broadcasts). For operational alert content use emitToAdminAlerts —
 * AUD103-3-F2 (r103). */
export function emitToAdmins(event: string, data: unknown) {
  if (io) {
    io.to("admin-room").emit(event, data);
    safeInc(socketEventsTotal, { event, direction: "outbound" });
  }
}

/** AUD103-3-F2 (r103): emit to the scope-gated admin alert room. Live
 * alert broadcasts (admin-alert-new) carry operational content (product
 * names, coupon codes, risk references) and now mirror the HTTP RBAC of
 * /api/admin/alerts (support scope; "all" wildcard passes). Membership is
 * granted at connect and reconciled on every liveness re-verify pass. */
export function emitToAdminAlerts(event: string, data: unknown) {
  if (io) {
    io.to(ADMIN_ALERTS_ROOM).emit(event, data);
    safeInc(socketEventsTotal, { event, direction: "outbound" });
  }
}

/**
 * R158 (B#2): the ONE home of the `admin-stats-update` notify idiom —
 * the 5-line dynamic-import + emitToAdmins + .catch block was
 * copy-pasted ×15 across the admin route family (users / orders /
 * products / product-variants / risk / tickets) with a byte-identical
 * event name, warn message and fire-and-forget contract. Routes now
 * call `notifyAdminStats("user-update")`; payload extras ride the
 * second arg (status / product_id / applied counts — the same shapes
 * the per-route R125-I6/R126-L4 pins assert).
 *
 * The original blocks' dynamic import existed to keep the socket
 * module out of the route files' eager graph; with this helper the
 * routes DO import lib/socket statically (already the precedent for
 * topup.service.ts / health.ts / diagnostics.ts), so the import can
 * no longer fail at emit time — the .catch's "degrade to one warn,
 * never a 500" contract is kept as a synchronous try/catch around the
 * (guarded, non-throwing) emit. The event name, payload shape and warn
 * message are pinned by routes/__tests__/admin-stats-emit.test.ts.
 */
export function notifyAdminStats(type: string, extra: Record<string, unknown> = {}) {
  try {
    emitToAdmins("admin-stats-update", { type, ...extra });
  } catch (err) {
    logger.warn({ err }, "socket admin-stats notify failed");
  }
}
