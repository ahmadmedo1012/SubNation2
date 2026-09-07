import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  adminAlertsTable,
  inventoryForecastsTable,
  inventoryForecastRunsTable,
  productsTable,
} from "../../../test/db";

// A6-P2-3 (round-93): mock the SRE alerting service — what's under test is
// the ROUTING through logAdminAlert (durable dedupe_key + socket fan-out),
// not the Telegram/Discord dispatch itself.
vi.mock("../../alerting.service", () => ({
  alertingService: { dispatchAlert: vi.fn(async () => []) },
}));

import { alertingService } from "../../alerting.service";
import { dispatchForecastAlerts } from "../alerts";
import { addDays, todayUtcDate } from "../../../lib/forecast/dates";

const dispatchAlertMock = vi.mocked(alertingService.dispatchAlert);

/**
 * 93-A6 P2#3 (round-93) — forecast alerts route through logAdminAlert.
 *
 * The old code did a raw `db.insert(adminAlertsTable)` with NO dedupe_key
 * and NO socket emit; the only suppression was the Redis NX claim, which
 * silently degrades to "emit anyway" on the Redis-less live production
 * topology. Every daily run would have re-alerted every at-risk product
 * into the drawer forever — the round-5 spam class through a side door.
 *
 * These tests pin the new contract on the harness (no Redis —
 * getRedisClient() returns null, exactly matching live prod):
 *   - insert carries dedupe_key `forecast:stockout:{pid}` (7-day window)
 *   - a second dispatch within the window inserts NOTHING and skips the
 *     outbound dispatch too
 *   - low-confidence rows are not alert candidates at all
 *
 * The forecast tables are not part of the shared harness DDL — provisioned
 * locally per-file (same pattern as forecast-gate.test.ts).
 */

const FORECAST_DDL = [
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
];

beforeAll(async () => {
  await initTestDb();
  for (const stmt of FORECAST_DDL) await db.execute(stmt);
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
  await db.execute(
    sql`TRUNCATE TABLE inventory_forecast_runs, inventory_forecasts RESTART IDENTITY CASCADE`,
  );
  dispatchAlertMock.mockClear();
});

async function seedAtRiskRun(
  productName: string,
  confidence: "high" | "medium" | "low",
): Promise<{ runId: number; productId: number }> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: productName, price: "10.00" })
    .returning({ id: productsTable.id });
  const [run] = await db.insert(inventoryForecastRunsTable).values({}).returning({
    id: inventoryForecastRunsTable.id,
  });
  await db.insert(inventoryForecastsTable).values({
    runId: run.id,
    productId: p.id,
    forecastDate: todayUtcDate(),
    currentStockOnHand: 2,
    predictedRunoutAt: addDays(todayUtcDate(), 2), // within the 3-day predicate
    confidence,
    atRisk: true,
  });
  return { runId: run.id, productId: p.id };
}

describe("dispatchForecastAlerts — logAdminAlert routing (A6-P2-3)", () => {
  it("inserts a forecast_stockout row with the durable dedupe key and dispatches once", async () => {
    const { runId, productId } = await seedAtRiskRun("At Risk Product", "high");

    const result = await dispatchForecastAlerts(runId);

    expect(result).toEqual({ alertsEmitted: 1, alertsCapped: false, paused: false });
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("forecast_stockout");
    expect(alerts[0].dedupeKey).toBe(`forecast:stockout:${productId}`);
    // The structured payload survives the routing (drawer parses it).
    const payload = JSON.parse(alerts[0].message!);
    expect(payload.kind).toBe("forecast_stockout");
    expect(payload.product_id).toBe(productId);
    expect(payload.confidence).toBe("high");
    expect(dispatchAlertMock).toHaveBeenCalledTimes(1);
    expect(dispatchAlertMock.mock.calls[0][0].rule).toBe("forecast_stockout");
  });

  it("second dispatch inside the 7-day window: no insert, no outbound re-dispatch", async () => {
    const { runId } = await seedAtRiskRun("Dedupe Product", "high");

    await dispatchForecastAlerts(runId);
    // The next daily run (or a scheduler double-fire) sees the same
    // candidates — the DB dedupe key, not Redis, must suppress everything.
    const second = await dispatchForecastAlerts(runId);

    expect(second.alertsEmitted).toBe(0);
    expect(await db.select().from(adminAlertsTable)).toHaveLength(1);
    expect(dispatchAlertMock).toHaveBeenCalledTimes(1);
  });

  it("low-confidence forecasts are not alert candidates", async () => {
    const { runId } = await seedAtRiskRun("Low Confidence", "low");

    const result = await dispatchForecastAlerts(runId);

    expect(result.alertsEmitted).toBe(0);
    expect(await db.select().from(adminAlertsTable)).toHaveLength(0);
    expect(dispatchAlertMock).not.toHaveBeenCalled();
  });
});
