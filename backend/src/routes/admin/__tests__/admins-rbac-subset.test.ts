import express, { type Express } from "express";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { requireAdmin } from "../../../middlewares/requireAdmin";
import { requirePermission } from "../../../lib/permissions";
import { adminAdminsRouter } from "../admins";

/**
 * R122 (A5-P1) — RBAC grants are subset-bounded.
 *
 * The H9 gate only fired when the granted array contained the literal
 * "all" string, so an admins-scoped operator could mint a puppet admin
 * holding the full 7-scope union (orders+finance+inventory+support+users+
 * admins+settings) — functionally "all", bypassing the H9 self-escalation
 * gate via BOTH the create (POST /) and edit (PATCH /:id) paths, and via
 * re-enabling a disabled puppet (POST /:id/enable).
 *
 * Locked behaviours:
 *   - POST: a scoped creator can only grant scopes they personally hold;
 *     anything beyond → 403 INSUFFICIENT_PERMISSIONS, no row inserted.
 *   - POST: an "all" creator can still grant anything (including "all")
 *     — the wildcard contract is unchanged.
 *   - PATCH: the same subset bound on editing ANOTHER admin's scopes.
 *   - enable: the actor must hold every scope the disabled target holds
 *     (a puppet holding the union is as privileged as one holding "all").
 *
 * The mount mirrors production (routes/admin/index.ts:115-119):
 * requireAdmin + requirePermission("admins") in front of the router.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/admins", requireAdmin, requirePermission("admins"), adminAdminsRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let adminSeq = 0;

/** Seed an admin row + a sid-less bearer token (requireAdmin accepts those
 * outside production as long as the row exists and is active). */
async function seedAdmin(
  permissions: string[],
  overrides: { isActive?: boolean; username?: string } = {},
): Promise<{ id: number; username: string; token: string }> {
  adminSeq += 1;
  const username = overrides.username ?? `admin_rbac_${String(adminSeq).padStart(3, "0")}`;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username,
      passwordHash: "not-a-real-hash",
      isActive: overrides.isActive ?? true,
      permissions,
    })
    .returning();
  return { id: a.id, username, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function jsonFetch(
  url: string,
  path: string,
  method: "POST" | "PATCH",
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

const FULL_UNION = [
  "orders",
  "finance",
  "inventory",
  "support",
  "users",
  "admins",
  "settings",
] as const;

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R122 (A5-P1) — POST /api/admin/admins: grants are subset-bounded", () => {
  it("an admins-scoped creator CANNOT mint a puppet with the full 7-scope union (403, no row)", async () => {
    // The exact A5-P1 scenario: functionally "all" without the literal.
    const creator = await seedAdmin(["admins"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(url, "/api/admin/admins", "POST", creator.token, {
        username: "ops2",
        password: "longenough1",
        permissions: [...FULL_UNION],
      });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "INSUFFICIENT_PERMISSIONS" });

      const rows = await db.select().from(adminUsersTable);
      expect(rows).toHaveLength(1); // only the creator — nothing was minted
    } finally {
      close();
    }
  });

  it("a single scope beyond the creator's own envelope is refused (finance)", async () => {
    const creator = await seedAdmin(["admins", "orders"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(url, "/api/admin/admins", "POST", creator.token, {
        username: "ops_orders",
        password: "longenough1",
        permissions: ["orders", "finance"],
      });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "INSUFFICIENT_PERMISSIONS" });
      expect(await db.select().from(adminUsersTable)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('granting "all" without holding it stays refused (the H9 case is subsumed, not weakened)', async () => {
    const creator = await seedAdmin(["admins"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(url, "/api/admin/admins", "POST", creator.token, {
        username: "super_puppet",
        password: "longenough1",
        permissions: ["all"],
      });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "INSUFFICIENT_PERMISSIONS" });
      expect(await db.select().from(adminUsersTable)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("subset grants succeed — the creator's own envelope is always grantable", async () => {
    const creator = await seedAdmin(["admins", "orders"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(url, "/api/admin/admins", "POST", creator.token, {
        username: "ops_orders_only",
        password: "longenough1",
        permissions: ["orders"],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ permissions: ["orders"] });
      const [created] = await db
        .select()
        .from(adminUsersTable)
        .where(eq(adminUsersTable.username, "ops_orders_only"));
      expect(created.permissions).toEqual(["orders"]);
    } finally {
      close();
    }
  });

  it('an "all" creator can still grant anything — the wildcard contract is unchanged', async () => {
    const creator = await seedAdmin(["all"]);
    const { url, close } = await listen(buildApp());
    try {
      const union = await jsonFetch(url, "/api/admin/admins", "POST", creator.token, {
        username: "ops_union",
        password: "longenough1",
        permissions: [...FULL_UNION],
      });
      expect(union.status).toBe(201);
      expect(union.body).toMatchObject({ permissions: [...FULL_UNION] });

      const all = await jsonFetch(url, "/api/admin/admins", "POST", creator.token, {
        username: "ops_super",
        password: "longenough1",
        permissions: ["all"],
      });
      expect(all.status).toBe(201);
      expect(all.body).toMatchObject({ permissions: ["all"] });
    } finally {
      close();
    }
  });
});

describe("R122 (A5-P1) — PATCH /api/admin/admins/:id: the same subset bound on edits", () => {
  it("a scoped editor cannot raise another admin beyond their own envelope (403, row untouched)", async () => {
    const editor = await seedAdmin(["admins", "orders"]);
    const target = await seedAdmin(["orders"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(url, `/api/admin/admins/${target.id}`, "PATCH", editor.token, {
        permissions: ["orders", "finance", "settings"],
      });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "INSUFFICIENT_PERMISSIONS" });

      const [after] = await db
        .select()
        .from(adminUsersTable)
        .where(eq(adminUsersTable.id, target.id));
      expect(after.permissions).toEqual(["orders"]); // untouched
    } finally {
      close();
    }
  });

  it("an editor can set another admin's scopes to any subset of their own (200)", async () => {
    const editor = await seedAdmin(["admins", "orders", "support"]);
    const target = await seedAdmin(["orders"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(url, `/api/admin/admins/${target.id}`, "PATCH", editor.token, {
        permissions: ["support", "orders"],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ permissions: ["support", "orders"] });
    } finally {
      close();
    }
  });

  it('an "all" editor is unrestricted (can even grant "all")', async () => {
    const editor = await seedAdmin(["all"]);
    const target = await seedAdmin(["orders"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(url, `/api/admin/admins/${target.id}`, "PATCH", editor.token, {
        permissions: ["all"],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ permissions: ["all"] });
    } finally {
      close();
    }
  });
});

describe("R122 (A5-P1) — POST /api/admin/admins/:id/enable: re-enable restores held scopes", () => {
  it("an actor without the target's full envelope cannot re-enable a union-holding puppet", async () => {
    const actor = await seedAdmin(["admins", "orders"]);
    const target = await seedAdmin([...FULL_UNION], { isActive: false });
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(
        url,
        `/api/admin/admins/${target.id}/enable`,
        "POST",
        actor.token,
        {},
      );
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "INSUFFICIENT_PERMISSIONS" });

      const [after] = await db
        .select()
        .from(adminUsersTable)
        .where(eq(adminUsersTable.id, target.id));
      expect(after.isActive).toBe(false); // still disabled
    } finally {
      close();
    }
  });

  it('a disabled ["all"] super-admin still requires an "all" actor (the V1-L11 case, now generalized)', async () => {
    const actor = await seedAdmin(["admins", "settings"]);
    const target = await seedAdmin(["all"], { isActive: false });
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(
        url,
        `/api/admin/admins/${target.id}/enable`,
        "POST",
        actor.token,
        {},
      );
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "INSUFFICIENT_PERMISSIONS" });
    } finally {
      close();
    }
  });

  it("an actor holding every target scope re-enables it (200)", async () => {
    const actor = await seedAdmin(["admins", "orders", "finance"]);
    const target = await seedAdmin(["orders", "finance"], { isActive: false });
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(
        url,
        `/api/admin/admins/${target.id}/enable`,
        "POST",
        actor.token,
        {},
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ is_active: true });
    } finally {
      close();
    }
  });

  it('an "all" actor re-enables any target (200)', async () => {
    const actor = await seedAdmin(["all"]);
    const target = await seedAdmin([...FULL_UNION], { isActive: false });
    const { url, close } = await listen(buildApp());
    try {
      const res = await jsonFetch(
        url,
        `/api/admin/admins/${target.id}/enable`,
        "POST",
        actor.token,
        {},
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ is_active: true });
    } finally {
      close();
    }
  });
});
