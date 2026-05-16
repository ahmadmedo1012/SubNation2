/**
 * Module-level singleton for the scheduler's runtime state.
 *
 * Set once at boot by `lib/web-scheduler.ts`, read by
 * `routes/admin/observability.ts` so the admin dashboard can surface the
 * actual scheduler mode (embedded vs disabled vs dedicated-worker) instead
 * of the misleading "worker failed" we used to derive from the Redis
 * heartbeat key.
 *
 * Scheduler modes:
 *   - "embedded"  : the web process runs heartbeat + alerting + cron itself
 *                   (current production reality — no dedicated worker
 *                   service provisioned yet).
 *   - "dedicated" : web process is gated off via DISABLE_WEB_SCHEDULERS=true
 *                   and a separate worker service is expected to own them.
 *   - "disabled"  : neither this process nor any other is running schedulers
 *                   (manual operator override; observable to the dashboard
 *                   so an alert can fire).
 */

export type SchedulerMode = "embedded" | "dedicated" | "disabled";

export type SchedulerReason =
  | "active"
  | "disabled_by_env"
  | "not_leader"
  | "redis_unavailable"
  | "unknown";

export interface SchedulerStateSnapshot {
  /** What kind of scheduler topology this process believes is in effect. */
  mode: SchedulerMode;
  /** Whether the scheduler loops are currently running in this process. */
  active: boolean;
  /** Whether this process holds the Redis-backed leader lock. */
  isLeader: boolean;
  /** Stable id of this process (host + pid + uuid). */
  instanceId: string | null;
  /** Why active is false (or "active" if true). */
  reason: SchedulerReason;
  /** ISO timestamp when the scheduler began running in this process. */
  startedAt: string | null;
}

let state: SchedulerStateSnapshot = {
  mode: "embedded",
  active: false,
  isLeader: false,
  instanceId: null,
  reason: "unknown",
  startedAt: null,
};

/**
 * Update the global scheduler state. Called by web-scheduler.ts after
 * startWebSchedulers() decides what mode it's in. Never throws — safe to
 * call from instrumentation paths.
 */
export function setSchedulerState(next: Partial<SchedulerStateSnapshot>): void {
  state = { ...state, ...next };
}

/**
 * Read the current scheduler state. Returns a clone — callers cannot
 * mutate the global.
 */
export function getSchedulerState(): SchedulerStateSnapshot {
  return { ...state };
}
