/**
 * Anomaly heuristics (010-ai-admin-copilot, US7).
 *
 * Four fixed-catalog heuristics the copilot can call via `find_anomalies`.
 * Each returns plain rows that the LLM relays verbatim — no fabrication
 * (FR-INTENT-003): the model MUST cite IDs from this output, never invent.
 *
 * The heuristics are intentionally simple. Bigger anomaly logic lives in
 * spec 003 (auth + wallet anomaly detection); these four are just the
 * "show me what's odd in the catalog right now" fast path.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface AnomalyFinding {
  kind: "loss_making_price" | "refund_cluster" | "stock_spike" | "discount_ratio";
  /** Stable identifier of the affected entity (product id, user id, …). */
  entity_type: string;
  entity_id: number;
  /** Human-readable label for the entity (product name, user email, …). */
  entity_label: string | null;
  /** One-line explanation citing the trigger. */
  reason: string;
  /** Numeric raw signal so the UI can sort or threshold. */
  metric: number;
  /** ISO timestamp of the most recent contributing event. */
  occurred_at: string | null;
}

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  const r = result as { rows?: Row[] } | Row[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

// ────────────────────────────────────────────────────────────────────────
// 1. loss_making_price — products.price < cost_price * 0.95
// ────────────────────────────────────────────────────────────────────────
export async function findLossMakingPrice(limit = 20): Promise<AnomalyFinding[]> {
  const result = await db.execute(sql`
    SELECT id, name, price::float8 AS price, cost_price::float8 AS cost,
           updated_at
    FROM products
    WHERE is_archived = false
      AND cost_price IS NOT NULL
      AND price::float8 < cost_price::float8 * 0.95
    ORDER BY (cost_price::float8 - price::float8) DESC
    LIMIT ${limit}
  `);
  return rowsOf(result).map((r) => ({
    kind: "loss_making_price",
    entity_type: "product",
    entity_id: Number(r.id),
    entity_label: typeof r.name === "string" ? r.name : null,
    reason: `price ${r.price} is below 95% of cost ${r.cost}`,
    metric: Number(r.cost) - Number(r.price),
    occurred_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : (r.updated_at as string | null),
  }));
}

// ────────────────────────────────────────────────────────────────────────
// 2. refund_cluster — ≥3 refunds against ONE user in the lookback window
// ────────────────────────────────────────────────────────────────────────
export async function findRefundCluster(hours = 24, limit = 20): Promise<AnomalyFinding[]> {
  const result = await db.execute(sql`
    SELECT user_id,
           COUNT(*)::int AS refunds,
           MAX(created_at) AS last_refund_at,
           SUM(amount::float8) AS total_refund
    FROM wallet_ledger
    WHERE type = 'refund'
      AND created_at >= NOW() - (${hours}::int * INTERVAL '1 hour')
    GROUP BY user_id
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC, SUM(amount::float8) DESC
    LIMIT ${limit}
  `);
  return rowsOf(result).map((r) => ({
    kind: "refund_cluster",
    entity_type: "user",
    entity_id: Number(r.user_id),
    entity_label: null,
    reason: `${r.refunds} refunds in last ${hours}h totalling ${Number(r.total_refund).toFixed(2)}`,
    metric: Number(r.refunds),
    occurred_at:
      r.last_refund_at instanceof Date ? r.last_refund_at.toISOString() : (r.last_refund_at as string | null),
  }));
}

// ────────────────────────────────────────────────────────────────────────
// 3. stock_spike — inventory rows added in last 24h > 5× per-day average
//    over the prior 7-day window (excluding the last 24h).
// ────────────────────────────────────────────────────────────────────────
export async function findStockSpike(limit = 20): Promise<AnomalyFinding[]> {
  const result = await db.execute(sql`
    WITH last_day AS (
      SELECT product_id, COUNT(*)::int AS recent
      FROM inventory
      WHERE created_at >= NOW() - INTERVAL '1 day'
      GROUP BY product_id
    ),
    prior_week AS (
      SELECT product_id, (COUNT(*)::float8 / 7.0) AS daily_avg
      FROM inventory
      WHERE created_at >= NOW() - INTERVAL '8 days'
        AND created_at < NOW() - INTERVAL '1 day'
      GROUP BY product_id
    )
    SELECT p.id, p.name,
           ld.recent,
           COALESCE(pw.daily_avg, 0) AS daily_avg
    FROM last_day ld
    JOIN products p ON p.id = ld.product_id
    LEFT JOIN prior_week pw ON pw.product_id = ld.product_id
    WHERE ld.recent >= 5
      AND ld.recent::float8 > COALESCE(pw.daily_avg, 0) * 5
    ORDER BY (ld.recent::float8 / GREATEST(COALESCE(pw.daily_avg, 0), 0.5)) DESC
    LIMIT ${limit}
  `);
  return rowsOf(result).map((r) => ({
    kind: "stock_spike",
    entity_type: "product",
    entity_id: Number(r.id),
    entity_label: typeof r.name === "string" ? r.name : null,
    reason: `${r.recent} new inventory rows in last 24h vs ${Number(r.daily_avg).toFixed(1)}/day prior 7d`,
    metric: Number(r.recent),
    occurred_at: null,
  }));
}

// ────────────────────────────────────────────────────────────────────────
// 4. discount_ratio — active flash sales with > 50% discount.
//    The "30-day median price unchanged" caveat is approximated by
//    reporting the flash discount itself; the price-history check is
//    deferred until we have a price-history table.
// ────────────────────────────────────────────────────────────────────────
export async function findDiscountRatio(limit = 20): Promise<AnomalyFinding[]> {
  const result = await db.execute(sql`
    SELECT id, title, discount_percent::float8 AS pct, ends_at, created_at
    FROM flash_sales
    WHERE is_active = true
      AND ends_at > NOW()
      AND discount_percent::float8 > 50
    ORDER BY discount_percent::float8 DESC
    LIMIT ${limit}
  `);
  return rowsOf(result).map((r) => ({
    kind: "discount_ratio",
    entity_type: "flash_sale",
    entity_id: Number(r.id),
    entity_label: typeof r.title === "string" ? r.title : null,
    reason: `flash sale "${r.title}" runs at ${r.pct}% off`,
    metric: Number(r.pct),
    occurred_at: r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at as string | null),
  }));
}

// ────────────────────────────────────────────────────────────────────────
// Aggregator
// ────────────────────────────────────────────────────────────────────────

export type AnomalyKind = AnomalyFinding["kind"] | "all";

export async function findAnomalies(args: {
  kind?: AnomalyKind;
  hours?: number;
  limit?: number;
}): Promise<AnomalyFinding[]> {
  const limit = Math.max(1, Math.min(50, args.limit ?? 20));
  const hours = Math.max(1, Math.min(720, args.hours ?? 24));
  const kind = args.kind ?? "all";

  if (kind === "loss_making_price") return findLossMakingPrice(limit);
  if (kind === "refund_cluster") return findRefundCluster(hours, limit);
  if (kind === "stock_spike") return findStockSpike(limit);
  if (kind === "discount_ratio") return findDiscountRatio(limit);

  // "all" — run them in parallel, cap each to ~limit/4 so the result stays
  // legible.
  const each = Math.max(1, Math.floor(limit / 4));
  const [a, b, c, d] = await Promise.all([
    findLossMakingPrice(each),
    findRefundCluster(hours, each),
    findStockSpike(each),
    findDiscountRatio(each),
  ]);
  return [...a, ...b, ...c, ...d];
}
