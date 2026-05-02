import { Router } from "express";
import { db, usersTable, referralEventsTable, walletTopupsTable, ordersTable } from "@workspace/db";
import { eq, desc, and, count, sum } from "drizzle-orm";
import { verifyToken } from "./auth";

const router = Router();
const POINTS_PER_LYD = 100;
const POINTS_PER_REFERRAL = 50;
const TIER_THRESHOLDS = { silver: 500, gold: 2000, platinum: 5000 };

function requireAuth(req: any, res: any): number | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "غير مصرح" }); return null; }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) { res.status(401).json({ error: "جلسة منتهية" }); return null; }
  return payload.userId;
}

function computeTier(lifetimeSpend: number): string {
  if (lifetimeSpend >= TIER_THRESHOLDS.platinum) return "platinum";
  if (lifetimeSpend >= TIER_THRESHOLDS.gold) return "gold";
  if (lifetimeSpend >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

router.get("/", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  const referrals = await db.select().from(referralEventsTable)
    .where(eq(referralEventsTable.referrerId, userId))
    .orderBy(desc(referralEventsTable.createdAt));

  const creditedCount = referrals.filter(r => r.status === "credited").length;
  const pendingCount = referrals.filter(r => r.status === "pending").length;

  const nextTier = computeNextTier(parseFloat(String(user.lifetimeSpend)));

  return res.json({
    points: user.loyaltyPoints,
    tier: user.loyaltyTier,
    lifetime_spend: parseFloat(String(user.lifetimeSpend)),
    referral_code: user.referralCode ?? "",
    referral_link: `${process.env.APP_URL ?? ""}/register?ref=${user.referralCode ?? ""}`,
    referred_by: user.referredBy,
    referrals_total: referrals.length,
    referrals_credited: creditedCount,
    referrals_pending: pendingCount,
    points_value_lyd: (user.loyaltyPoints / POINTS_PER_LYD).toFixed(2),
    next_tier: nextTier,
    tier_thresholds: TIER_THRESHOLDS,
    points_rate: { points_per_referral: POINTS_PER_REFERRAL, points_per_lyd: POINTS_PER_LYD },
  });
});

router.post("/convert-points", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { points } = req.body ?? {};
  const pointsToConvert = parseInt(points);

  if (!pointsToConvert || pointsToConvert < POINTS_PER_LYD) {
    return res.status(400).json({ error: `الحد الأدنى للتحويل ${POINTS_PER_LYD} نقطة` });
  }
  if (pointsToConvert % POINTS_PER_LYD !== 0) {
    return res.status(400).json({ error: `يجب أن تكون النقاط من مضاعفات ${POINTS_PER_LYD}` });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  if (user.loyaltyPoints < pointsToConvert) {
    return res.status(400).json({ error: "رصيد النقاط غير كافٍ" });
  }

  const lydValue = pointsToConvert / POINTS_PER_LYD;
  const newPoints = user.loyaltyPoints - pointsToConvert;
  const newBalance = (parseFloat(String(user.walletBalance)) + lydValue).toFixed(2);

  await db.update(usersTable).set({
    loyaltyPoints: newPoints,
    walletBalance: newBalance,
  }).where(eq(usersTable.id, userId));

  return res.json({
    success: true,
    points_spent: pointsToConvert,
    lyd_credited: lydValue,
    new_points: newPoints,
    new_balance: parseFloat(newBalance),
    message: `تم تحويل ${pointsToConvert} نقطة إلى ${lydValue.toFixed(2)} د.ل`,
  });
});

router.get("/referrals", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const events = await db
    .select({
      id: referralEventsTable.id,
      status: referralEventsTable.status,
      createdAt: referralEventsTable.createdAt,
      creditedAt: referralEventsTable.creditedAt,
      phone: usersTable.phone,
    })
    .from(referralEventsTable)
    .innerJoin(usersTable, eq(usersTable.id, referralEventsTable.refereeId))
    .where(eq(referralEventsTable.referrerId, userId))
    .orderBy(desc(referralEventsTable.createdAt));

  const maskPhone = (p: string) =>
    p.length >= 7 ? p.slice(0, 3) + "****" + p.slice(-3) : p;

  return res.json(
    events.map(e => ({
      id: e.id,
      status: e.status,
      phone_masked: maskPhone(e.phone),
      created_at: e.createdAt.toISOString(),
      credited_at: e.creditedAt?.toISOString() ?? null,
      points_earned: e.status === "credited" ? POINTS_PER_REFERRAL : 0,
    }))
  );
});

function computeNextTier(spend: number): { tier: string; label: string; remaining: number } | null {
  if (spend < TIER_THRESHOLDS.silver) return { tier: "silver", label: "فضي", remaining: TIER_THRESHOLDS.silver - spend };
  if (spend < TIER_THRESHOLDS.gold) return { tier: "gold", label: "ذهبي", remaining: TIER_THRESHOLDS.gold - spend };
  if (spend < TIER_THRESHOLDS.platinum) return { tier: "platinum", label: "بلاتيني", remaining: TIER_THRESHOLDS.platinum - spend };
  return null;
}

export { router as loyaltyRouter, POINTS_PER_REFERRAL, computeTier };
