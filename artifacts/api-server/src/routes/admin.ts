import { Router } from "express";
import { db, usersTable, ordersTable, productsTable, walletTopupsTable, inventoryTable, adminUsersTable } from "@workspace/db";
import { eq, and, count, sum, desc, gte, like, sql, or } from "drizzle-orm";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import { AdminLoginBody, CreateProductBody, UpdateProductBody } from "@workspace/api-zod";

const router = Router();
const JWT_SECRET = process.env.SESSION_SECRET ?? "subnation-secret-key-change-in-prod";
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
    payment_network: r.topup.paymentNetwork,
    sender_phone: r.topup.senderPhone ?? null,
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
    await db.update(usersTable).set({ walletBalance: String(newBalance) }).where(eq(usersTable.id, user.id));
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

export { router as adminRouter };
