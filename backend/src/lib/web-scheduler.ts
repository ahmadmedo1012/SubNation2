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
 * R6 (round-93 A3): losing the leader lock now DEMOTES this process —
 * heartbeat / alerting / watchers / cron are stopped locally via the
 * coordinator's onLost callback (the demoted instance must not keep
 * firing jobs in parallel with the new leader), and the acquisition
 * retry loop is restarted so the schedulers come back if the new leader
 * dies.
 *
 * 97-F1 (round-97): when no Redis client exists (REDIS_URL missing — the
 * production shape behind the silent scheduler outage of 2026-09-08..11)
 * the coordinator now elects the leader via the PG-backed lease
 * (lib/pg-leader-lease.ts) instead of failing closed forever, so these
 * jobs run with or without Redis. The boot one-shot list also gained the
 * three cleanups the outage proved were cron-only with no restart
 * catch-up: pruneExpiredOtps (hourly :15), pruneStaleAdminSessions
 * (daily 05:00) and the flash-sale expiry catch-up (5-min watcher) — all
 * idempotent, all safe to fire at every leader start.
 *
 * Migration to a dedicated worker (when ready — NOTE: the 2026-09-20
 * free-infrastructure round removed the paid `subnation-worker`
 * service from render.yaml; this code path is dormant documentation):
 *   1. Provision a dedicated worker service on a PAID plan you choose
 *      to add later (not from this blueprint).
 *   2. Render MCP `update_environment_variables` to set
 *      `DISABLE_WEB_SCHEDULERS=true` on the web service.
 *   3. Web tier stops running these. The worker tier owns them by
 *      default (workerEntry calls `alertingService.start` / `startHeartbeat`
 *      directly, no leader gate — it's the only node running them).
 *
 * 2026-09-20 (free-infrastructure round): NO interval timers start here
 * anymore. The coupon / stock / flash-sale watchers became
 * traffic-triggered opportunistic sweeps (lib/opportunistic.ts) + boot
 * one-shots; the WhatsApp channel watch is fed by real readiness
 * observations (services/whatsapp-watch.ts); the WhatsApp warm-up
 * self-check is intent-driven (services/openwa.service.ts). Only the
 * daily retention crons + the Redis heartbeat / alerting evaluator
 * (in-memory, no DB, no outbound) remain on schedules.
 */

import type { RedisClientType } from "redis";
import { logger } from "./logger";
import { pruneStaleAdminSessions } from "./admin-session";
// 2026-09-20 (free-infrastructure round): couponWatcher / stockWatcher /
// flashSaleWatcher lost their interval timers — their sweeps now run
// (a) at leader boot (one-shots below) and (b) opportunistically off
// real traffic via lib/opportunistic.ts (route-level triggers).
import { checkExpiringCoupons } from "../jobs/couponWatcher";
import { initCronJobs } from "../jobs/cron";
import { cleanupOldAuthActivity } from "../jobs/cleanup-auth-activity";
import { checkAdminTotpAdvisory } from "../jobs/security-advisories";
import { pruneExpiredSessions } from "../jobs/session-prune";
import { reapExpiredRiskEvents } from "../jobs/risk-retention";
import { markStaleUnreadAlertsRead, pruneReadAlerts } from "../jobs/alertLogger";
import { deactivateExpiredFlashSales } from "../jobs/flashSaleWatcher";
import { runStockSweep } from "../jobs/stockWatcher";
import { reapExpiredCopilotPreviews } from "../jobs/copilot-reaper";
import { pruneExpiredOtps } from "../services/whatsapp-otp.service";
import { alertingService } from "../services/alerting.service";
import { startHeartbeat } from "../worker/heartbeat";
import { acquireSchedulerLeadership, type SchedulerLeadership } from "./scheduler-coordinator";
import { getRedisClient } from "./redis-client";
import { setSchedulerState } from "./scheduler-state";
import type { CronJobsHandle } from "../jobs/cron";

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
 * 97-F1 (round-97 A6/D.2): flash-sale expiry catch-up, fired once at leader
 * start via the now-exported jobs/flashSaleWatcher.ts sweep (the mirrored
 * copy this file used to carry was deleted with the interval timer —
 * same predicate, same alert, same per-sale 7-day dedupe key, so the
 * boot catch-up and the route-triggered sweeps collapse to one alert
 * per sale). Idempotent by construction.
 */
async function deactivateExpiredFlashSalesCatchUp(): Promise<{ deactivated: number }> {
  // The sweep logs its own outcome; the return shape only feeds the
  // fireOneShot logger on failure.
  await deactivateExpiredFlashSales();
  return { deactivated: -1 };
}

/**
 * Cold-start query-storm guard (2026-09-20 free-infrastructure round):
 * the boot one-shots used to fire CONCURRENTLY — eight retention jobs
 * hitting a freshly-woken Neon compute (0.25 CU free tier) in the same
 * tick, exactly the "storm" §25 of the optimization brief forbids.
 * They now run strictly sequentially: each job waits for the previous
 * one to settle. Total wall-clock is a few seconds; the first user
 * requests stop competing with retention DELETEs for pool slots.
 * fireOneShot semantics are unchanged (fire-and-forget from the
 * caller's perspective — the chain is self-driving).
 */
function fireOneShotsSequentially(jobs: Array<[name: string, fn: () => Promise<unknown>]>): void {
  void (async () => {
    for (const [name, fn] of jobs) {
      try {
        await fn();
      } catch (err) {
        logger.warn(
          { err, category: "monitoring" },
          `[scheduler] ${name} boot one-shot failed (will run again at its cron slot)`,
        );
      }
    }
  })();
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
  let cronJobs: CronJobsHandle | null = null;

  /**
   * Stop the leader-only jobs (R6). Used BOTH for shutdown (drain) and
   * for demotion after leadership loss — the demoted instance must not
   * keep firing cron/watchers/alerting in parallel with the new leader.
   * Resets the `started` flag so a later re-acquisition (onAcquired) can
   * start everything again.
   */
  const stopLeaderJobs = (context: "demoted" | "shutdown") => {
    if (!started) return;
    started = false;
    heartbeatCleanup?.stop();
    heartbeatCleanup = null;
    alertingService.stop();
    // 2026-09-20: no watcher handles to stop anymore — the coupon/stock/
    // flash-sale sweeps and the WhatsApp channel watch are event-driven
    // (see lib/opportunistic.ts + services/whatsapp-watch.ts).
    // R8 (round-93 A3): node-cron tasks have real stop handles now — the
    // old "auto cleanup on process exit" claim left a window where the
    // drain released the lock while this instance's crons still ticked,
    // double-running jobs against the new leader for up to 10 s.
    cronJobs?.stop();
    cronJobs = null;
    setSchedulerState({
      active: false,
      isLeader: false,
      reason: "not_leader",
      startedAt: null,
    });
    logger.info(
      { category: "monitoring", instanceId: leadership.instanceId, context },
      context === "demoted"
        ? "[scheduler] demoted — local schedulers stopped (lost leader lock)"
        : "[scheduler] local schedulers stopped",
    );
  };

  // Everything the leader runs, extracted so it can start EITHER
  // immediately (initial lock win) or later (lock freed on retry).
  const startLeaderJobs = () => {
    if (started) return;
    started = true;

    // F2 (round-94 A6): resolve the client at START time, not boot time —
    // when leadership is acquired on a later retry (Redis returned after
    // a degraded boot), the captured `redis` argument is still null and
    // the heartbeat would silently never start while cron/watchers ran.
    const heartbeatClient = getRedisClient();
    if (heartbeatClient) {
      heartbeatCleanup = startHeartbeat(heartbeatClient);
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

    // Cron — same code path used by worker.ts when a worker exists.
    // (2026-09-20: the coupon/stock/flash-sale watchers + the WhatsApp
    // channel watch no longer start here — they were interval timers
    // that kept Neon/OpenWA awake; see the module header.)
    cronJobs = initCronJobs();

    // Boot one-shots — SEQUENTIAL (cold-start storm guard), fire-and-
    // forget from the caller's perspective (scheduler startup must not
    // block):
    //   - session prune: sessions that expired while the process was down;
    //   - TOTP advisory: weekly admin-TOTP nudge;
    //   - retention catch-up (B7-P2-12): alert + risk-events retention
    //     would otherwise be skipped entirely if the instance was down at
    //     the 00:00/03:30 slots;
    //   - auth-activity retention (B7-P1-2): the job was previously wired
    //     to nothing — 90-day retention was never enforced;
    //   - coupon + stock sweeps: the old 30 s / 60 s watcher initial
    //     passes, now the only boot-time trigger (route-triggered
    //     opportunistic sweeps carry the rest);
    //   - copilot reaper: the old hourly :45 cron slot, now boot +
    //     admin-surface-triggered;
    //   - whatsapp OTP prune + admin-session prune + flash-sale catch-up:
    //     unchanged from 97-F1 (the silent-outage restart-gap fix).
    fireOneShotsSequentially([
      ["session-prune", pruneExpiredSessions],
      ["security-advisories", checkAdminTotpAdvisory],
      [
        "alert-retention",
        async () => {
          const staled = await markStaleUnreadAlertsRead(14);
          const pruned = await pruneReadAlerts(30);
          return { staled, pruned };
        },
      ],
      ["risk-retention", reapExpiredRiskEvents],
      ["auth-activity-retention", cleanupOldAuthActivity],
      ["coupon-sweep", checkExpiringCoupons],
      ["stock-sweep", runStockSweep],
      ["copilot-reaper", reapExpiredCopilotPreviews],
      ["whatsapp-otp-prune", pruneExpiredOtps],
      ["admin-session-prune", pruneStaleAdminSessions],
      ["flash-sale-catchup", deactivateExpiredFlashSalesCatchUp],
    ]);

    logger.info(
      { category: "monitoring", instanceId: leadership.instanceId },
      "[scheduler] cron + sequential boot one-shots started (cron, sessionPrune, securityAdvisories, alertRetention, riskRetention, authActivityRetention, couponSweep, stockSweep, copilotReaper, whatsappOtpPrune, adminSessionPrune, flashSaleCatchup)",
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
    onLost: () => {
      // R6 (round-93 A3): another instance took the lock — stop OUR
      // schedulers so we don't double-run cron/alerting/heartbeat against
      // the new leader (split-brain). The coordinator already restarted
      // the acquisition loop; if the new leader dies, onAcquired fires
      // and startLeaderJobs() runs again.
      stopLeaderJobs("demoted");
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
    // R5 (round-93 A3): leadership.release() is internally bounded (2 s per
    // Redis op) — a Redis outage during SIGTERM can no longer stall the
    // drain until the 10 s force-exit. R8: crons/watchers/heartbeat stop
    // BEFORE the lock is released so the new leader never double-runs.
    stopLeaderJobs("shutdown");
    await leadership.release();
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
