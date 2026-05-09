import { AdminLoginBody, CreateProductBody, UpdateProductBody } from "@workspace/api-zod";
import {
  adminAlertsTable,
  adminUsersTable,
  db,
  inventoryTable,
  ordersTable,
  productsTable,
  referralEventsTable,
  supportTicketsTable,
  ticketRepliesTable,
  usersTable,
  walletTopupsTable,
} from "@workspace/db";
import { and, count, desc, eq, gte, like, sql, sum } from "drizzle-orm";
import { Router } from "express";
import {
  countUnreadAlerts,
  deleteAllAlerts,
  deleteReadAlerts,
  getAdminAlerts,
  markAlertRead,
  markAllAlertsRead,
} from "../jobs/alertLogger";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { intParam, queryString, rowsFromResult } from "../lib/http";
import { signAdminToken } from "../lib/jwt";
import { checkLockout, recordFailedAttempt, resetAttempts } from "../lib/lockout";
import { requireAdmin } from "../middlewares/requireAdmin";
import { createNotification } from "../notify";
import { isTelegramConfigured, notifyTopupApproved, notifyTopupRejected } from "../telegram";

const router = Router();

router.post("/login", async (req, res) => {
  const parse = AdminLoginBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const { username, password } = parse.data;

  const lockoutKey = `admin:${username}`;
  const { locked, lockedUntil } = await checkLockout(lockoutKey);
  if (locked) {
    const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
    return res
      .status(429)
      .json({ error: `الحساب مقفل بسبب محاولات فاشلة. حاول بعد ${mins} دقيقة.` });
  }

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.username, username))
    .limit(1);
  if (!admin) {
    await recordFailedAttempt(lockoutKey);
    return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
  }
  const { valid, needsRehash } = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    await recordFailedAttempt(lockoutKey);
    return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
  }
  if (needsRehash) {
    await db
      .update(adminUsersTable)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(adminUsersTable.id, admin.id));
  }
  await resetAttempts(lockoutKey);

  const token = signAdminToken({ adminId: admin.id });
  return res.json({ token, display_name: admin.displayName });
});

router.get("/stats", requireAdmin, async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalUsers] = await db.select({ count: count() }).from(usersTable);
  const [totalOrders] = await db
    .select({ count: count() })
    .from(ordersTable)
    .where(eq(ordersTable.status, "completed"));
  const [totalRevenue] = await db
    .select({ sum: sum(ordersTable.amount) })
    .from(ordersTable)
    .where(eq(ordersTable.status, "completed"));
  const [pendingTopups] = await db
    .select({ count: count() })
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.status, "pending"));
  const [todayOrders] = await db
    .select({ count: count() })
    .from(ordersTable)
    .where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, today)));
  const [todayRevenue] = await db
    .select({ sum: sum(ordersTable.amount) })
    .from(ordersTable)
    .where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, today)));
  const [availableStock] = await db
    .select({ count: count() })
    .from(inventoryTable)
    .where(eq(inventoryTable.isSold, false));
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

router.get("/orders", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(
    Math.max(Number.parseInt(queryString(req, "limit", "100"), 10) || 100, 1),
    200,
  );
  const page = Math.max(Number.parseInt(queryString(req, "page", "1"), 10) || 1, 1);
  const conditions =
    status && typeof status === "string" ? [eq(ordersTable.status, status as any)] : [];

  const orders = await db
    .select({
      order: ordersTable,
      userPhone: usersTable.phone,
      productName: productsTable.name,
    })
    .from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id))
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return res.json(
    orders.map((r) => ({
      id: r.order.id,
      order_code: r.order.orderCode,
      user_phone: r.userPhone ?? "",
      product_name: r.productName ?? "",
      amount: parseFloat(String(r.order.amount)),
      status: r.order.status,
      delivered_email: r.order.deliveredEmail ?? null,
      delivered_password: r.order.deliveredPassword ?? null,
      delivered_extra_details: r.order.deliveredExtraDetails ?? null,
      coupon_code: r.order.couponCode ?? null,
      discount_amount: r.order.discountAmount ? parseFloat(String(r.order.discountAmount)) : 0,
      created_at: r.order.createdAt?.toISOString(),
    })),
  );
});

router.patch("/orders/bulk-status", requireAdmin, async (req, res) => {
  const { ids, status } = req.body ?? {};
  const ALLOWED = ["pending", "processing", "completed", "delivered", "failed", "refunded"];
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids مطلوبة" });
  if (!status || !ALLOWED.includes(status))
    return res.status(400).json({ error: "حالة غير صالحة" });
  const numIds: number[] = ids.map(Number).filter((n) => !isNaN(n));
  if (numIds.length === 0) return res.status(400).json({ error: "لا معرّفات صالحة" });
  await db
    .update(ordersTable)
    .set({ status: status as any })
    .where(sql`id = ANY(${numIds})`);
  return res.json({ success: true, updated: numIds.length });
});

router.get("/topups", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const conditions =
    status && typeof status === "string" ? [eq(walletTopupsTable.status, status as any)] : [];

  const topups = await db
    .select({
      topup: walletTopupsTable,
      userPhone: usersTable.phone,
    })
    .from(walletTopupsTable)
    .leftJoin(usersTable, eq(walletTopupsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(walletTopupsTable.createdAt))
    .limit(100);

  return res.json(
    topups.map((r) => ({
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
    })),
  );
});

router.post("/topups/:id/approve", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [topup] = await db
    .select()
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.id, id))
    .limit(1);
  if (!topup) return res.status(404).json({ error: "طلب الشحن غير موجود" });
  if (topup.status !== "pending")
    return res.status(400).json({ error: "الطلب تمت معالجته مسبقاً" });

  const adminNote = req.body?.admin_note ?? null;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, topup.userId)).limit(1);

  await db
    .transaction(async (tx) => {
      // Re-check topup status inside tx to prevent double-approve race
      const [current] = await tx
        .select({ status: walletTopupsTable.status })
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.id, id))
        .limit(1);
      if (current?.status !== "pending") throw new Error("ALREADY_PROCESSED");

      await tx
        .update(walletTopupsTable)
        .set({ status: "approved", adminNote, reviewedAt: new Date() })
        .where(eq(walletTopupsTable.id, id));

      if (user) {
        const newBalance = +(
          parseFloat(String(user.walletBalance)) + parseFloat(String(topup.amount))
        ).toFixed(2);
        const newLifetime = +(
          parseFloat(String(user.lifetimeSpend)) + parseFloat(String(topup.amount))
        ).toFixed(2);

        let newTier = user.loyaltyTier;
        if (newLifetime >= 5000) newTier = "platinum";
        else if (newLifetime >= 2000) newTier = "gold";
        else if (newLifetime >= 500) newTier = "silver";
        else newTier = "bronze";

        await tx
          .update(usersTable)
          .set({
            walletBalance: String(newBalance),
            lifetimeSpend: String(newLifetime),
            loyaltyTier: newTier,
          })
          .where(eq(usersTable.id, user.id));

        if (user.referredBy) {
          const [existingCredit] = await tx
            .select()
            .from(referralEventsTable)
            .where(eq(referralEventsTable.refereeId, user.id))
            .limit(1);

          if (existingCredit && existingCredit.status === "pending") {
            await tx
              .update(referralEventsTable)
              .set({ status: "credited", creditedAt: new Date() })
              .where(eq(referralEventsTable.refereeId, user.id));

            const [referrer] = await tx
              .select()
              .from(usersTable)
              .where(eq(usersTable.id, user.referredBy))
              .limit(1);
            if (referrer) {
              await tx
                .update(usersTable)
                .set({ loyaltyPoints: referrer.loyaltyPoints + 50 })
                .where(eq(usersTable.id, referrer.id));
            }
          }
        }
      }
    })
    .catch((err) => {
      if (err.message === "ALREADY_PROCESSED") {
        return res.status(409).json({ error: "الطلب تمت معالجته مسبقاً" });
      }
      throw err;
    });

  // Notifications outside transaction (non-critical, best-effort)
  if (user) {
    if (user.referredBy) {
      const [referrer] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, user.referredBy))
        .limit(1);
      if (referrer) {
        await createNotification(
          referrer.id,
          "loyalty",
          "حصلت على 50 نقطة من إحالة!",
          "تمت مكافأتك بنجاح لأن صديقك أتم أول شحن",
          "/loyalty",
        );
      }
    }
    notifyTopupApproved(user.phone, parseFloat(String(topup.amount)));
    await createNotification(
      user.id,
      "wallet",
      `تم قبول شحن ${parseFloat(String(topup.amount)).toFixed(2)} د.ل`,
      "تمت إضافة الرصيد إلى محفظتك بنجاح",
      "/wallet",
    );
  }

  return res.json({ success: true, message: "تمت الموافقة على طلب الشحن وإضافة الرصيد" });
});

router.post("/topups/:id/reject", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [topup] = await db
    .select()
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.id, id))
    .limit(1);
  if (!topup) return res.status(404).json({ error: "طلب الشحن غير موجود" });
  if (topup.status !== "pending")
    return res.status(400).json({ error: "الطلب تمت معالجته مسبقاً" });

  const adminNote = req.body?.admin_note ?? null;
  await db
    .update(walletTopupsTable)
    .set({ status: "rejected", adminNote, reviewedAt: new Date() })
    .where(eq(walletTopupsTable.id, id));

  const [rejUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, topup.userId))
    .limit(1);
  if (rejUser) {
    notifyTopupRejected(rejUser.phone, parseFloat(String(topup.amount)));
    await createNotification(
      rejUser.id,
      "wallet",
      `تم رفض طلب الشحن (${parseFloat(String(topup.amount)).toFixed(2)} د.ل)`,
      "تواصل مع الدعم إذا كنت ترى أن هذا خطأ",
      "/support",
    );
  }

  return res.json({ success: true, message: "تم رفض طلب الشحن" });
});

router.get("/products", requireAdmin, async (_req, res) => {
  const products = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.isArchived, false))
    .orderBy(desc(productsTable.createdAt));

  const stockCounts = await db
    .select({ productId: inventoryTable.productId, count: count() })
    .from(inventoryTable)
    .where(eq(inventoryTable.isSold, false))
    .groupBy(inventoryTable.productId);
  const stockMap = new Map(stockCounts.map((r) => [r.productId, Number(r.count)]));

  const orderCounts = await db
    .select({ productId: ordersTable.productId, count: count() })
    .from(ordersTable)
    .where(eq(ordersTable.status, "completed"))
    .groupBy(ordersTable.productId);
  const orderMap = new Map(orderCounts.map((r) => [r.productId, Number(r.count)]));

  return res.json(
    products.map((p) => ({
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
    })),
  );
});

router.post("/products", requireAdmin, async (req, res) => {
  const parse = CreateProductBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const data = parse.data;

  const [product] = await db
    .insert(productsTable)
    .values({
      name: data.name,
      description: data.description ?? null,
      imageUrl: data.image_url ?? null,
      price: String(data.price),
      category: data.category ?? null,
      usageTerms: data.usage_terms ?? null,
      isActive: data.is_active ?? true,
    })
    .returning();

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

router.patch("/products/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

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

  const [product] = await db
    .update(productsTable)
    .set(updateData)
    .where(eq(productsTable.id, id))
    .returning();
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const [stockResult] = await db
    .select({ count: count() })
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, id), eq(inventoryTable.isSold, false)));
  const [orderResult] = await db
    .select({ count: count() })
    .from(ordersTable)
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

router.delete("/products/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  await db
    .update(productsTable)
    .set({ isArchived: true, isActive: false })
    .where(eq(productsTable.id, id));
  return res.json({ success: true, message: "تم أرشفة المنتج" });
});

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

router.post("/products/:id/inventory", requireAdmin, async (req, res) => {
  const productId = intParam(req, "id");
  if (productId === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const { entries, bulk_text } = req.body ?? {};

  let items: Array<{ accountEmail: string; accountPassword: string; extraDetails?: string }> = [];

  if (bulk_text && typeof bulk_text === "string") {
    const lines = bulk_text
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean);
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

  const inserted = await db
    .insert(inventoryTable)
    .values(
      items.map((item) => ({
        productId,
        accountEmail: item.accountEmail,
        accountPassword: item.accountPassword,
        extraDetails: item.extraDetails ?? null,
      })),
    )
    .returning();

  return res.status(201).json({
    success: true,
    added: inserted.length,
    message: `تم إضافة ${inserted.length} عنصر إلى المخزون`,
  });
});

router.get("/settings", requireAdmin, async (_req, res) => {
  return res.json({
    telegram_configured: isTelegramConfigured(),
    telegram_bot_set: !!process.env.TELEGRAM_BOT_TOKEN,
    telegram_chat_set: !!process.env.TELEGRAM_CHAT_ID,
  });
});

router.get("/chart-data", requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "7")) || 7, 1), 365);
  const result: Array<{
    date: string;
    orders: number;
    revenue: number;
    users: number;
    discounts: number;
    coupon_orders: number;
  }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start.getTime() + 86400000);

    const [ordersRow] = await db
      .select({
        count: count(),
        revenue: sum(ordersTable.amount),
        discounts: sum(ordersTable.discountAmount),
        coupon_orders: sql<number>`count(case when ${ordersTable.couponCode} is not null then 1 end)`,
      })
      .from(ordersTable)
      .where(
        and(sql`${ordersTable.createdAt} >= ${start}`, sql`${ordersTable.createdAt} < ${end}`),
      );

    const [usersRow] = await db
      .select({ count: count() })
      .from(usersTable)
      .where(and(sql`${usersTable.createdAt} >= ${start}`, sql`${usersTable.createdAt} < ${end}`));

    result.push({
      date: start.toLocaleDateString("ar-LY", { month: "short", day: "numeric" }),
      orders: Number(ordersRow?.count ?? 0),
      revenue: parseFloat(String(ordersRow?.revenue ?? 0)),
      discounts: parseFloat(String(ordersRow?.discounts ?? 0)),
      coupon_orders: Number(ordersRow?.coupon_orders ?? 0),
      users: Number(usersRow?.count ?? 0),
    });
  }

  return res.json(result);
});

router.get("/tickets", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const conditions =
    status && typeof status === "string" ? [eq(supportTicketsTable.status, status as any)] : [];

  const tickets = await db
    .select({
      ticket: supportTicketsTable,
      userPhone: usersTable.phone,
    })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(100);

  const withCounts = await Promise.all(
    tickets.map(async ({ ticket, userPhone }) => {
      const [cntRow] = await db
        .select({ count: count() })
        .from(ticketRepliesTable)
        .where(eq(ticketRepliesTable.ticketId, ticket.id));
      const [lastReply] = await db
        .select()
        .from(ticketRepliesTable)
        .where(eq(ticketRepliesTable.ticketId, ticket.id))
        .orderBy(desc(ticketRepliesTable.createdAt))
        .limit(1);
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
    }),
  );

  return res.json(withCounts);
});

router.get("/tickets/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [row] = await db
    .select({ ticket: supportTicketsTable, userPhone: usersTable.phone })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(eq(supportTicketsTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ error: "التذكرة غير موجودة" });

  const replies = await db
    .select()
    .from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);

  return res.json({
    id: row.ticket.id,
    user_phone: row.userPhone ?? "",
    title: row.ticket.title,
    category: row.ticket.category,
    status: row.ticket.status,
    created_at: row.ticket.createdAt.toISOString(),
    replies: replies.map((r) => ({
      id: r.id,
      author_type: r.authorType,
      message: r.message,
      created_at: r.createdAt.toISOString(),
    })),
  });
});

router.post("/tickets/:id/reply", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const { message } = req.body ?? {};
  if (!message?.trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.id, id))
    .limit(1);
  if (!ticket) return res.status(404).json({ error: "التذكرة غير موجودة" });

  const [reply] = await db
    .insert(ticketRepliesTable)
    .values({
      ticketId: id,
      authorType: "admin",
      message: message.trim(),
    })
    .returning();

  await db
    .update(supportTicketsTable)
    .set({ status: "in_progress" })
    .where(eq(supportTicketsTable.id, id));

  await createNotification(
    ticket.userId,
    "support",
    "رد جديد على تذكرتك",
    message.trim().slice(0, 100),
    `/support`,
  );

  return res.status(201).json({
    id: reply.id,
    author_type: reply.authorType,
    message: reply.message,
    created_at: reply.createdAt.toISOString(),
  });
});

router.patch("/tickets/:id/status", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const { status } = req.body ?? {};
  if (!["open", "in_progress", "closed"].includes(status))
    return res.status(400).json({ error: "حالة غير صالحة" });

  await db.update(supportTicketsTable).set({ status }).where(eq(supportTicketsTable.id, id));
  return res.json({ success: true });
});

router.get("/referrals", requireAdmin, async (req, res) => {
  const status = queryString(req, "status");
  const search = queryString(req, "search");

  const rows = rowsFromResult<any>(
    await db.execute(sql`
    SELECT
      re.id,
      re.status,
      re.created_at,
      re.credited_at,
      r.phone  AS referrer_phone,
      r.id     AS referrer_id,
      e.phone  AS referee_phone,
      50       AS points_earned
    FROM referral_events re
    JOIN users r ON r.id = re.referrer_id
    JOIN users e ON e.id = re.referee_id
    ${status !== "" ? sql`WHERE re.status = ${status}` : sql``}
    ORDER BY re.created_at DESC
    LIMIT 200
  `),
  );

  const topReferrers = rowsFromResult<any>(
    await db.execute(sql`
    SELECT
      u.phone,
      u.id,
      COUNT(*) FILTER (WHERE re.status = 'credited') AS credited_count,
      COUNT(*) AS total_count
    FROM referral_events re
    JOIN users u ON u.id = re.referrer_id
    GROUP BY u.id, u.phone
    ORDER BY credited_count DESC
    LIMIT 10
  `),
  );

  const [statsRow = {}] = rowsFromResult<any>(
    await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'credited') AS credited,
      COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
      COUNT(*) FILTER (WHERE status = 'credited') * 50 AS total_points
    FROM referral_events
  `),
  );

  const searchStr = search.toLowerCase();
  let list = rows.map((r) => ({
    id: Number(r.id),
    status: r.status as string,
    created_at: new Date(r.created_at as string).toISOString(),
    credited_at: r.credited_at ? new Date(r.credited_at as string).toISOString() : null,
    referrer_phone: r.referrer_phone as string,
    referrer_id: Number(r.referrer_id),
    referee_phone: r.referee_phone as string,
    points_earned: r.status === "credited" ? 50 : 0,
  }));

  if (searchStr) {
    list = list.filter(
      (r) => r.referrer_phone.includes(searchStr) || r.referee_phone.includes(searchStr),
    );
  }

  return res.json({
    stats: {
      total: Number(statsRow.total ?? 0),
      credited: Number(statsRow.credited ?? 0),
      pending: Number(statsRow.pending ?? 0),
      total_points: Number(statsRow.total_points ?? 0),
    },
    top_referrers: topReferrers.map((r) => ({
      id: Number(r.id),
      phone: r.phone as string,
      credited_count: Number(r.credited_count),
      total_count: Number(r.total_count),
    })),
    list,
  });
});

router.post("/referrals/:id/credit", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [event] = await db
    .select()
    .from(referralEventsTable)
    .where(eq(referralEventsTable.id, id))
    .limit(1);
  if (!event) return res.status(404).json({ error: "الإحالة غير موجودة" });
  if (event.status === "credited") return res.status(400).json({ error: "تم منح النقاط مسبقاً" });

  const POINTS = 50;
  await db
    .update(referralEventsTable)
    .set({ status: "credited", creditedAt: new Date() })
    .where(eq(referralEventsTable.id, id));

  await db
    .update(usersTable)
    .set({ loyaltyPoints: sql`${usersTable.loyaltyPoints} + ${POINTS}` })
    .where(eq(usersTable.id, event.referrerId));

  await createNotification(
    event.referrerId,
    "loyalty",
    "تم منح نقاط الإحالة",
    `تم قيد ${POINTS} نقطة في حسابك كمكافأة إحالة`,
    "/loyalty",
  );

  return res.json({ success: true, points_credited: POINTS });
});

router.get("/alerts/new", requireAdmin, async (req, res) => {
  try {
    const sinceId = Number.parseInt(queryString(req, "since", "0"), 10) || 0;
    const allAlerts = await getAdminAlerts(50);
    const newAlerts = allAlerts.filter((a) => a.id > sinceId);
    return res.json({ alerts: newAlerts });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch new alerts");
    return res.status(500).json({ error: "خطأ" });
  }
});

router.get("/alerts/unread-count", requireAdmin, async (_req, res) => {
  try {
    const c = await countUnreadAlerts();
    return res.json({ count: c });
  } catch {
    return res.status(500).json({ error: "خطأ" });
  }
});

router.get("/alerts", requireAdmin, async (req, res) => {
  try {
    const alerts = await getAdminAlerts(200);
    const unreadCount = await countUnreadAlerts();
    return res.json({ alerts, unreadCount });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin alerts");
    return res.status(500).json({ error: "خطأ في جلب التنبيهات" });
  }
});

router.patch("/alerts/read-all", requireAdmin, async (req, res) => {
  try {
    await markAllAlertsRead();
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to mark all alerts read");
    return res.status(500).json({ error: "خطأ" });
  }
});

router.patch("/alerts/:id/read", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرّف غير صالح" });
  try {
    await markAlertRead(id);
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to mark alert read");
    return res.status(500).json({ error: "خطأ" });
  }
});

router.delete("/alerts/read", requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteReadAlerts();
    return res.json({ success: true, deleted });
  } catch (err) {
    req.log.error({ err }, "Failed to delete read alerts");
    return res.status(500).json({ error: "خطأ" });
  }
});

router.delete("/alerts/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرّف غير صالح" });
  try {
    await db.delete(adminAlertsTable).where(eq(adminAlertsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete alert");
    return res.status(500).json({ error: "خطأ" });
  }
});

router.delete("/alerts", requireAdmin, async (req, res) => {
  try {
    await deleteAllAlerts();
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete all alerts");
    return res.status(500).json({ error: "خطأ" });
  }
});

export { router as adminRouter };
