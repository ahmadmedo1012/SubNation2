import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R108 (final-hardening FH-A1 P0 §9.8.1) — SINGLE_INSTANCE_MODE wiring.
 *
 * On the single-container Oracle/Coolify target, the PG-lease refresher
 * (25 s refresh / 60 s TTL) kept Neon's compute awake 24/7 — 144
 * coordination queries/hour against a ~191.9 awake-hours/month free
 * allowance — while buying nothing (no second instance to arbitrate).
 * `SINGLE_INSTANCE_MODE=true` now declares this process the only
 * scheduler owner: synthetic in-process leadership, NO election, NO
 * lease heartbeat — while every job (heartbeat-if-Redis, alerting,
 * crons, boot one-shots) keeps running on its normal cadence.
 *
 * Pins (FH-A1 §9.8.1):
 *   - election machinery NEVER runs in single mode (no Neon coordination);
 *   - all leader jobs still start (heartbeat via getRedisClient, alerting,
 *     cron, the deferred boot one-shot chain);
 *   - scheduler state reports mode "single" + active + isLeader;
 *   - stop() drains jobs and resolves (release is the synthetic no-op);
 *   - DISABLE_WEB_SCHEDULERS=true still WINS (hard off-switch precedence);
 *   - only the exact (case-insensitive) string "true" engages single mode —
 *     every other spelling ("false"/"1"/"yes"/garbage/unset) takes the
 *     r107 election path (mode "embedded");
 *   - the no-Redis shape (REDIS_URL unset): heartbeat skipped AND the
 *     30 s recovery poll never armed (R104 AG1-2) — no leaked interval.
 *
 * The coordinator is mocked (its state machine is covered by
 * scheduler-coordinator.test.ts); the heavy job modules are mocked so the
 * test exercises web-scheduler's own wiring only — the exact scaffold of
 * web-scheduler-demotion.test.ts.
 */

vi.mock("../scheduler-coordinator", () => ({
  acquireSchedulerLeadership: vi.fn(),
}));

vi.mock("../../jobs/couponWatcher", () => ({
  checkExpiringCoupons: vi.fn(async () => undefined),
}));
vi.mock("../../jobs/stockWatcher", () => ({
  runStockSweep: vi.fn(async () => undefined),
  // R102: the orphan-inventory report joined the boot one-shot roster.
  reportOrphanInventory: vi.fn(async () => undefined),
}));
vi.mock("../../jobs/flashSaleWatcher", () => ({
  deactivateExpiredFlashSales: vi.fn(async () => undefined),
}));
vi.mock("../../jobs/copilot-reaper", () => ({
  reapExpiredCopilotPreviews: vi.fn(async () => 0),
}));
vi.mock("../../jobs/cron", () => ({ initCronJobs: vi.fn(() => ({ stop: vi.fn() })) }));
vi.mock("../../services/alerting.service", () => ({
  alertingService: { start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../../worker/heartbeat", () => ({ startHeartbeat: vi.fn(() => ({ stop: vi.fn() })) }));
// Boot one-shots — fire-and-forget async, mocked to instant no-ops.
vi.mock("../../jobs/alertLogger", () => ({
  markStaleUnreadAlertsRead: vi.fn(async () => 0),
  pruneReadAlerts: vi.fn(async () => 0),
}));
vi.mock("../../jobs/session-prune", () => ({ pruneExpiredSessions: vi.fn(async () => 0) }));
vi.mock("../../jobs/risk-retention", () => ({ reapExpiredRiskEvents: vi.fn(async () => ({})) }));
vi.mock("../../jobs/security-advisories", () => ({
  checkAdminTotpAdvisory: vi.fn(async () => undefined),
}));
vi.mock("../../jobs/cleanup-auth-activity", () => ({
  cleanupOldAuthActivity: vi.fn(async () => 0),
}));
// AUD103-8-F3 (r103): idempotency-retention joined the boot one-shot roster.
vi.mock("../../jobs/idempotency-retention", () => ({
  pruneOldIdempotencyKeys: vi.fn(async () => 0),
}));
// AUD103-1-F2 (r103): notifications retention (new job).
vi.mock("../../jobs/notifications-retention", () => ({
  pruneOldNotifications: vi.fn(async () => 0),
}));
vi.mock("../../services/whatsapp-otp.service", () => ({
  pruneExpiredOtps: vi.fn(async () => 0),
}));
vi.mock("../../lib/admin-session", () => ({
  pruneStaleAdminSessions: vi.fn(async () => 0),
}));

import { acquireSchedulerLeadership } from "../scheduler-coordinator";
import { initCronJobs } from "../../jobs/cron";
import { alertingService } from "../../services/alerting.service";
import { startHeartbeat } from "../../worker/heartbeat";
import { checkExpiringCoupons } from "../../jobs/couponWatcher";
import { runStockSweep, reportOrphanInventory } from "../../jobs/stockWatcher";
import { deactivateExpiredFlashSales } from "../../jobs/flashSaleWatcher";
import { reapExpiredCopilotPreviews } from "../../jobs/copilot-reaper";
import { pruneExpiredOtps } from "../../services/whatsapp-otp.service";
import { getSchedulerState } from "../scheduler-state";
import { startWebSchedulers } from "../web-scheduler";

// F2 (round-94 C6): web-scheduler resolves the heartbeat client via
// getRedisClient() at START time. Mocked with a swappable holder so the
// no-Redis shape (client → null) is reachable without re-importing.
const { redisState } = vi.hoisted(() => ({ redisState: { client: null as unknown } }));
vi.mock("../redis-client", () => ({
  getRedisClient: () => redisState.client,
}));

const fakeRedis = { get: vi.fn(), set: vi.fn() };

// R104 (AG6-6): stop every started handle afterEach — the deferred boot
// one-shot chain otherwise leaks a pending timer into the next test.
const activeHandles: Array<{ stop: () => Promise<void> }> = [];
function trackHandle(h: { stop: () => Promise<void> }) {
  activeHandles.push(h);
}

const ENV_KEYS = ["SINGLE_INSTANCE_MODE", "DISABLE_WEB_SCHEDULERS", "REDIS_URL"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // R104 (AG6-6): zero the boot one-shot deferral (real timers here).
  process.env.BOOT_ONE_SHOT_DELAY_MS = "0";
  redisState.client = fakeRedis;
  vi.mocked(acquireSchedulerLeadership).mockImplementation(async () => ({
    instanceId: "test-instance",
    isLeader: true,
    release: vi.fn(async () => {}),
  }));
});

afterEach(async () => {
  for (const h of activeHandles.splice(0)) {
    await h.stop().catch(() => undefined);
  }
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  delete process.env.BOOT_ONE_SHOT_DELAY_MS;
});

describe("R108 — SINGLE_INSTANCE_MODE=true: ungated in-process schedulers", () => {
  it("never elects, starts heartbeat + alerting + cron, and reports mode single", async () => {
    process.env.SINGLE_INSTANCE_MODE = "true";
    const handle = await startWebSchedulers(fakeRedis as never);
    trackHandle(handle);

    expect(handle.active).toBe(true);
    // THE economics pin (FH-A1 P0): zero coordination queries — the
    // election/lease machinery must not run at all.
    expect(acquireSchedulerLeadership).not.toHaveBeenCalled();
    // Synthetic in-process leadership.
    expect(handle.leadership?.isLeader).toBe(true);
    expect(handle.leadership?.instanceId).toBe(`single-instance-${process.pid}`);
    // Every leader job still starts exactly once (heartbeat resolved via
    // getRedisClient at start time — fakeRedis present here).
    expect(startHeartbeat).toHaveBeenCalledTimes(1);
    expect(alertingService.start).toHaveBeenCalledTimes(1);
    expect(initCronJobs).toHaveBeenCalledTimes(1);
    expect(getSchedulerState()).toMatchObject({
      mode: "single",
      active: true,
      isLeader: true,
    });
  });

  it("fires the deferred boot one-shot chain exactly once (same chain as an elected leader)", async () => {
    process.env.SINGLE_INSTANCE_MODE = "true";
    const handle = await startWebSchedulers(fakeRedis as never);
    trackHandle(handle);
    expect(handle.active).toBe(true);

    // BOOT_ONE_SHOT_DELAY_MS=0 (beforeEach) — flush the fire-and-forget
    // microtasks with the demotion suite's waitFor pattern.
    await vi.waitFor(() => {
      expect(checkExpiringCoupons).toHaveBeenCalledTimes(1);
      expect(runStockSweep).toHaveBeenCalledTimes(1);
      expect(reportOrphanInventory).toHaveBeenCalledTimes(1);
      expect(deactivateExpiredFlashSales).toHaveBeenCalledTimes(1);
      expect(reapExpiredCopilotPreviews).toHaveBeenCalledTimes(1);
      expect(pruneExpiredOtps).toHaveBeenCalledTimes(1);
    });
  });

  it("stop() drains alerting + cron and resolves (release is the synthetic no-op)", async () => {
    process.env.SINGLE_INSTANCE_MODE = "true";
    const handle = await startWebSchedulers(fakeRedis as never);
    trackHandle(handle);

    await expect(handle.stop()).resolves.toBeUndefined();
    expect(handle.active).toBe(false);
    expect(alertingService.stop).toHaveBeenCalledTimes(1);
    expect(vi.mocked(initCronJobs).mock.results[0]?.value.stop).toHaveBeenCalledTimes(1);
    // Still no election — release was the in-process no-op, not a lock op.
    expect(acquireSchedulerLeadership).not.toHaveBeenCalled();

    // Idempotent shutdown.
    await handle.stop();
    expect(alertingService.stop).toHaveBeenCalledTimes(1);
  });

  it("DISABLE_WEB_SCHEDULERS=true WINS over SINGLE_INSTANCE_MODE=true (hard off-switch)", async () => {
    process.env.SINGLE_INSTANCE_MODE = "true";
    process.env.DISABLE_WEB_SCHEDULERS = "true";
    const handle = await startWebSchedulers(fakeRedis as never);
    trackHandle(handle);

    expect(handle.active).toBe(false);
    expect(handle.reason).toBe("disabled_by_env");
    expect(acquireSchedulerLeadership).not.toHaveBeenCalled();
    expect(alertingService.start).not.toHaveBeenCalled();
    expect(initCronJobs).not.toHaveBeenCalled();
    expect(startHeartbeat).not.toHaveBeenCalled();
    expect(getSchedulerState()).toMatchObject({
      mode: "dedicated",
      active: false,
      isLeader: false,
      reason: "disabled_by_env",
    });
  });

  it('the flag is exact-match "true" (case-insensitive) — "TRUE" also engages single mode', async () => {
    process.env.SINGLE_INSTANCE_MODE = "TRUE";
    const handle = await startWebSchedulers(fakeRedis as never);
    trackHandle(handle);

    expect(handle.active).toBe(true);
    expect(acquireSchedulerLeadership).not.toHaveBeenCalled();
    expect(getSchedulerState()).toMatchObject({ mode: "single", active: true });
  });

  it.each(["false", "1", "yes", "garbage", undefined])(
    "SINGLE_INSTANCE_MODE=%s takes the r107 ELECTION path (mode embedded)",
    async (value) => {
      if (value !== undefined) process.env.SINGLE_INSTANCE_MODE = value;
      const handle = await startWebSchedulers(fakeRedis as never);
      trackHandle(handle);

      // Flip-back safety (FH-A1 §9.9): anything but "true" restores the
      // r107-hardened election machinery byte-for-byte.
      expect(acquireSchedulerLeadership).toHaveBeenCalledTimes(1);
      expect(getSchedulerState()).toMatchObject({ mode: "embedded", active: true });
      expect(handle.leadership?.instanceId).toBe("test-instance");
    },
  );

  it("no-Redis shape: heartbeat skipped AND the 30 s recovery poll never armed (no leaked interval)", async () => {
    process.env.SINGLE_INSTANCE_MODE = "true";
    // The production/target shape: no client object AND no REDIS_URL —
    // the singleton factory can never produce a client (redis-client.ts
    // CASE 1), so arming the 30 s recovery poll would be a pure leak.
    redisState.client = null;
    delete process.env.REDIS_URL;

    vi.useFakeTimers();
    const handle = await startWebSchedulers(null as never);
    trackHandle(handle);

    expect(handle.active).toBe(true);
    expect(getSchedulerState()).toMatchObject({ mode: "single", active: true });
    // Heartbeat deferred (no client)…
    expect(startHeartbeat).not.toHaveBeenCalled();

    // …and the recovery poll must NOT exist: advancing past a full poll
    // window (30 s) still leaves the heartbeat dark. R104 AG1-2 skips
    // arming the poll when REDIS_URL is unset; R108 must not regress it.
    await vi.advanceTimersByTimeAsync(35_000);
    expect(startHeartbeat).not.toHaveBeenCalled();

    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
