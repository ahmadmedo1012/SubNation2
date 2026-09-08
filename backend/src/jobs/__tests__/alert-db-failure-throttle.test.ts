import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb } from "../../test/db";
import {
  __resetAlertDbFailureThrottleForTests,
  logAdminAlert,
} from "../alertLogger";

/**
 * F9 (round-94 A6) — DB failure must not become a phone-spam channel.
 *
 * logAdminAlert's catch deliberately keeps the side-channel green light ON
 * for the FIRST failure (the underlying condition is real), but the old
 * code re-lit it on EVERY cycle: with stockWatcher's 30-minute cadence, a
 * day-long DB outage meant ~48 Telegram messages per out-of-stock product
 * — the operator's phone spammed precisely while the alert drawer itself
 * was down. The fix throttles the green light to once per hour per
 * identity; the insert keeps retrying every cycle.
 *
 * DB failures are simulated by dropping `admin_alerts` on the pglite
 * harness (every statement in logAdminAlert then throws), then restoring
 * the pristine harness DDL.
 */

const ENV_KEYS = ["ALERT_DB_FAILURE_THROTTLE_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

// Same DDL as the harness (test/db.ts) — restore after the drop.
// IF NOT EXISTS: idempotent restore (the recovery test re-creates the
// table mid-test; afterEach must not 42P07 on it).
const ALERTS_DDL = `
CREATE TABLE IF NOT EXISTS admin_alerts (
  id serial PRIMARY KEY,
  type varchar(30) NOT NULL DEFAULT 'system',
  title varchar(255) NOT NULL,
  message text,
  is_read boolean NOT NULL DEFAULT false,
  dedupe_key varchar(100),
  created_at timestamptz NOT NULL DEFAULT now()
)`;

async function dropAlertsTable(): Promise<void> {
  await db.execute(sql.raw("DROP TABLE IF EXISTS admin_alerts"));
}

async function restoreAlertsTable(): Promise<void> {
  await db.execute(sql.raw(ALERTS_DDL));
  await db.execute(
    sql.raw(
      "CREATE INDEX IF NOT EXISTS idx_admin_alerts_dedupe_key ON admin_alerts (dedupe_key, created_at)",
    ),
  );
}

async function alertsRowCount(): Promise<number> {
  const result = await db.execute(sql`SELECT count(*) AS c FROM admin_alerts`);
  const rows = (result as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

beforeAll(initTestDb, 60_000);

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // 60 ms window: immediate re-calls throttled, calls after a short wait
  // re-lit — the same shape as production's 1 h vs 30 min cadence.
  process.env.ALERT_DB_FAILURE_THROTTLE_MS = "60";
  __resetAlertDbFailureThrottleForTests();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await restoreAlertsTable();
});

describe("F9 — DB-failure side-channel throttle (once per hour, not per cycle)", () => {
  it("first failure lights the side channels; immediate re-cycles are suppressed", async () => {
    await dropAlertsTable();

    const first = await logAdminAlert("no_stock", "نفاد المخزون: A", "m", {
      dedupeKey: "stock:zero:1",
    });
    expect(first.suppressed).toBe(false); // the real condition still pages once
    expect(first.id).toBeNull();

    // stockWatcher cadence: same condition, next 30-minute cycles.
    const second = await logAdminAlert("no_stock", "نفاد المخزون: A", "m", {
      dedupeKey: "stock:zero:1",
    });
    const third = await logAdminAlert("no_stock", "نفاد المخزون: A", "m", {
      dedupeKey: "stock:zero:1",
    });
    expect(second.suppressed).toBe(true);
    expect(third.suppressed).toBe(true);
  });

  it("the green light repeats only after the window elapses (1/hour, not 1/cycle)", async () => {
    await dropAlertsTable();

    expect(
      (await logAdminAlert("no_stock", "نفاد المخزون: B", "m", { dedupeKey: "stock:zero:2" }))
        .suppressed,
    ).toBe(false);

    await new Promise((r) => setTimeout(r, 90)); // past the 60 ms test window

    expect(
      (await logAdminAlert("no_stock", "نفاد المخزون: B", "m", { dedupeKey: "stock:zero:2" }))
        .suppressed,
    ).toBe(false);
  });

  it("different identities throttle independently (each product pages once)", async () => {
    await dropAlertsTable();

    for (const key of ["stock:zero:1", "stock:zero:2", "stock:zero:3"]) {
      expect(
        (await logAdminAlert("no_stock", `نفاد المخزون: ${key}`, "m", { dedupeKey: key }))
          .suppressed,
      ).toBe(false);
    }
    // Second cycle for each: all throttled, none of them silencing the others.
    for (const key of ["stock:zero:1", "stock:zero:2", "stock:zero:3"]) {
      expect(
        (await logAdminAlert("no_stock", `نفاد المخزون: ${key}`, "m", { dedupeKey: key }))
          .suppressed,
      ).toBe(true);
    }
  });

  it("keyless alerts fall back to type+title as the throttle identity", async () => {
    await dropAlertsTable();

    expect((await logAdminAlert("system", "عنوان", "m")).suppressed).toBe(false);
    expect((await logAdminAlert("system", "عنوان", "m")).suppressed).toBe(true);
    // A different title is a different identity.
    expect((await logAdminAlert("system", "عنوان آخر", "m")).suppressed).toBe(false);
  });

  it("recovery: once the DB answers again the normal dedupe path resumes", async () => {
    await dropAlertsTable();
    expect(
      (await logAdminAlert("no_stock", "نفاد المخزون: R", "m", { dedupeKey: "stock:zero:9" }))
        .suppressed,
    ).toBe(false);

    await restoreAlertsTable();
    const outcome = await logAdminAlert("no_stock", "نفاد المخزون: R", "m", {
      dedupeKey: "stock:zero:9",
    });
    expect(outcome.suppressed).toBe(false);
    expect(typeof outcome.id).toBe("number");
    expect(await alertsRowCount()).toBe(1);
  });
});
