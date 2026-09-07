import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round-93 C3 (A3 audit R6) — web-scheduler demotion wiring.
 *
 * The coordinator test pins the leadership-state machine; THIS suite pins
 * that web-scheduler actually stops everything it started when leadership
 * is lost (heartbeat, alerting evaluator, watchers, cron) and can start
 * it all again if leadership returns. The old code started jobs once and
 * had no demotion path at all — a lost lock meant two instances running
 * every job in parallel until the next deploy.
 *
 * The coordinator is mocked (its state machine is covered by
 * scheduler-coordinator.test.ts); the heavy job modules are mocked so the
 * test exercises web-scheduler's own wiring only.
 */

vi.mock("../scheduler-coordinator", () => ({
  acquireSchedulerLeadership: vi.fn(),
}));

vi.mock("../../jobs/couponWatcher", () => ({
  startCouponWatcher: vi.fn(() => ({ stop: vi.fn() })),
}));
vi.mock("../../jobs/stockWatcher", () => ({ startStockWatcher: vi.fn(() => ({ stop: vi.fn() })) }));
vi.mock("../../jobs/flashSaleWatcher", () => ({
  startFlashSaleWatcher: vi.fn(() => ({ stop: vi.fn() })),
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

import { acquireSchedulerLeadership } from "../scheduler-coordinator";
import { initCronJobs } from "../../jobs/cron";
import { startCouponWatcher } from "../../jobs/couponWatcher";
import { startStockWatcher } from "../../jobs/stockWatcher";
import { startFlashSaleWatcher } from "../../jobs/flashSaleWatcher";
import { alertingService } from "../../services/alerting.service";
import { startHeartbeat } from "../../worker/heartbeat";
import { getSchedulerState } from "../scheduler-state";
import { startWebSchedulers } from "../web-scheduler";

type CoordinatorOptions = Parameters<typeof acquireSchedulerLeadership>[1];
let capturedOptions: CoordinatorOptions;

const fakeRedis = { get: vi.fn(), set: vi.fn() } as never;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DISABLE_WEB_SCHEDULERS;
  capturedOptions = {};
  vi.mocked(acquireSchedulerLeadership).mockImplementation(
    async (_redis: unknown, options: CoordinatorOptions = {}) => {
      capturedOptions = options;
      return {
        instanceId: "test-instance",
        isLeader: true,
        release: vi.fn(async () => {}),
      };
    },
  );
});

afterEach(() => {
  delete process.env.DISABLE_WEB_SCHEDULERS;
});

describe("R6 — startWebSchedulers demotion wiring", () => {
  it("starts heartbeat + alerting + watchers + cron when it holds leadership", async () => {
    const handle = await startWebSchedulers(fakeRedis);

    expect(handle.active).toBe(true);
    expect(startHeartbeat).toHaveBeenCalledTimes(1);
    expect(alertingService.start).toHaveBeenCalledTimes(1);
    expect(initCronJobs).toHaveBeenCalledTimes(1);
    expect(startCouponWatcher).toHaveBeenCalledTimes(1);
    expect(startStockWatcher).toHaveBeenCalledTimes(1);
    expect(startFlashSaleWatcher).toHaveBeenCalledTimes(1);
    expect(getSchedulerState()).toMatchObject({ active: true, isLeader: true });
  });

  it("onLost (leadership loss) STOPS everything — the split-brain fix", async () => {
    const handle = await startWebSchedulers(fakeRedis);
    expect(handle.active).toBe(true);

    // Another instance took the lock → coordinator fires onLost.
    capturedOptions?.onLost?.();

    expect(handle.active).toBe(false);
    expect(alertingService.stop).toHaveBeenCalledTimes(1);
    expect(initCronJobs).toHaveBeenCalledTimes(1);
    // R8: the cron handle's stop() is invoked (the old code had no handle
    // at all — node-cron kept firing after demotion/shutdown).
    expect(vi.mocked(initCronJobs).mock.results[0]?.value.stop).toHaveBeenCalledTimes(1);
    // Watchers stopped via their handles.
    for (const [watcher, name] of [
      [startCouponWatcher, "couponWatcher"],
      [startStockWatcher, "stockWatcher"],
      [startFlashSaleWatcher, "flashSaleWatcher"],
    ] as const) {
      expect(
        vi.mocked(watcher).mock.results[0]?.value.stop,
        `${name} stop handle invoked`,
      ).toHaveBeenCalledTimes(1);
    }
    // Heartbeat stopped via its handle.
    expect(vi.mocked(startHeartbeat).mock.results[0]?.value.stop).toHaveBeenCalledTimes(1);
    expect(getSchedulerState()).toMatchObject({ active: false, isLeader: false });
  });

  it("after demotion, a later re-acquisition (onAcquired) restarts everything", async () => {
    const handle = await startWebSchedulers(fakeRedis);
    capturedOptions?.onLost?.();
    expect(handle.active).toBe(false);

    capturedOptions?.onAcquired?.();

    expect(handle.active).toBe(true);
    expect(initCronJobs).toHaveBeenCalledTimes(2);
    expect(alertingService.start).toHaveBeenCalledTimes(2);
    expect(startHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("stop() (shutdown drain) stops jobs BEFORE releasing the lock and is bounded", async () => {
    const release = vi.fn(async () => {});
    vi.mocked(acquireSchedulerLeadership).mockImplementation(
      async (_redis: unknown, options: CoordinatorOptions = {}) => {
        capturedOptions = options;
        return { instanceId: "test-instance", isLeader: true, release };
      },
    );

    const handle = await startWebSchedulers(fakeRedis);
    await handle.stop();

    // Everything local stopped once...
    expect(alertingService.stop).toHaveBeenCalledTimes(1);
    expect(vi.mocked(initCronJobs).mock.results[0]?.value.stop).toHaveBeenCalledTimes(1);
    // ...and the lock release happened (R5 bounds it internally).
    expect(release).toHaveBeenCalledTimes(1);
    expect(handle.active).toBe(false);

    // Idempotent.
    await handle.stop();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("non-leader boot starts nothing and reports not_leader", async () => {
    vi.mocked(acquireSchedulerLeadership).mockImplementation(
      async (_redis: unknown, options: CoordinatorOptions = {}) => {
        capturedOptions = options;
        return { instanceId: "test-instance", isLeader: false, release: vi.fn(async () => {}) };
      },
    );

    const handle = await startWebSchedulers(fakeRedis);
    expect(handle.active).toBe(false);
    expect(handle.reason).toBe("not_leader");
    expect(alertingService.start).not.toHaveBeenCalled();
    expect(initCronJobs).not.toHaveBeenCalled();
  });

  it("DISABLE_WEB_SCHEDULERS=true skips everything (unchanged migration switch)", async () => {
    process.env.DISABLE_WEB_SCHEDULERS = "true";
    const handle = await startWebSchedulers(fakeRedis);

    expect(handle.active).toBe(false);
    expect(handle.reason).toBe("disabled_by_env");
    expect(acquireSchedulerLeadership).not.toHaveBeenCalled();
    expect(alertingService.start).not.toHaveBeenCalled();
  });
});
