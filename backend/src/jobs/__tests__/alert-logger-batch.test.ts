import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, adminAlertsTable } from "../../test/db";
import { __resetAlertDbFailureThrottleForTests, logAdminAlertBatch } from "../alertLogger";

/**
 * PERF #5 (R136) — logAdminAlertBatch: the sweep-batched twin of
 * logAdminAlert, behaviorally tested.
 *
 * The single form's dedupe/retention contracts are pinned by
 * alert-hygiene.test.ts (Round-5) and its DB-failure throttle by
 * alert-db-failure-throttle.test.ts (F9); the watcher notify-gating that
 * rides these outcomes by stock-notify-gate / coupon-watcher-gate
 * (A6-P2-1). This suite pins what the R136 batching change must NOT
 * regress — the batched form must be behaviorally the sequential form:
 *
 *   1. dedupe respected: an entry whose key has a recent row is skipped
 *      (no insert, suppressed outcome pointing at the existing row);
 *   2. ONE insert per sweep: the whole batch lands as a single multi-row
 *      INSERT into admin_alerts (the regression net for a future revert
 *      to per-entry inserts — the exact shape the stockWatcher sweep paid
 *      3 RTTs × catalog size for);
 *   3. suppressed keys are skipped: only fresh keys + keyless one-offs
 *      ever reach the INSERT;
 *   4. per-entry dedupe windows hold inside one batch (mixed windows);
 *   5. a duplicate key WITHIN one batch behaves like N sequential calls;
 *   6. the F9 DB-failure throttle keeps its per-identity semantics when
 *      the whole batch fails.
 *
 * The socket fan-out inside the batch is fire-and-forget failure-isolated
 * (dynamic import, same as the single form) — no mocking required (same
 * reliance-on-failure-isolation as alert-hygiene).
 */

beforeAll(async () => {
  await initTestDb();
}, 30_000);

beforeEach(async () => {
  await resetTestDb();
});

/** db.insert calls that targeted the alerts table (table identity filter). */
function alertInsertCalls(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((call: unknown[]) => call[0] === adminAlertsTable);
}

describe("logAdminAlertBatch — fresh inserts (Round-5 parity)", () => {
  it("inserts every fresh keyed entry in ONE multi-row INSERT, outcomes {suppressed:false, id}", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    try {
      const outcomes = await logAdminAlertBatch([
        { type: "no_stock", title: "نفاد المخزون: A", message: "m", opts: { dedupeKey: "k1" } },
        { type: "low_stock", title: "مخزون منخفض: B", message: "m", opts: { dedupeKey: "k2" } },
        { type: "no_stock", title: "نفاد المخزون: C", message: "m", opts: { dedupeKey: "k3" } },
      ]);

      // THE batching assertion: exactly ONE insert statement (the old
      // shape was one db.insert per entry — drizzle's fluent API puts the
      // row values on the chained .values(), so the statement count is
      // read off the insert calls; the row count below pins that the one
      // statement carried all three rows).
      const calls = alertInsertCalls(insertSpy);
      expect(calls).toHaveLength(1);

      expect(outcomes).toHaveLength(3);
      for (const outcome of outcomes) {
        expect(outcome.suppressed).toBe(false);
        expect(typeof outcome.id).toBe("number");
      }

      const rows = await db.select().from(adminAlertsTable);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.dedupeKey))).toEqual(new Set(["k1", "k2", "k3"]));
      expect(rows.every((r) => r.isRead === false)).toBe(true);
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("keyless entries always insert (the one-off contract), dedupeKey NULL", async () => {
    const outcomes = await logAdminAlertBatch([
      { type: "system", title: "تنبيه 1", message: "m" },
      { type: "system", title: "تنبيه 2", message: "m" },
    ]);
    expect(outcomes.map((o) => o.suppressed)).toEqual([false, false]);
    const rows = await db.select().from(adminAlertsTable);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.dedupeKey === null)).toBe(true);
  });

  it("an empty batch writes nothing and returns []", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    try {
      const outcomes = await logAdminAlertBatch([]);
      expect(outcomes).toEqual([]);
      expect(alertInsertCalls(insertSpy)).toHaveLength(0);
      expect(await db.select().from(adminAlertsTable)).toHaveLength(0);
    } finally {
      insertSpy.mockRestore();
    }
  });
});

describe("logAdminAlertBatch — dedupe (Round-5 parity, batched)", () => {
  it("suppresses an entry whose key has a recent row: no insert, outcome points at the existing row", async () => {
    // The pre-existing drawer row (minutes old — inside the 24h window).
    await db
      .insert(adminAlertsTable)
      .values({ type: "no_stock", title: "نفاد المخزون: A", message: "m", dedupeKey: "k1" });
    const [existing] = await db.select().from(adminAlertsTable);

    const insertSpy = vi.spyOn(db, "insert");
    try {
      const outcomes = await logAdminAlertBatch([
        { type: "no_stock", title: "نفاد المخزون: A", message: "m", opts: { dedupeKey: "k1" } },
        { type: "no_stock", title: "نفاد المخزون: B", message: "m", opts: { dedupeKey: "k2" } },
      ]);

      expect(outcomes[0]!.suppressed).toBe(true);
      expect(outcomes[0]!.id).toBe(existing.id);
      expect(outcomes[1]!.suppressed).toBe(false);
      expect(typeof outcomes[1]!.id).toBe("number");

      // Suppressed keys are SKIPPED: one insert call, and the DB ends with
      // seed + exactly one new row (the suppressed key never lands).
      const calls = alertInsertCalls(insertSpy);
      expect(calls).toHaveLength(1);

      const rows = await db.select().from(adminAlertsTable);
      expect(rows).toHaveLength(2); // seed + the one fresh insert
      expect(rows.filter((r) => r.dedupeKey === "k1")).toHaveLength(1);
      expect(rows.filter((r) => r.dedupeKey === "k2")).toHaveLength(1);
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("different keys never suppress each other", async () => {
    await logAdminAlertBatch([
      { type: "no_stock", title: "A", message: "m", opts: { dedupeKey: "k1" } },
      { type: "no_stock", title: "B", message: "m", opts: { dedupeKey: "k2" } },
    ]);
    expect(await db.select().from(adminAlertsTable)).toHaveLength(2);
  });

  it("a duplicate key WITHIN one batch behaves like N sequential calls (first claims, rest suppress)", async () => {
    const outcomes = await logAdminAlertBatch([
      { type: "no_stock", title: "A", message: "m", opts: { dedupeKey: "dup" } },
      { type: "no_stock", title: "A (again)", message: "m", opts: { dedupeKey: "dup" } },
    ]);
    expect(outcomes[0]!.suppressed).toBe(false);
    expect(outcomes[1]!.suppressed).toBe(true);
    // The suppressed twin points at the row the first entry inserted —
    // the same outcome two sequential logAdminAlert calls would produce.
    expect(outcomes[1]!.id).toBe(outcomes[0]!.id);

    const rows = await db.select().from(adminAlertsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("A"); // the FIRST entry's payload wins
  });

  it("per-entry dedupe windows hold inside one batch (mixed windows)", async () => {
    // Two rows seeded 2 days ago: outside the default 24h window, inside
    // a 7-day window. The batch must suppress ONLY the long-window entry.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db.insert(adminAlertsTable).values([
      { type: "no_stock", title: "short", message: "m", dedupeKey: "short" },
      { type: "no_stock", title: "long", message: "m", dedupeKey: "long" },
    ]);
    await db.execute(
      sql`UPDATE admin_alerts SET created_at = ${twoDaysAgo} WHERE dedupe_key IN ('short', 'long')`,
    );

    const outcomes = await logAdminAlertBatch([
      // default 24h window: the 2-day-old "short" row is OUTSIDE → fresh.
      { type: "no_stock", title: "short", message: "m", opts: { dedupeKey: "short" } },
      // 7-day window: the 2-day-old "long" row is INSIDE → suppressed.
      {
        type: "no_stock",
        title: "long",
        message: "m",
        opts: { dedupeKey: "long", dedupeWindowMs: 7 * 24 * 60 * 60 * 1000 },
      },
    ]);

    expect(outcomes[0]!.suppressed).toBe(false);
    expect(outcomes[1]!.suppressed).toBe(true);

    const rows = await db.select().from(adminAlertsTable);
    expect(rows).toHaveLength(3); // 2 seeded + 1 fresh insert for "short"
    expect(rows.filter((r) => r.dedupeKey === "short")).toHaveLength(2);
    expect(rows.filter((r) => r.dedupeKey === "long")).toHaveLength(1);
  });

  it("the whole sweep is ONE dedupe SELECT (mixed fresh + suppressed batch)", async () => {
    await db
      .insert(adminAlertsTable)
      .values({ type: "no_stock", title: "A", message: "m", dedupeKey: "k1" });

    const selectSpy = vi.spyOn(db, "select");
    try {
      await logAdminAlertBatch([
        { type: "no_stock", title: "A", message: "m", opts: { dedupeKey: "k1" } },
        { type: "no_stock", title: "B", message: "m", opts: { dedupeKey: "k2" } },
        { type: "no_stock", title: "C", message: "m", opts: { dedupeKey: "k3" } },
      ]);
      expect(selectSpy).toHaveBeenCalledTimes(1);
    } finally {
      selectSpy.mockRestore();
    }
  });
});

// ── F9 (round-94 A6) parity: DB-failure side-channel throttle ────────────────
//
// Same simulation as alert-db-failure-throttle.test.ts: drop admin_alerts
// so every statement in the batched path throws, then restore the pristine
// harness DDL. The green-light throttle must keep its per-identity
// semantics when a whole sweep fails at once.

const ENV_KEYS = ["ALERT_DB_FAILURE_THROTTLE_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

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

describe("logAdminAlertBatch — DB-failure side-channel throttle (F9 parity)", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // 60 ms window: immediate re-sweeps throttled, sweeps after a short
    // wait re-lit — the same shape as production's 1 h vs 30 min cadence.
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

  it("first failed sweep lights every side channel; immediate re-sweeps are throttled", async () => {
    await dropAlertsTable();

    const first = await logAdminAlertBatch([
      { type: "no_stock", title: "نفاد المخزون: A", message: "m", opts: { dedupeKey: "k1" } },
      { type: "no_stock", title: "نفاد المخزون: B", message: "m", opts: { dedupeKey: "k2" } },
    ]);
    expect(first.map((o) => o.suppressed)).toEqual([false, false]);
    expect(first.every((o) => o.id === null)).toBe(true);

    // Watcher cadence: same conditions, next sweeps.
    const second = await logAdminAlertBatch([
      { type: "no_stock", title: "نفاد المخزون: A", message: "m", opts: { dedupeKey: "k1" } },
      { type: "no_stock", title: "نفاد المخزون: B", message: "m", opts: { dedupeKey: "k2" } },
    ]);
    expect(second.map((o) => o.suppressed)).toEqual([true, true]);
  });

  it("different identities throttle independently inside one failed sweep's retries", async () => {
    await dropAlertsTable();
    await logAdminAlertBatch([
      { type: "no_stock", title: "A", message: "m", opts: { dedupeKey: "k1" } },
    ]);
    // k2 is a DIFFERENT identity — its side channel still lights once.
    const outcomes = await logAdminAlertBatch([
      { type: "no_stock", title: "B", message: "m", opts: { dedupeKey: "k2" } },
    ]);
    expect(outcomes[0]!.suppressed).toBe(false);
  });

  it("keyless entries fall back to type+title as the throttle identity", async () => {
    await dropAlertsTable();
    const first = await logAdminAlertBatch([{ type: "system", title: "عنوان", message: "m" }]);
    const second = await logAdminAlertBatch([{ type: "system", title: "عنوان", message: "m" }]);
    expect(first[0]!.suppressed).toBe(false);
    expect(second[0]!.suppressed).toBe(true);
    // A different title is a different identity.
    const other = await logAdminAlertBatch([{ type: "system", title: "عنوان آخر", message: "m" }]);
    expect(other[0]!.suppressed).toBe(false);
  });

  it("recovery: once the DB answers again the batched dedupe path resumes", async () => {
    await dropAlertsTable();
    await logAdminAlertBatch([
      { type: "no_stock", title: "R", message: "m", opts: { dedupeKey: "k9" } },
    ]);

    await restoreAlertsTable();
    const outcomes = await logAdminAlertBatch([
      { type: "no_stock", title: "R", message: "m", opts: { dedupeKey: "k9" } },
    ]);
    expect(outcomes[0]!.suppressed).toBe(false);
    expect(typeof outcomes[0]!.id).toBe("number");
    const rows = await db.select().from(adminAlertsTable);
    expect(rows).toHaveLength(1);
  });
});
