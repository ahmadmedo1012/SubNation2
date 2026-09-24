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

export async function createAdminSession(
  input: CreateAdminSessionInput,
): Promise<AdminSessionToken> {
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
  // RT-4 (R104 red team): purge the 60 s validity cache so a logout /
  // password-change revocation takes effect immediately on THIS
  // instance instead of waiting out the cache window. The cache key is
  // `${sid}:${adminId}` — this function only holds the sid, so purge by
  // prefix (the sid half is unique per session row).
  for (const key of adminSessionValidityCache.keys()) {
    if (key.startsWith(`${sid}:`)) adminSessionValidityCache.delete(key);
  }
  await db
    .update(adminSessionsTable)
    .set({ revokedAt: new Date(), revokedReason: reason.slice(0, 100) })
    .where(and(eq(adminSessionsTable.id, sid), isNull(adminSessionsTable.revokedAt)));
}

export async function revokeAllAdminSessions(adminId: number, reason: string): Promise<void> {
  // RT-4 (R104 red team): same immediate-purge contract as above, scoped
  // to the admin's every session.
  for (const key of adminSessionValidityCache.keys()) {
    if (key.endsWith(`:${adminId}`)) adminSessionValidityCache.delete(key);
  }
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
// ── R104 (AG5-4): 60 s in-process validity cache ────────────────────────────
//
// requireAdmin ran 2 uncached session queries on EVERY admin request —
// and the admin UI polls observability at 15-60 s (system tab metrics
// alone = 8 auth queries/min). Same pattern + trade-off as user
// sessions (lib/session-liveness.ts): revocation propagates within
// ≤ 60 s per instance, an explicit, documented window. The admin ROW
// (is_active soft-disable + permissions) deliberately stays UNcached —
// real-time disable semantics are preserved.
const ADMIN_SESSION_CACHE_TTL_MS = 60_000;
const adminSessionValidityCache = new Map<string, number>();

let adminCachePruneCounter = 0;
function pruneAdminSessionValidityCache(): void {
  if (++adminCachePruneCounter % 500 !== 0) return;
  const now = Date.now();
  for (const [key, expiry] of adminSessionValidityCache) {
    if (expiry < now) adminSessionValidityCache.delete(key);
  }
}

export async function isValidAdminSession(sid: string, adminId: number): Promise<boolean> {
  const cacheKey = `${sid}:${adminId}`;
  const now = Date.now();
  const cachedUntil = adminSessionValidityCache.get(cacheKey);
  if (cachedUntil !== undefined && cachedUntil > now) return true;

  // B6-06 (R111, round-111 B6 audit): this is the hottest index in the
  // system (admin_users_pkey ≈ 7,886 scans live) and it used to run TWO
  // queries — a full row SELECT by sid followed by a second ownership
  // SELECT (`sid AND adminId`). Both verdicts are pure predicates over
  // the same row, so they merge into ONE query whose WHERE carries all
  // four conditions:
  //
  //   1. the row exists            (eq(id, sid))
  //   2. not revoked               (isNull(revokedAt))
  //   3. expires in the future     (gt(expiresAt, now))
  //   4. belongs to the token's admin (eq(adminId, adminId))
  //
  // Semantics identical to the two-query form (AND of the same
  // predicates); the row-missing / revoked / expired / foreign-owner
  // cases all fold into "no row returned" → false. The expiry boundary
  // moved from a JS `expiresAt.getTime() <= Date.now()` compare to the
  // SQL `expires_at > now` compare — same inclusive/exclusive shape,
  // one fewer TOCTOU window.
  const [row] = await db
    .select({ id: adminSessionsTable.id })
    .from(adminSessionsTable)
    .where(
      and(
        eq(adminSessionsTable.id, sid),
        eq(adminSessionsTable.adminId, adminId),
        isNull(adminSessionsTable.revokedAt),
        // The JWT's own expiry is checked by the verifier before this
        // runs — here the ROW is the truth for revocation + lifetime.
        sql`${adminSessionsTable.expiresAt} > now()`,
      ),
    )
    .limit(1);
  const valid = Boolean(row);
  if (valid) {
    adminSessionValidityCache.set(cacheKey, Date.now() + ADMIN_SESSION_CACHE_TTL_MS);
    pruneAdminSessionValidityCache();
  }
  return valid;
}

/** Test-only hook: drop the 60 s admin-session cache. */
export function __clearAdminSessionValidityCacheForTests(): void {
  adminSessionValidityCache.clear();
  adminCachePruneCounter = 0;
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
