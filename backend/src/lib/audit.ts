/**
 * Best-effort admin-action audit log.
 *
 * Inserts into `audit_logs` for any admin-write operation. Never throws —
 * a failed audit must NOT block the user-facing operation. Failures emit a
 * warn-level pino log with `category: "audit"` so the alerting pipeline
 * can detect a broken audit trail.
 *
 * Usage:
 *   await writeAuditLog(req, "topup.approve", "topup", topupId, { amount });
 *
 * Cardinality discipline: keep `action` strings stable
 * (`<resource>.<verb>`); never include user-supplied strings in the action
 * field. `metadata` is JSON-stringified — bound the size so the table doesn't
 * become a haystack. Aim for ≤2 KB per entry.
 */

import type { Request } from "express";
import { auditLogsTable, db } from "@workspace/db";
import { logger } from "./logger";
import type { AdminAuthenticatedRequest } from "../middlewares/requireAdmin";

const MAX_METADATA_BYTES = 2048;

/**
 * Resolve the client IP for audit rows (SEC-92-06, round-92).
 *
 * Resolution order:
 *   1. `req.ip` — the `cloudflareClientIp` middleware has already validated
 *      the CF-Connecting-IP chain (it only trusts that header when the
 *      Render-facing XFF peer is itself a Cloudflare IP) and overridden
 *      req.ip, so this is the trusted value. Express computes it from
 *      `trust proxy = 1` otherwise (the direct proxy peer).
 *   2. RIGHTMOST X-Forwarded-For entry — documented fallback only (used
 *      when req.ip is unavailable, e.g. synthetic requests). The rightmost
 *      entry is the one appended by OUR trusted proxy; the LEFTMOST entry
 *      is client-supplied and spoofable, and was previously recorded here
 *      — poisoning audit forensics for exactly the incident class these
 *      rows exist for.
 *   3. req.socket.remoteAddress, then "unknown".
 *
 * Exported for unit tests (see lib/__tests__/audit-client-ip.test.ts).
 */
export function resolveAuditClientIp(req: Request): string {
  if (req.ip) return req.ip;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const entries = xff
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length > 0) return entries[entries.length - 1];
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function safeMetadata(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_METADATA_BYTES) {
      // Truncate but flag — don't silently drop information
      return JSON.stringify({ _truncated: true, head: json.slice(0, MAX_METADATA_BYTES - 64) });
    }
    return json;
  } catch {
    return JSON.stringify({ _serialize_error: true });
  }
}

export async function writeAuditLog(
  req: Request,
  action: string,
  targetType?: string,
  targetId?: number | null,
  metadata?: unknown,
): Promise<void> {
  const adminReq = req as AdminAuthenticatedRequest;
  const actorId = typeof adminReq.adminId === "number" ? adminReq.adminId : null;

  try {
    await db.insert(auditLogsTable).values({
      actorId,
      actorType: "admin",
      action,
      targetType: targetType ?? null,
      targetId: targetId ?? null,
      metadata: safeMetadata(metadata),
      ip: resolveAuditClientIp(req).slice(0, 45),
      userAgent: (req.headers["user-agent"] ?? "").slice(0, 500),
    });
  } catch (err) {
    logger.warn(
      { err, category: "audit", action, actorId, targetType, targetId },
      "[audit] write failed — operation succeeded but audit trail is incomplete",
    );
  }
}
