import { Router } from "express";
import { db, usersTable, referralEventsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { ErrorCode, createErrorResponse } from "../lib/errors";

const router = Router();

export const POINTS_PER_LYD = 100;
export const POINTS_PER_REFERRAL = 50;
export const TIER_THRESHOLDS = { silver: 500, gold: 2000, platinum: 5000 } as const;

export function computeTier(lifetimeSpend: number): string {
  if (lifetimeSpend >= TIER_THRESHOLDS.platinum) return "platinum";
  if (lifetimeSpend >= TIER_THRESHOLDS.gold) return "gold";
  if (lifetimeSpend >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

function computeNextTier(spend: number): { tier: string; label: string; remaining: number } | null {
  if (spend < TIER_THRESHOLDS.silver)
    return { tier: "silver", label: "فضي", remaining: TIER_THRESHOLDS.silver - spend };
  if (spend < TIER_THRESHOLDS.gold)
    return { tier: "gold", label: "ذهبي", remaining: TIER_THRESHOLDS.gold - spend };
  if (spend < TIER_THRESHOLDS.platinum)
    return { tier: "platinum", label: "بلاتيني", remaining: TIER_THRESHOLDS.platinum - spend };
  return null;
}

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));

  const referrals = await db
    .select()
    .from(referralEventsTable)
    .where(eq(referralEventsTable.referrerId, userId))
    .orderBy(desc(referralEventsTable.createdAt));

  const creditedCount = referrals.filter((r) => r.status === "credited").length;
  const pendingCount = referrals.filter((r) => r.status === "pending").length;

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

router.post("/convert-points", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const { points } = req.body ?? {};
  const pointsToConvert = parseInt(points);

  if (!pointsToConvert || pointsToConvert < POINTS_PER_LYD) {
    return res.status(400).json(createErrorResponse(`الحد الأدنى للتحويل ${POINTS_PER_LYD} نقطة`, ErrorCode.INVALID_DATA));
  }
  if (pointsToConvert % POINTS_PER_LYD !== 0) {
    return res.status(400).json(createErrorResponse(`يجب أن تكون النقاط من مضاعفات ${POINTS_PER_LYD}`, ErrorCode.INVALID_DATA));
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));

  if (user.loyaltyPoints < pointsToConvert) {
    return res.status(400).json(createErrorResponse("رصيد النقاط غير كافٍ", ErrorCode.INVALID_DATA));
  }

  const lydValue = pointsToConvert / POINTS_PER_LYD;
  const newPoints = user.loyaltyPoints - pointsToConvert;
  const newBalance = (parseFloat(String(user.walletBalance)) + lydValue).toFixed(2);

  await db
    .update(usersTable)
    .set({
      loyaltyPoints: newPoints,
      walletBalance: newBalance,
    })
    .where(eq(usersTable.id, userId));

  return res.json({
    success: true,
    points_spent: pointsToConvert,
    lyd_credited: lydValue,
    new_points: newPoints,
    new_balance: parseFloat(newBalance),
    message: `تم تحويل ${pointsToConvert} نقطة إلى ${lydValue.toFixed(2)} د.ل`,
  });
});

router.get("/referrals", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

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

  const maskPhone = (p: string) => (p.length >= 7 ? p.slice(0, 3) + "****" + p.slice(-3) : p);

  return res.json(
    events.map((e) => ({
      id: e.id,
      status: e.status,
      phone_masked: maskPhone(e.phone),
      created_at: e.createdAt.toISOString(),
      credited_at: e.creditedAt?.toISOString() ?? null,
      points_earned: e.status === "credited" ? POINTS_PER_REFERRAL : 0,
    })),
  );
});

export { router as loyaltyRouter };
