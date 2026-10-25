import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, execTestSql, initTestDb, resetTestDb } from "../../test/db";

/**
 * R146 audit F1 — every Redis op in the risk pipeline is bounded.
 *
 * The R2/F3 rule ("a ready-but-black-holed socket must never queue a
 * command forever") covered only the GET in risk-config-cache.service.ts;
 * the SET / DEL / PUBLISH / subscriber-connect and the degraded-flag SET
 * in risk-scoring.service.ts were raw awaits. In the black-holed-socket
 * outage class that is exactly F3's documented failure, getRiskConfig
 * never settled after the DB read had already SUCCEEDED — every
 * scoreEvent fire-and-forget promise piled up with zero Sentry signal,
 * and the admin PUT /api/admin/risk/config hung on the unbounded
 * del/publish.
 *
 * Here the client's every command (get/set/del/publish and the
 * subscriber's connect) NEVER settles; the REAL withRedisCommandTimeout
 * (kept via importOriginal) must convert each hang into a fast rejection
 * the existing catch blocks already swallow. If any of the five wraps is
 * removed, the matching await never settles and the test times out.
 */

const { redisState } = vi.hoisted(() => ({ redisState: { client: null as unknown } }));

vi.mock("../../lib/redis-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/redis-client")>();
  return { ...actual, getRedisClient: () => redisState.client };
});

/** A ready-but-black-holed socket: commands queue forever, never settle. */
const blackHole = () => new Promise<never>(() => {});
function makeBlackHoledClient(): Record<string, () => unknown> {
  return {
    get: blackHole,
    set: blackHole,
    del: blackHole,
    publish: blackHole,
    connect: blackHole,
    subscribe: blackHole,
    // R146 review F1: the real duplicate gets an "error" listener before
    // connect and a best-effort disconnect() on timeout — mirror the
    // surface so the bounded-connect path runs the real code shape.
    on: () => {},
    disconnect: () => {},
    duplicate: () => makeBlackHoledClient(),
  };
}

import { getRiskConfig, invalidateRiskConfig } from "../risk-config-cache.service";
import { scoreEvent } from "../risk-scoring.service";
import { invalidateUserAggregate } from "../../lib/risk-aggregate";

const SAVED_TIMEOUT_MS = process.env.REDIS_COMMAND_TIMEOUT_MS;

beforeAll(async () => {
  await initTestDb();
  // risk_config is not in the shared harness DDL (same block as
  // risk-scoring.test.ts) — needed so the DB read succeeds and the
  // bounded SET path actually runs. risk_events/risk_rules are
  // deliberately NOT created: their absence drives the persist failure
  // (→ markPipelineDegraded) in the third case.
  await execTestSql(`CREATE TABLE IF NOT EXISTS risk_config (
  id integer PRIMARY KEY DEFAULT 1,
  thresholds jsonb NOT NULL,
  allowlist jsonb NOT NULL,
  auto_block_enabled jsonb NOT NULL,
  require_approval_user_ids jsonb NOT NULL DEFAULT '[]',
  model_enabled boolean NOT NULL DEFAULT false,
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now()
)`);
  // Keep the black-holed commands cheap: 50 ms per bounded op.
  process.env.REDIS_COMMAND_TIMEOUT_MS = "50";
  redisState.client = makeBlackHoledClient();
});

afterAll(() => {
  if (SAVED_TIMEOUT_MS === undefined) delete process.env.REDIS_COMMAND_TIMEOUT_MS;
  else process.env.REDIS_COMMAND_TIMEOUT_MS = SAVED_TIMEOUT_MS;
  delete process.env.RISK_PIPELINE_ENABLED;
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE risk_config"));
  // Clear the module-level in-memory cache so every case re-runs the
  // full redis → db path (bounded connect + get + set).
  await invalidateRiskConfig();
  delete process.env.RISK_PIPELINE_ENABLED;
});

describe("R146 F1 — risk pipeline Redis ops are bounded (black-holed socket)", () => {
  it("getRiskConfig settles and auto-seeds defaults (bounded connect + get + set)", async () => {
    const snap = await getRiskConfig();

    expect(snap).toMatchObject({
      modelEnabled: false,
      thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
    });
  });

  it("invalidateRiskConfig settles (bounded del + publish)", async () => {
    // Seed the in-memory cache first so the invalidation has state to clear.
    await getRiskConfig();
    await expect(invalidateRiskConfig()).resolves.toBeUndefined();
  });

  it("R187 (G-F2): invalidateUserAggregate settles when DEL black-holes (the last unwrapped command)", async () => {
    // risk-aggregate's get (:49) and cachePut (:111) were bounded by
    // 99-R1/R2; the del in invalidateUserAggregate was the ONLY unwrapped
    // Redis command left in the backend — pre-fix this await never settled
    // and the test times out.
    await expect(invalidateUserAggregate(42)).resolves.toBeUndefined();
  });

  it("scoreEvent settles when the degraded-flag SET black-holes (persist fails → markPipelineDegraded)", async () => {
    process.env.RISK_PIPELINE_ENABLED = "true";
    // risk_events does not exist in this file → the persist insert throws →
    // markPipelineDegraded() runs against the black-holed client. Unbounded
    // (pre-R146), that await never settles and scoreEvent hangs.
    const result = await scoreEvent({
      eventType: "login_success",
      ruleContext: { event: { eventType: "login_success" } },
    });

    expect(result.degraded).toBe(true);
    expect(result.riskEventId).toBeNull();
  });
});
