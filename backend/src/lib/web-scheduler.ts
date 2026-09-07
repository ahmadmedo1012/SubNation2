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
 * B7-P1-1 (round-92): when the leader lock is held by the OLD instance
 * during a blue-green deploy, this process keeps waiting for it via the
 * coordinator's retry loop and starts everything through `onAcquired`
 * the moment the lock frees up — instead of booting leaderless forever.
 *
 * B7-P2-12: daily retention jobs have no node-cron catch-up — if the
 * instance was down at slot time, the day's run is simply skipped. The
 * retention jobs are idempotent by construction, so they also run as
 * boot one-shots here (session prune, alert retention, risk-events
 * retention, auth-activity retention) to close the restart gap.
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
import { cleanupOldAuthActivity } from "../jobs/cleanup-auth-activity";
import { checkAdminTotpAdvisory } from "../jobs/security-advisories";
import { pruneExpiredSessions } from "../jobs/session-prune";
import { reapExpiredRiskEvents } from "../jobs/risk-retention";
import { markStaleUnreadAlertsRead, pruneReadAlerts } from "../jobs/alertLogger";
import { startFlashSaleWatcher } from "../jobs/flashSaleWatcher";
import { startStockWatcher } from "../jobs/stockWatcher";
import { alertingService } from "../services/alerting.service";
import { startHeartbeat } from "../worker/heartbeat";
import { acquireSchedulerLeadership, type SchedulerLeadership } from "./scheduler-coordinator";
import { setSchedulerState } from "./scheduler-state";

export interface WebSchedulerHandle {
  /** Whether the schedulers are actually running in this process (live value). */
  active: boolean;
  /** Reason if !active (for logs). */
  reason?: "disabled_by_env" | "not_leader";
  leadership?: SchedulerLeadership;
  /** Idempotent shutdown: stops everything and releases the leader lock. */
  stop: () => Promise<void>;
}

/**
 * Fire a boot one-shot WITHOUT swallowing errors silently (B7-P2-4): a
 * failing one-shot logs a warn + is visible in Render logs; a silent
 * `.catch(() => {})` is indistinguishable from success.
 */
function fireOneShot(name: string, fn: () => Promise<unknown>): void {
  void fn().catch((err) =>
    logger.warn(
      { err, category: "monitoring" },
      `[scheduler] ${name} boot one-shot failed (will run again at its cron slot)`,
    ),
  );
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

  let started = false;
  let heartbeatCleanup: { stop: () => void } | null = null;
  const watchers: Array<{ stop: () => void }> = [];

  // Everything the leader runs, extracted so it can start EITHER
  // immediately (initial lock win) or later (lock freed on retry).
  const startLeaderJobs = () => {
    if (started) return;
    started = true;

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
    watchers.push(startCouponWatcher(), startStockWatcher(), startFlashSaleWatcher());
    initCronJobs();

    // Boot one-shots (fire-and-forget: scheduler startup must not block):
    //   - session prune: sessions that expired while the process was down;
    //   - TOTP advisory: weekly admin-TOTP nudge;
    //   - retention catch-up (B7-P2-12): alert + risk-events retention
    //     would otherwise be skipped entirely if the instance was down at
    //     the 00:00/03:30 slots;
    //   - auth-activity retention (B7-P1-2): the job was previously wired
    //     to nothing — 90-day retention was never enforced.
    fireOneShot("session-prune", pruneExpiredSessions);
    fireOneShot("security-advisories", checkAdminTotpAdvisory);
    fireOneShot("alert-retention", async () => {
      const staled = await markStaleUnreadAlertsRead(14);
      const pruned = await pruneReadAlerts(30);
      return { staled, pruned };
    });
    fireOneShot("risk-retention", reapExpiredRiskEvents);
    fireOneShot("auth-activity-retention", cleanupOldAuthActivity);

    logger.info(
      { category: "monitoring", instanceId: leadership.instanceId },
      "[scheduler] cron + watchers + boot one-shots started (couponWatcher, stockWatcher, flashSaleWatcher, cron, sessionPrune, securityAdvisories, alertRetention, riskRetention, authActivityRetention)",
    );

    setSchedulerState({
      mode: "embedded",
      active: true,
      isLeader: true,
      instanceId: leadership.instanceId,
      reason: "active",
      startedAt: new Date().toISOString(),
    });
  };

  const leadership = await acquireSchedulerLeadership(redis, {
    onAcquired: () => {
      // B7-P1-1: the lock freed up while we were booting/running — take
      // the schedulers over now.
      logger.info(
        { category: "monitoring", instanceId: leadership.instanceId },
        "[scheduler] leadership acquired after retry — starting schedulers in this process now",
      );
      startLeaderJobs();
    },
  });

  if (leadership.isLeader) {
    startLeaderJobs();
  } else {
    setSchedulerState({
      mode: "embedded",
      active: false,
      isLeader: false,
      instanceId: leadership.instanceId,
      reason: "not_leader",
      startedAt: null,
    });
  }

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
    // B7-P2-11: watchers now expose stop handles — actually stop the
    // intervals instead of relying on process exit.
    for (const watcher of watchers) watcher.stop();
    // node-cron jobs auto-cleanup on process exit; no stop hooks needed
    // for them (they hold no resources beyond the interval).
    await leadership.release();
    setSchedulerState({
      active: false,
      isLeader: false,
      reason: "not_leader",
      startedAt: null,
    });
  };

  return {
    get active() {
      return started;
    },
    reason: started ? undefined : "not_leader",
    leadership,
    stop,
  };
}
