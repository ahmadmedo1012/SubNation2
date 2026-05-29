import { db, ordersTable, usersTable } from "@workspace/db";
import { count, desc, eq, like } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

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
      // Display name (from Firebase / Telegram / Google) for admin
      // search + visual identification when phone is a placeholder
      // (e.g. tg_<id> for Telegram-first accounts).
      display_name: u.displayName ?? null,
      email: u.email ?? null,
      photo_url: u.photoUrl ?? null,
      // Self-reported auth provider — values: "firebase_phone" |
      // "firebase_google" | "firebase" | "telegram" | "legacy_password"
      auth_provider: u.authProvider ?? "legacy_password",
      // Boolean flags — let the frontend render Provider badges
      // without parsing auth_provider strings.
      has_google: !!u.googleId,
      has_telegram: !!u.telegramId,
      has_firebase: !!u.firebaseUid,
      // Derived from the stored authProvider tag — there's no
      // dedicated column for WhatsApp identity (the phone field
      // itself is the identity, since WhatsApp users have a real
      // 9-digit Libyan local form rather than a placeholder).
      has_whatsapp: u.authProvider === "whatsapp_phone",
      last_auth_at: u.lastAuthAt?.toISOString() ?? null,
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
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));

  const { wallet_balance, wallet_adjustment, loyalty_points, loyalty_tier } = req.body ?? {};
  const updates: Record<string, any> = {};

  if (typeof wallet_adjustment === "number") {
    const current = parseFloat(String(user.walletBalance));
    const next = +(current + wallet_adjustment).toFixed(2);
    if (next < 0) return res.status(400).json(createErrorResponse("الرصيد لا يمكن أن يكون سالباً", ErrorCode.INVALID_DATA));
    updates.walletBalance = String(next);
  } else if (typeof wallet_balance === "number") {
    if (wallet_balance < 0) return res.status(400).json(createErrorResponse("الرصيد لا يمكن أن يكون سالباً", ErrorCode.INVALID_DATA));
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

  if (Object.keys(updates).length === 0) return res.status(400).json(createErrorResponse("لا توجد تعديلات", ErrorCode.INVALID_DATA));

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();

  void writeAuditLog(req, "user.update", "user", id, {
    fields_changed: Object.keys(updates),
  });

  return res.json({
    id: updated.id,
    phone: updated.phone,
    wallet_balance: parseFloat(String(updated.walletBalance)),
    loyalty_points: updated.loyaltyPoints,
    loyalty_tier: updated.loyaltyTier,
  });
});

export { router as adminUsersRouter };
