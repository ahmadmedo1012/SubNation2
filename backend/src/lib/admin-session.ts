import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, adminSessionsTable } from "@workspace/db";
import { signAdminToken } from "./jwt";
import { logger } from "./logger";

/**
 * A8-01/A8-02 (round-94): revocable admin sessions.
 *
 * `createAdminSession` pairs the (still short-lived, 8h) admin JWT with a
 * durable `admin_sessions` row; the token gains a `sid` claim and every
 * gated request re-validates the row (requireAdmin already hits the DB
 * per request for is_active/permissions — the extra indexed PK lookup
 * rides the same round trip budget). Revocation paths:
 *
 *   - logout            → revokeAdminSession(sid, "logout")
 *   - change-password   → revokeAllAdminSessions(adminId, "password_changed")
 *                         (all rows, INCLUDING the caller's — the operator
 *                         re-authenticates with the new password; standard
 *                         practice, matches how Google/others treat it)
 *   - is_active = false → requireAdmin's existing row check kills access,
 *                         revokeAllAdminSessions is belt-and-suspenders
 *
 * The JWT expiry stays the first line of defense; the row is the
 * revocation truth. A stolen token now has a maximum useful life of
 * "until the operator notices and logs out / changes the password",
 * not "8 hours no matter what".
 */

const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface CreateAdminSessionInput {
  adminId: number;
  role: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AdminSessionToken {
  token: string;
  sid: string;
}

export async function createAdminSession(input: CreateAdminSessionInput): Promise<AdminSessionToken> {
  const sid = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
  await db.insert(adminSessionsTable).values({
    id: sid,
    adminId: input.adminId,
    expiresAt,
    userAgent: input.userAgent?.slice(0, 255) ?? null,
    ipAddress: input.ipAddress?.slice(0, 45) ?? null,
  });
  const token = signAdminToken(
    { adminId: input.adminId, role: input.role, sid },
    { expiresIn: "8h" },
  );
  return { token, sid };
}

export async function revokeAdminSession(sid: string, reason: string): Promise<void> {
  await db
    .update(adminSessionsTable)
    .set({ revokedAt: new Date(), revokedReason: reason.slice(0, 100) })
    .where(and(eq(adminSessionsTable.id, sid), isNull(adminSessionsTable.revokedAt)));
}

export async function revokeAllAdminSessions(adminId: number, reason: string): Promise<void> {
  const result = await db
    .update(adminSessionsTable)
    .set({ revokedAt: new Date(), revokedReason: reason.slice(0, 100) })
    .where(and(eq(adminSessionsTable.adminId, adminId), isNull(adminSessionsTable.revokedAt)))
    .returning({ id: adminSessionsTable.id });
  logger.info(
    { category: "security", adminId, revoked: result.length, reason },
    "admin sessions revoked",
  );
}

/**
 * True when the session row exists, belongs to the admin, and is neither
 * revoked nor expired. The JWT's own expiry is checked by the verifier
 * before this runs — here the ROW is the truth for revocation.
 */
export async function isValidAdminSession(sid: string, adminId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: adminSessionsTable.id, expiresAt: adminSessionsTable.expiresAt, revokedAt: adminSessionsTable.revokedAt })
    .from(adminSessionsTable)
    .where(eq(adminSessionsTable.id, sid))
    .limit(1);
  if (!row) return false;
  if (row.revokedAt !== null) return false;
  if (row.expiresAt.getTime() <= Date.now()) return false;
  // The row must belong to the token's admin — a sid mismatch (token
  // reuse across admins) is structurally impossible when the sid is
  // minted with the token, but the check costs nothing and closes the
  // "old token + re-minted sid" confusion forever.
  const [owner] = await db
    .select({ adminId: adminSessionsTable.adminId })
    .from(adminSessionsTable)
    .where(and(eq(adminSessionsTable.id, sid), eq(adminSessionsTable.adminId, adminId)))
    .limit(1);
  return Boolean(owner);
}

/**
 * Maintenance: purge rows that are expired > 24h or revoked > 30 days.
 * Called from the 05:00 retention cron (see jobs/cron.ts) — keeps the
 * table tiny without touching live sessions.
 *
 * Uses DELETE ... RETURNING (not rowCount) because pglite's driver
 * result doesn't carry rowCount — same pattern as pruneExpiredSessions
 * (jobs/session-prune.ts). Bounded ctid batches keep a large catch-up
 * purge from holding a single long lock.
 */
export async function pruneStaleAdminSessions(): Promise<number> {
  const BATCH = 1000;
  let removed = 0;
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM admin_sessions
      WHERE ctid IN (
        SELECT ctid FROM admin_sessions
        WHERE expires_at < now() - interval '24 hours'
           OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
        LIMIT ${BATCH}
      )
      RETURNING id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ id: string }> }).rows ??
      (result as unknown as Array<{ id: string }>) ??
      [];
    removed += rows.length;
    if (rows.length < BATCH) break;
  }
  return removed;
}
