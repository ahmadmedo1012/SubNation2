/**
 * Single-leader election for in-process schedulers.
 *
 * Currently the web service runs the heartbeat + alerting evaluator + cron
 * jobs because the dedicated worker tier is not yet provisioned (free-tier
 * billing constraint, see FINAL_RUNTIME_STATE.md §4). To stay safe under
 * accidental horizontal scale, we acquire a Redis lock at startup and only
 * the lock-holder runs the schedulers. Other instances (today there are
 * none, tomorrow there might be) will skip them silently.
 *
 * B7-P1-1 (round-92 audit): leadership acquisition is no longer one-shot.
 * Render blue-green deploys boot the NEW instance while the OLD instance
 * still holds `scheduler:leader` — the new instance used to return
 * isLeader=false FOREVER (the old instance then exits and releases, and
 * nobody re-attempts), leaving cron/watchers/alerting dead until the next
 * restart. Now a failed acquisition (lock held OR Redis hiccup) starts a
 * 20 s retry loop (aligned with the TTL refresh cadence) that keeps
 * re-attempting until the lock frees up; the moment it is acquired the
 * `onAcquired` callback fires so the caller can start its schedulers.
 *
 * R5 (round-93 A3): every leadership Redis op is bounded (2 s command
 * timeout). During a Redis outage the raw ops queued forever — the TTL
 * refresher iterations hung and, worse, `release()` on SIGTERM never
 * settled: the whole graceful drain stalled until the 10 s force-exit cut
 * in-flight responses mid-byte. A timed-out release is fine — the 60 s lock
 * TTL hands leadership over anyway.
 *
 * R6 (round-93 A3): losing the leader lock now DEMOTES this process. The
 * old refresher only logged a warning while the instance kept firing every
 * cron/watcher/alert in parallel with the new leader until the next deploy
 * (split-brain). On loss: `isLeader` flips false, the refresher stops, the
 * `onLost` callback fires (the caller stops heartbeat/alerting/watchers/
 * cron locally) and the acquisition retry loop restarts — so if the NEW
 * leader dies, this instance takes over again instead of staying dark.
 *
 * Migration path to a dedicated worker:
 *   1. Provision the `subnation-worker` Render service (apply the
 *      blueprint).
 *   2. Set `DISABLE_WEB_SCHEDULERS=true` on the web service's env.
 *   3. Web tier stops running schedulers; worker takes over the lock on
 *      its first boot.
 *
 * Without Redis (dev fallback), we always grant leadership so the dev
 * environment still gets all the cron output.
 */

import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { logger } from "./logger";
import { noteRedisDegradedMode, withRedisCommandTimeout } from "./redis-client";

const SCHEDULER_LEADER_KEY = "scheduler:leader";
const LEADER_TTL_SEC = 60;
const REFRESH_INTERVAL_MS = 20_000;
const DEFAULT_ACQUIRE_RETRY_MS = 20_000;
// R5: bound for every leadership command. Generous vs the 500 ms default
// command timeout (lock ops are not request-path) but far below the 10 s
// shutdown force-exit so `release()` can never wedge the drain.
// SCHEDULER_OP_TIMEOUT_MS is a test/ops override.
const LEADERSHIP_OP_TIMEOUT_MS = (() => {
  const raw = Number(process.env.SCHEDULER_OP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 2_000;
})();

export interface SchedulerLeadership {
  /** Unique id of the process that holds (or attempted) the leadership. */
  readonly instanceId: string;
  /**
   * True when this process holds the leader lock. LIVE value — flips to
   * false the moment the refresher notices another holder (R6 demotion)
   * and back to true when a retry (or re-acquisition after demotion)
   * succeeds (B7-P1-1).
   */
  readonly isLeader: boolean;
  /** Stop refreshing, cancel acquisition retries, release the lock if we own it. Idempotent. */
  release: () => Promise<void>;
}

export interface LeadershipAcquireOptions {
  /**
   * Fired (at most once) when leadership is acquired on a LATER retry —
   * the caller starts its schedulers here. NOT called when the initial
   * acquisition succeeds synchronously (caller already knows).
   */
  onAcquired?: () => void;
  /**
   * R6 (round-93 A3): fired when this process LOSES the lock after having
   * held it (another instance took over). The caller must STOP its local
   * schedulers here (heartbeat / alerting / watchers / cron) — otherwise
   * both instances run them in parallel (split-brain) until the next
   * deploy. NOT called for a non-leader that never acquired.
   */
  onLost?: () => void;
  /** Interval between acquisition retries. Default 20 s. */
  retryIntervalMs?: number;
  /** TTL-refresh poll interval. Default 20 s. Test seam (R6 tests). */
  refreshIntervalMs?: number;
}

/**
 * Try to become the scheduler leader. Returns a SchedulerLeadership object
 * with `isLeader=true` if we won the SETNX race; `false` otherwise — in
 * which case the object keeps retrying in the background and `isLeader`
 * becomes true (and `options.onAcquired` fires) once the lock frees up.
 *
 * The leader periodically refreshes its TTL so a long-running healthy
 * process keeps the lock. If the leader dies without releasing (e.g.
 * SIGKILL, OOM), the TTL expires within `LEADER_TTL_SEC` and another
 * process can take over on its next attempt.
 */
export async function acquireSchedulerLeadership(
  redis: RedisClientType | null,
  options: LeadershipAcquireOptions = {},
): Promise<SchedulerLeadership> {
  const instanceId = `${process.env.RENDER_SERVICE_NAME ?? "web"}-${process.pid}-${randomUUID()}`;
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_ACQUIRE_RETRY_MS;
  const refreshIntervalMs = options.refreshIntervalMs ?? REFRESH_INTERVAL_MS;

  // Without Redis, allow leadership in dev (single-instance only).
  if (!redis) {
    logger.warn(
      { category: "monitoring" },
      "[scheduler] Redis unavailable — granting unguarded leadership (dev only). Production must have REDIS_URL set.",
    );
    return {
      instanceId,
      isLeader: true,
      release: async () => {},
    };
  }

  let leader = false;
  let refresher: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let released = false;

  const stopRetryTimer = () => {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  };

  const stopRefresher = () => {
    if (refresher) {
      clearInterval(refresher);
      refresher = null;
    }
  };

  /**
   * R6: demote on leadership loss — stop considering ourselves the leader,
   * stop the refresher (no more 20 s log spam), notify the caller so it
   * stops its schedulers, and re-enter the acquisition loop so we take the
   * lock back if the new holder dies.
   */
  const demote = (currentLeader: unknown): void => {
    if (!leader || released) return;
    leader = false;
    stopRefresher();
    noteRedisDegradedMode("lost_leadership");
    logger.warn(
      { category: "monitoring", instanceId, currentLeader },
      "[scheduler] Lost scheduler leadership — demoting this process (stopping local schedulers, R6)",
    );
    try {
      options.onLost?.();
    } catch (err) {
      logger.error(
        { err, category: "monitoring" },
        "[scheduler] onLost callback threw — schedulers may be partially stopped",
      );
    }
    // Re-acquisition: if the new leader dies without releasing, the TTL
    // expires and this instance becomes leader again (onAcquired fires,
    // schedulers restart). Without this the demotion would leave the fleet
    // scheduler-less until a manual restart.
    startRetryTimer();
  };

  const startRefresher = () => {
    if (refresher) return;
    // Periodically renew the lock TTL — but ONLY if we still own it. This
    // protects against a clock skew or split-brain situation where another
    // instance has already taken over.
    refresher = setInterval(async () => {
      if (released || !leader) return;
      try {
        // R5: bounded — during a Redis outage the raw get queued forever
        // (offline queue) and the 20 s iterations hang-stacked.
        const current = await withRedisCommandTimeout(
          "leader_refresh_get",
          () => redis.get(SCHEDULER_LEADER_KEY),
          LEADERSHIP_OP_TIMEOUT_MS,
        );
        if (current === instanceId) {
          await withRedisCommandTimeout(
            "leader_refresh_expire",
            () => redis.expire(SCHEDULER_LEADER_KEY, LEADER_TTL_SEC),
            LEADERSHIP_OP_TIMEOUT_MS,
          );
        } else {
          // We lost it. R6: actually demote instead of warning-and-continuing.
          demote(current);
        }
      } catch {
        // Redis hiccup — leadership state stays as-is this round; surfaced
        // via redis_errors_total elsewhere. R5: bounded, so this iteration
        // settles and cannot pile up.
      }
    }, refreshIntervalMs);
    refresher.unref?.();
  };

  const becomeLeader = () => {
    leader = true;
    logger.info(
      { category: "monitoring", instanceId },
      "[scheduler] Acquired scheduler leadership — heartbeat + alerting evaluator + cron will run here",
    );
    startRefresher();
  };

  const attemptAcquisition = async (): Promise<"acquired" | "busy" | "error"> => {
    if (released || leader) return "busy";
    try {
      const result = await withRedisCommandTimeout(
        "leader_acquire_set",
        () =>
          redis.set(SCHEDULER_LEADER_KEY, instanceId, {
            NX: true,
            EX: LEADER_TTL_SEC,
          }),
        LEADERSHIP_OP_TIMEOUT_MS,
      );
      return result === "OK" ? "acquired" : "busy";
    } catch (err) {
      // Redis hiccup — fall closed for THIS attempt (don't run schedulers
      // from this process; other instances might) but keep retrying:
      // erroring forever on a boot-time blip lost schedulers for whole
      // days before B7-P1-1.
      logger.warn(
        { err, category: "monitoring" },
        "[scheduler] Leadership lock evaluation failed — will retry",
      );
      return "error";
    }
  };

  const startRetryTimer = () => {
    if (retryTimer) return;
    retryTimer = setInterval(() => {
      if (released || leader) return;
      void attemptAcquisition()
        .then((outcome) => {
          if (outcome !== "acquired" || released || leader) return;
          stopRetryTimer();
          becomeLeader();
          try {
            options.onAcquired?.();
          } catch (err) {
            logger.error(
              { err, category: "monitoring" },
              "[scheduler] onAcquired callback threw — schedulers may be partially started",
            );
          }
        })
        .catch(() => {
          // attemptAcquisition never rejects; belt-and-suspenders.
        });
    }, retryIntervalMs);
    retryTimer.unref?.();
  };

  const first = await attemptAcquisition();

  if (first === "acquired") {
    becomeLeader();
  } else {
    if (first === "busy") {
      logger.info(
        { category: "monitoring", instanceId, retryIntervalMs },
        "[scheduler] Another instance currently holds leadership — retrying every 20s until it frees up (blue-green deploy window)",
      );
    }
    // B7-P1-1: keep re-attempting in the background. The old instance's
    // SIGTERM release (or a 60 s TTL expiry after SIGKILL) hands the lock
    // over; when that happens we become leader and notify the caller.
    startRetryTimer();
  }

  return {
    instanceId,
    get isLeader() {
      return leader;
    },
    release: async () => {
      released = true;
      stopRetryTimer();
      stopRefresher();
      if (!leader) return;
      leader = false;
      try {
        // Release only if we still own it (a different instance may have
        // taken over after a TTL expiry).
        //
        // R5 (round-93 A3): SIGTERM during a Redis outage must not stall
        // the graceful drain. The old raw get/del queued forever on a dead
        // socket (offline queue) — shutdown stalled in schedulers.stop()
        // until the 10 s force-exit cut in-flight responses mid-byte and
        // skipped pool drain. Bounded to 2 s: if we cannot release, the
        // 60 s lock TTL hands leadership over anyway.
        const current = await withRedisCommandTimeout(
          "leader_release_get",
          () => redis.get(SCHEDULER_LEADER_KEY),
          LEADERSHIP_OP_TIMEOUT_MS,
        );
        if (current === instanceId) {
          await withRedisCommandTimeout(
            "leader_release_del",
            () => redis.del(SCHEDULER_LEADER_KEY),
            LEADERSHIP_OP_TIMEOUT_MS,
          );
        }
      } catch {
        // ignore — the lock TTL (60 s) is the backstop.
      }
    },
  };
}
