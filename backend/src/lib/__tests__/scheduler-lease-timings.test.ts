import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R108 (FH-A1 §9.8.3 + FH-A12 F-11) — PG-lease timer resolution.
 *
 * The r107 lease knobs (SCHEDULER_LEASE_TTL_SEC / SCHEDULER_LEASE_REFRESH_MS)
 * were resolved in module-load IIFEs with zero direct tests: the cap logic
 * (refresh ≤ TTL/2), the TTL floor (≥10 s), the refresh floor (1 s) and
 * the non-finite fallbacks were only ever exercised incidentally. R108
 * extracted the exact same logic into the pure `resolveLeaseTimings(env)`
 * so every rule is table-testable WITHOUT module resets — and one wiring
 * test proves the module-load call site still feeds the coordinator the
 * resolved values (env → EX on the Redis SET).
 *
 * Semantics pinned VERBATIM from the pre-R108 IIFEs (do not "improve"):
 *   - TTL: finite + ≥ 10 → floor(raw); anything else → 60.
 *   - refresh: non-finite or ≤ 0 → 25 000; else min(raw, TTL*1000/2)
 *     with a 1 000 ms floor after Math.floor.
 */

import { resolveLeaseTimings } from "../scheduler-coordinator";

const ENV_KEYS = ["SCHEDULER_LEASE_TTL_SEC", "SCHEDULER_LEASE_REFRESH_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("R108 — resolveLeaseTimings (r107 lease-knob semantics, now pure)", () => {
  it("defaults: unset env → 60 s TTL / 25 s refresh (the r104 values)", () => {
    expect(resolveLeaseTimings({})).toEqual({ ttlSec: 60, refreshMs: 25_000 });
  });

  it("SCHEDULER_LEASE_REFRESH_MS=50000 with TTL=60 is capped at half the TTL (30000)", () => {
    expect(
      resolveLeaseTimings({ SCHEDULER_LEASE_TTL_SEC: "60", SCHEDULER_LEASE_REFRESH_MS: "50000" }),
    ).toEqual({ ttlSec: 60, refreshMs: 30_000 });
  });

  it("TTL below the 10 s floor falls back to 60 (fail-safe failover window)", () => {
    expect(resolveLeaseTimings({ SCHEDULER_LEASE_TTL_SEC: "5" })).toEqual({
      ttlSec: 60,
      refreshMs: 25_000,
    });
  });

  it("TTL=10 with unset refresh → the UNCAPPED 25 s fallback (verbatim r107 quirk)", () => {
    // The fallback returns EARLY, before the half-TTL cap: only an
    // EXPLICITLY SET refresh value is capped. So TTL=10 + unset refresh
    // yields a 25 s refresh against a 10 s TTL (the lease expires
    // between refreshes). Pinned as-is — R108 must not "improve" r107
    // semantics; changing this needs its own deliberate decision.
    expect(resolveLeaseTimings({ SCHEDULER_LEASE_TTL_SEC: "10" })).toEqual({
      ttlSec: 10,
      refreshMs: 25_000,
    });
  });

  it("TTL=10 with an EXPLICIT refresh → capped to half the TTL (5000)", () => {
    expect(
      resolveLeaseTimings({ SCHEDULER_LEASE_TTL_SEC: "10", SCHEDULER_LEASE_REFRESH_MS: "25000" }),
    ).toEqual({ ttlSec: 10, refreshMs: 5_000 });
  });

  it("non-finite garbage falls back on BOTH knobs (NaN TTL + NaN refresh)", () => {
    expect(
      resolveLeaseTimings({
        SCHEDULER_LEASE_TTL_SEC: "not-a-number",
        SCHEDULER_LEASE_REFRESH_MS: "also-not-a-number",
      }),
    ).toEqual({ ttlSec: 60, refreshMs: 25_000 });
  });

  it("empty-string / zero / negative refresh values are the fallback class (Number('') === 0)", () => {
    for (const bad of ["", "0", "-5000"]) {
      expect(resolveLeaseTimings({ SCHEDULER_LEASE_REFRESH_MS: bad })).toEqual({
        ttlSec: 60,
        refreshMs: 25_000,
      });
    }
  });

  it("the 1 s refresh floor: a sub-second explicit refresh never starves the refresher", () => {
    // TTL=10 → cap 5000; raw 5 → capped 5 → floored to the 1000 ms minimum.
    expect(
      resolveLeaseTimings({ SCHEDULER_LEASE_TTL_SEC: "10", SCHEDULER_LEASE_REFRESH_MS: "5" }),
    ).toEqual({ ttlSec: 10, refreshMs: 1_000 });
  });

  it("fractional TTL floors DOWN, and an explicit refresh cap uses the floored TTL", () => {
    // floor(10.9) = 10 → cap = 5000, not 5450.
    expect(
      resolveLeaseTimings({ SCHEDULER_LEASE_TTL_SEC: "10.9", SCHEDULER_LEASE_REFRESH_MS: "25000" }),
    ).toEqual({ ttlSec: 10, refreshMs: 5_000 });
  });

  it("the documented single-container values (TTL=120, REFRESH=50000) survive uncapped", () => {
    // 120*1000/2 = 60000 > 50000 → no cap: exactly the r107 suggested pair.
    expect(
      resolveLeaseTimings({
        SCHEDULER_LEASE_TTL_SEC: "120",
        SCHEDULER_LEASE_REFRESH_MS: "50000",
      }),
    ).toEqual({ ttlSec: 120, refreshMs: 50_000 });
  });
});

describe("R108 — resolveLeaseTimings wiring (module-load constants feed the coordinator)", () => {
  it("SCHEDULER_LEASE_TTL_SEC=120 flows into the Redis SET's EX (env → module load → acquire)", async () => {
    process.env.SCHEDULER_LEASE_TTL_SEC = "120";
    const { acquireSchedulerLeadership } = await import("../scheduler-coordinator");

    const set = vi.fn(() => Promise.resolve("OK"));
    const get = vi.fn<(rawKey: string) => Promise<string | null>>(() => Promise.resolve(null));
    const redis = { set, get, expire: vi.fn(), del: vi.fn() };

    const leadership = await acquireSchedulerLeadership(redis as never);
    expect(leadership.isLeader).toBe(true);
    // The exact r107 wiring contract: the TTL from the env is what the
    // lock (and the PG lease) is created with.
    expect(set).toHaveBeenCalledWith("scheduler:leader", leadership.instanceId, {
      NX: true,
      EX: 120,
    });

    get.mockImplementation(() => Promise.resolve(leadership.instanceId));
    await leadership.release();
  });
});
