import { db, ordersTable, usersTable } from "@workspace/db";
import { count, desc, eq, like } from "drizzle-orm";
import { Router } from "express";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

router.get("/users", requireAdmin, async (req, res) => {
  const { search } = req.query;

  const users =
    search && typeof search === "string"
      ? await db
          .select()
          .from(usersTable)
          .where(like(usersTable.phone, `%${search}%`))
          .orderBy(desc(usersTable.createdAt))
          .limit(100)
      : await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(100);

  const orderCounts = await db
    .select({ userId: ordersTable.userId, count: count() })
    .from(ordersTable)
    .where(eq(ordersTable.status, "completed"))
    .groupBy(ordersTable.userId);
  const orderMap = new Map(orderCounts.map((r) => [r.userId, Number(r.count)]));

  return res.json(
    users.map((u) => ({
      id: u.id,
      phone: u.phone,
      wallet_balance: parseFloat(String(u.walletBalance)),
      loyalty_points: u.loyaltyPoints,
      loyalty_tier: u.loyaltyTier,
      lifetime_spend: parseFloat(String(u.lifetimeSpend)),
      order_count: orderMap.get(u.id) ?? 0,
      referral_code: u.referralCode ?? null,
      created_at: u.createdAt?.toISOString(),
    })),
  );
});

router.patch("/users/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  const { wallet_balance, wallet_adjustment, loyalty_points, loyalty_tier } = req.body ?? {};
  const updates: Record<string, any> = {};

  if (typeof wallet_adjustment === "number") {
    const current = parseFloat(String(user.walletBalance));
    const next = +(current + wallet_adjustment).toFixed(2);
    if (next < 0) return res.status(400).json({ error: "الرصيد لا يمكن أن يكون سالباً" });
    updates.walletBalance = String(next);
  } else if (typeof wallet_balance === "number") {
    if (wallet_balance < 0) return res.status(400).json({ error: "الرصيد لا يمكن أن يكون سالباً" });
    updates.walletBalance = String(wallet_balance.toFixed(2));
  }
  if (typeof loyalty_points === "number" && loyalty_points >= 0) {
    updates.loyaltyPoints = loyalty_points;
  }
  if (
    typeof loyalty_tier === "string" &&
    ["bronze", "silver", "gold", "platinum"].includes(loyalty_tier)
  ) {
    updates.loyaltyTier = loyalty_tier;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "لا توجد تعديلات" });

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();
  return res.json({
    id: updated.id,
    phone: updated.phone,
    wallet_balance: parseFloat(String(updated.walletBalance)),
    loyalty_points: updated.loyaltyPoints,
    loyalty_tier: updated.loyaltyTier,
  });
});

export { router as adminUsersRouter };
