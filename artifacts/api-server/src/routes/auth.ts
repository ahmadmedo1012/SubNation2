import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { RegisterBody, LoginBody } from "@workspace/api-zod";

const router = Router();

const JWT_SECRET = process.env.SESSION_SECRET ?? "subnation-secret-key-change-in-prod";

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

router.post("/register", async (req, res) => {
  const parse = RegisterBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "بيانات غير صالحة" });
  }
  const { phone, password, referral_code } = parse.data;

  const normalizedPhone = phone.replace(/\D/g, "").slice(-9);
  if (normalizedPhone.length < 9) {
    return res.status(400).json({ error: "رقم الهاتف غير صالح" });
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, normalizedPhone)).limit(1);
  if (existing) {
    return res.status(409).json({ error: "رقم الهاتف مسجل مسبقاً" });
  }

  let referredById: number | undefined;
  if (referral_code) {
    const [referrer] = await db.select().from(usersTable).where(eq(usersTable.referralCode, referral_code)).limit(1);
    if (referrer) referredById = referrer.id;
  }

  const [user] = await db.insert(usersTable).values({
    phone: normalizedPhone,
    passwordHash: hashPassword(password),
    referralCode: generateReferralCode(),
    referredBy: referredById,
    walletBalance: referredById ? "5.00" : "0.00",
  }).returning();

  const token = generateToken({ userId: user.id });
  return res.status(201).json({ user: formatUser(user), token });
});

router.post("/login", async (req, res) => {
  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "بيانات غير صالحة" });
  }
  const { phone, password } = parse.data;
  const normalizedPhone = phone.replace(/\D/g, "").slice(-9);

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

export { router as authRouter, formatUser };
