import { Router } from "express";
import { db, usersTable, walletTopupsTable, ordersTable, productsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { verifyToken } from "./auth";
import { CreateTopupBody } from "@workspace/api-zod";
import { notifyNewTopup } from "../telegram";

const router = Router();

function requireAuth(req: any, res: any): number | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "غير مصرح" });
    return null;
  }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "جلسة منتهية" });
    return null;
  }
  return payload.userId;
}

router.get("/", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return res.status(401).json({ error: "المستخدم غير موجود" });

  const [pendingResult] = await db.select({ count: count() }).from(walletTopupsTable)
    .where(eq(walletTopupsTable.userId, userId));

  const recentOrders = await db.select({
    order: ordersTable,
    productName: productsTable.name,
    productImageUrl: productsTable.imageUrl,
  }).from(ordersTable)
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt))
    .limit(5);

  const pendingTopups = await db.select({ count: count() }).from(walletTopupsTable)
    .where(eq(walletTopupsTable.userId, userId));

  const pendingCount = (await db.select({ count: count() }).from(walletTopupsTable)
    .where(eq(walletTopupsTable.status, "pending")))[0]?.count ?? 0;

  return res.json({
    balance: parseFloat(String(user.walletBalance)),
    loyalty_points: user.loyaltyPoints,
    loyalty_tier: user.loyaltyTier,
    pending_topups_count: Number(pendingCount),
    recent_orders: recentOrders.map(r => ({
      id: r.order.id,
      order_code: r.order.orderCode,
      product_id: r.order.productId,
      product_name: r.productName ?? "",
      product_image_url: r.productImageUrl ?? null,
      amount: parseFloat(String(r.order.amount)),
      status: r.order.status,
      delivered_email: r.order.deliveredEmail ?? null,
      delivered_password: r.order.deliveredPassword ?? null,
      delivered_extra_details: r.order.deliveredExtraDetails ?? null,
      delivered_usage_terms: r.order.deliveredUsageTerms ?? null,
      delivered_at: r.order.deliveredAt?.toISOString() ?? null,
      created_at: r.order.createdAt?.toISOString(),
    })),
  });
});

router.get("/topups", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const topups = await db.select().from(walletTopupsTable)
    .where(eq(walletTopupsTable.userId, userId))
    .orderBy(desc(walletTopupsTable.createdAt));

  return res.json(topups.map(formatTopup));
});

router.post("/topups", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parse = CreateTopupBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const { amount, payment_network, sender_phone, payment_reference } = parse.data;

  if (amount <= 0 || amount > 10000) {
    return res.status(400).json({ error: "قيمة الشحن غير صالحة" });
  }

  const [topup] = await db.insert(walletTopupsTable).values({
    userId,
    amount: String(amount),
    paymentNetwork: payment_network,
    senderPhone: sender_phone,
    paymentReference: payment_reference ?? null,
    status: "pending",
  }).returning();

  const [currentUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (currentUser) notifyNewTopup(currentUser.phone, amount, payment_network);

  return res.status(201).json(formatTopup(topup));
});

function formatTopup(topup: typeof walletTopupsTable.$inferSelect) {
  return {
    id: topup.id,
    amount: parseFloat(String(topup.amount)),
    payment_network: topup.paymentNetwork,
    sender_phone: topup.senderPhone ?? null,
    payment_reference: topup.paymentReference ?? null,
    status: topup.status,
    admin_note: topup.adminNote ?? null,
    created_at: topup.createdAt?.toISOString(),
    reviewed_at: topup.reviewedAt?.toISOString() ?? null,
  };
}

export { router as walletRouter };
