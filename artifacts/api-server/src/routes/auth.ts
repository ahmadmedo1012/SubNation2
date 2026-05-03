import { Router } from "express";
import { db, usersTable, referralEventsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { notifyNewUser, notifyPasswordResetRequest } from "../telegram";

// ── In-memory OTP store (phone → {code, expires}) ─────────────────────────────
const otpStore = new Map<string, { code: string; expires: number }>();
function purgeExpiredOtps() {
  const now = Date.now();
  for (const [k, v] of otpStore) if (v.expires < now) otpStore.delete(k);
}

const router = Router();

if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET environment variable is required");
const JWT_SECRET: string = process.env.SESSION_SECRET;

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "subnation_salt").digest("hex");
}

function generateReferralCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function generateToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: number } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    return decoded;
  } catch {
    return null;
  }
}

// Libyan mobile: 091/092/093/094 + 7 digits = 10 digits total
// After normalizing (strip leading 0) stored as 9 digits: 91/92/93/94 + 7
const LIBYAN_PREFIXES = ["91", "92", "93", "94"];

function validateLibyanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  // accept 10-digit (with leading 0) or 9-digit (without)
  const normalized = digits.length === 10 && digits.startsWith("0") ? digits.slice(1) : digits;
  if (normalized.length !== 9) return null;
  if (!LIBYAN_PREFIXES.some(p => normalized.startsWith(p))) return null;
  return normalized;
}

router.post("/register", async (req, res) => {
  const parse = RegisterBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "بيانات غير صالحة" });
  }
  const { phone, password, referral_code } = parse.data;

  // Sanitize inputs
  const passwordTrimmed = password.trim();
  if (passwordTrimmed.length < 8 || passwordTrimmed.length > 128) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
  }

  const normalizedPhone = validateLibyanPhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "رقم الهاتف غير صالح. يجب أن يبدأ بـ 091 أو 092 أو 093 أو 094" });
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, normalizedPhone!)).limit(1);
  if (existing) {
    return res.status(409).json({ error: "رقم الهاتف مسجل مسبقاً" });
  }

  let referredById: number | undefined;
  if (referral_code) {
    const [referrer] = await db.select().from(usersTable).where(eq(usersTable.referralCode, referral_code)).limit(1);
    if (referrer) referredById = referrer.id;
  }

  const [user] = await db.insert(usersTable).values({
    phone: normalizedPhone!,
    passwordHash: hashPassword(passwordTrimmed),
    referralCode: generateReferralCode(),
    referredBy: referredById,
    walletBalance: referredById ? "5.00" : "0.00",
  }).returning();

  // Create pending referral event so it gets credited on first approved topup
  if (referredById && referredById !== user.id) {
    await db.insert(referralEventsTable).values({
      referrerId: referredById,
      refereeId: user.id,
      status: "pending",
    }).onConflictDoNothing();
  }

  notifyNewUser(normalizedPhone!, !!referredById);

  const token = generateToken({ userId: user.id });
  return res.status(201).json({ user: formatUser(user), token });
});

router.post("/login", async (req, res) => {
  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "بيانات غير صالحة" });
  }
  const { phone, password } = parse.data;
  const normalizedPhone = validateLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, normalizedPhone)).limit(1);
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
  }

  const token = generateToken({ userId: user.id });
  return res.json({ user: formatUser(user), token });
});

router.post("/logout", (_req, res) => {
  return res.json({ success: true, message: "تم تسجيل الخروج" });
});

// ── Forgot password: generate OTP, notify admin via Telegram ──────────────────
router.post("/forgot-password", async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "رقم الهاتف مطلوب" });
  }
  const normalizedPhone = validateLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "رقم الهاتف غير صالح" });
  }

  // Always respond success to prevent user enumeration
  const [user] = await db.select({ id: usersTable.id })
    .from(usersTable).where(eq(usersTable.phone, normalizedPhone)).limit(1);

  if (user) {
    purgeExpiredOtps();
    const code = Math.floor(100_000 + Math.random() * 900_000).toString();
    otpStore.set(normalizedPhone, { code, expires: Date.now() + 30 * 60_000 });
    notifyPasswordResetRequest(normalizedPhone, code);
  }

  return res.json({ success: true, message: "إذا كان الرقم مسجلاً، سيتم إرسال كود التحقق قريباً" });
});

// ── Reset password: validate OTP, update password hash ────────────────────────
router.post("/reset-password", async (req, res) => {
  const { phone, otp, newPassword } = req.body as {
    phone?: string; otp?: string; newPassword?: string;
  };
  if (!phone || !otp || !newPassword) {
    return res.status(400).json({ error: "جميع الحقول مطلوبة" });
  }
  const normalizedPhone = validateLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);

  const passwordTrimmed = newPassword.trim();
  if (passwordTrimmed.length < 8 || passwordTrimmed.length > 128) {
    return res.status(400).json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
  }

  purgeExpiredOtps();
  const stored = otpStore.get(normalizedPhone);
  if (!stored || stored.code !== otp.trim() || stored.expires < Date.now()) {
    return res.status(400).json({ error: "كود التحقق غير صحيح أو منتهي الصلاحية" });
  }

  const [user] = await db.update(usersTable)
    .set({ passwordHash: hashPassword(passwordTrimmed) })
    .where(eq(usersTable.phone, normalizedPhone))
    .returning();

  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  otpStore.delete(normalizedPhone);
  const token = generateToken({ userId: user.id });
  return res.json({ success: true, token });
});

// ── Change password (authenticated) ──────────────────────────────────────────
router.post("/change-password", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "جلسة منتهية" });

  const { current_password, new_password } = req.body as { current_password?: string; new_password?: string };
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "جميع الحقول مطلوبة" });
  }
  const newTrimmed = new_password.trim();
  if (newTrimmed.length < 6) {
    return res.status(400).json({ error: "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  if (user.passwordHash !== hashPassword(current_password)) {
    return res.status(400).json({ error: "كلمة المرور الحالية غير صحيحة" });
  }

  await db.update(usersTable)
    .set({ passwordHash: hashPassword(newTrimmed) })
    .where(eq(usersTable.id, payload.userId));

  return res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
});

router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "جلسة منتهية" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user) return res.status(401).json({ error: "المستخدم غير موجود" });
  return res.json(formatUser(user));
});

function formatUser(user: typeof usersTable.$inferSelect) {
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

// ── Google OAuth ──────────────────────────────────────────────────────────────

router.post("/google", async (req, res) => {
  const { credential } = req.body as { credential?: string };
  if (!credential || typeof credential !== "string") {
    return res.status(400).json({ error: "رمز التحقق مطلوب" });
  }

  // Verify the ID token using Google's tokeninfo endpoint (no SDK needed)
  let payload: { sub: string; email?: string; name?: string } | null = null;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!r.ok) throw new Error("invalid token");
    const data = await r.json() as any;

    // Validate audience if GOOGLE_CLIENT_ID is set
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

  // Check if user already linked to this Google account
  const [existingByGoogle] = await db.select().from(usersTable)
    .where(eq(usersTable.googleId, payload.sub)).limit(1);

  if (existingByGoogle) {
    const token = generateToken({ userId: existingByGoogle.id });
    return res.json({ user: formatUser(existingByGoogle), token });
  }

  // Create a new account linked to Google (phone = g_<sub> as placeholder)
  const placeholderPhone = `g_${payload.sub}`;
  const [newUser] = await db.insert(usersTable).values({
    phone: placeholderPhone,
    passwordHash: "",
    googleId: payload.sub,
    referralCode: generateReferralCode(),
    walletBalance: "0.00",
  }).returning();

  const token = generateToken({ userId: newUser.id });
  return res.status(201).json({ user: formatUser(newUser), token, needs_phone: true });
});

export { router as authRouter, formatUser };
