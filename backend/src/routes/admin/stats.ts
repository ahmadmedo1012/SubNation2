import {
  db,
  inventoryTable,
  ordersTable,
  usersTable,
  walletTopupsTable,
} from "@workspace/db";
import { and, count, eq, gte, sql, sum } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

router.get("/stats", requireAdmin, async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    [totalUsers],
    [totalOrders],
    [totalRevenue],
    [pendingTopups],
    [todayOrders],
    [todayRevenue],
    [availableStock],
    [totalWallet]
  ] = await Promise.all([
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "completed")),
    db.select({ sum: sum(ordersTable.amount) }).from(ordersTable).where(eq(ordersTable.status, "completed")),
    db.select({ count: count() }).from(walletTopupsTable).where(eq(walletTopupsTable.status, "pending")),
    db.select({ count: count() }).from(ordersTable).where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, today))),
    db.select({ sum: sum(ordersTable.amount) }).from(ordersTable).where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, today))),
    db.select({ count: count() }).from(inventoryTable).where(eq(inventoryTable.isSold, false)),
    db.select({ sum: sum(usersTable.walletBalance) }).from(usersTable)
  ]);

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

router.get("/chart-data", requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "7")) || 7, 1), 365);

  // Single aggregate query instead of N+1 sequential queries
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  const [orderRows, userRows] = await Promise.all([
    db.execute(sql`
      SELECT
        DATE(${ordersTable.createdAt}) AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM(${ordersTable.amount}), 0) AS revenue,
        COALESCE(SUM(${ordersTable.discountAmount}), 0) AS discounts,
        COUNT(CASE WHEN ${ordersTable.couponCode} IS NOT NULL THEN 1 END)::int AS coupon_orders
      FROM ${ordersTable}
      WHERE ${ordersTable.createdAt} >= ${startDate}
      GROUP BY DATE(${ordersTable.createdAt})
    `),
    db.execute(sql`
      SELECT
        DATE(${usersTable.createdAt}) AS day,
        COUNT(*)::int AS users
      FROM ${usersTable}
      WHERE ${usersTable.createdAt} >= ${startDate}
      GROUP BY DATE(${usersTable.createdAt})
    `),
  ]);

  // Build lookup maps
  const orderMap = new Map<string, any>();
  for (const r of orderRows.rows ?? orderRows) {
    const key = new Date(r.day as string).toISOString().slice(0, 10);
    orderMap.set(key, r);
  }
  const userMap = new Map<string, number>();
  for (const r of userRows.rows ?? userRows) {
    const key = new Date(r.day as string).toISOString().slice(0, 10);
    userMap.set(key, Number(r.users));
  }

  // Generate result for each day
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
    const key = d.toISOString().slice(0, 10);
    const oRow = orderMap.get(key);

    result.push({
      date: d.toLocaleDateString("ar-LY", { month: "short", day: "numeric" }),
      orders: oRow ? Number(oRow.orders) : 0,
      revenue: oRow ? parseFloat(String(oRow.revenue)) : 0,
      discounts: oRow ? parseFloat(String(oRow.discounts)) : 0,
      coupon_orders: oRow ? Number(oRow.coupon_orders) : 0,
      users: userMap.get(key) ?? 0,
    });
  }

  return res.json(result);
});

export { router as adminStatsRouter };
