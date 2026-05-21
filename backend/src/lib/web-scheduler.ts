/**
 * Web-process scheduler bootstrap.
 *
 * Wires the worker-tier loops (heartbeat, alerting evaluator, cron jobs)
 * to start inside the web process when no dedicated worker service is
 * provisioned. Gated by:
 *
 *   1. `DISABLE_WEB_SCHEDULERS=true` env override → schedulers skipped
 *      entirely (the explicit migration switch — set this once a real
 *      worker service exists).
 *   2. Redis-backed `scheduler:leader` lock via
 *      `acquireSchedulerLeadership()` → only the lock-holder runs the
 *      schedulers. Protects against accidental horizontal scale today,
 *      and against split-brain when a worker service is later added in
 *      parallel before flipping the env override.
 *
 * Migration to a dedicated worker (when ready):
 *   1. Provision the `subnation-worker` Render service.
 *   2. Render MCP `update_environment_variables` to set
 *      `DISABLE_WEB_SCHEDULERS=true` on the web service.
 *   3. Web tier stops running these. The worker tier owns them by
 *      default (workerEntry calls `alertingService.start` / `startHeartbeat`
 *      directly, no leader gate — it's the only node running them).
 */

import type { RedisClientType } from "redis";
import { logger } from "./logger";
import { startCouponWatcher } from "../jobs/couponWatcher";
import { initCronJobs } from "../jobs/cron";
import { startFlashSaleWatcher } from "../jobs/flashSaleWatcher";
import { startStockWatcher } from "../jobs/stockWatcher";
import { alertingService } from "../services/alerting.service";
import { startHeartbeat } from "../worker/heartbeat";
import { acquireSchedulerLeadership, type SchedulerLeadership } from "./scheduler-coordinator";
import { setSchedulerState } from "./scheduler-state";

export interface WebSchedulerHandle {
  /** Whether the schedulers are actually running in this process. */
  active: boolean;
  /** Reason if !active (for logs). */
  reason?: "disabled_by_env" | "not_leader";
  leadership?: SchedulerLeadership;
  /** Idempotent shutdown: stops everything and releases the leader lock. */
  stop: () => Promise<void>;
}

export async function startWebSchedulers(
  redis: RedisClientType | null,
): Promise<WebSchedulerHandle> {
  const disabled = (process.env.DISABLE_WEB_SCHEDULERS ?? "").toLowerCase() === "true";

  if (disabled) {
    logger.info(
      { category: "monitoring" },
      "[scheduler] DISABLE_WEB_SCHEDULERS=true — web process will not run heartbeat / alerting / cron. A dedicated worker service is expected to own them.",
    );
    setSchedulerState({
      mode: "dedicated",
      active: false,
      isLeader: false,
      instanceId: null,
      reason: "disabled_by_env",
      startedAt: null,
    });
    return { active: false, reason: "disabled_by_env", stop: async () => {} };
  }

  const leadership = await acquireSchedulerLeadership(redis);
  if (!leadership.isLeader) {
    setSchedulerState({
      mode: "embedded",
      active: false,
      isLeader: false,
      instanceId: leadership.instanceId,
      reason: "not_leader",
      startedAt: null,
    });
    return { active: false, reason: "not_leader", leadership, stop: leadership.release };
  }

  // We are the leader — actually start everything.
  let heartbeatCleanup: { stop: () => void } | null = null;
  if (redis) {
    heartbeatCleanup = startHeartbeat(redis);
    logger.info(
      { category: "monitoring", instanceId: leadership.instanceId },
      "[scheduler] heartbeat started",
    );
  } else {
    logger.warn(
      { category: "monitoring" },
      "[scheduler] Redis unavailable — heartbeat skipped (no key to write)",
    );
  }

  alertingService.start();
  logger.info(
    { category: "monitoring", instanceId: leadership.instanceId },
    "[scheduler] alerting evaluator started (60s interval)",
  );

  // Cron + watchers — same code path used by worker.ts when a worker exists.
  startCouponWatcher();
  startStockWatcher();
  startFlashSaleWatcher();
  initCronJobs();
  logger.info(
    { category: "monitoring", instanceId: leadership.instanceId },
    "[scheduler] cron + watchers started (couponWatcher, stockWatcher, flashSaleWatcher, cron)",
  );

  setSchedulerState({
    mode: "embedded",
    active: true,
    isLeader: true,
    instanceId: leadership.instanceId,
    reason: "active",
    startedAt: new Date().toISOString(),
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    logger.info(
      { category: "monitoring", instanceId: leadership.instanceId },
      "[scheduler] stopping web schedulers",
    );
    heartbeatCleanup?.stop();
    alertingService.stop();
    // node-cron jobs auto-cleanup on process exit; we don't have stop hooks
    // for them today, but they don't hold resources beyond the interval.
    await leadership.release();
  };

  return { active: true, leadership, stop };
}
