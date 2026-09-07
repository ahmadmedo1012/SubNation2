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

const SCHEDULER_LEADER_KEY = "scheduler:leader";
const LEADER_TTL_SEC = 60;
const REFRESH_INTERVAL_MS = 20_000;
const DEFAULT_ACQUIRE_RETRY_MS = 20_000;

export interface SchedulerLeadership {
  /** Unique id of the process that holds (or attempted) the leadership. */
  readonly instanceId: string;
  /**
   * True when this process holds the leader lock. LIVE value — when the
   * initial acquisition fails, this flips to true the moment a retry
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
  /** Interval between acquisition retries. Default 20 s. */
  retryIntervalMs?: number;
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

  const startRefresher = () => {
    if (refresher) return;
    // Periodically renew the lock TTL — but ONLY if we still own it. This
    // protects against a clock skew or split-brain situation where another
    // instance has already taken over.
    refresher = setInterval(async () => {
      try {
        const current = await redis.get(SCHEDULER_LEADER_KEY);
        if (current === instanceId) {
          await redis.expire(SCHEDULER_LEADER_KEY, LEADER_TTL_SEC);
        } else {
          // We lost it. Stop refreshing — the per-job interval still ticks
          // but next refresh attempt will keep failing harmlessly. The
          // operator's signal to investigate is the
          // `redis_degraded_mode_total{reason="lost_leadership"}` counter.
          logger.warn(
            { category: "monitoring", instanceId, currentLeader: current },
            "[scheduler] Lost scheduler leadership; another process holds the lock now",
          );
        }
      } catch {
        // ignore — Redis hiccups are surfaced via redis_errors_total elsewhere
      }
    }, REFRESH_INTERVAL_MS);
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
      const result = await redis.set(SCHEDULER_LEADER_KEY, instanceId, {
        NX: true,
        EX: LEADER_TTL_SEC,
      });
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
  }

  return {
    instanceId,
    get isLeader() {
      return leader;
    },
    release: async () => {
      released = true;
      stopRetryTimer();
      if (refresher) {
        clearInterval(refresher);
        refresher = null;
      }
      if (!leader) return;
      leader = false;
      try {
        // Release only if we still own it (a different instance may have
        // taken over after a TTL expiry).
        const current = await redis.get(SCHEDULER_LEADER_KEY);
        if (current === instanceId) {
          await redis.del(SCHEDULER_LEADER_KEY);
        }
      } catch {
        // ignore
      }
    },
  };
}
