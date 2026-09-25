import { db, inventoryTable, ordersTable, usersTable, walletTopupsTable } from "@workspace/db";
import { and, count, eq, gte, sql, sum } from "drizzle-orm";
import { Router } from "express";
import { cacheWrap } from "../../lib/cache";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

// ── Day boundaries in Libya wall-clock time ──────────────────────────────────
// Libya = Africa/Tripoli = fixed UTC+2 (no DST since 2013). All "today"/chart
// buckets must align three layers that previously disagreed (server-local
// midnight — historically UTC on the Render deployment, now fixed by the
// container's TZ; SQL DATE() truncation in the session TZ; and UTC-based
// toISOString keys) — flipping the dashboard's "today" at 02:00 local.
// Everything below computes Tripoli calendar days explicitly.
const TRIPOLI_OFFSET_MS = 2 * 60 * 60 * 1000;

/** UTC instant of Tripoli midnight for the day containing `now`. */
function tripoliDayStartUtc(now: number): number {
  return Math.floor((now + TRIPOLI_OFFSET_MS) / 86_400_000) * 86_400_000 - TRIPOLI_OFFSET_MS;
}

/** YYYY-MM-DD Tripoli calendar key from a UTC day-start instant. */
function tripoliKey(dayStartUtcMs: number): string {
  return new Date(dayStartUtcMs + TRIPOLI_OFFSET_MS).toISOString().slice(0, 10);
}

router.get("/stats", requireAdmin, async (_req, res) => {
  const today = new Date(tripoliDayStartUtc(Date.now()));

  // Round-3 (8-c §5.2): the dashboard polls this every 30s and each poll
  // ran 8 full-table aggregates (COUNT users/orders, SUM revenue ×2,
  // SUM wallet, pending topups, stock). `lib/cache.ts` existed for exactly
  // this and had ZERO callers — wiring it here makes the dead module live
  // and cuts 8 aggregates/poll to 8 aggregates/30s (Redis or in-memory LRU
  // fallback, whichever is active).
  const payload = await cacheWrap("admin:stats", 30, async () => {
    const [
      [totalUsers],
      [totalOrders],
      [totalRevenue],
      [pendingTopups],
      [todayOrders],
      [todayRevenue],
      [availableStock],
      [totalWallet],
    ] = await Promise.all([
      db.select({ count: count() }).from(usersTable),
      db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "completed")),
      db
        .select({ sum: sum(ordersTable.amount) })
        .from(ordersTable)
        .where(eq(ordersTable.status, "completed")),
      db
        .select({ count: count() })
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.status, "pending")),
      db
        .select({ count: count() })
        .from(ordersTable)
        .where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, today))),
      db
        .select({ sum: sum(ordersTable.amount) })
        .from(ordersTable)
        .where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, today))),
      db.select({ count: count() }).from(inventoryTable).where(eq(inventoryTable.isSold, false)),
      db.select({ sum: sum(usersTable.walletBalance) }).from(usersTable),
    ]);

    return {
      total_users: Number(totalUsers?.count ?? 0),
      total_orders: Number(totalOrders?.count ?? 0),
      total_revenue: parseFloat(String(totalRevenue?.sum ?? 0)),
      pending_topups: Number(pendingTopups?.count ?? 0),
      today_orders: Number(todayOrders?.count ?? 0),
      today_revenue: parseFloat(String(todayRevenue?.sum ?? 0)),
      available_stock: Number(availableStock?.count ?? 0),
      total_wallet_balance: parseFloat(String(totalWallet?.sum ?? 0)),
    };
  });

  return res.json(payload);
});

router.get("/chart-data", requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "7")) || 7, 1), 365);

  // Round-3 (8-c §5.4): re-aggregating the whole order/user history per
  // dashboard mount (and per days-toggle) — cache per (days, day-bucket)
  // for 30s. The day bucket in the key means the cache flips automatically
  // at Tripoli midnight instead of serving yesterday's partial bucket.
  const todayBucket = tripoliKey(tripoliDayStartUtc(Date.now()));
  const payload = await cacheWrap(`admin:chart:${days}:${todayBucket}`, 30, () =>
    computeChartData(days),
  );
  return res.json(payload);
});

async function computeChartData(days: number) {
  const todayStartMs = tripoliDayStartUtc(Date.now());
  const startDate = new Date(todayStartMs - (days - 1) * 86_400_000);

  // Group by the Tripoli calendar day: shift each timestamp +2h inside SQL
  // before truncating to DATE (Postgres session TZ is UTC on Neon).
  const [orderRows, userRows] = await Promise.all([
    db.execute(sql`
      SELECT
        DATE((${ordersTable.createdAt} AT TIME ZONE 'UTC') + INTERVAL '2 hours') AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM(${ordersTable.amount}), 0) AS revenue,
        COALESCE(SUM(${ordersTable.discountAmount}), 0) AS discounts,
        COUNT(CASE WHEN ${ordersTable.couponCode} IS NOT NULL THEN 1 END)::int AS coupon_orders
      FROM ${ordersTable}
      WHERE ${ordersTable.createdAt} >= ${startDate}
      GROUP BY 1
    `),
    db.execute(sql`
      SELECT
        DATE((${usersTable.createdAt} AT TIME ZONE 'UTC') + INTERVAL '2 hours') AS day,
        COUNT(*)::int AS users
      FROM ${usersTable}
      WHERE ${usersTable.createdAt} >= ${startDate}
      GROUP BY 1
    `),
  ]);

  // `r.day` is already a Tripoli calendar date — use it verbatim as key.
  const orderMap = new Map<string, any>();
  for (const r of orderRows.rows ?? orderRows) {
    orderMap.set(String(r.day).slice(0, 10), r);
  }
  const userMap = new Map<string, number>();
  for (const r of userRows.rows ?? userRows) {
    userMap.set(String(r.day).slice(0, 10), Number(r.users));
  }

  // Generate result for each Tripoli calendar day
  const result: Array<{
    date: string;
    orders: number;
    revenue: number;
    users: number;
    discounts: number;
    coupon_orders: number;
  }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const dayStartMs = todayStartMs - i * 86_400_000;
    const key = tripoliKey(dayStartMs);
    const oRow = orderMap.get(key);

    result.push({
      // r4 red-team F-5: send the RAW ISO calendar key (e.g. "2026-09-06")
      // — NOT a pre-localized Arabic label. The frontend's
      // aggregateData() parses `new Date(d.date)` to bucket weekly/
      // monthly, and the XAxis tickFormatter localizes for display.
      // Pre-localized strings ("6 سبتمبر") parsed as Invalid Date made
      // weekly/monthly aggregation collapse into one garbage bucket and
      // left the tickFormatter fallback carrying the raw string. ISO keys
      // keep both paths honest; display localization stays client-side.
      // `key` is tripoliKey(dayStartMs) — the same Tripoli calendar date
      // the SQL GROUP BY buckets on, so no UTC/UTC+2 off-by-one.
      date: key,
      orders: oRow ? Number(oRow.orders) : 0,
      revenue: oRow ? parseFloat(String(oRow.revenue)) : 0,
      discounts: oRow ? parseFloat(String(oRow.discounts)) : 0,
      coupon_orders: oRow ? Number(oRow.coupon_orders) : 0,
      users: userMap.get(key) ?? 0,
    });
  }

  return result;
}

export { router as adminStatsRouter };
