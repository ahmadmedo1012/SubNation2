import { AdminLoginBody } from "@workspace/api-zod";
import { adminUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { generateSecret, generateURI, verifySync } from "otplib";
import { hashPassword, verifyPassword } from "../../lib/crypto";
import { ADMIN_JWT_SECRET, signAdminToken } from "../../lib/jwt";
import { checkLockout, recordFailedAttempt, resetAttempts } from "../../lib/lockout";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

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
    return res.json({ token, display_name: admin.displayName });
  } catch {
    return res.status(401).json({ error: "جلسة غير صالحة أو منتهية الصلاحية" });
  }
});

router.get("/session", requireAdmin, async (req, res) => {
  const adminId = (req as any).adminId as number;
  const [admin] = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      displayName: adminUsersTable.displayName,
      role: adminUsersTable.role,
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
  });
});

router.post("/2fa/setup", requireAdmin, async (req, res) => {
  const adminId = (req as any).adminId;
  const secret = generateSecret();
  const otpauth = generateURI({ label: `admin_${adminId}`, issuer: "SubNation", secret });

  await db
    .update(adminUsersTable)
    .set({ totpSecret: secret, totpEnabled: false })
    .where(eq(adminUsersTable.id, adminId));

  return res.json({ secret, otpauth_url: otpauth });
});

router.post("/2fa/verify-setup", requireAdmin, async (req, res) => {
  const adminId = (req as any).adminId;
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

  return res.json({ success: true, message: "تم تفعيل المصادقة الثنائية بنجاح" });
});

export { router as adminAuthRouter };
