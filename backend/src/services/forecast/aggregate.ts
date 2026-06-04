/**
 * Single batched aggregate query (011-inventory-demand-forecast, T015).
 *
 * Pulls per-product order counts grouped by calendar day for the
 * trailing 28 days. One round-trip; the math service consumes the
 * result in-memory.
 *
 * Why 28 days when the moving-average window is 14? The DoW multiplier
 * (research §R-1) needs ≥ 4 occurrences of each weekday to be
 * defensible. 28 = 14 (avg window) + 14 (DoW lookback overlap).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { IsoDate } from "../../lib/forecast/dates";

export interface ProductOrderHistory {
  productId: number;
  /** Sparse — one row per (product, day) that had ≥1 order. */
  history: Array<{ date: IsoDate; count: number }>;
  /** COUNT(inventory.is_sold = false) at query time. */
  currentStockOnHand: number;
  /** First-order timestamp; if older than 14 days, we can forecast. */
  firstOrderAt: Date | null;
}

interface AggregateRow {
  product_id: number;
  order_date: string;
  order_count: number;
}

interface StockRow {
  product_id: number;
  stock: number;
}

interface FirstOrderRow {
  product_id: number;
  first_order_at: Date | string | null;
}

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

/**
 * Returns one history slice per active+non-archived product. Archived
 * and inactive products are excluded at the SQL layer (FR-FORECAST-004).
 */
export async function loadOrderHistoryForActiveProducts(): Promise<
  ProductOrderHistory[]
> {
  // 1. Per-product per-day order counts over the last 28 days.
  const aggResult = await db.execute(sql`
    SELECT
      o.product_id,
      DATE(o.created_at AT TIME ZONE 'UTC') AS order_date,
      COUNT(*)::int AS order_count
    FROM orders o
    JOIN products p ON p.id = o.product_id
    WHERE o.created_at >= NOW() - INTERVAL '28 days'
      AND p.is_archived = false
      AND p.is_active = true
      AND o.status IN ('pending', 'completed')
    GROUP BY o.product_id, order_date
  `);

  // 2. Current stock-on-hand per active+non-archived product.
  //    Includes products with zero stock (LEFT JOIN).
  const stockResult = await db.execute(sql`
    SELECT
      p.id AS product_id,
      COALESCE(SUM(CASE WHEN i.is_sold = false THEN 1 ELSE 0 END), 0)::int AS stock
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.is_archived = false AND p.is_active = true
    GROUP BY p.id
  `);

  // 3. First-order timestamp per product (drives the insufficient_data gate).
  const firstResult = await db.execute(sql`
    SELECT product_id, MIN(created_at) AS first_order_at
    FROM orders
    WHERE status IN ('pending', 'completed')
    GROUP BY product_id
  `);

  const aggRows = rowsOf<AggregateRow>(aggResult);
  const stockRows = rowsOf<StockRow>(stockResult);
  const firstRows = rowsOf<FirstOrderRow>(firstResult);

  const stockMap = new Map<number, number>(
    stockRows.map((r) => [Number(r.product_id), Number(r.stock)]),
  );
  const firstMap = new Map<number, Date | null>(
    firstRows.map((r) => {
      const v = r.first_order_at;
      const d = v instanceof Date ? v : v == null ? null : new Date(v);
      return [Number(r.product_id), d];
    }),
  );

  const historyByProduct = new Map<number, Array<{ date: IsoDate; count: number }>>();
  for (const r of aggRows) {
    const pid = Number(r.product_id);
    if (!historyByProduct.has(pid)) historyByProduct.set(pid, []);
    historyByProduct.get(pid)!.push({
      date: typeof r.order_date === "string" ? r.order_date : String(r.order_date),
      count: Number(r.order_count),
    });
  }

  const out: ProductOrderHistory[] = [];
  for (const [productId, stock] of stockMap.entries()) {
    out.push({
      productId,
      history: historyByProduct.get(productId) ?? [],
      currentStockOnHand: stock,
      firstOrderAt: firstMap.get(productId) ?? null,
    });
  }
  return out;
}
