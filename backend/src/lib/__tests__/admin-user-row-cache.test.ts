import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, adminUsersTable } from "../../test/db";
import { __clearAdminRowCacheForTests, getAdminRowCached } from "../admin-user-row-cache";

/**
 * R192 (the Neon compute-quota incident) — the admin_users row cache.
 *
 * requireAdmin read the row uncached on EVERY admin request while the
 * admin UI polls at 15-60 s — against a scale-to-zero Neon that means
 * the endpoint never idles while any admin tab is open. The cache's
 * contract (the session-liveness.ts positive-verdict pattern):
 *
 *   - an ACTIVE row is served from a 30 s in-process cache;
 *   - a soft-disable / permission change propagates within ≤ 30 s (the
 *     cached-active window — the same trade the admin SESSION row makes
 *     at 60 s, R104 AG5-4, at half the length);
 *   - a MISSING or INACTIVE row is never cached — once the window ages
 *     out, the disabled admin is re-read every request;
 *   - callers still see the row (with isActive) so requireAdmin keeps
 *     its 401-missing / 403-inactive distinction.
 */

let adminSeq = 0;
async function seedAdmin(options: { isActive?: boolean; permissions?: string[] } = {}) {
  adminSeq += 1;
  const [admin] = await db
    .insert(adminUsersTable)
    .values({
      username: `rowcache${String(adminSeq).padStart(4, "0")}`,
      passwordHash: "x".repeat(60),
      displayName: "Row Cache Test",
      role: "admin",
      permissions: options.permissions ?? ["orders"],
      isActive: options.isActive ?? true,
    })
    .returning();
  return admin;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  __clearAdminRowCacheForTests();
});

describe("getAdminRowCached (R192 — the admin row cache)", () => {
  it("an active row is returned with its full shape", async () => {
    const admin = await seedAdmin({ permissions: ["orders", "users"] });
    const row = await getAdminRowCached(admin.id);
    expect(row).toMatchObject({
      id: admin.id,
      username: admin.username,
      role: "admin",
      isActive: true,
      permissions: ["orders", "users"],
    });
  });

  it("a missing admin → null", async () => {
    await seedAdmin(); // sequence does not matter
    expect(await getAdminRowCached(999_999)).toBeNull();
  });

  it("an ACTIVE row is cached: a same-TTL re-read serves the pre-mutation value", async () => {
    const admin = await seedAdmin({ permissions: ["orders"] });
    const first = await getAdminRowCached(admin.id);
    expect(first?.permissions).toEqual(["orders"]);

    // Mutate the row OUT from under the cache — within the TTL the
    // cached copy is served (the documented 30 s window; permission
    // changes take ≤ 30 s to appear).
    await db
      .update(adminUsersTable)
      .set({ permissions: ["orders", "products"] })
      .where(eq(adminUsersTable.id, admin.id));

    const second = await getAdminRowCached(admin.id);
    expect(second?.permissions).toEqual(["orders"]); // cached

    // Cache cleared → the fresh row surfaces.
    __clearAdminRowCacheForTests();
    const third = await getAdminRowCached(admin.id);
    expect(third?.permissions).toEqual(["orders", "products"]);
  });

  it("a soft-disable propagates within the ≤ 30 s window (the cached-active row serves until TTL, then the disable is honored)", async () => {
    const admin = await seedAdmin({ isActive: true });
    await getAdminRowCached(admin.id); // primes the ACTIVE cache entry

    // Soft-disable the admin.
    await db
      .update(adminUsersTable)
      .set({ isActive: false })
      .where(eq(adminUsersTable.id, admin.id));

    // Within the TTL the cached ACTIVE row is still served — the same
    // shape of window the admin SESSION row carries (60 s, R104 AG5-4),
    // at half the length. (The session row is also revoked on disable
    // paths, and its OWN 60 s cache gates access regardless of this one.)
    const withinWindow = await getAdminRowCached(admin.id);
    expect(withinWindow).toMatchObject({ id: admin.id, isActive: true });

    // Once the cache entry is gone (TTL aged out), the disable is
    // honored — and the INACTIVE row is never re-cached.
    __clearAdminRowCacheForTests();
    const row = await getAdminRowCached(admin.id);
    expect(row).toMatchObject({ id: admin.id, isActive: false });
    // Re-read: still the honest inactive row (not cached, not flapping).
    expect(await getAdminRowCached(admin.id)).toMatchObject({ isActive: false });
  });

  it("a row deleted while cached (admin deleted) → null on the next read only after TTL… but delete is the rarer path: the row stays cached within the TTL like any active row", async () => {
    const admin = await seedAdmin();
    await getAdminRowCached(admin.id); // prime

    await db.delete(adminUsersTable).where(eq(adminUsersTable.id, admin.id));

    // Within the TTL the cached ACTIVE row is still served — the same
    // 30 s window as the permission-mutation case, and strictly weaker
    // than the 60 s admin SESSION row window (R104 AG5-4). The session
    // row is deleted with CASCADE, so isValidAdminSession (uncached
    // miss → false) locks the account out regardless of this cache.
    const row = await getAdminRowCached(admin.id);
    expect(row).not.toBeNull();
    __clearAdminRowCacheForTests();
    expect(await getAdminRowCached(admin.id)).toBeNull();
  });
});
