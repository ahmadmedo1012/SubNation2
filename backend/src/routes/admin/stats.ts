import {
  db,
  inventoryTable,
  ordersTable,
  supportTicketsTable,
  usersTable,
  walletTopupsTable,
} from "@workspace/db";
import { count, eq, inArray, isNotNull, or, sql, sum } from "drizzle-orm";
import { Router } from "express";
import { cacheWrap } from "../../lib/cache";
import { requirePermission } from "../../lib/permissions";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

// R123-E5 (A6 P3): no-store parity with the 98-F3 pattern — the
// dashboard's /stats + /chart-data carry revenue/wallet aggregates and
// open-ticket counts; an intermediary must never serve them from cache
// (the 30s server-side cacheWrap is the ONLY caching layer allowed).
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

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

/** R120-B4 (A6-F5): a unit counts as available stock only when it is
 *  DELIVERABLE — at least one credential field present. Mirrors
 *  routes/products.ts:83 `deliverableUnitCondition` (R102) verbatim; the
 *  admin count previously counted ALL unsold rows, so ghost rows
 *  (zero credentials — refused at checkout by the INVENTORY_CORRUPT
 *  gate) inflated the dashboard's stock KPI above what the public
 *  stats reported for the same catalog. Defined locally because the
 *  public route's helper is not exported (importing across route
 *  modules would couple the two routers). */
const deliverableUnitCondition = () =>
  or(
    isNotNull(inventoryTable.accountPassword),
    isNotNull(inventoryTable.accountEmail),
    isNotNull(inventoryTable.extraDetails),
  );

/** YYYY-MM-DD Tripoli calendar key from a UTC day-start instant. */
function tripoliKey(dayStartUtcMs: number): string {
  return new Date(dayStartUtcMs + TRIPOLI_OFFSET_MS).toISOString().slice(0, 10);
}

router.get(
  "/stats",
  requireAdmin,
  // R126-L4 (A7-F1, P2): this route (and /chart-data below) previously
  // carried NO permission scope — mounted ahead of the scope-gated
  // protectedRouter in admin/index.ts, any scoped admin (e.g. a
  // `support`-only session) read total_revenue / today_revenue /
  // total_wallet_balance straight off the API even though the dashboard
  // UI hides those tiles for non-finance operators (dashboard.tsx
  // canSeeMoney, R122 A2-P2 — the UI was the ONLY gate). `finance` is the
  // honest scope: revenue + wallet aggregates are money data, and every
  // other money surface is finance-gated (topups mount, coupons,
  // wallet edits in users.ts).
  //
  // Frontend alignment, verified before shipping: the dashboard nav is
  // the one unscoped item, so scoped admins still LAND on /admin — for
  // them the stats query now 403s and the tile grid renders empty (the
  // page degrades gracefully; layout badges fall back to page-passed
  // counts) — the same accepted trade the R123-E3 chart gate made (a
  // non-finance operator's chart payload goes dark). The operator's
  // own account holds ["all"] (verified live, sole active admin), so
  // the primary dashboard is unaffected.
  requirePermission("finance"),
  async (_req, res) => {
    const today = new Date(tripoliDayStartUtc(Date.now()));

    // Round-3 (8-c §5.2): the dashboard polls this every 30s and each poll
    // ran 8 full-table aggregates (COUNT users/orders, SUM revenue ×2,
    // SUM wallet, pending topups, stock). `lib/cache.ts` existed for exactly
    // this and had ZERO callers — wiring it here makes the dead module live
    // and cuts 8 aggregates/poll to 8 aggregates/30s (Redis or in-memory LRU
    // fallback, whichever is active).
    const payload = await cacheWrap("admin:stats", 30, async () => {
      // R126-L4 (A6-F2): the ten parallel count()/sum() aggregates folded
      // into five single-scan queries via count(*) FILTER (the shipped
      // admin/security.ts:91-104 + products.ts:452 idiom). 10 round-trips
      // per 30s cache-miss → 5, and the Promise.all stage width (5) now
      // fits inside the pool's 8 clients instead of queueing two queries
      // behind it. Predicates mirror the pre-fold queries EXACTLY — same
      // numbers, same response shape; only the scan count changed.
      const [[usersAgg], [ordersAgg], [pendingTopups], [openTickets], [invAgg]] = await Promise.all(
        [
          // users: total count + wallet sum shared ONE users scan.
          db
            .select({ totalUsers: count(), walletSum: sum(usersTable.walletBalance) })
            .from(usersTable),
          // orders: completed totals + today's completed slice — one
          // orders scan, the today-boundary rides a FILTER clause instead
          // of a second/third query.
          db
            .select({
              completedOrders:
                sql<number>`count(*) filter (where ${ordersTable.status} = 'completed')`.mapWith(
                  Number,
                ),
              totalRevenue: sql<
                string | null
              >`sum(${ordersTable.amount}) filter (where ${ordersTable.status} = 'completed')`,
              todayOrders:
                sql<number>`count(*) filter (where ${ordersTable.status} = 'completed' and ${ordersTable.createdAt} >= ${today})`.mapWith(
                  Number,
                ),
              todayRevenue: sql<
                string | null
              >`sum(${ordersTable.amount}) filter (where ${ordersTable.status} = 'completed' and ${ordersTable.createdAt} >= ${today})`,
            })
            .from(ordersTable),
          db
            .select({ count: count() })
            .from(walletTopupsTable)
            .where(eq(walletTopupsTable.status, "pending")),
          // R120-B4 (A2-F3): the support badge count — tickets NOT yet
          // resolved (the ticket_status pg enum is open/in_progress/closed;
          // dashboard + tickets page badge the same population).
          db
            .select({ count: count() })
            .from(supportTicketsTable)
            .where(inArray(supportTicketsTable.status, ["open", "in_progress"])),
          // R120-B4 (A6-F5): ONE unsold scan — deliverable units (at least
          // one credential field present, the public stock definition) via
          // a FILTER on the deliverableUnitCondition, the raw unsold-row
          // count alongside so a ghost-row gap stays observable.
          db
            .select({
              unsoldRows: count(),
              deliverableUnits:
                sql<number>`count(*) filter (where ${deliverableUnitCondition()})`.mapWith(Number),
            })
            .from(inventoryTable)
            .where(eq(inventoryTable.isSold, false)),
        ],
      );

      return {
        total_users: Number(usersAgg?.totalUsers ?? 0),
        total_orders: Number(ordersAgg?.completedOrders ?? 0),
        total_revenue: parseFloat(String(ordersAgg?.totalRevenue ?? 0)),
        pending_topups: Number(pendingTopups?.count ?? 0),
        today_orders: Number(ordersAgg?.todayOrders ?? 0),
        today_revenue: parseFloat(String(ordersAgg?.todayRevenue ?? 0)),
        // R120-B4 (A6-F5): deliverable units only — the public stock
        // definition (see deliverableUnitCondition above). The raw
        // unsold count rides along as unsold_rows.
        available_stock: Number(invAgg?.deliverableUnits ?? 0),
        total_wallet_balance: parseFloat(String(usersAgg?.walletSum ?? 0)),
        // R120-B4 (A2-F3): rides the same 30s cacheWrap window as
        // pending_topups — a ticket closed up to 30s ago may still count
        // (the established admin:stats staleness contract; no write-side
        // invalidation exists for this cache key — see the topup approve
        // path, which shares the window).
        open_tickets: Number(openTickets?.count ?? 0),
        unsold_rows: Number(invAgg?.unsoldRows ?? 0),
      };
    });

    return res.json(payload);
  },
);

router.get(
  "/chart-data",
  requireAdmin,
  // R126-L4 (A7-F1): same finance gate as /stats — the chart payload
  // carries the daily revenue/discount series (money data; CSV export
  // included). The frontend already never fetches this endpoint for
  // non-finance operators (dashboard.tsx fetchChart early-returns on
  // !canSeeMoney, R123 E3 item 5) — the gate just moves that contract
  // server-side where it can't be bypassed with a raw fetch.
  requirePermission("finance"),
  async (req, res) => {
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
  },
);

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
