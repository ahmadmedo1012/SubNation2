import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  inventoryForecastsTable,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../../../test/db";

// The alert dispatcher is a separate concern (pinned by
// alerts-dedupe.test.ts) — mock it out so this file exercises ONLY the
// insufficient_data gate without pulling the alerting-service module.
vi.mock("../alerts", () => ({
  dispatchForecastAlerts: vi.fn(async () => ({
    alertsEmitted: 0,
    alertsCapped: false,
    paused: false,
  })),
}));

import { runForecast } from "../forecast.service";
import { deriveConfidence, type OrderHistoryDay } from "../statistical";
import { addDays, todayUtcDate } from "../../../lib/forecast/dates";

/**
 * 93-A6 P2#2 (round-93) — the forecast `insufficient_data` gate is real.
 *
 * densifyHistory() backfills zero-sales days, so the dense array always
 * carries exactly 14 rows — the `history.length < 14` branch in
 * deriveConfidence was unreachable dead code, and `firstOrderAt` (fetched
 * by aggregate.ts since day one) was never read. Day one after enabling
 * the runner, every zero-sales product got a FABRICATED
 * `floor(stock / max(0, 0.1))` = stock×10-days runout with confidence
 * "low" and atRisk=true — 18 meaningless rows in the admin risk panel,
 * violating FR-FORECAST-003 and the nullable-metrics schema contract.
 *
 * Level 1 (pure): deriveConfidence + the firstOrderAt/asOf gate.
 * Level 2 (service): runForecast against the pglite harness — a
 * zero-sales product writes an insufficient_data row with NULL metrics,
 * never a fabricated runout.
 *
 * The forecast tables are not part of the shared harness DDL — this file
 * provisions them locally (per-file pglite instance, same pattern as
 * retention-batching.test.ts's auth_activity).
 */

const FORECAST_DDL = [
  sql`CREATE TYPE audit_actor_type AS ENUM ('user','admin','system')`,
  sql`CREATE TABLE audit_logs (
    id serial PRIMARY KEY,
    actor_id integer,
    actor_type audit_actor_type NOT NULL DEFAULT 'system',
    action varchar(100) NOT NULL,
    target_type varchar(50),
    target_id integer,
    metadata text,
    ip varchar(45),
    user_agent varchar(500),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE TABLE inventory_forecast_runs (
    id serial PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    outcome varchar(20) NOT NULL DEFAULT 'in_flight',
    products_predicted integer NOT NULL DEFAULT 0,
    products_skipped jsonb NOT NULL DEFAULT '{}'::jsonb,
    alerts_emitted integer NOT NULL DEFAULT 0,
    alerts_capped boolean NOT NULL DEFAULT false,
    capture_rate_14d numeric(4,3),
    worker_tier varchar(50),
    failure_reason text
  )`,
  sql`CREATE TABLE inventory_forecasts (
    id serial PRIMARY KEY,
    run_id integer NOT NULL REFERENCES inventory_forecast_runs(id) ON DELETE CASCADE,
    product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    forecast_date date NOT NULL,
    current_stock_on_hand integer NOT NULL,
    avg_daily_sales numeric(8,4),
    dow_blend_7d numeric(8,4),
    predicted_demand_7d integer,
    predicted_demand_30d integer,
    predicted_runout_at date,
    recommended_reorder_qty integer,
    confidence varchar(20) NOT NULL,
    at_risk boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX uq_forecast_product_date ON inventory_forecasts (product_id, forecast_date)`,
];

beforeAll(async () => {
  await initTestDb();
  for (const stmt of FORECAST_DDL) await db.execute(stmt);
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // products CASCADE already wipes inventory_forecasts; runs + audit_logs
  // have no FK into the harness tables, so truncate them explicitly.
  await db.execute(
    sql`TRUNCATE TABLE inventory_forecast_runs, inventory_forecasts, audit_logs RESTART IDENTITY CASCADE`,
  );
});

let orderSeq = 0;

async function seedProduct(name: string): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name, price: "10.00" })
    .returning({ id: productsTable.id });
  return p.id;
}

async function seedUser(): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `091${String(1000000 + orderSeq).slice(1)}` })
    .returning({ id: usersTable.id });
  return u.id;
}

async function seedStock(productId: number, units: number): Promise<void> {
  await db.insert(inventoryTable).values(Array.from({ length: units }, () => ({ productId })));
}

async function seedOrder(userId: number, productId: number, daysAgo: number): Promise<void> {
  orderSeq += 1;
  await db.insert(ordersTable).values({
    orderCode: `FC-${orderSeq}`,
    userId,
    productId,
    amount: "10.00",
    status: "completed",
    createdAt: new Date(Date.now() - daysAgo * 86_400_000 - 3_600_000),
  });
}

describe("deriveConfidence — A6-P2-2 history-availability gate (pure)", () => {
  const AS_OF = new Date("2026-06-02T12:00:00Z");
  const FORECAST_DATE = "2026-06-02";

  function uniformHistory(perDay: number, days: number): OrderHistoryDay[] {
    const out: OrderHistoryDay[] = [];
    for (let i = days; i >= 1; i--) {
      const d = new Date(`${FORECAST_DATE}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      out.push({ date: d.toISOString().slice(0, 10), count: perDay });
    }
    return out;
  }

  it("never sold (firstOrderAt null) → insufficient_data even though the dense array has 14 rows", () => {
    // The old dead-gate shape: 14 densified rows would read as "14 days
    // available" — the gate must catch the product that never sold.
    expect(deriveConfidence(uniformHistory(1, 14), { firstOrderAt: null, asOf: AS_OF })).toBe(
      "insufficient_data",
    );
  });

  it("first order 3 days ago → insufficient_data (zeros are 'not measured yet')", () => {
    expect(
      deriveConfidence(uniformHistory(1, 14), {
        firstOrderAt: new Date(AS_OF.getTime() - 3 * 86_400_000),
        asOf: AS_OF,
      }),
    ).toBe("insufficient_data");
  });

  it("first order 15 days ago with steady sales → real confidence tier (high)", () => {
    expect(
      deriveConfidence(uniformHistory(1, 14), {
        firstOrderAt: new Date(AS_OF.getTime() - 15 * 86_400_000),
        asOf: AS_OF,
      }),
    ).toBe("high");
  });

  it("boundary: first order exactly 14 days old is inside the forecastable window", () => {
    expect(
      deriveConfidence(uniformHistory(1, 14), {
        firstOrderAt: new Date(AS_OF.getTime() - 14 * 86_400_000),
        asOf: AS_OF,
      }),
    ).toBe("high");
  });

  it("legacy sparse-input fallback preserved: < 14 rows without opts → insufficient_data", () => {
    expect(deriveConfidence(uniformHistory(1, 13))).toBe("insufficient_data");
    expect(deriveConfidence([])).toBe("insufficient_data");
  });
});

describe("runForecast — insufficient_data gate at the service level (A6-P2-2)", () => {
  it("zero-sales product: insufficient_data row with NULL metrics, no fabricated stock×10 runout", async () => {
    const neverSold = await seedProduct("Never Sold");
    await seedStock(neverSold, 3); // stock 3 — old code fabricated +30d runout

    const result = await runForecast();

    expect(result.outcome).toBe("success");
    expect(result.productsPredicted).toBe(0);
    expect(result.productsSkipped.insufficient_data).toBe(1);

    const [row] = await db
      .select()
      .from(inventoryForecastsTable)
      .where(sql`${inventoryForecastsTable.productId} = ${neverSold}`);
    expect(row.confidence).toBe("insufficient_data");
    expect(row.avgDailySales).toBeNull();
    expect(row.dowBlend7d).toBeNull();
    expect(row.predictedDemand7d).toBeNull();
    expect(row.predictedDemand30d).toBeNull();
    // THE regression: the old dead gate produced forecast_date + 30 here.
    expect(row.predictedRunoutAt).toBeNull();
    expect(row.recommendedReorderQty).toBeNull();
    expect(row.atRisk).toBe(false);
  });

  it("product with ≥14 days of real history: real forecast with non-null metrics", async () => {
    const steady = await seedProduct("Steady Seller");
    await seedStock(steady, 5);
    const user = await seedUser();
    for (let days = 20; days >= 1; days--) {
      await seedOrder(user, steady, days); // 1 order/day for 20 days
    }

    const result = await runForecast();

    expect(result.outcome).toBe("success");
    expect(result.productsPredicted).toBe(1);
    expect(result.productsSkipped.insufficient_data ?? 0).toBe(0);

    const [row] = await db
      .select()
      .from(inventoryForecastsTable)
      .where(sql`${inventoryForecastsTable.productId} = ${steady}`);
    expect(row.confidence).toBe("high");
    expect(Number(row.avgDailySales)).toBe(1);
    // floor(5 / max(1, 0.1)) = 5 → runout at forecast_date + 5, NOT stock×10.
    expect(row.predictedRunoutAt).toBe(addDays(todayUtcDate(), 5));
    expect(row.predictedDemand7d).toBe(7);
    expect(row.predictedDemand30d).toBe(30);
    expect(row.atRisk).toBe(true);
  });

  it("young product (first sale 5 days ago) is gated even with sales every day", async () => {
    const young = await seedProduct("Young Product");
    await seedStock(young, 10);
    const user = await seedUser();
    for (let days = 5; days >= 1; days--) {
      await seedOrder(user, young, days);
    }

    const result = await runForecast();

    expect(result.productsSkipped.insufficient_data).toBe(1);
    const [row] = await db
      .select()
      .from(inventoryForecastsTable)
      .where(sql`${inventoryForecastsTable.productId} = ${young}`);
    expect(row.confidence).toBe("insufficient_data");
    expect(row.predictedRunoutAt).toBeNull();
    expect(row.atRisk).toBe(false);
  });
});
