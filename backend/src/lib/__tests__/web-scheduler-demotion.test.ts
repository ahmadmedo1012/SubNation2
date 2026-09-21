import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round-93 C3 (A3 audit R6) — web-scheduler demotion wiring.
 *
 * The coordinator test pins the leadership-state machine; THIS suite pins
 * that web-scheduler actually stops everything it started when leadership
 * is lost (heartbeat, alerting evaluator, cron) and can start it all
 * again if leadership returns. The old code started jobs once and had no
 * demotion path at all — a lost lock meant two instances running every
 * job in parallel until the next deploy.
 *
 * 2026-09-20 (free-infrastructure round): there are no interval watcher
 * starters anymore (coupon/stock/flash-sale sweeps + the WhatsApp
 * channel watch became event-driven; the boot one-shots run through
 * fireOneShotsSequentially and need no handles). This suite pins the
 * slimmed surface: heartbeat + alerting + cron + the boot one-shot
 * chain firing exactly once per leadership acquisition.
 *
 * The coordinator is mocked (its state machine is covered by
 * scheduler-coordinator.test.ts); the heavy job modules are mocked so the
 * test exercises web-scheduler's own wiring only.
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
// AUD103-8-F3 (r103): idempotency-retention joined the boot one-shot
// roster (was cron-only — the 00:00 UTC slot never fires on a sleeping
// Render-Free instance).
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

type CoordinatorOptions = Parameters<typeof acquireSchedulerLeadership>[1];
let capturedOptions: CoordinatorOptions;

// F2 (round-94 C6): web-scheduler now resolves the heartbeat client via
// getRedisClient() at START time (a leader acquired on a later retry must
// not run cron against a stale null client). Mocked here so the heartbeat
// path stays exercised exactly like the old boot-time argument did.
const { fakeRedis } = vi.hoisted(() => ({ fakeRedis: { get: vi.fn(), set: vi.fn() } }));
vi.mock("../redis-client", () => ({
  getRedisClient: () => fakeRedis,
}));

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
  it("starts heartbeat + alerting + cron when it holds leadership", async () => {
    const handle = await startWebSchedulers(fakeRedis as never);

    expect(handle.active).toBe(true);
    expect(startHeartbeat).toHaveBeenCalledTimes(1);
    expect(alertingService.start).toHaveBeenCalledTimes(1);
    expect(initCronJobs).toHaveBeenCalledTimes(1);
    expect(getSchedulerState()).toMatchObject({ active: true, isLeader: true });
  });

  it("fires the SEQUENTIAL boot one-shot chain exactly once per leadership acquisition", async () => {
    const handle = await startWebSchedulers(fakeRedis as never);
    expect(handle.active).toBe(true);

    // Every one-shot body ran (fire-and-forget chain — flush microtasks).
    await vi.waitFor(() => {
      expect(checkExpiringCoupons).toHaveBeenCalledTimes(1);
      expect(runStockSweep).toHaveBeenCalledTimes(1);
      // R102: the orphan-inventory report fires with the rest of the chain.
      expect(reportOrphanInventory).toHaveBeenCalledTimes(1);
      expect(deactivateExpiredFlashSales).toHaveBeenCalledTimes(1);
      expect(reapExpiredCopilotPreviews).toHaveBeenCalledTimes(1);
      expect(pruneExpiredOtps).toHaveBeenCalledTimes(1);
    });
  });

  it("onLost (leadership loss) STOPS everything — the split-brain fix", async () => {
    const handle = await startWebSchedulers(fakeRedis as never);
    expect(handle.active).toBe(true);

    // Another instance took the lock → coordinator fires onLost.
    capturedOptions?.onLost?.();

    expect(handle.active).toBe(false);
    expect(alertingService.stop).toHaveBeenCalledTimes(1);
    expect(initCronJobs).toHaveBeenCalledTimes(1);
    // R8: the cron handle's stop() is invoked (the old code had no handle
    // at all — node-cron kept firing after demotion/shutdown).
    expect(vi.mocked(initCronJobs).mock.results[0]?.value.stop).toHaveBeenCalledTimes(1);
    // Heartbeat stopped via its handle.
    expect(vi.mocked(startHeartbeat).mock.results[0]?.value.stop).toHaveBeenCalledTimes(1);
    expect(getSchedulerState()).toMatchObject({ active: false, isLeader: false });
  });

  it("after demotion, a later re-acquisition (onAcquired) restarts everything", async () => {
    const handle = await startWebSchedulers(fakeRedis as never);
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

    const handle = await startWebSchedulers(fakeRedis as never);
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

    const handle = await startWebSchedulers(fakeRedis as never);
    expect(handle.active).toBe(false);
    expect(handle.reason).toBe("not_leader");
    expect(alertingService.start).not.toHaveBeenCalled();
    expect(initCronJobs).not.toHaveBeenCalled();
    expect(checkExpiringCoupons).not.toHaveBeenCalled();
  });

  it("DISABLE_WEB_SCHEDULERS=true skips everything (unchanged migration switch)", async () => {
    process.env.DISABLE_WEB_SCHEDULERS = "true";
    const handle = await startWebSchedulers(fakeRedis as never);

    expect(handle.active).toBe(false);
    expect(handle.reason).toBe("disabled_by_env");
    expect(acquireSchedulerLeadership).not.toHaveBeenCalled();
    expect(alertingService.start).not.toHaveBeenCalled();
  });
});
