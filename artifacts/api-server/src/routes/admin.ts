import { Router } from "express";
import { db, usersTable, ordersTable, productsTable, walletTopupsTable, inventoryTable, adminUsersTable, supportTicketsTable, ticketRepliesTable, referralEventsTable } from "@workspace/db";
import { createNotification } from "../notify";
import { eq, and, count, sum, desc, gte, like, sql, or } from "drizzle-orm";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import { AdminLoginBody, CreateProductBody, UpdateProductBody } from "@workspace/api-zod";
import { notifyTopupApproved, notifyTopupRejected, isTelegramConfigured } from "../telegram";

const router = Router();
if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET environment variable is required");
const JWT_SECRET: string = process.env.SESSION_SECRET;
const ADMIN_JWT_SECRET = JWT_SECRET + "_admin";

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "subnation_salt").digest("hex");
}

function verifyAdminToken(req: any, res: any): { adminId: number } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "غير مصرح" });
    return null;
  }
  try {
    const decoded = jwt.verify(authHeader.slice(7), ADMIN_JWT_SECRET) as { adminId: number };
    return decoded;
  } catch {
    res.status(401).json({ error: "جلسة الإدارة منتهية" });
    return null;
  }
}

router.post("/login", async (req, res) => {
  const parse = AdminLoginBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const { username, password } = parse.data;

  const [admin] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.username, username)).limit(1);
  if (!admin || admin.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
  }

  const token = jwt.sign({ adminId: admin.id }, ADMIN_JWT_SECRET, { expiresIn: "8h" });
  return res.json({ token, display_name: admin.displayName });
});

router.get("/stats", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalUsers] = await db.select({ count: count() }).from(usersTable);
  const [totalOrders] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "completed"));
  const [totalRevenue] = await db.select({ sum: sum(ordersTable.amount) }).from(ordersTable).where(eq(ordersTable.status, "completed"));
  const [pendingTopups] = await db.select({ count: count() }).from(walletTopupsTable).where(eq(walletTopupsTable.status, "pending"));
  const [todayOrders] = await db.select({ count: count() }).from(ordersTable).where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, today)));
  const [todayRevenue] = await db.select({ sum: sum(ordersTable.amount) }).from(ordersTable).where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, today)));
  const [availableStock] = await db.select({ count: count() }).from(inventoryTable).where(eq(inventoryTable.isSold, false));
  const [totalWallet] = await db.select({ sum: sum(usersTable.walletBalance) }).from(usersTable);

  return res.json({
    total_users: Number(totalUsers?.count ?? 0),
    total_orders: Number(totalOrders?.count ?? 0),
    total_revenue: parseFloat(String(totalRevenue?.sum ?? 0)),
    pending_topups: Number(pendingTopups?.count ?? 0),
    today_orders: Number(todayOrders?.count ?? 0),
    today_revenue: parseFloat(String(todayRevenue?.sum ?? 0)),
    available_stock: Number(availableStock?.count ?? 0),
    total_wallet_balance: parseFloat(String(totalWallet?.sum ?? 0)),
  });
});

router.get("/orders", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;

  const { status } = req.query;
  const conditions = status && typeof status === "string"
    ? [eq(ordersTable.status, status as any)]
    : [];

  const orders = await db.select({
    order: ordersTable,
    userPhone: usersTable.phone,
    productName: productsTable.name,
  }).from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id))
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(100);

  return res.json(orders.map(r => ({
    id: r.order.id,
    order_code: r.order.orderCode,
    user_phone: r.userPhone ?? "",
    product_name: r.productName ?? "",
    amount: parseFloat(String(r.order.amount)),
    status: r.order.status,
    delivered_email: r.order.deliveredEmail ?? null,
    delivered_password: r.order.deliveredPassword ?? null,
    created_at: r.order.createdAt?.toISOString(),
  })));
});

router.get("/topups", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;

  const { status } = req.query;
  const conditions = status && typeof status === "string"
    ? [eq(walletTopupsTable.status, status as any)]
    : [];

  const topups = await db.select({
    topup: walletTopupsTable,
    userPhone: usersTable.phone,
  }).from(walletTopupsTable)
    .leftJoin(usersTable, eq(walletTopupsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(walletTopupsTable.createdAt))
    .limit(100);

  return res.json(topups.map(r => ({
    id: r.topup.id,
    user_id: r.topup.userId,
    user_phone: r.userPhone ?? "",
    amount: parseFloat(String(r.topup.amount)),
    payment_method: r.topup.paymentMethod ?? "mobile_transfer",
    payment_network: r.topup.paymentNetwork ?? null,
    sender_phone: r.topup.senderPhone ?? null,
    sender_account: r.topup.senderAccount ?? null,
    payment_reference: r.topup.paymentReference ?? null,
    status: r.topup.status,
    admin_note: r.topup.adminNote ?? null,
    created_at: r.topup.createdAt?.toISOString(),
  })));
});

router.post("/topups/:id/approve", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const [topup] = await db.select().from(walletTopupsTable).where(eq(walletTopupsTable.id, id)).limit(1);
  if (!topup) return res.status(404).json({ error: "طلب الشحن غير موجود" });
  if (topup.status !== "pending") return res.status(400).json({ error: "الطلب تمت معالجته مسبقاً" });

  const adminNote = req.body?.admin_note ?? null;
  await db.update(walletTopupsTable).set({ status: "approved", adminNote, reviewedAt: new Date() }).where(eq(walletTopupsTable.id, id));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, topup.userId)).limit(1);
  if (user) {
    const newBalance = +(parseFloat(String(user.walletBalance)) + parseFloat(String(topup.amount))).toFixed(2);
    const newLifetime = +(parseFloat(String(user.lifetimeSpend)) + parseFloat(String(topup.amount))).toFixed(2);

    let newTier = user.loyaltyTier;
    if (newLifetime >= 5000) newTier = "platinum";
    else if (newLifetime >= 2000) newTier = "gold";
    else if (newLifetime >= 500) newTier = "silver";
    else newTier = "bronze";

    await db.update(usersTable).set({
      walletBalance: String(newBalance),
      lifetimeSpend: String(newLifetime),
      loyaltyTier: newTier,
    }).where(eq(usersTable.id, user.id));

    // Referral credit: credit 50 points to referrer on first approved topup
    if (user.referredBy) {
      const [existingCredit] = await db.select().from(referralEventsTable)
        .where(eq(referralEventsTable.refereeId, user.id)).limit(1);

      if (existingCredit && existingCredit.status === "pending") {
        await db.update(referralEventsTable).set({ status: "credited", creditedAt: new Date() })
          .where(eq(referralEventsTable.refereeId, user.id));

        const [referrer] = await db.select().from(usersTable).where(eq(usersTable.id, user.referredBy)).limit(1);
        if (referrer) {
          await db.update(usersTable).set({ loyaltyPoints: referrer.loyaltyPoints + 50 })
            .where(eq(usersTable.id, referrer.id));
          await createNotification(referrer.id, "loyalty",
            "حصلت على 50 نقطة من إحالة!",
            "تمت مكافأتك بنجاح لأن صديقك أتم أول شحن", "/loyalty");
        }
      }
    }

    notifyTopupApproved(user.phone, parseFloat(String(topup.amount)));
    await createNotification(user.id, "wallet",
      `تم قبول شحن ${parseFloat(String(topup.amount)).toFixed(2)} د.ل`,
      "تمت إضافة الرصيد إلى محفظتك بنجاح", "/wallet");
  }

  return res.json({ success: true, message: "تمت الموافقة على طلب الشحن وإضافة الرصيد" });
});

router.post("/topups/:id/reject", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const [topup] = await db.select().from(walletTopupsTable).where(eq(walletTopupsTable.id, id)).limit(1);
  if (!topup) return res.status(404).json({ error: "طلب الشحن غير موجود" });
  if (topup.status !== "pending") return res.status(400).json({ error: "الطلب تمت معالجته مسبقاً" });

  const adminNote = req.body?.admin_note ?? null;
  await db.update(walletTopupsTable).set({ status: "rejected", adminNote, reviewedAt: new Date() }).where(eq(walletTopupsTable.id, id));

  const [rejUser] = await db.select().from(usersTable).where(eq(usersTable.id, topup.userId)).limit(1);
  if (rejUser) {
    notifyTopupRejected(rejUser.phone, parseFloat(String(topup.amount)));
    await createNotification(rejUser.id, "wallet",
      `تم رفض طلب الشحن (${parseFloat(String(topup.amount)).toFixed(2)} د.ل)`,
      "تواصل مع الدعم إذا كنت ترى أن هذا خطأ", "/support");
  }

  return res.json({ success: true, message: "تم رفض طلب الشحن" });
});

router.get("/products", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;

  const products = await db.select().from(productsTable)
    .where(eq(productsTable.isArchived, false))
    .orderBy(desc(productsTable.createdAt));

  const stockCounts = await db.select({ productId: inventoryTable.productId, count: count() })
    .from(inventoryTable).where(eq(inventoryTable.isSold, false)).groupBy(inventoryTable.productId);
  const stockMap = new Map(stockCounts.map(r => [r.productId, Number(r.count)]));

  const orderCounts = await db.select({ productId: ordersTable.productId, count: count() })
    .from(ordersTable).where(eq(ordersTable.status, "completed")).groupBy(ordersTable.productId);
  const orderMap = new Map(orderCounts.map(r => [r.productId, Number(r.count)]));

  return res.json(products.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    image_url: p.imageUrl,
    price: parseFloat(String(p.price)),
    category: p.category,
    is_active: p.isActive,
    is_archived: p.isArchived,
    stock_count: stockMap.get(p.id) ?? 0,
    order_count: orderMap.get(p.id) ?? 0,
    usage_terms: p.usageTerms,
    created_at: p.createdAt?.toISOString(),
  })));
});

router.post("/products", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const parse = CreateProductBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const data = parse.data;

  const [product] = await db.insert(productsTable).values({
    name: data.name,
    description: data.description ?? null,
    imageUrl: data.image_url ?? null,
    price: String(data.price),
    category: data.category ?? null,
    usageTerms: data.usage_terms ?? null,
    isActive: data.is_active ?? true,
  }).returning();

  return res.status(201).json({
    id: product.id,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: parseFloat(String(product.price)),
    category: product.category,
    is_active: product.isActive,
    is_archived: product.isArchived,
    stock_count: 0,
    order_count: 0,
    usage_terms: product.usageTerms,
    created_at: product.createdAt?.toISOString(),
  });
});

router.patch("/products/:id", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const parse = UpdateProductBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const data = parse.data;

  const updateData: Record<string, any> = {};
  if (data.name != null) updateData.name = data.name;
  if (data.description != null) updateData.description = data.description;
  if (data.image_url != null) updateData.imageUrl = data.image_url;
  if (data.price != null) updateData.price = String(data.price);
  if (data.category != null) updateData.category = data.category;
  if (data.usage_terms != null) updateData.usageTerms = data.usage_terms;
  if (data.is_active != null) updateData.isActive = data.is_active;

  const [product] = await db.update(productsTable).set(updateData).where(eq(productsTable.id, id)).returning();
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const [stockResult] = await db.select({ count: count() }).from(inventoryTable)
    .where(and(eq(inventoryTable.productId, id), eq(inventoryTable.isSold, false)));
  const [orderResult] = await db.select({ count: count() }).from(ordersTable)
    .where(and(eq(ordersTable.productId, id), eq(ordersTable.status, "completed")));

  return res.json({
    id: product.id,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: parseFloat(String(product.price)),
    category: product.category,
    is_active: product.isActive,
    is_archived: product.isArchived,
    stock_count: Number(stockResult?.count ?? 0),
    order_count: Number(orderResult?.count ?? 0),
    usage_terms: product.usageTerms,
    created_at: product.createdAt?.toISOString(),
  });
});

router.delete("/products/:id", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  await db.update(productsTable).set({ isArchived: true, isActive: false }).where(eq(productsTable.id, id));
  return res.json({ success: true, message: "تم أرشفة المنتج" });
});

router.get("/users", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const { search } = req.query;

  const users = search && typeof search === "string"
    ? await db.select().from(usersTable).where(like(usersTable.phone, `%${search}%`)).orderBy(desc(usersTable.createdAt)).limit(100)
    : await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(100);

  const orderCounts = await db.select({ userId: ordersTable.userId, count: count() })
    .from(ordersTable).where(eq(ordersTable.status, "completed")).groupBy(ordersTable.userId);
  const orderMap = new Map(orderCounts.map(r => [r.userId, Number(r.count)]));

  return res.json(users.map(u => ({
    id: u.id,
    phone: u.phone,
    wallet_balance: parseFloat(String(u.walletBalance)),
    loyalty_points: u.loyaltyPoints,
    loyalty_tier: u.loyaltyTier,
    lifetime_spend: parseFloat(String(u.lifetimeSpend)),
    order_count: orderMap.get(u.id) ?? 0,
    referral_code: u.referralCode ?? null,
    created_at: u.createdAt?.toISOString(),
  })));
});

router.patch("/users/:id", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

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
  if (typeof loyalty_tier === "string" && ["bronze", "silver", "gold", "platinum"].includes(loyalty_tier)) {
    updates.loyaltyTier = loyalty_tier;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "لا توجد تعديلات" });

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  return res.json({
    id: updated.id,
    phone: updated.phone,
    wallet_balance: parseFloat(String(updated.walletBalance)),
    loyalty_points: updated.loyaltyPoints,
    loyalty_tier: updated.loyaltyTier,
  });
});

router.post("/products/:id/inventory", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const productId = parseInt(req.params.id);
  if (isNaN(productId)) return res.status(400).json({ error: "معرف غير صالح" });

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const { entries, bulk_text } = req.body ?? {};

  let items: Array<{ accountEmail: string; accountPassword: string; extraDetails?: string }> = [];

  if (bulk_text && typeof bulk_text === "string") {
    const lines = bulk_text.split("\n").map((l: string) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/[|,\t]/);
      if (parts.length >= 2) {
        items.push({
          accountEmail: parts[0].trim(),
          accountPassword: parts[1].trim(),
          extraDetails: parts[2]?.trim() || undefined,
        });
      }
    }
  } else if (Array.isArray(entries)) {
    items = entries
      .filter((e: any) => e.account_email && e.account_password)
      .map((e: any) => ({
        accountEmail: e.account_email,
        accountPassword: e.account_password,
        extraDetails: e.extra_details || undefined,
      }));
  }

  if (items.length === 0) return res.status(400).json({ error: "لا توجد بيانات صالحة للإضافة" });
  if (items.length > 500) return res.status(400).json({ error: "الحد الأقصى 500 عنصر دفعة واحدة" });

  const inserted = await db.insert(inventoryTable).values(
    items.map(item => ({
      productId,
      accountEmail: item.accountEmail,
      accountPassword: item.accountPassword,
      extraDetails: item.extraDetails ?? null,
    }))
  ).returning();

  return res.status(201).json({ success: true, added: inserted.length, message: `تم إضافة ${inserted.length} عنصر إلى المخزون` });
});

router.get("/settings", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  return res.json({
    telegram_configured: isTelegramConfigured(),
    telegram_bot_set: !!process.env.TELEGRAM_BOT_TOKEN,
    telegram_chat_set: !!process.env.TELEGRAM_CHAT_ID,
  });
});

// ── Chart Data ────────────────────────────────────────────────────────────────

router.get("/chart-data", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;

  const days = 7;
  const result: Array<{ date: string; orders: number; revenue: number; users: number }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start.getTime() + 86400000);

    const [ordersRow] = await db.select({ count: count(), revenue: sum(ordersTable.amount) })
      .from(ordersTable)
      .where(and(sql`${ordersTable.createdAt} >= ${start}`, sql`${ordersTable.createdAt} < ${end}`));

    const [usersRow] = await db.select({ count: count() })
      .from(usersTable)
      .where(and(sql`${usersTable.createdAt} >= ${start}`, sql`${usersTable.createdAt} < ${end}`));

    result.push({
      date: start.toLocaleDateString("ar-LY", { month: "short", day: "numeric" }),
      orders: Number(ordersRow?.count ?? 0),
      revenue: parseFloat(String(ordersRow?.revenue ?? 0)),
      users: Number(usersRow?.count ?? 0),
    });
  }

  return res.json(result);
});

// ── Admin Ticket Management ───────────────────────────────────────────────────

router.get("/tickets", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const { status } = req.query;

  const conditions = status && typeof status === "string"
    ? [eq(supportTicketsTable.status, status as any)]
    : [];

  const tickets = await db.select({
    ticket: supportTicketsTable,
    userPhone: usersTable.phone,
  }).from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(100);

  const withCounts = await Promise.all(tickets.map(async ({ ticket, userPhone }) => {
    const [cntRow] = await db.select({ count: count() }).from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, ticket.id));
    const [lastReply] = await db.select().from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, ticket.id))
      .orderBy(desc(ticketRepliesTable.createdAt)).limit(1);
    return {
      id: ticket.id,
      user_phone: userPhone ?? "",
      title: ticket.title,
      category: ticket.category,
      status: ticket.status,
      created_at: ticket.createdAt.toISOString(),
      reply_count: Number(cntRow?.count ?? 0),
      last_reply_at: lastReply?.createdAt?.toISOString() ?? null,
      has_unread_admin: lastReply?.authorType === "user",
    };
  }));

  return res.json(withCounts);
});

router.get("/tickets/:id", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const [row] = await db.select({ ticket: supportTicketsTable, userPhone: usersTable.phone })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(eq(supportTicketsTable.id, id)).limit(1);

  if (!row) return res.status(404).json({ error: "التذكرة غير موجودة" });

  const replies = await db.select().from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);

  return res.json({
    id: row.ticket.id,
    user_phone: row.userPhone ?? "",
    title: row.ticket.title,
    category: row.ticket.category,
    status: row.ticket.status,
    created_at: row.ticket.createdAt.toISOString(),
    replies: replies.map(r => ({ id: r.id, author_type: r.authorType, message: r.message, created_at: r.createdAt.toISOString() })),
  });
});

router.post("/tickets/:id/reply", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const { message } = req.body ?? {};
  if (!message?.trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id)).limit(1);
  if (!ticket) return res.status(404).json({ error: "التذكرة غير موجودة" });

  const [reply] = await db.insert(ticketRepliesTable).values({
    ticketId: id,
    authorType: "admin",
    message: message.trim(),
  }).returning();

  await db.update(supportTicketsTable).set({ status: "in_progress" }).where(eq(supportTicketsTable.id, id));

  // Notify ticket owner
  await createNotification(ticket.userId, "support",
    "رد جديد على تذكرتك",
    message.trim().slice(0, 100), `/support`);

  return res.status(201).json({ id: reply.id, author_type: reply.authorType, message: reply.message, created_at: reply.createdAt.toISOString() });
});

router.patch("/tickets/:id/status", async (req, res) => {
  if (!verifyAdminToken(req, res)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const { status } = req.body ?? {};
  if (!["open", "in_progress", "closed"].includes(status)) return res.status(400).json({ error: "حالة غير صالحة" });

  await db.update(supportTicketsTable).set({ status }).where(eq(supportTicketsTable.id, id));
  return res.json({ success: true });
});

export { router as adminRouter };
