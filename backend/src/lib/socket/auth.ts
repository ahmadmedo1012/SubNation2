/**
 * Socket.IO handshake + identity verification — the auth half of the
 * lib/socket package (R136 BE-2 decomposition of lib/socket.ts; the
 * server bootstrap/emitters live in the lib/socket.ts facade).
 *
 * SECURITY MODEL (auth layers, in priority order):
 *
 *   1. Origin allowlist at handshake time (cheapest fail-fast).
 *      socket.handshake.headers.origin must be in APP_ORIGINS.
 *      In dev (no APP_ORIGINS set), all origins are accepted.
 *      R107: an Origin-less polling handshake is accepted when the
 *      Host header matches an allowlist entry's host (single-origin
 *      deployments — see isOriginAllowed).
 *
 *   2. Token verification at handshake time.
 *      auth_token cookie OR auth.userToken handshake field
 *        → verifies via signUserToken's secret → socket.data.identity.userId
 *      admin_token cookie OR auth.adminToken handshake field
 *        → verifies via signAdminToken's secret
 *        → socket.data.identity.{adminId, role, isAdmin: true}
 *      A handshake that presents NEITHER valid token is rejected
 *      (SEC-92-02: the 2FA TEMP token is treated as unauthenticated).
 *
 *   2b. DB-backed liveness re-verification (93-A1 S1, round-93).
 *      JWT verification alone means a revoked session (logout /
 *      logout-all / user deletion) or a soft-disabled admin kept its
 *      socket — and with it the auto-joined user:/admin-room membership
 *      streaming wallet/order PII — for the token's full life (30 d
 *      user / 8 h admin). The handshake gate, the periodic re-verify
 *      (every 5 min per socket) and the legacy room-join events all
 *      consult the same sources requireUser/requireAdmin use:
 *        - user token  → `sessions` row exists + unexpired
 *          (lib/session-liveness.isSessionRowLive, 60 s cache)
 *        - admin token → `admin_users.is_active`
 *      A dead component is stripped (room left); a fully dead identity
 *      disconnects. DB probe failures fail OPEN (JWT is still
 *      cryptographically sound) — mirrors requireUser's posture.
 *
 *   3. Scope-gated alert room (AUD103-3-F2, r103): "admin-room" stays
 *      open to every active admin, but the admin-alerts room carries
 *      operational content and mirrors the HTTP RBAC of
 *      /api/admin/alerts (support scope; "all" wildcard passes).
 *
 * THE PURE-FUNCTION SHAPE:
 *
 *   parseCookieHeader, authenticateSocketHandshake,
 *   authorizeJoinUser, authorizeJoinAdmin, isOriginAllowed —
 *   all exported for unit testing without spinning up a server.
 */
import type { Socket } from "socket.io";
import { verifyAdminTokenDetailed, verifyUserTokenDetailed } from "../jwt";
import { logger } from "../logger";
import { hasPermission } from "../permissions";
import { isSessionRowLive } from "../session-liveness";
import { isValidAdminSession } from "../admin-session";
// R192 (Neon compute-quota incident): the admin row read rides the 30 s
// ACTIVE-only cache (lib/admin-user-row-cache.ts) — the periodic socket
// re-verify no longer queries admin_users per pass (soft-disable
// propagates within ≤ 30 s + the re-verify interval itself).
import { getAdminRowCached } from "../admin-user-row-cache";
import { getRemoteAddr, recordRejection } from "./rejections";

/** How often each connected socket's identity is re-verified against the
 * DB (sessions row / admin is_active). 93-A1 S1 recommended "e.g. every 5
 * min" — cheap indexed lookups (session probe is additionally 60 s-cached).
 *
 * R192 (the Neon compute-quota incident): 5 min was EXACTLY the wrong
 * cadence for a scale-to-zero database — Neon's autosuspend window is
 * ~5 min, so one query per 5 min per connected socket reset the idle
 * timer forever: a single admin tab or a wallet/order page left open
 * kept the compute endpoint awake 24/7 (12 queries/hour/socket, and the
 * admin panel holds a persistent socket). At 15 min the endpoint sleeps
 * ~10 of every 15 minutes between probes; a wake costs seconds of
 * compute, not an hour. Revocation SLA moves 5 → 15 min on LIVE SOCKETS
 * only — every HTTP navigation still gates through requireUser /
 * requireAdmin instantly, and room-join re-checks fire at join time. */
export const SOCKET_REVERIFY_INTERVAL_MS = 15 * 60_000;

/** AUD103-3-F2 (r103): scope-gated room for live admin ALERT broadcasts.
 * "admin-room" stays open to every active admin (counter-only stats
 * updates), but admin-alert-new payloads carry operational content
 * (product names, coupon codes, risk references) — the socket stream now
 * mirrors the HTTP RBAC of /api/admin/alerts (support scope; "all"
 * wildcard passes). */
export const ADMIN_ALERTS_ROOM = "admin-alerts-room";

/** AUD103-3-F2 (r103): does this permission set unlock the live alert
 * room? Kept in sync with the HTTP mount (routes/admin/index.ts mounts
 * the alerts router under the `support` scope). */
export function hasAlertScope(granted: readonly string[] | null | undefined): boolean {
  return hasPermission(granted, "support");
}

/** Verified identity attached to every authenticated socket. */
export interface SocketIdentity {
  /** User JWT subject. Present when auth_token verifies. */
  userId?: number;
  /** Session row id embedded in the user JWT (93-A1 S1). Present when the
   * token was minted by lib/session.ts; absent on pre-unification legacy
   * tokens — those skip the row check exactly like requireUser. */
  sessionId?: string;
  /** Admin JWT subject. Present when admin_token verifies. */
  adminId?: number;
  /** Admin role string. Present when adminId is present. */
  role?: string;
  /** True when admin_token verified. False/undefined otherwise. */
  isAdmin: boolean;
  /** A8-01 (round-94): admin_sessions row id from the admin JWT. The
   * liveness gate consults it exactly like requireAdmin does — a revoked
   * (logout / password-change) admin token loses its socket identity
   * too, not just its HTTP routes. Absent on legacy sid-less tokens. */
  adminSessionId?: string;
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
 *     one of the entries exactly. Missing/empty Origin is rejected —
 *     EXCEPT the R107 same-origin rule below.
 *
 * R107 (migration fix — same-origin polling handshake): browsers do
 * NOT send an Origin header on same-origin XHR GETs, and the
 * socket.io client always starts with a polling handshake. On the
 * split deployment (Vercel SPA → Render API) every handshake was
 * cross-origin, so Origin was always present. On a single-origin
 * deployment (Docker/Coolify: the backend serves the SPA itself)
 * the very first handshake arrived Origin-less and was rejected →
 * "unauthorized" reconnect loops. WS upgrades always carry Origin
 * and were unaffected — the bug only bit the polling transport.
 *
 * Fix: when Origin is absent, accept the handshake if the request's
 * Host header matches the host of an allowlist entry (hostname,
 * case-insensitive; explicit ports must match the origin's effective
 * port). The Host header is set by the browser from the request URL
 * and forwarded verbatim by Cloudflare/traefik — it is not a
 * client-side forgeable CSRF surface, and this branch grants NO
 * identity: layer 2 (JWT) and layer 2b (DB liveness) still apply in
 * full. A cross-site browser attacker still sends Origin
 * (attacker.com) and fails; a non-browser attacker with a spoofed
 * Host still needs a valid token.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
  host?: string | null,
): boolean {
  // Permissive mode (dev) — empty allowlist accepts everything.
  if (allowedOrigins.length === 0) return true;
  if (origin && typeof origin === "string") {
    return allowedOrigins.includes(origin);
  }
  // R107: Origin-less request — allow only when the Host header proves
  // the request targets one of the allowlist's own origins.
  if (typeof host === "string" && host.length > 0) {
    const hostLower = host.toLowerCase().trim();
    const hostNoPort = hostLower.replace(/:\d+$/, "");
    const hostPort = hostLower.includes(":") ? hostLower.slice(hostLower.indexOf(":") + 1) : null;
    for (const allowed of allowedOrigins) {
      try {
        const url = new URL(allowed);
        const allowedHost = url.hostname.toLowerCase();
        const allowedPort = url.port || (url.protocol === "https:" ? "443" : "80");
        if (hostNoPort !== allowedHost) continue;
        // No explicit port on Host (proxied default) → hostname match is
        // sufficient; an explicit port must equal the origin's effective one.
        if (hostPort === null || hostPort === allowedPort) return true;
      } catch {
        // Malformed allowlist entry — skip it (matches strict-compare
        // behavior, which would also never equal a real header).
      }
    }
  }
  return false;
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

export function authenticateSocketHandshake(handshake: SocketHandshakeLike): SocketIdentity | null {
  const cookies = parseCookieHeader(handshake.headers?.cookie);
  const identity: SocketIdentity = { isAdmin: false };

  // ── User token ─────────────────────────────────────────────────────
  const userToken = cookies.auth_token ?? handshake.auth?.userToken;
  if (typeof userToken === "string" && userToken.length > 0) {
    const result = verifyUserTokenDetailed(userToken);
    if (result.ok) {
      identity.userId = result.payload.userId;
      // 93-A1 S1: keep the session id so the liveness gate below (and the
      // periodic re-verify) can consult the sessions row — the exact same
      // claim requireUser reads. Legacy tokens without it skip the check.
      identity.sessionId = result.payload.sessionId;
    }
  }

  // ── Admin token ────────────────────────────────────────────────────
  const adminToken = cookies.admin_token ?? handshake.auth?.adminToken;
  if (typeof adminToken === "string" && adminToken.length > 0) {
    const result = verifyAdminTokenDetailed(adminToken);
    // SEC-92-02 (round-92 B1 audit): reject the 2FA TEMP token exactly
    // like requireAdmin does (middlewares/requireAdmin.ts V1-CRITICAL
    // block — mirrored here rather than imported to avoid a middleware
    // dependency cycle). The temp token proves password-only possession;
    // granting it admin-room membership (live order/topup/alert events,
    // PII-bearing payloads) would bypass 2FA for this surface. Treat it
    // as unauthenticated: no adminId/role/isAdmin → the decision below
    // rejects the socket unless a valid USER token is also present.
    if (result.ok && result.payload.isTemp !== true) {
      identity.adminId = result.payload.adminId;
      identity.role = result.payload.role;
      identity.isAdmin = true;
      // A8-01: keep the sid for the liveness gate below.
      if (typeof result.payload.sid === "string" && result.payload.sid.length > 0) {
        identity.adminSessionId = result.payload.sid;
      }
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

// ── DB-backed identity liveness (93-A1 S1) ──────────────────────────

export type SocketLivenessFailure =
  | "session_revoked" // sessions row deleted (logout / logout-all / user deletion) or expired
  | "admin_missing" // admin_users row deleted
  | "admin_inactive" // admin_users.is_active = false (soft-disable)
  | "admin_session_revoked"; // admin_sessions row revoked (logout / password change) — A8-01

export interface SocketLivenessResult {
  /** True when the identity is entirely live (or DB probes failed → fail-open). */
  ok: boolean;
  /** The user component (userId) is revoked — strip it / leave user room. */
  userRevoked?: boolean;
  /** The admin component (adminId/role/isAdmin) is revoked — strip it / leave admin-room. */
  adminRevoked?: boolean;
  /** AUD103-3-F2 (r103): the admin's CURRENT permission scopes, read by
   * the same probe that checks is_active — present whenever the admin row
   * was found (even on fail-open probe errors it stays undefined, in which
   * case room membership is simply left as-is). Used to reconcile the
   * scope-gated alert room on every re-verify pass. */
  adminPermissions?: string[];
  /** First failure reason — used for the rejection counter + logs. */
  reason?: SocketLivenessFailure;
}

/**
 * Verify a handshake-verified identity against the DB — the WS mirror
 * of what requireUser / requireAdmin do per HTTP request (93-A1 S1).
 *
 *   - user  : sessions row must exist + be unexpired. Reuses the shared
 *     60 s-cached isSessionRowLive probe (lib/session-liveness.ts) so
 *     the WS and HTTP surfaces can never disagree on revocation.
 *     Legacy tokens without a sessionId skip the check (requireUser
 *     semantics — they age out within 30 d).
 *   - admin : admin_users row must exist and is_active must be true
 *     (requireAdmin semantics).
 *
 * DB probe failures fail OPEN (the JWT is still cryptographically
 * sound) and are logged — a Postgres blip must not kick every live
 * socket.
 */
export async function verifySocketIdentityLive(
  identity: SocketIdentity,
): Promise<SocketLivenessResult> {
  const result: SocketLivenessResult = { ok: true };

  if (identity.userId != null && identity.sessionId) {
    try {
      // B1-4 (R111): pass the handshake's userId so the probe enforces
      // session ownership (admin-twin parity).
      const live = await isSessionRowLive(identity.sessionId, identity.userId);
      if (!live) {
        result.ok = false;
        result.userRevoked = true;
        result.reason = "session_revoked";
      }
    } catch (err) {
      logger.warn(
        {
          category: "security",
          userId: identity.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        "[socket-auth] session-row probe failed — keeping identity on JWT strength",
      );
    }
  }

  if (identity.isAdmin && identity.adminId != null) {
    try {
      // A8-01: the admin_sessions row is the revocation truth — check it
      // FIRST (cheap PK lookup) so a logged-out/password-rotated admin
      // loses the socket at the next liveness pass, mirroring requireAdmin.
      if (identity.adminSessionId) {
        const sessionLive = await isValidAdminSession(identity.adminSessionId, identity.adminId);
        if (!sessionLive) {
          result.ok = false;
          result.adminRevoked = true;
          result.reason = "admin_session_revoked";
          return result;
        }
      }
      const admin = await getAdminRowCached(identity.adminId);
      if (!admin) {
        result.ok = false;
        result.adminRevoked = true;
        result.reason ??= "admin_missing";
      } else if (!admin.isActive) {
        result.ok = false;
        result.adminRevoked = true;
        result.reason ??= "admin_inactive";
      } else {
        // AUD103-3-F2 (r103): carry the live scopes out so the caller can
        // reconcile the scope-gated alert room without a second read.
        // (null from the jsonb column → undefined on the result type.)
        result.adminPermissions = admin.permissions ?? undefined;
      }
    } catch (err) {
      logger.warn(
        {
          category: "security",
          adminId: identity.adminId,
          err: err instanceof Error ? err.message : String(err),
        },
        "[socket-auth] admin liveness probe failed — keeping identity on JWT strength",
      );
    }
  }

  return result;
}

/**
 * Pure companion of verifySocketIdentityLive: given a liveness verdict,
 * produce the identity that should remain attached to the socket.
 *
 *   - ok             → identity unchanged (same reference)
 *   - component dead → that component stripped
 *   - both dead / nothing left → null (caller disconnects / rejects)
 *
 * Exported for unit testing — the io.use gate, the periodic re-verify
 * and the room-join re-checks all funnel through this one rule.
 */
export function stripIdentityForLiveness(
  identity: SocketIdentity,
  liveness: SocketLivenessResult,
): SocketIdentity | null {
  if (liveness.ok) return identity;

  let next: SocketIdentity = identity;
  if (liveness.userRevoked === true && identity.userId != null) {
    next = { ...next, userId: undefined, sessionId: undefined };
  }
  if (liveness.adminRevoked === true && identity.isAdmin) {
    next = { ...next, adminId: undefined, role: undefined, isAdmin: false };
  }

  if (next.userId == null && !next.isAdmin) return null;
  return next;
}

// ── Mid-session re-verification wiring (93-A1 S1) ────────────────────

export function stopIdentityReverification(socket: Socket): void {
  const timer = socket.data.reverifyTimer as NodeJS.Timeout | undefined;
  if (timer) {
    clearInterval(timer);
    socket.data.reverifyTimer = undefined;
  }
}

export function startIdentityReverification(socket: Socket): void {
  const timer = setInterval(() => {
    void reverifyAndEnforce(socket);
  }, SOCKET_REVERIFY_INTERVAL_MS);
  // Never keep the process alive just for a socket timer — the server's
  // own HTTP listener owns the event loop.
  timer.unref();
  socket.data.reverifyTimer = timer;
}

/**
 * Re-verify a connected socket's identity against the DB and enforce the
 * verdict: a dead component leaves its room (and is stripped from the
 * identity), a fully dead identity is hard-disconnected. DB probe
 * failures fail open inside verifySocketIdentityLive.
 *
 * Exported (R127-B6-1) for direct unit testing — the periodic timer
 * (startIdentityReverification), the legacy join-user/join-admin
 * re-checks and this function form the one gate piece with no pure
 * helper underneath; the alert-room scope reconciliation needed a test
 * against the real DB probe (see socket-alert-room-reconcile.test.ts).
 */
export async function reverifyAndEnforce(socket: Socket): Promise<void> {
  const identity = socket.data.identity as SocketIdentity | undefined;
  if (!identity) return;

  const liveness = await verifySocketIdentityLive(identity);
  if (liveness.ok) {
    // AUD103-3-F2 (r103): reconcile the scope-gated alert room on every
    // pass — a scope granted or removed mid-connection takes effect
    // within one re-verify interval, without waiting for a reconnect.
    // Only when the probe actually returned the live scopes (fail-open
    // probes leave the current membership untouched).
    //
    // R127-B6-1 (B6 sockets audit): this block used to sit BELOW the
    // early return above — testing liveness.ok on a path only reachable
    // when liveness.ok is false, i.e. it could never execute. A revoked
    // `support` scope (scope revocation ≠ session revocation — the
    // admin stays active, liveness stays ok) kept streaming
    // admin-alert-new PII for the life of the connection while the HTTP
    // side 403'd. Moved onto the healthy path, exactly as the original
    // comment promised.
    if (identity.isAdmin && liveness.adminPermissions) {
      if (hasAlertScope(liveness.adminPermissions)) {
        socket.join(ADMIN_ALERTS_ROOM);
      } else {
        socket.leave(ADMIN_ALERTS_ROOM);
      }
    }
    return;
  }

  const remaining = stripIdentityForLiveness(identity, liveness);

  // Leave the rooms tied to revoked components FIRST so no further
  // outbound event can reach this socket through them.
  if (liveness.userRevoked === true && identity.userId != null) {
    socket.leave(`user:${identity.userId}`);
  }
  if (liveness.adminRevoked === true && identity.isAdmin) {
    socket.leave("admin-room");
    socket.leave(ADMIN_ALERTS_ROOM);
  }

  recordRejection(liveness.reason ?? "session_revoked", {
    socketId: socket.id,
    userId: identity.userId,
    adminId: identity.adminId,
    userRevoked: liveness.userRevoked === true,
    adminRevoked: liveness.adminRevoked === true,
    remoteAddress: getRemoteAddr(socket),
  });

  if (!remaining) {
    stopIdentityReverification(socket);
    // Hard disconnect — the client must re-handshake (and re-auth).
    socket.disconnect(true);
    return;
  }

  // One component died, the other is still live: degrade gracefully.
  socket.data.identity = remaining;
  logger.warn(
    {
      socketId: socket.id,
      userId: identity.userId,
      adminId: identity.adminId,
      userRevoked: liveness.userRevoked === true,
      adminRevoked: liveness.adminRevoked === true,
      reason: liveness.reason,
    },
    "[socket-auth] mid-session re-verify revoked an identity component — room left, socket kept",
  );
}
