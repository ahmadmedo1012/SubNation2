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
// 2026-09-20 (free-infrastructure round): couponWatcher / stockWatcher /
// flashSaleWatcher lost their interval timers — their sweeps now run
// (a) at leader boot (the shared one-shots below) and (b) opportunistically
// off real traffic via lib/opportunistic.ts (route-level triggers).
import { initCronJobs } from "../jobs/cron";
import { runBootOneShots } from "../jobs/boot-one-shots";
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

// R101: the boot one-shot chain (roster + cold-start storm guard) lives in
// jobs/boot-one-shots.ts now — shared with worker.ts so the documented
// DISABLE_WEB_SCHEDULERS=true migration path keeps the B7-P2-12 restart-gap
// protection instead of silently dropping it.

// R101: heartbeat re-attach cadence for PG-lease leaders whose Redis client
// arrives mid-reign (same value as worker.ts R1 — a poll this cheap can
// afford 30 s granularity).
const HEARTBEAT_RECOVERY_POLL_MS = 30_000;

// R104 (AG6-6): deferral between leadership acquisition and the boot
// one-shot chain, so retention DELETEs never race the first real user
// requests of a cold start through the shared 8-connection pool.
// Env-tunable (tests set 0; operators can stretch it under load). Read
// at CALL time so environment changes after module load apply.
function bootOneShotDelayMs(): number {
  return Math.max(0, Number(process.env.BOOT_ONE_SHOT_DELAY_MS ?? 7_000) || 0);
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
  let heartbeatRecoveryPoll: ReturnType<typeof setInterval> | null = null;
  // R104 (AG6-6): pending delayed boot one-shots (cleared on demote/shutdown).
  let pendingOneShot: ReturnType<typeof setTimeout> | null = null;
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
    // R101: stop the heartbeat-recovery poll too — a demoted/draining
    // leader must not attach a heartbeat after demotion.
    if (heartbeatRecoveryPoll) {
      clearInterval(heartbeatRecoveryPoll);
      heartbeatRecoveryPoll = null;
    }
    if (pendingOneShot) {
      clearTimeout(pendingOneShot);
      pendingOneShot = null;
    }
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
        "[scheduler] Redis unavailable — heartbeat deferred (PG-lease leadership); will attach if Redis returns mid-reign",
      );
      // R101: a PG-lease leader has no Redis client at acquisition time
      // (that is the whole point of the 97-F1 fallback). Before R101 the
      // heartbeat then stayed dark for the ENTIRE reign even if Redis
      // returned five minutes later — a stale worker:heartbeat key fed
      // false worker_heartbeat_missing alerts and healthz' worker check
      // stayed degraded forever. worker.ts has had this recovery poll
      // since R1 (round-93); the web leader now gets the same fix:
      // poll the singleton every 30 s and attach the heartbeat (once)
      // the moment a client exists. Stopped by stopLeaderJobs.
      // R104 (AG1-2): with REDIS_URL entirely unset (the production
      // shape) no Redis client can EVER appear — the singleton factory
      // resolves null permanently (redis-client.ts never creates a
      // client object without a URL). Skip arming the 30 s no-op poll
      // entirely; it can only ever succeed when a URL exists.
      if (!process.env.REDIS_URL) {
        logger.info(
          { category: "monitoring" },
          "[scheduler] REDIS_URL unset — heartbeat recovery poll skipped (cannot heal without a URL)",
        );
      } else {
        heartbeatRecoveryPoll = setInterval(() => {
          const recovered = getRedisClient();
          if (!recovered) return;
          if (heartbeatRecoveryPoll) clearInterval(heartbeatRecoveryPoll);
          heartbeatRecoveryPoll = null;
          heartbeatCleanup = startHeartbeat(recovered);
          logger.warn(
            { category: "monitoring", instanceId: leadership.instanceId },
            "[scheduler] Redis recovered mid-reign — heartbeat attached",
          );
        }, HEARTBEAT_RECOVERY_POLL_MS);
        heartbeatRecoveryPoll.unref?.();
      }
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

    // Boot one-shots — sequential (cold-start storm guard), shared with
    // the dedicated-worker path via jobs/boot-one-shots.ts (R101):
    // retention catch-up (B7-P2-12), opportunistic-sweep boot passes,
    // and the 97-F1 restart-gap cleanups — all idempotent.
    //
    // R104 (AG6-6): DELAYED ~7 s after leadership. The chain fires
    // ~simultaneously with gate-open on a cold start, sharing the
    // 8-connection pool (and a just-woken 0.25 CU Neon) with the FIRST
    // real user requests of the wake. A short deferral decouples the
    // retention DELETEs from the first-visitor path while keeping the
    // restart-gap catch-up semantics (the jobs are idempotent; 7 s
    // changes nothing about correctness).
    pendingOneShot = setTimeout(() => {
      pendingOneShot = null;
      runBootOneShots();
    }, bootOneShotDelayMs());
    pendingOneShot.unref?.();

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
