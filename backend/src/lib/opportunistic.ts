/**
 * Opportunistic, throttled maintenance — the free-tier replacement for
 * interval polling (2026-09-20 free-infrastructure round).
 *
 * WHY THIS EXISTS
 * ───────────────
 * Render Free sleeps the web service after ~15 min without inbound
 * traffic, and Neon Free autosuspends ~5 min after the last query. Every
 * in-process timer that touches the DB on a short cadence (the old
 * 5-minute flash-sale watcher, 30-minute stock watcher, hourly coupon /
 * OTP / copilot sweepers) kept Neon compute awake 24/7 whenever the
 * process itself was awake — the direct cause of free-tier quota
 * exhaustion (Aug 2026). The keep-alive self-pings that kept Render
 * awake are gone entirely (see jobs/cron.ts); these helpers retire the
 * remaining timers by moving maintenance ONTO the requests that make
 * the work meaningful:
 *
 *   - expired flash sales flip when a user READS the flash-sale surface
 *     or an admin opens the promotions panel (the runtime query already
 *     gates on `ends_at > now()` — the flip is operator UX, not safety);
 *   - expired coupons disable when a user APPLIES a coupon at checkout
 *     or an admin lists them (redemption was already guarded in-tx);
 *   - low/zero stock alerts fire after purchases / refunds / admin
 *     inventory writes — the only events that change stock;
 *   - OTP + copilot retention sweep when those surfaces are exercised.
 *
 * GUARANTEES
 *   1. Fire-and-forget: the triggering request NEVER awaits the
 *      maintenance work (no latency, no failure coupling).
 *   2. In-process throttle: at most one run per `key` per
 *      `minIntervalMs`, measured from run START. A second caller inside
 *      the window is a no-op. Single-instance production (leader-gated
 *      schedulers) means in-memory state is sufficient; a blue-green
 *      overlap merely double-runs a bounded idempotent sweep.
 *   3. Re-entry guard: a hung run cannot stack a concurrent twin.
 *   4. Never throws: failures are warn-logged (Sentry breadcrumb via
 *      logger) exactly like the old scheduler contract.
 *   5. No timers are created — nothing here can keep a process, a
 *      Render service, or a Neon compute awake.
 *
 * Boot catch-up: jobs/cron.ts + web-scheduler.ts still fire the
 * retention one-shots at leader start (idempotent), so a mostly-sleeping
 * service still converges — the throttle keys below simply dedupe the
 * first post-boot trigger within its window.
 */

import { logger } from "./logger";

interface ThrottleEntry {
  /** Epoch ms of the run START for the currently-throttled window. */
  startedAt: number;
  /** True while the async body is executing (re-entry guard). */
  inFlight: boolean;
}

const registry = new Map<string, ThrottleEntry>();

/** Test seam — wipe the throttle map to simulate a cold process. */
export function resetOpportunisticMaintenanceForTests(): void {
  registry.clear();
}

/**
 * Fire a throttled, fire-and-forget maintenance job.
 *
 * @param key           Stable identity of the job (e.g. "flash-sale-sweep").
 * @param minIntervalMs Minimum spacing between runs, per process.
 * @param fn            The idempotent maintenance body. Must never be
 *                      relied upon for correctness of the triggering
 *                      request — it is best-effort housekeeping.
 * @returns true when the job actually started, false when throttled or
 *          a previous run is still in flight.
 */
export function fireThrottledMaintenance(
  key: string,
  minIntervalMs: number,
  fn: () => Promise<unknown>,
): boolean {
  const now = Date.now();
  const entry = registry.get(key);

  if (entry) {
    if (entry.inFlight) return false; // a hung run must not stack twins
    if (now - entry.startedAt < minIntervalMs) return false; // throttled
  }

  registry.set(key, { startedAt: now, inFlight: true });

  void (async () => {
    try {
      await fn();
    } catch (err) {
      logger.warn(
        { err, category: "maintenance", job: key },
        `[opportunistic] maintenance job "${key}" failed (non-fatal)`,
      );
    } finally {
      const current = registry.get(key);
      if (current) current.inFlight = false;
    }
  })();

  return true;
}
