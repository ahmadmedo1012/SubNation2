import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, execTestSql, idempotencyKeysTable, initTestDb } from "../../test/db";
import { getRegistry } from "../metrics";
import {
  __resetIdempotencyTableProbeForTests,
  findIdempotentOrderId,
  probeIdempotencyTable,
} from "../idempotency";

/**
 * R135 (BE-1, repo audit #9) — 42P01 degradation observability +
 * self-healing for the durable purchase-dedup guard (lib/idempotency.ts).
 *
 * The audit item: "a dropped idempotency_keys table mid-process silently
 * disables the guard" — the latch cleared only at the next process boot,
 * with no signal anywhere. The R135 contract pinned here:
 *
 *   1. latch set → the `idempotency_degraded` Prometheus gauge reads 1
 *      (the silent-disable state is now observable on /api/metrics);
 *   2. a SUCCESSFUL re-probe (table back) → latch cleared + gauge 0 and
 *      the guard is genuinely re-armed (a lookup resolves against the
 *      restored table, not the pass-through null);
 *   3. a FAILED re-probe (table still missing) → stays degraded — no
 *      false recovery;
 *   4. the hourly unref'd re-probe TIMER (armed only while latched)
 *      fires the probe and recovers without a restart.
 *
 * The harness DDL deliberately does NOT create idempotency_keys (only
 * the suites that need the guard create it ad hoc) — which is exactly
 * the degraded state under test: for this file the table genuinely does
 * not exist unless a test (re-)creates it, the same mid-process DROP the
 * audit item describes.
 */

// The V1-M20 (post-fix) shape used by the routes suites: plain integer
// order_id, no FK — inserting a claim row needs no orders row.
const IDEMPOTENCY_DDL = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  order_id integer,
  reference_type varchar(32) NOT NULL DEFAULT 'order',
  body_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

/** prom-client's getMetricsAsJSON() shape, narrowed to what we read. */
type GaugeMetricJson = { name: string; values: Array<{ value: number }> };

async function idempotencyDegradedValue(): Promise<number> {
  const metrics = (await getRegistry().getMetricsAsJSON()) as unknown as GaugeMetricJson[];
  const gauge = metrics.find((m) => m.name === "idempotency_degraded");
  if (!gauge || gauge.values.length === 0) {
    throw new Error("idempotency_degraded gauge is not registered");
  }
  return gauge.values[0]!.value;
}

/** Drop the backing table — the mid-process DROP the audit item describes. */
async function dropIdempotencyTable(): Promise<void> {
  await execTestSql("DROP TABLE IF EXISTS idempotency_keys");
}

/** Latch the 42P01 probe the production way: a real lookup against the missing table. */
function latchViaMissingTable() {
  return findIdempotentOrderId("u1:degradation-latch-key");
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  // Start every test in the degraded universe: table gone, latch re-armed,
  // gauge back to 0 (the seam routes through clearTableMissing so the
  // latch, the gauge, and any leftover re-probe timer can never disagree).
  await dropIdempotencyTable();
  __resetIdempotencyTableProbeForTests();
});

describe("R135 (BE-1) — the 42P01 latch is observable (idempotency_degraded gauge)", () => {
  it("a lookup against the missing table latches AND flips the gauge to 1", async () => {
    const result = await latchViaMissingTable();
    // Pre-F10 pass-through semantics are unchanged: null, never a throw.
    expect(result).toBeNull();
    // The new half: the silent-disable state is now a metric.
    await expect(idempotencyDegradedValue()).resolves.toBe(1);
  });

  it("subsequent latched lookups keep the pass-through null and the gauge at 1", async () => {
    await latchViaMissingTable();
    const second = await findIdempotentOrderId("u1:degradation-latch-key-2");
    expect(second).toBeNull();
    await expect(idempotencyDegradedValue()).resolves.toBe(1);
  });
});

describe("R135 (BE-1) — re-probe: self-healing without a restart", () => {
  it("a SUCCESSFUL re-probe clears the latch, flips the gauge to 0, and re-arms the guard", async () => {
    await latchViaMissingTable();
    expect(await idempotencyDegradedValue()).toBe(1);

    // The table comes back (operator restore / migration landed).
    await execTestSql(IDEMPOTENCY_DDL);
    await expect(probeIdempotencyTable()).resolves.toBe(true);
    await expect(idempotencyDegradedValue()).resolves.toBe(0);

    // Genuinely re-armed: the lookup now resolves against the restored
    // table instead of the latched pass-through null.
    await db
      .insert(idempotencyKeysTable)
      .values({ key: "u1:rearmed-key", orderId: 4217, referenceType: "order" });
    await expect(findIdempotentOrderId("u1:rearmed-key", "order")).resolves.toEqual({
      orderId: 4217,
      bodyHash: null,
    });
    await expect(idempotencyDegradedValue()).resolves.toBe(0);
  });

  it("a FAILED re-probe (table still missing) keeps the guard degraded", async () => {
    await latchViaMissingTable();
    expect(await idempotencyDegradedValue()).toBe(1);

    // No restore — the probe answers false and nothing flips.
    await expect(probeIdempotencyTable()).resolves.toBe(false);
    await expect(idempotencyDegradedValue()).resolves.toBe(1);

    // Still pass-through: the guard did not falsely re-arm.
    await expect(latchViaMissingTable()).resolves.toBeNull();
    await expect(idempotencyDegradedValue()).resolves.toBe(1);
  });

  it("the probe never latches a HEALTHY process (failure without the latch is silent-free)", async () => {
    // Healthy + table present: probe true, no side effects.
    await execTestSql(IDEMPOTENCY_DDL);
    await expect(probeIdempotencyTable()).resolves.toBe(true);
    await expect(idempotencyDegradedValue()).resolves.toBe(0);

    // Healthy + table MISSING again (fresh boot, no query has latched
    // yet): the probe reports false but does NOT engage the latch —
    // only real guard queries own the latch, the probe only clears it.
    await dropIdempotencyTable();
    await expect(probeIdempotencyTable()).resolves.toBe(false);
    await expect(idempotencyDegradedValue()).resolves.toBe(0);
    // ...and the guard is still armed, so the next lookup latches for real.
    await expect(latchViaMissingTable()).resolves.toBeNull();
    await expect(idempotencyDegradedValue()).resolves.toBe(1);
  });
});

describe("R135 (BE-1) — the hourly re-probe TIMER (armed only while degraded)", () => {
  it("fires after 60 min and recovers the guard when the table is back", async () => {
    // Fake timers BEFORE the latch so the re-probe interval is faked
    // (same DB-under-fake-timers harness shape as openwa-epoch-memory).
    vi.useFakeTimers();
    try {
      await latchViaMissingTable();
      expect(await idempotencyDegradedValue()).toBe(1);

      // The table returns mid-process; nothing notices until the timer.
      await execTestSql(IDEMPOTENCY_DDL);
      expect(await idempotencyDegradedValue()).toBe(1);

      // One hour passes — the guarded interval runs the probe.
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      await expect(idempotencyDegradedValue()).resolves.toBe(0);

      // And the guard answers real lookups again.
      await db
        .insert(idempotencyKeysTable)
        .values({ key: "u1:timer-recovered-key", orderId: 991, referenceType: "order" });
      await expect(findIdempotentOrderId("u1:timer-recovered-key", "order")).resolves.toEqual({
        orderId: 991,
        bodyHash: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays degraded across timer fires while the table is still missing", async () => {
    vi.useFakeTimers();
    try {
      await latchViaMissingTable();
      expect(await idempotencyDegradedValue()).toBe(1);

      // Three hourly fires against a still-missing table: no recovery,
      // no throw, the latch holds (audit #3 — no false recovery).
      await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
      await expect(idempotencyDegradedValue()).resolves.toBe(1);
      await expect(latchViaMissingTable()).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Guard against accidental gauge-shape drift: the metric must surface in
// the Prometheus exposition exactly as the /admin alert rules would read it.
describe("R135 (BE-1) — exposition shape", () => {
  it("idempotency_degraded appears in the registry's text exposition", async () => {
    await latchViaMissingTable();
    const text = await getRegistry().metrics();
    // Unlabeled gauge → the bare `name value` exposition line (what the
    // /api/metrics surface and any alert rule would scrape).
    expect(text).toContain("# TYPE idempotency_degraded gauge");
    expect(text).toMatch(/^idempotency_degraded\s+1$/m);
  });
});
