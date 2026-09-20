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
 * F2 (round-94 A6): Redis null no longer grants unguarded leadership —
 * the old dev fallback was reachable from PRODUCTION via the degraded
 * boot path (initRedisClient catches, getRedisClient() → null,
 * startWebSchedulers(null)): the returned object had no refresher, no
 * retry loop and no onLost, so an instance that "won" that way kept
 * running every cron/watcher/alerting forever, in parallel with the old
 * leader once Redis returned — split-brain until the next deploy. Now a
 * null client means NO leadership (jobs stop safely, fail-closed) with a
 * single warn, and the existing acquisition retry loop polls
 * getRedisClient() so the process takes the REAL lock (onAcquired fires,
 * schedulers start) the moment Redis comes back.
 *
 * 97-F1 (round-97): F2's fail-closed policy had a structural blind spot —
 * with REDIS_URL missing from the environment NO Redis client object is
 * ever created (redis-client.ts resolves to null forever), so the
 * "self-healing" retry loop polled a client that could never appear:
 * leadership was never granted and every cron, watcher and the alerting
 * evaluator stayed dead for the whole process lifetime while the app
 * kept serving traffic and passing health checks (silent production
 * outage 2026-09-08..11 — see docs/inspection-r97/backend-services-infra.md).
 * Postgres is already the money-path dependency in every environment, so
 * when the Redis client resolves to null the coordinator now falls back
 * to the PG-backed leader lease (lib/pg-leader-lease.ts, same
 * acquire/refresh/release semantics) INSTEAD of returning "no_client"
 * — the exact same state machine drives it (first attempt →
 * acquired/busy/error, retry timer, becomeLeader → refresher, demotion
 * on an unverified/lost lease, release). Redis REMAINS the primary
 * backend whenever a client exists; the PG lease only serves the
 * no-Redis shape, and a PG leader that notices Redis has come back hands
 * leadership over (releases the lease, demotes, re-competes for the real
 * Redis lock) so the two backends can never elect parallel leaders for
 * longer than one refresh interval.
 */

import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { logger } from "./logger";
import { getRedisClient, noteRedisDegradedMode, withRedisCommandTimeout } from "./redis-client";
import {
  getSchedulerLeaderLeaseBackend,
  type SchedulerLeaderLeaseBackend,
} from "./pg-leader-lease";

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
  /**
   * F2 (round-94 A6): lazy client source polled by the acquisition retry
   * loop while the boot-time client was null (degraded boot). Defaults to
   * getRedisClient(). Test seam — production callers pass their client as
   * the first argument and never set this.
   */
  redisProvider?: () => RedisClientType | null;
  /**
   * 97-F1 test seam: the PG leader-lease backend used when Redis is
   * unavailable (null client). Defaults to the shared backend from
   * lib/pg-leader-lease.ts. Production callers never set this — the
   * default resolves the existing shared db pool lazily.
   */
  pgLeaseBackend?: SchedulerLeaderLeaseBackend;
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

  // F2: the boot-time client may be null (degraded boot). The acquisition
  // retry loop re-resolves the client through this provider, so leadership
  // is only ever granted against a REAL lock — never unguarded.
  const resolveClient = options.redisProvider ?? (redis ? () => redis : getRedisClient);
  let client: RedisClientType | null = redis;
  // 97-F1: lock backend used when the Redis client resolves to null.
  const pgLease = options.pgLeaseBackend ?? getSchedulerLeaderLeaseBackend();
  // True while the CURRENT leadership attempt/hold rides the PG lease
  // backend — refresh() and release() must talk to the backend that
  // actually granted us the lease, not to whichever is preferred now.
  let usingPgLease = false;
  // 97-F1: one clear line for the whole no-Redis episode — NOT one per
  // retry tick (the loop polls silently; Redis returning is the normal
  // upgrade path back to the primary backend).
  let pgFallbackLogged = false;
  const logPgFallbackOnce = () => {
    if (pgFallbackLogged) return;
    pgFallbackLogged = true;
    logger.warn(
      { category: "monitoring", instanceId },
      "[scheduler] Redis unavailable — using PostgreSQL leader lease (single-db fallback)",
    );
  };

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
      if (usingPgLease) {
        // 97-F1: Redis is the PRIMARY backend — if a client has (re)appeared
        // since we took the PG lease (degraded boot that healed, or a
        // REDIS_URL re-add), hand leadership over CLEANLY instead of running
        // on the fallback forever: release our lease row, demote (the caller
        // stops its schedulers), and let the retry loop compete for the real
        // Redis lock like everyone else. Without this, a PG leader + a
        // Redis leader could double-run every cron/watcher indefinitely.
        // (With REDIS_URL truly absent this check never fires — no client
        // object is ever created — so the fallback leadership is stable.)
        const redisNow = client ?? resolveClient();
        if (redisNow) {
          client = redisNow;
          usingPgLease = false;
          try {
            await pgLease.release(instanceId);
          } catch {
            // ignore — the 60 s lease TTL is the backstop.
          }
          demote("redis_returned");
          return;
        }
        // 97-F1: PG refresher — the lease outcome VERIFIES the holder (the
        // UPDATE's WHERE clause only returns a row for the current holder
        // of an unexpired lease). A lost lease after expiry must demote
        // IMMEDIATELY — another instance may have taken over and may be
        // running the schedulers already.
        //
        // "error" (DB hiccup) ALSO demotes: holdership could not be
        // verified, and an unverified lease must never keep firing
        // schedulers (fail-closed). The demotion is cheap to recover from —
        // the retry loop re-acquires, and a same-holder re-acquire is
        // idempotent in the lease SQL (no waiting for TTL expiry).
        try {
          const outcome = await pgLease.refresh(instanceId, LEADER_TTL_SEC);
          if (outcome === "renewed") return;
          // "lost" or "error": the current holder is not verifiably us.
          demote(outcome);
        } catch (err) {
          // The lease backend contract is never-throw; belt-and-suspenders.
          logger.warn(
            { err, category: "monitoring" },
            "[scheduler] PG leader lease refresh threw — demoting",
          );
          demote("refresh_threw");
        }
        return;
      }
      if (!client) return;
      try {
        // R5: bounded — during a Redis outage the raw get queued forever
        // (offline queue) and the 20 s iterations hang-stacked.
        const current = await withRedisCommandTimeout(
          "leader_refresh_get",
          () => client!.get(SCHEDULER_LEADER_KEY),
          LEADERSHIP_OP_TIMEOUT_MS,
        );
        if (current === instanceId) {
          await withRedisCommandTimeout(
            "leader_refresh_expire",
            () => client!.expire(SCHEDULER_LEADER_KEY, LEADER_TTL_SEC),
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
    // F2: re-resolve the client each attempt — a null boot-time client
    // (degraded boot) upgrades to the live one the moment Redis returns.
    // 97-F1: Redis stays the PRIMARY backend whenever a client exists.
    const target = client ?? resolveClient();
    if (target) {
      client = target;
      usingPgLease = false;
      try {
        const result = await withRedisCommandTimeout(
          "leader_acquire_set",
          () =>
            target.set(SCHEDULER_LEADER_KEY, instanceId, {
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
    }
    // 97-F1: no Redis client (no REDIS_URL — no client object is EVER
    // created, so unlike a connection blip this state cannot heal itself).
    // Fall back to the PG-backed leader lease instead of returning
    // "no_client" and staying dark for the whole process lifetime. Same
    // acquire semantics, same retry loop, same guarded leadership.
    logPgFallbackOnce();
    usingPgLease = true;
    try {
      return await pgLease.acquire(instanceId, LEADER_TTL_SEC);
    } catch (err) {
      // The lease backend contract is never-throw; belt-and-suspenders.
      logger.warn(
        { err, category: "monitoring" },
        "[scheduler] PG leader lease evaluation failed — will retry",
      );
      return "error";
    }
  };

  // R101 (orphan-lock guard): best-effort immediate release of a lock/lease
  // that resolved as OURS after release() already ran. Never throws — a
  // failure simply leaves the 60 s TTL as the backstop, exactly like the
  // release() path below.
  const freeOrphanedLock = async (): Promise<void> => {
    try {
      if (usingPgLease) {
        await pgLease.release(instanceId);
        return;
      }
      if (!client) return;
      const current = await withRedisCommandTimeout(
        "leader_orphan_get",
        () => client!.get(SCHEDULER_LEADER_KEY),
        LEADERSHIP_OP_TIMEOUT_MS,
      );
      if (current === instanceId) {
        await withRedisCommandTimeout(
          "leader_orphan_del",
          () => client!.del(SCHEDULER_LEADER_KEY),
          LEADERSHIP_OP_TIMEOUT_MS,
        );
        logger.info(
          { category: "monitoring", instanceId },
          "[scheduler] released an acquisition that resolved post-shutdown (orphan-lock guard)",
        );
      }
    } catch {
      // TTL (60 s) is the backstop — cleanup must never stall shutdown.
    }
  };

  const startRetryTimer = () => {
    if (retryTimer) return;
    retryTimer = setInterval(() => {
      if (released || leader) return;
      void attemptAcquisition()
        .then((outcome) => {
          if (outcome !== "acquired" || leader) return;
          // R101 (orphan-lock guard): the acquisition SET can resolve a
          // hair's-breadth AFTER release() ran (fast SIGTERM at boot, or
          // signal during the retry window). Before R101 the lock then sat
          // in Redis under OUR id with nobody owning it — the new instance
          // waited out the full 60 s TTL in blue-green deploys. Free it
          // now instead; any failure falls back to the TTL backstop.
          if (released) {
            void freeOrphanedLock();
            return;
          }
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
    // R101: same orphan-lock guard on the initial (non-retry) acquisition —
    // release() may already have run while the SET was in flight.
    if (released) {
      void freeOrphanedLock();
    } else {
      becomeLeader();
    }
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
    // F2: also the recovery path for a degraded (Redis-less) boot.
    // 97-F1: with no Redis client the loop now races the PG lease instead —
    // the moment the lease frees up (release or TTL expiry elsewhere)
    // onAcquired fires and the schedulers start here.
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
      if (usingPgLease) {
        // 97-F1: release OUR lease row on the PG backend that granted it.
        // A failure is swallowed — the 60 s lease TTL hands leadership
        // over anyway (same backstop philosophy as the Redis path below,
        // and SIGTERM drain must never stall on a DB hiccup).
        try {
          await pgLease.release(instanceId);
        } catch {
          // ignore — the lease TTL (60 s) is the backstop.
        }
        return;
      }
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
          () => client!.get(SCHEDULER_LEADER_KEY),
          LEADERSHIP_OP_TIMEOUT_MS,
        );
        if (current === instanceId) {
          await withRedisCommandTimeout(
            "leader_release_del",
            () => client!.del(SCHEDULER_LEADER_KEY),
            LEADERSHIP_OP_TIMEOUT_MS,
          );
        }
      } catch {
        // ignore — the lock TTL (60 s) is the backstop.
      }
    },
  };
}
