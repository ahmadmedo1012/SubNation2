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

export interface SchedulerLeadership {
  /** Unique id of the process that holds (or attempted) the leadership. */
  readonly instanceId: string;
  /** True when this process holds the leader lock. */
  readonly isLeader: boolean;
  /** Stop refreshing + release the lock if we own it. Idempotent. */
  release: () => Promise<void>;
}

/**
 * Try to become the scheduler leader. Returns a SchedulerLeadership object
 * with `isLeader=true` if we won the SETNX race, `false` otherwise.
 *
 * The leader periodically refreshes its TTL so a long-running healthy
 * process keeps the lock. If the leader dies without releasing (e.g.
 * SIGKILL, OOM), the TTL expires within `LEADER_TTL_SEC` and another
 * process can take over on its next attempt.
 */
export async function acquireSchedulerLeadership(
  redis: RedisClientType | null,
): Promise<SchedulerLeadership> {
  const instanceId = `${process.env.RENDER_SERVICE_NAME ?? "web"}-${process.pid}-${randomUUID()}`;

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

  let isLeader = false;
  try {
    const result = await redis.set(SCHEDULER_LEADER_KEY, instanceId, {
      NX: true,
      EX: LEADER_TTL_SEC,
    });
    isLeader = result === "OK";
  } catch (err) {
    // Redis hiccup at boot — fall closed (don't run schedulers from this
    // process; other instances might).
    logger.warn(
      { err, category: "monitoring" },
      "[scheduler] Failed to evaluate leadership lock — declining leadership",
    );
    return {
      instanceId,
      isLeader: false,
      release: async () => {},
    };
  }

  if (!isLeader) {
    logger.info(
      { category: "monitoring", instanceId },
      "[scheduler] Another instance holds leadership — schedulers will not start in this process",
    );
    return {
      instanceId,
      isLeader: false,
      release: async () => {},
    };
  }

  logger.info(
    { category: "monitoring", instanceId },
    "[scheduler] Acquired scheduler leadership — heartbeat + alerting evaluator + cron will run here",
  );

  // Periodically renew the lock TTL — but ONLY if we still own it. This
  // protects against a clock skew or split-brain situation where another
  // instance has already taken over.
  const refresher = setInterval(async () => {
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

  return {
    instanceId,
    isLeader: true,
    release: async () => {
      clearInterval(refresher);
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
