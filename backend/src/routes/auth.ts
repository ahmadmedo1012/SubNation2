import { LoginBody, RegisterBody } from "@workspace/api-zod";
import { db, otpsTable, referralEventsTable, usersTable } from "@workspace/db";
import { and, eq, gt, lt } from "drizzle-orm";
import { Router } from "express";
import {
  generateReferralCode,
  hashPassword,
  normalizeLibyanPhone,
  verifyPassword,
} from "../lib/crypto";
import { signUserToken, verifyUserToken } from "../lib/jwt";
import { checkLockout, recordFailedAttempt, resetAttempts } from "../lib/lockout";
import { notifyNewUser, notifyPasswordResetRequest } from "../telegram";

const router = Router();

router.post("/register", async (req, res) => {
  const parse = RegisterBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "بيانات غير صالحة" });
  }
  const { phone, password, referral_code } = parse.data;

  const passwordTrimmed = password.trim();
  if (passwordTrimmed.length < 8 || passwordTrimmed.length > 128) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
  }

  const normalizedPhone = normalizeLibyanPhone(phone);
  if (!normalizedPhone) {
    return res
      .status(400)
      .json({ error: "رقم الهاتف غير صالح. يجب أن يبدأ بـ 091 أو 092 أو 093 أو 094" });
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, normalizedPhone))
    .limit(1);
  if (existing) {
    return res.status(409).json({ error: "رقم الهاتف مسجل مسبقاً" });
  }

  let referredById: number | undefined;
  if (referral_code) {
    const [referrer] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.referralCode, referral_code))
      .limit(1);
    if (referrer) referredById = referrer.id;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      phone: normalizedPhone,
      passwordHash: await hashPassword(passwordTrimmed),
      referralCode: generateReferralCode(),
      referredBy: referredById,
      walletBalance: referredById ? "5.00" : "0.00",
    })
    .returning();

  if (referredById && referredById !== user.id) {
    await db
      .insert(referralEventsTable)
      .values({
        referrerId: referredById,
        refereeId: user.id,
        status: "pending",
      })
      .onConflictDoNothing();
  }

  notifyNewUser(normalizedPhone, !!referredById);

  const token = signUserToken({ userId: user.id });
  return res.status(201).json({ user: formatUser(user), token });
});

router.post("/login", async (req, res) => {
  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "بيانات غير صالحة" });
  }
  const { phone, password } = parse.data;
  const normalizedPhone = normalizeLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);

  const { locked, lockedUntil } = await checkLockout(normalizedPhone);
  if (locked) {
    const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
    return res
      .status(429)
      .json({ error: `الحساب مقفل بسبب محاولات فاشلة. حاول بعد ${mins} دقيقة.` });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, normalizedPhone))
    .limit(1);
  if (!user) {
    await recordFailedAttempt(normalizedPhone);
    return res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
  }
  const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedAttempt(normalizedPhone);
    return res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
  }
  // Auto-migrate legacy SHA-256 hash to argon2id
  if (needsRehash) {
    await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(usersTable.id, user.id));
  }
  await resetAttempts(normalizedPhone);

  const token = signUserToken({ userId: user.id });
  return res.json({ user: formatUser(user), token });
});

router.post("/logout", (_req, res) => {
  return res.json({ success: true, message: "تم تسجيل الخروج" });
});

router.post("/forgot-password", async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "رقم الهاتف مطلوب" });
  }
  const normalizedPhone = normalizeLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "رقم الهاتف غير صالح" });
  }

  // Always respond success to prevent user enumeration
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, normalizedPhone))
    .limit(1);

  if (user) {
    const code = Math.floor(100_000 + Math.random() * 900_000).toString();
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await db.insert(otpsTable).values({
      phone: normalizedPhone,
      code,
      expiresAt,
    });
    notifyPasswordResetRequest(normalizedPhone, code);
  }

  return res.json({ success: true, message: "إذا كان الرقم مسجلاً، سيتم إرسال كود التحقق قريباً" });
});

router.post("/reset-password", async (req, res) => {
  const { phone, otp, newPassword } = req.body as {
    phone?: string;
    otp?: string;
    newPassword?: string;
  };
  if (!phone || !otp || !newPassword) {
    return res.status(400).json({ error: "جميع الحقول مطلوبة" });
  }
  const normalizedPhone = normalizeLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);

  const passwordTrimmed = newPassword.trim();
  if (passwordTrimmed.length < 8 || passwordTrimmed.length > 128) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
  }

  const now = new Date();
  const [otpRecord] = await db
    .select()
    .from(otpsTable)
    .where(and(eq(otpsTable.phone, normalizedPhone), gt(otpsTable.expiresAt, now)))
    .orderBy(otpsTable.createdAt)
    .limit(1);
  if (!otpRecord || otpRecord.code !== otp.trim()) {
    return res.status(400).json({ error: "كود التحقق غير صحيح أو منتهي الصلاحية" });
  }

  const [user] = await db
    .update(usersTable)
    .set({ passwordHash: await hashPassword(passwordTrimmed) })
    .where(eq(usersTable.phone, normalizedPhone))
    .returning();

  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  // Delete used OTP and any expired OTPs for this phone
  await db
    .delete(otpsTable)
    .where(and(eq(otpsTable.phone, normalizedPhone), lt(otpsTable.expiresAt, now)));
  await db.delete(otpsTable).where(eq(otpsTable.id, otpRecord.id));
  const token = signUserToken({ userId: user.id });
  return res.json({ success: true, token });
});

router.post("/change-password", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  const payload = verifyUserToken(authHeader.slice(7));
  if (!payload) return res.status(401).json({ error: "جلسة منتهية" });

  const { current_password, new_password } = req.body as {
    current_password?: string;
    new_password?: string;
  };
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "جميع الحقول مطلوبة" });
  }
  const newTrimmed = new_password.trim();
  if (newTrimmed.length < 8) {
    return res.status(400).json({ error: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل" });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  const { valid: currentValid, needsRehash: currentNeedsRehash } = await verifyPassword(
    current_password,
    user.passwordHash,
  );
  if (!currentValid) {
    return res.status(400).json({ error: "كلمة المرور الحالية غير صحيحة" });
  }
  if (currentNeedsRehash) {
    await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(current_password) })
      .where(eq(usersTable.id, user.id));
  }

  await db
    .update(usersTable)
    .set({ passwordHash: await hashPassword(newTrimmed) })
    .where(eq(usersTable.id, payload.userId));

  return res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
});

router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  const payload = verifyUserToken(authHeader.slice(7));
  if (!payload) return res.status(401).json({ error: "جلسة منتهية" });

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1);
  if (!user) return res.status(401).json({ error: "المستخدم غير موجود" });
  return res.json(formatUser(user));
});

router.post("/google", async (req, res) => {
  const { credential } = req.body as { credential?: string };
  if (!credential || typeof credential !== "string") {
    return res.status(400).json({ error: "رمز التحقق مطلوب" });
  }

  let payload: { sub: string; email?: string; name?: string } | null = null;
  try {
    const r = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
    );
    if (!r.ok) throw new Error("invalid token");
    const data = (await r.json()) as any;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && data.aud !== clientId) {
      return res.status(401).json({ error: "رمز Google غير صالح" });
    }
    payload = { sub: data.sub, email: data.email, name: data.name };
  } catch {
    return res.status(401).json({ error: "فشل التحقق من Google. حاول مرة أخرى." });
  }

  if (!payload?.sub) {
    return res.status(401).json({ error: "فشل استرجاع بيانات Google" });
  }

  const [existingByGoogle] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.googleId, payload.sub))
    .limit(1);

  if (existingByGoogle) {
    const token = signUserToken({ userId: existingByGoogle.id });
    return res.json({ user: formatUser(existingByGoogle), token });
  }

  const placeholderPhone = `g_${payload.sub}`;
  const [newUser] = await db
    .insert(usersTable)
    .values({
      phone: placeholderPhone,
      passwordHash: "",
      googleId: payload.sub,
      referralCode: generateReferralCode(),
      walletBalance: "0.00",
    })
    .returning();

  const token = signUserToken({ userId: newUser.id });
  return res.status(201).json({ user: formatUser(newUser), token, needs_phone: true });
});

export function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    phone: user.phone,
    wallet_balance: parseFloat(String(user.walletBalance)),
    loyalty_points: user.loyaltyPoints,
    loyalty_tier: user.loyaltyTier,
    lifetime_spend: parseFloat(String(user.lifetimeSpend)),
    referral_code: user.referralCode,
    created_at: user.createdAt?.toISOString(),
  };
}

export { router as authRouter };
