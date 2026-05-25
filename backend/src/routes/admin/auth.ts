import { AdminLoginBody } from "@workspace/api-zod";
import { adminUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type CookieOptions } from "express";
import jwt from "jsonwebtoken";
import { generateSecret, generateURI, verifySync } from "otplib";
import { writeAuditLog } from "../../lib/audit";
import { hashPassword, verifyPassword } from "../../lib/crypto";
import { ADMIN_JWT_SECRET, signAdminToken } from "../../lib/jwt";
import { checkLockout, recordFailedAttempt, resetAttempts } from "../../lib/lockout";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";

const router = Router();

/**
 * Admin session cookie shape — same security profile as the user
 * `auth_token` cookie (httpOnly, secure-in-prod, SameSite=Lax) but a
 * tighter 7-day lifetime reflecting admin privilege.
 *
 * Setting this cookie on /login and /login/verify-2fa is what makes
 * admin sessions survive a page refresh: the browser sends the cookie
 * automatically on every request, so the SPA's `requireAdmin`
 * middleware succeeds without the frontend having to reattach an
 * Authorization header from React state (which is wiped on refresh).
 */
const ADMIN_COOKIE_NAME = "admin_token";
const ADMIN_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: "/",
};

router.post("/login", async (req, res) => {
  const parse = AdminLoginBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const { username, password } = parse.data;

  const lockoutKey = `admin:${username}`;
  const { locked, lockedUntil } = await checkLockout(lockoutKey);
  if (locked) {
    const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
    return res
      .status(429)
      .json({ error: `الحساب مقفل بسبب محاولات فاشلة. حاول بعد ${mins} دقيقة.` });
  }

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.username, username))
    .limit(1);
  if (!admin) {
    await recordFailedAttempt(lockoutKey);
    return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
  }
  const { valid, needsRehash } = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    await recordFailedAttempt(lockoutKey);
    return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
  }
  if (needsRehash) {
    await db
      .update(adminUsersTable)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(adminUsersTable.id, admin.id));
  }
  await resetAttempts(lockoutKey);

  if (admin.totpEnabled && admin.totpSecret) {
    const tempToken = signAdminToken({ adminId: admin.id, role: admin.role, isTemp: true });
    return res.json({ requires_2fa: true, temp_token: tempToken });
  }

  const token = signAdminToken({ adminId: admin.id, role: admin.role });
  res.cookie(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
  return res.json({ token, display_name: admin.displayName });
});

router.post("/login/verify-2fa", async (req, res) => {
  const { temp_token, code } = req.body ?? {};
  if (!temp_token || !code) return res.status(400).json({ error: "بيانات غير مكتملة" });

  try {
    const decoded = jwt.verify(temp_token, ADMIN_JWT_SECRET) as {
      adminId?: number;
      isTemp?: boolean;
    };

    if (!decoded.isTemp || !decoded.adminId) {
      return res.status(401).json({ error: "جلسة غير صالحة" });
    }

    const [admin] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, decoded.adminId))
      .limit(1);

    if (!admin || !admin.totpEnabled || !admin.totpSecret) {
      return res.status(401).json({ error: "بيانات الاعتماد غير صالحة" });
    }

    const isValid = verifySync({ token: code, secret: admin.totpSecret });
    if (!isValid) {
      return res.status(401).json({ error: "رمز التحقق غير صحيح" });
    }

    const token = signAdminToken({ adminId: admin.id, role: admin.role });
    res.cookie(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
    return res.json({ token, display_name: admin.displayName });
  } catch {
    return res.status(401).json({ error: "جلسة غير صالحة أو منتهية الصلاحية" });
  }
});

/**
 * GET /api/admin/probe — 200-always cookie-presence probe.
 *
 * Mirrors the public /api/auth/probe pattern: lets the SPA detect
 * whether the httpOnly admin_token cookie carries a live session
 * without producing a console-visible 401 on the unauthenticated
 * path. Used by the frontend AuthProvider on cold boot to hydrate
 * the admin session across page refreshes.
 *
 *  - cookie present + valid → 200 + { authenticated: true, admin: {…} }
 *  - cookie missing/invalid → 200 + { authenticated: false }
 */
router.get("/probe", async (req, res) => {
  res.set("Cache-Control", "private, max-age=0, no-store");

  const token =
    req.cookies?.[ADMIN_COOKIE_NAME] ||
    req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(200).json({ authenticated: false });
  }

  let decoded: { adminId?: number };
  try {
    decoded = jwt.verify(token, ADMIN_JWT_SECRET) as { adminId?: number };
  } catch {
    return res.status(200).json({ authenticated: false });
  }
  if (!decoded.adminId) {
    return res.status(200).json({ authenticated: false });
  }

  const [admin] = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      displayName: adminUsersTable.displayName,
      role: adminUsersTable.role,
      totpEnabled: adminUsersTable.totpEnabled,
    })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, decoded.adminId))
    .limit(1);

  if (!admin) {
    return res.status(200).json({ authenticated: false });
  }

  return res.status(200).json({
    authenticated: true,
    admin: {
      id: admin.id,
      username: admin.username,
      display_name: admin.displayName,
      role: admin.role,
      totp_enabled: admin.totpEnabled,
    },
  });
});

router.get("/session", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const [admin] = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      displayName: adminUsersTable.displayName,
      role: adminUsersTable.role,
      totpEnabled: adminUsersTable.totpEnabled,
      createdAt: adminUsersTable.createdAt,
    })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);

  if (!admin) {
    return res.status(401).json({ error: "جلسة الإدارة غير صالحة" });
  }

  return res.json({
    id: admin.id,
    username: admin.username,
    display_name: admin.displayName,
    role: admin.role,
    totp_enabled: admin.totpEnabled,
    created_at: admin.createdAt?.toISOString(),
  });
});

/**
 * POST /api/admin/logout — clears the admin_token cookie + emits
 * an audit log entry. Idempotent: clearing an already-cleared cookie
 * is fine, the response is always 200.
 */
router.post("/logout", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  res.clearCookie(ADMIN_COOKIE_NAME, { ...ADMIN_COOKIE_OPTIONS, maxAge: undefined });
  void writeAuditLog(req, "admin.logout", "admin_user", adminId, {});
  return res.json({ success: true });
});

/**
 * POST /api/admin/change-password — old-password-gated rotation.
 *
 * Security:
 *   - Requires a valid admin session (httpOnly cookie) + the old
 *     password as additional re-authentication.
 *   - Rate-limited via the same lockout helper as login (so a
 *     compromised session can't brute-force the old password).
 *   - Audit-logged on every attempt + success.
 *   - Does NOT clear the existing session cookie — the operator
 *     stays logged in on the same device. They can revoke other
 *     sessions explicitly via /logout if needed.
 */
router.post("/change-password", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const { current_password, new_password } = (req.body ?? {}) as {
    current_password?: string;
    new_password?: string;
  };

  if (!current_password || !new_password) {
    return res.status(400).json({ error: "كلمة المرور الحالية والجديدة مطلوبتان" });
  }
  if (new_password.length < 8) {
    return res
      .status(400)
      .json({ error: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل" });
  }

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);
  if (!admin) {
    return res.status(401).json({ error: "جلسة الإدارة غير صالحة" });
  }

  const lockoutKey = `admin-pwchange:${admin.username}`;
  const { locked, lockedUntil } = await checkLockout(lockoutKey);
  if (locked) {
    const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
    return res
      .status(429)
      .json({ error: `محاولات كثيرة. حاول بعد ${mins} دقيقة.` });
  }

  const { valid } = await verifyPassword(current_password, admin.passwordHash);
  if (!valid) {
    await recordFailedAttempt(lockoutKey);
    void writeAuditLog(req, "admin.password_change_failed", "admin_user", adminId, {
      reason: "wrong_current_password",
    });
    return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
  }
  await resetAttempts(lockoutKey);

  await db
    .update(adminUsersTable)
    .set({ passwordHash: await hashPassword(new_password) })
    .where(eq(adminUsersTable.id, adminId));

  void writeAuditLog(req, "admin.password_changed", "admin_user", adminId, {});
  return res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
});

/**
 * PATCH /api/admin/profile — change username + display_name.
 *
 * Security:
 *   - Requires re-entry of the current password to authorize the
 *     change (defence-in-depth even though the session cookie is
 *     already valid — username changes are a high-leverage action).
 *   - Username uniqueness enforced at DB level (UNIQUE constraint);
 *     SQLSTATE 23505 → 409.
 *   - Audit-logged.
 */
router.patch("/profile", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const { username, display_name, current_password } = (req.body ?? {}) as {
    username?: string;
    display_name?: string;
    current_password?: string;
  };

  if (!current_password) {
    return res
      .status(400)
      .json({ error: "كلمة المرور الحالية مطلوبة لتأكيد التغيير" });
  }
  if (!username && !display_name) {
    return res.status(400).json({ error: "لا توجد حقول للتحديث" });
  }
  if (username !== undefined) {
    if (typeof username !== "string" || username.trim().length < 3) {
      return res
        .status(400)
        .json({ error: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل" });
    }
    if (username.trim().length > 100) {
      return res.status(400).json({ error: "اسم المستخدم طويل جداً" });
    }
  }

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);
  if (!admin) {
    return res.status(401).json({ error: "جلسة الإدارة غير صالحة" });
  }

  const { valid } = await verifyPassword(current_password, admin.passwordHash);
  if (!valid) {
    void writeAuditLog(req, "admin.profile_change_failed", "admin_user", adminId, {
      reason: "wrong_current_password",
    });
    return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
  }

  const updates: Partial<typeof adminUsersTable.$inferInsert> = {};
  if (username !== undefined) updates.username = username.trim();
  if (display_name !== undefined) updates.displayName = display_name.trim();

  try {
    const [updated] = await db
      .update(adminUsersTable)
      .set(updates)
      .where(eq(adminUsersTable.id, adminId))
      .returning();

    void writeAuditLog(req, "admin.profile_changed", "admin_user", adminId, {
      fields_changed: Object.keys(updates),
    });

    return res.json({
      id: updated.id,
      username: updated.username,
      display_name: updated.displayName,
      role: updated.role,
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

router.post("/2fa/setup", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const secret = generateSecret();
  const otpauth = generateURI({ label: `admin_${adminId}`, issuer: "SubNation", secret });

  await db
    .update(adminUsersTable)
    .set({ totpSecret: secret, totpEnabled: false })
    .where(eq(adminUsersTable.id, adminId));

  return res.json({ secret, otpauth_url: otpauth });
});

router.post("/2fa/verify-setup", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: "الرمز مطلوب" });

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);

  if (!admin || !admin.totpSecret) {
    return res.status(400).json({ error: "إعداد 2FA غير موجود" });
  }

  const isValid = verifySync({ token: code, secret: admin.totpSecret });
  if (!isValid) {
    return res.status(401).json({ error: "رمز التحقق غير صحيح" });
  }

  await db
    .update(adminUsersTable)
    .set({ totpEnabled: true })
    .where(eq(adminUsersTable.id, adminId));

  void writeAuditLog(req, "admin.totp_enabled", "admin_user", adminId, {});
  return res.json({ success: true, message: "تم تفعيل المصادقة الثنائية بنجاح" });
});

export { router as adminAuthRouter };
