import { adminUsersTable, db } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { hashPassword } from "../../lib/crypto";
import { intParam } from "../../lib/http";
import { ALL_SCOPES, PERMISSION_SCOPES } from "../../lib/permissions";
import { type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";

const router = Router();

const VALID_SCOPES = new Set<string>([PERMISSION_SCOPES.ALL, ...ALL_SCOPES]);

function sanitizePermissions(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") return null;
    const v = item.trim().toLowerCase();
    if (!VALID_SCOPES.has(v)) return null;
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * GET /api/admin/admins
 * List every admin account (active + disabled). Sorted by id asc so
 * the original/super admin always renders first.
 */
router.get("/", async (_req, res) => {
  const rows = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      displayName: adminUsersTable.displayName,
      role: adminUsersTable.role,
      permissions: adminUsersTable.permissions,
      isActive: adminUsersTable.isActive,
      totpEnabled: adminUsersTable.totpEnabled,
      createdAt: adminUsersTable.createdAt,
    })
    .from(adminUsersTable)
    .orderBy(adminUsersTable.id);

  return res.json(
    rows.map((r) => ({
      id: r.id,
      username: r.username,
      display_name: r.displayName,
      role: r.role,
      permissions: r.permissions ?? [],
      is_active: r.isActive,
      totp_enabled: r.totpEnabled,
      created_at: r.createdAt?.toISOString(),
    })),
  );
});

/**
 * POST /api/admin/admins
 * Create a new admin account. The creator MUST have the "admins" scope
 * (enforced at the parent router via requirePermission). New accounts
 * are active by default and have totp_enabled=false; the new admin
 * sets up 2FA themselves on first login.
 */
router.post("/", async (req, res) => {
  const { username, password, display_name, permissions, role } = (req.body ?? {}) as {
    username?: string;
    password?: string;
    display_name?: string;
    permissions?: unknown;
    role?: string;
  };

  if (!username || typeof username !== "string" || username.trim().length < 3) {
    return res.status(400).json({ error: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل" });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
  }
  const cleanPerms = sanitizePermissions(permissions);
  if (cleanPerms === null || cleanPerms.length === 0) {
    return res.status(400).json({ error: "يجب اختيار صلاحية واحدة على الأقل من القائمة" });
  }

  try {
    const [created] = await db
      .insert(adminUsersTable)
      .values({
        username: username.trim(),
        passwordHash: await hashPassword(password),
        displayName: (display_name ?? username).trim() || username.trim(),
        role: role && typeof role === "string" ? role : "admin",
        permissions: cleanPerms,
        isActive: true,
      })
      .returning();

    void writeAuditLog(req, "admin.created", "admin_user", created.id, {
      username: created.username,
      permissions: cleanPerms,
    });

    return res.status(201).json({
      id: created.id,
      username: created.username,
      display_name: created.displayName,
      role: created.role,
      permissions: created.permissions ?? [],
      is_active: created.isActive,
      totp_enabled: created.totpEnabled,
      created_at: created.createdAt?.toISOString(),
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return res.status(409).json({ error: "اسم المستخدم مستخدم بالفعل" });
    }
    throw err;
  }
});

/**
 * PATCH /api/admin/admins/:id
 * Update display name + permissions of another admin. Username is NOT
 * editable from here — admins change their own usernames via the
 * self-service /api/admin/profile flow.
 *
 * Cannot edit yourself via this endpoint (use /profile + /change-password).
 */
router.patch("/:id", async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const adminReq = req as unknown as AdminAuthenticatedRequest;
  if (adminReq.adminId === id) {
    return res
      .status(400)
      .json({ error: "لا يمكنك تعديل صلاحيات حسابك من هنا. استخدم صفحة 'حسابي'." });
  }

  const { display_name, permissions } = (req.body ?? {}) as {
    display_name?: string;
    permissions?: unknown;
  };

  const updates: { displayName?: string; permissions?: string[] } = {};
  if (display_name !== undefined) {
    if (typeof display_name !== "string" || display_name.trim().length === 0) {
      return res.status(400).json({ error: "الاسم الظاهر مطلوب" });
    }
    updates.displayName = display_name.trim();
  }
  if (permissions !== undefined) {
    const cleanPerms = sanitizePermissions(permissions);
    if (cleanPerms === null || cleanPerms.length === 0) {
      return res.status(400).json({ error: "يجب اختيار صلاحية واحدة على الأقل" });
    }
    updates.permissions = cleanPerms;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "لا توجد حقول للتحديث" });
  }

  // Last-admin guard: if removing the "admins" scope from this user,
  // make sure at least one OTHER active admin still has it (or "all").
  if (updates.permissions && !updates.permissions.includes("admins") && !updates.permissions.includes("all")) {
    const [{ count: stillCount } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminUsersTable)
      .where(
        and(
          eq(adminUsersTable.isActive, true),
          ne(adminUsersTable.id, id),
          sql`(${adminUsersTable.permissions} @> '["admins"]'::jsonb OR ${adminUsersTable.permissions} @> '["all"]'::jsonb)`,
        ),
      );
    if (Number(stillCount) === 0) {
      return res.status(400).json({
        error: "لا يمكن سحب صلاحية إدارة المسؤولين من آخر مسؤول يملكها",
      });
    }
  }

  const [updated] = await db
    .update(adminUsersTable)
    .set(updates)
    .where(eq(adminUsersTable.id, id))
    .returning();

  if (!updated) {
    return res.status(404).json({ error: "الحساب غير موجود" });
  }

  void writeAuditLog(req, "admin.updated", "admin_user", id, {
    fields_changed: Object.keys(updates),
  });

  return res.json({
    id: updated.id,
    username: updated.username,
    display_name: updated.displayName,
    role: updated.role,
    permissions: updated.permissions ?? [],
    is_active: updated.isActive,
    totp_enabled: updated.totpEnabled,
  });
});

/**
 * POST /api/admin/admins/:id/disable
 * POST /api/admin/admins/:id/enable
 *
 * Soft-toggle is_active. Disabled admins fail login + the requireAdmin
 * middleware (current sessions invalidate on the next request) but
 * their audit trail stays intact for security review.
 *
 * Cannot disable yourself. Cannot disable the last active admin with
 * the "admins" scope.
 */
router.post("/:id/disable", async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const adminReq = req as unknown as AdminAuthenticatedRequest;
  if (adminReq.adminId === id) {
    return res.status(400).json({ error: "لا يمكنك تعطيل حسابك" });
  }

  // Last-active-admin-with-admins-scope guard.
  const [{ count: othersCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adminUsersTable)
    .where(
      and(
        eq(adminUsersTable.isActive, true),
        ne(adminUsersTable.id, id),
        sql`(${adminUsersTable.permissions} @> '["admins"]'::jsonb OR ${adminUsersTable.permissions} @> '["all"]'::jsonb)`,
      ),
    );
  if (Number(othersCount) === 0) {
    return res.status(400).json({
      error: "لا يمكن تعطيل آخر مسؤول قادر على إدارة الحسابات",
    });
  }

  const [updated] = await db
    .update(adminUsersTable)
    .set({ isActive: false })
    .where(eq(adminUsersTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "الحساب غير موجود" });

  void writeAuditLog(req, "admin.disabled", "admin_user", id, {});
  return res.json({ id: updated.id, is_active: updated.isActive });
});

router.post("/:id/enable", async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [updated] = await db
    .update(adminUsersTable)
    .set({ isActive: true })
    .where(eq(adminUsersTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "الحساب غير موجود" });

  void writeAuditLog(req, "admin.enabled", "admin_user", id, {});
  return res.json({ id: updated.id, is_active: updated.isActive });
});

/**
 * GET /api/admin/admins/scopes
 * Returns the permission catalog so the frontend can render checkboxes
 * without hardcoding the list (single source of truth = backend).
 */
router.get("/scopes", async (_req, res) => {
  return res.json({
    scopes: ALL_SCOPES.map((scope) => ({ id: scope, label: scopeLabel(scope) })),
  });
});

function scopeLabel(scope: string): string {
  switch (scope) {
    case "orders":
      return "الطلبات";
    case "finance":
      return "المعاملات المالية";
    case "inventory":
      return "المخزون والمنتجات";
    case "support":
      return "الدعم الفني";
    case "users":
      return "المستخدمون والإحالات";
    case "admins":
      return "إدارة المسؤولين";
    case "settings":
      return "إعدادات النظام";
    default:
      return scope;
  }
}

export { router as adminAdminsRouter };
