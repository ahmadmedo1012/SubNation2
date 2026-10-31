import { eq } from "drizzle-orm";
import { db, adminUsersTable } from "@workspace/db";

/**
 * R192 (the Neon compute-quota incident) — the admin_users ROW read,
 * cached 30 s for ACTIVE admins only.
 *
 * requireAdmin read the row uncached on EVERY admin request, and the
 * admin UI polls at 15-60 s (alerts tab alone = 3 row reads/min) — under
 * a scale-to-zero Neon that means the endpoint never idles while any
 * admin tab is open. lib/admin-session.ts's comment records why the row
 * "deliberately stays UNcached": real-time disable semantics.
 *
 * The trade this cache makes instead (the session-liveness.ts pattern,
 * strictly TIGHTER than the admin SESSION row's own 60 s window from
 * R104 AG5-4): an ACTIVE row serves from cache for 30 s, so a
 * soft-disable or a permission change propagates within ≤ 30 s — the
 * same shape of window the session row already carries, half as long.
 * An inactive/missing row is never CACHED (re-read every request), so
 * a disabled admin re-locking after the window is immediate.
 */

export interface CachedAdminRow {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  permissions: string[] | null;
}

const ADMIN_ROW_CACHE_TTL_MS = 30_000;
const adminRowCache = new Map<string, { row: CachedAdminRow; expiry: number }>();

let cachePruneCounter = 0;
function pruneAdminRowCache(): void {
  // Cheap opportunistic prune — no interval timer, no unbounded growth.
  if (++cachePruneCounter % 500 !== 0) return;
  const now = Date.now();
  for (const [key, entry] of adminRowCache) {
    if (entry.expiry < now) adminRowCache.delete(key);
  }
}

/**
 * The admin_users row for an id — `null` when the admin does not exist.
 * ACTIVE rows are served from a 30 s in-process cache; inactive rows are
 * returned uncached every time (so a disabled admin's NEXT lockout after
 * the window is immediate — the row itself never caches while inactive).
 */
export async function getAdminRowCached(adminId: number): Promise<CachedAdminRow | null> {
  const cacheKey = String(adminId);
  const now = Date.now();
  const cached = adminRowCache.get(cacheKey);
  if (cached && cached.expiry > now) return cached.row;

  const [admin] = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      role: adminUsersTable.role,
      isActive: adminUsersTable.isActive,
      permissions: adminUsersTable.permissions,
    })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);

  // Positive-verdict caching only: only ACTIVE rows cache — a missing
  // or disabled row is re-read on every request while it stays disabled
  // (a soft-disable propagates within ≤ 30 s: the cached-active window,
  // strictly tighter than the admin SESSION row's 60 s one).
  if (admin && admin.isActive) {
    adminRowCache.set(cacheKey, { row: admin, expiry: now + ADMIN_ROW_CACHE_TTL_MS });
    pruneAdminRowCache();
  }
  return admin ?? null;
}

/** Test-only hook: drop the cache so the next read hits the DB. */
export function __clearAdminRowCacheForTests(): void {
  adminRowCache.clear();
  cachePruneCounter = 0;
}
