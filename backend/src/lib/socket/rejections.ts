/**
 * Socket auth-gate rejection observability — the metrics/logs half of the
 * lib/socket package (R136 BE-2 decomposition of lib/socket.ts).
 *
 * Every rejection (origin, token, liveness, connection caps) funnels
 * through {@link recordRejection} so the observability contract stays
 * identical no matter which layer issued the verdict:
 *   - Prom counter `socket_auth_rejected_total{reason}` for dashboards
 *   - Sentry breadcrumb (category "socket-auth") so the next captured
 *     exception in the session carries the audit trail — NO
 *     captureMessage, which would spam from automated probe traffic
 *   - Pino warn-log (category "security")
 *
 * {@link getRemoteAddr} lives here too: rejection log lines are the one
 * place socket forensics need the RIGHTMOST X-Forwarded-For entry.
 */
import * as Sentry from "@sentry/node";
import { Counter } from "@prometheus-io/client";
import type { Socket } from "socket.io";
import { getRegistry } from "../metrics";
import { logger } from "../logger";

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

export type RejectionReason =
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
export function recordRejection(reason: RejectionReason, context: Record<string, unknown>): void {
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

export function getRemoteAddr(socket: Socket): string {
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
