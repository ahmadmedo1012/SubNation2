import { CreateTopupBody } from "@workspace/api-zod";
import { db, ordersTable, productsTable, usersTable, walletTopupsTable } from "@workspace/db";
import { and, count, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { normalizeLibyanPhone } from "../lib/crypto";
import { safeDecrypt } from "../lib/encryption";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { notifyNewTopup } from "../telegram";

const router = Router();

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return res.status(401).json({ error: "المستخدم غير موجود" });

  const recentOrders = await db
    .select({
      order: ordersTable,
      productName: productsTable.name,
      productImageUrl: productsTable.imageUrl,
    })
    .from(ordersTable)
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt))
    .limit(5);

  // Count only THIS user's pending topups
  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(walletTopupsTable)
    .where(and(eq(walletTopupsTable.userId, userId), eq(walletTopupsTable.status, "pending")));

  return res.json({
    balance: parseFloat(String(user.walletBalance)),
    loyalty_points: user.loyaltyPoints,
    loyalty_tier: user.loyaltyTier,
    pending_topups_count: Number(pendingCount),
    recent_orders: recentOrders.map((r) => ({
      id: r.order.id,
      order_code: r.order.orderCode,
      product_id: r.order.productId,
      product_name: r.productName ?? "",
      product_image_url: r.productImageUrl ?? null,
      amount: parseFloat(String(r.order.amount)),
      status: r.order.status,
      delivered_email: r.order.deliveredEmail ?? null,
      delivered_password: safeDecrypt(r.order.deliveredPassword),
      delivered_extra_details: r.order.deliveredExtraDetails ?? null,
      delivered_usage_terms: r.order.deliveredUsageTerms ?? null,
      delivered_at: r.order.deliveredAt?.toISOString() ?? null,
      created_at: r.order.createdAt?.toISOString(),
    })),
  });
});

router.get("/topups", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const topups = await db
    .select()
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.userId, userId))
    .orderBy(desc(walletTopupsTable.createdAt));

  return res.json(topups.map(formatTopup));
});

router.post("/topups", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const parse = CreateTopupBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const {
    amount,
    payment_method,
    payment_network,
    sender_phone,
    sender_account,
    payment_reference,
  } = parse.data;

  if (amount <= 0 || amount > 10000) {
    return res.status(400).json({ error: "قيمة الشحن غير صالحة" });
  }

  const method = payment_method ?? "mobile_transfer";

  if (method === "mobile_transfer" && !payment_network) {
    return res.status(400).json({ error: "يرجى اختيار الشبكة" });
  }
  if (method === "lypay" && !sender_account) {
    return res.status(400).json({ error: "يرجى إدخال رقم حساب المُرسل" });
  }

  if (method === "mobile_transfer" && sender_phone) {
    if (!normalizeLibyanPhone(sender_phone)) {
      return res.status(400).json({ error: "رقم هاتف المُرسل غير صالح" });
    }
  }

  // Anti-abuse: max 3 pending requests per user
  const MAX_PENDING = 3;
  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(walletTopupsTable)
    .where(and(eq(walletTopupsTable.userId, userId), eq(walletTopupsTable.status, "pending")));

  if (Number(pendingCount) >= MAX_PENDING) {
    return res.status(429).json({
      error: "لديك طلبات قيد المراجعة، يرجى الانتظار حتى يتم اعتمادها",
      pending_count: Number(pendingCount),
      limit: MAX_PENDING,
    });
  }

  const [{ rejectedCount }] = await db
    .select({ rejectedCount: count() })
    .from(walletTopupsTable)
    .where(and(eq(walletTopupsTable.userId, userId), eq(walletTopupsTable.status, "rejected")));

  let initialStatus = "pending";
  let initialAdminNote = null;

  // Recharge Verification Heuristic: Auto-reject serial abusers
  if (Number(rejectedCount) >= 3) {
    initialStatus = "rejected";
    initialAdminNote = "رفض تلقائي: تاريخ من الطلبات المرفوضة المتكررة (احتيال محتمل)";
  }

  const [topup] = await db
    .insert(walletTopupsTable)
    .values({
      userId,
      amount: String(amount),
      paymentMethod: method,
      paymentNetwork: payment_network ?? null,
      senderPhone: sender_phone ?? null,
      senderAccount: sender_account ?? null,
      paymentReference: payment_reference ?? null,
      status: initialStatus as any,
      adminNote: initialAdminNote,
    })
    .returning();

  const [currentUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (currentUser)
    notifyNewTopup(
      currentUser.phone,
      amount,
      method === "lypay" ? "LyPay" : (payment_network ?? ""),
    );

  return res.status(201).json(formatTopup(topup));
});

function formatTopup(topup: typeof walletTopupsTable.$inferSelect) {
  return {
    id: topup.id,
    amount: parseFloat(String(topup.amount)),
    payment_method: topup.paymentMethod,
    payment_network: topup.paymentNetwork ?? null,
    sender_phone: topup.senderPhone ?? null,
    sender_account: topup.senderAccount ?? null,
    payment_reference: topup.paymentReference ?? null,
    status: topup.status,
    admin_note: topup.adminNote ?? null,
    created_at: topup.createdAt?.toISOString(),
    reviewed_at: topup.reviewedAt?.toISOString() ?? null,
  };
}

export { router as walletRouter };
