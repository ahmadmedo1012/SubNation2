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
 *   2b. DB-backed liveness re-verification (93-A1 S1, round-93).
 *      JWT verification alone means a revoked session (logout /
 *      logout-all / user deletion) or a soft-disabled admin kept its
 *      socket — and with it the auto-joined user:/admin-room membership
 *      streaming wallet/order PII — for the token's full life (30 d
 *      user / 8 h admin). The handshake gate, a periodic re-verify
 *      (every 5 min per socket) and the legacy room-join events now all
 *      consult the same sources requireUser/requireAdmin use:
 *        - user token  → `sessions` row exists + unexpired
 *          (lib/session-liveness.isSessionRowLive, 60 s cache)
 *        - admin token → `admin_users.is_active`
 *      A dead component is stripped (room left); a fully dead identity
 *      disconnects. DB probe failures fail OPEN (JWT is still
 *      cryptographically sound) — mirrors requireUser's posture.
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
 *   6. Connection caps (R97-06, round-97 F2). /socket.io sits OUTSIDE
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
 * THE PURE-FUNCTION SHAPE:
 *
 *   parseCookieHeader, authenticateSocketHandshake,
 *   authorizeJoinUser, authorizeJoinAdmin, isOriginAllowed —
 *   all exported for unit testing without spinning up a server.
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

import * as Sentry from "@sentry/node";
import { createAdapter } from "@socket.io/redis-adapter";
import { adminUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Server as HttpServer } from "http";
import { Counter } from "prom-client";
import { createClient } from "redis";
import { Server as SocketServer, type Socket } from "socket.io";
import { __testables as cloudflareIpTestables } from "../middlewares/cloudflareClientIp";
import { verifyAdminTokenDetailed, verifyUserTokenDetailed } from "./jwt";
import { logger } from "./logger";
import { hasPermission } from "./permissions";
import { isSessionRowLive } from "./session-liveness";
import { isValidAdminSession } from "./admin-session";
import { getConfiguredOrigins } from "./origins";
import {
  getRegistry,
  safeGaugeDec,
  safeGaugeInc,
  safeInc,
  socketConnectedClients,
  socketEventsTotal,
} from "./metrics";

let io: SocketServer | null = null;

/** How often each connected socket's identity is re-verified against the
 * DB (sessions row / admin is_active). 93-A1 S1 recommended "e.g. every 5
 * min" — cheap indexed lookups (session probe is additionally 60 s-cached). */
export const SOCKET_REVERIFY_INTERVAL_MS = 5 * 60_000;

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

// ── R97-06 (round-97 F2): connection caps ────────────────────────────────

/** Max CONCURRENT authenticated sockets per client IP. 5 covers every
 * legitimate shape (main tab + admin tab + a refresh overlap + a mobile
 * PWA) while making thousands-of-connections-per-attacker structurally
 * impossible. CGNAT note: Libyan mobile carriers NAT many users behind
 * one address; a shared 5-slot ceiling there degrades to reconnect
 * churn, not lockout — acceptable for the exhaustion attack this caps. */
export const MAX_SOCKET_CONNECTIONS_PER_IP = 5;

/** Total concurrent sockets this instance will serve before refusing.
 * Sanity bound against FD/memory exhaustion; 2000 is ~10× the observed
 * peak for this deployment. */
export const MAX_TOTAL_SOCKET_CONNECTIONS = 2_000;

/** How often the tracker drops ids whose socket is no longer connected
 * (missed disconnects, bookkeeping drift) — keeps the Map bounded. */
export const SOCKET_CAP_SWEEP_INTERVAL_MS = 60_000;

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

function getAllowedOrigins(): string[] {
  return getConfiguredOrigins();
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
      const [admin] = await db
        .select({ isActive: adminUsersTable.isActive, permissions: adminUsersTable.permissions })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.id, identity.adminId))
        .limit(1);
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
        result.adminPermissions = admin.permissions;
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

function getAuthRejectedCounter() {
  const reg = getRegistry();
  const name = "socket_auth_rejected_total";
  let counter = reg.getSingleMetric(name) as Counter<string> | undefined;
  if (!counter) {
    counter = new Counter({
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
  | "anon_join_admin"
  // 93-A1 S1: DB-backed liveness verdicts (handshake gate + mid-session re-verify)
  | "session_revoked"
  | "admin_missing"
  | "admin_inactive"
  | "admin_session_revoked" // A8-01: admin_sessions row revoked
  // R97-06 (round-97 F2): connection-cap rejections
  | "ip_connection_cap"
  | "total_connection_cap";

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
function recordRejection(reason: RejectionReason, context: Record<string, unknown>): void {
  try {
    getAuthRejectedCounter().inc({ reason });
  } catch {
    // best-effort
  }
  try {
    Sentry.addBreadcrumb({
      category: "socket-auth",
      // Security-relevant verdicts (forgery, revocation, admin state) are
      // warnings; the routine anon/no_token path is info (probe traffic).
      level:
        reason.startsWith("forged_") ||
        reason === "session_revoked" ||
        reason === "admin_missing" ||
        reason === "admin_inactive"
          ? "warning"
          : "info",
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
  // SEC-92-06 (round-92): use the RIGHTMOST X-Forwarded-For entry — the
  // one appended by our trusted proxy — never the leftmost (client-
  // spoofable; it only pollutes the warn-logs below, but forensic logs
  // should not record attacker-chosen values either).
  const xff = socket.handshake.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const entries = xff
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length > 0) return entries[entries.length - 1];
  }
  return socket.handshake.address || "unknown";
}

// ── R97-06 (round-97 F2): connection caps ────────────────────────────────

/** Verdict of SocketConnectionTracker.admit — the connection handler
 * disconnects anything that is not "ok". */
export type SocketCapVerdict = "ok" | "per_ip_cap" | "total_cap";

/**
 * In-memory concurrent-connection accounting: per-client-IP socket-id
 * sets plus a total counter. Deliberately dependency-free and pure so
 * the exhaustion math is unit-testable without a socket.io server
 * (same shape as the exported auth helpers above).
 *
 * One tracker per initSocket() call (per process in production).
 */
export class SocketConnectionTracker {
  private readonly perIp = new Map<string, Set<string>>();
  private total = 0;

  constructor(
    private readonly maxPerIp: number = MAX_SOCKET_CONNECTIONS_PER_IP,
    private readonly maxTotal: number = MAX_TOTAL_SOCKET_CONNECTIONS,
  ) {}

  /** R104 (AG3-4): non-mutating verdict probe — what WOULD admit()
   * return for this IP right now? Used by the io.use pre-check so a
   * capped client is rejected BEFORE the auth/DB probe chain without
   * occupying a slot. */
  peek(ip: string): SocketCapVerdict {
    if (this.total >= this.maxTotal) return "total_cap";
    const ids = this.perIp.get(ip);
    if (ids && ids.size >= this.maxPerIp) return "per_ip_cap";
    return "ok";
  }

  /** Register a connection. Returns the verdict; only "ok" connections
   * are tracked (a capped socket must not occupy a slot). */
  admit(ip: string, socketId: string): SocketCapVerdict {
    if (this.total >= this.maxTotal) return "total_cap";
    let ids = this.perIp.get(ip);
    if (!ids) {
      ids = new Set<string>();
      this.perIp.set(ip, ids);
    }
    if (ids.has(socketId)) return "ok"; // idempotent re-admit
    if (ids.size >= this.maxPerIp) return "per_ip_cap";
    ids.add(socketId);
    this.total += 1;
    return "ok";
  }

  /** Free the slot a disconnecting socket occupied. No-op for ids that
   * were never admitted (capped sockets have no slot to free). */
  release(ip: string, socketId: string): void {
    const ids = this.perIp.get(ip);
    if (!ids || !ids.delete(socketId)) return;
    this.total -= 1;
    if (ids.size === 0) this.perIp.delete(ip);
  }

  /** Drop tracked ids the caller reports as dead — bounds drift from any
   * missed disconnect path and keeps the Map size = live IP count. */
  sweep(isLive: (socketId: string) => boolean): void {
    for (const [ip, ids] of this.perIp) {
      for (const id of ids) {
        if (!isLive(id)) {
          ids.delete(id);
          this.total -= 1;
        }
      }
      if (ids.size === 0) this.perIp.delete(ip);
    }
  }

  /** Observability for tests + logs. */
  stats(): { ips: number; sockets: number } {
    return { ips: this.perIp.size, sockets: this.total };
  }
}

/**
 * Client IP for the per-IP connection cap. Mirrors cloudflareClientIp
 * (H11) semantics on the WS surface: the rightmost XFF entry is the peer
 * that actually connected to Render — when THAT peer is a Cloudflare
 * edge, the CF-Connecting-IP header is Cloudflare's own (trustworthy)
 * client value; otherwise (direct-to-Render connection) the rightmost
 * XFF entry IS the client. Keying the cap on the raw rightmost XFF alone
 * would lump every Cloudflare-routed user onto a handful of CF edge IPs
 * and over-block; keying it on the unvalidated CF header would let a
 * direct attacker rotate keys freely — this resolution is neither.
 *
 * Reuses the middleware's exported CF range tables (single source of
 * truth — a local copy would drift when Cloudflare announces new ranges).
 */
export function resolveSocketClientIp(socket: {
  handshake: { headers: Record<string, unknown>; address?: string };
}): string {
  const headers = socket.handshake.headers;
  const cfIp = headers["cf-connecting-ip"];
  const xff = headers["x-forwarded-for"];

  let peer: string | null = null;
  if (typeof xff === "string" && xff.length > 0) {
    const entries = xff
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length > 0) peer = entries[entries.length - 1]!;
  }

  if (
    peer &&
    typeof cfIp === "string" &&
    cfIp.length > 0 &&
    cloudflareIpTestables.isCloudflareIp(peer)
  ) {
    return cfIp;
  }

  return peer ?? socket.handshake.address ?? "unknown";
}

// ── Mid-session re-verification wiring (93-A1 S1) ────────────────────

function stopIdentityReverification(socket: Socket): void {
  const timer = socket.data.reverifyTimer as NodeJS.Timeout | undefined;
  if (timer) {
    clearInterval(timer);
    socket.data.reverifyTimer = undefined;
  }
}

function startIdentityReverification(socket: Socket): void {
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
