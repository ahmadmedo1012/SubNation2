/**
 * Boot one-shots — the leader-start catch-up jobs (B7-P2-12 family).
 *
 * Daily retention jobs have no node-cron catch-up: if the instance was
 * down at slot time, the day's run is simply skipped. Every job here is
 * idempotent by construction, so firing them at leader start closes the
 * restart gap with zero double-run risk.
 *
 * R101: this list moved out of lib/web-scheduler.ts into a shared module
 * because BOTH scheduler owners need it:
 *   - the web process when it wins the (Redis or PG-lease) leader lock
 *     (embedded mode — current production reality), and
 *   - the dedicated worker process (DISABLE_WEB_SCHEDULERS=true on the
 *     web tier) — the documented migration path. Before R101 the worker
 *     fired cron + alerting + heartbeat but NONE of these one-shots, so
 *     flipping the migration switch silently dropped the B7-P2-12
 *     restart-gap protection (retention would again be cron-only).
 *
 * The chain is SEQUENTIAL (cold-start query-storm guard, 2026-09-20):
 * the boot one-shots used to fire CONCURRENTLY — eight retention jobs
 * hitting a freshly-woken Neon compute (0.25 CU free tier) in the same
 * tick. They now run strictly sequentially: each job waits for the
 * previous one to settle. Total wall-clock is a few seconds; the first
 * user requests stop competing with retention DELETEs for pool slots.
 * Callers fire-and-forget — the chain is self-driving.
 */

import { logger } from "../lib/logger";
import { pruneStaleAdminSessions } from "../lib/admin-session";
import { checkExpiringCoupons } from "./couponWatcher";
import { cleanupOldAuthActivity } from "./cleanup-auth-activity";
import { checkAdminTotpAdvisory } from "./security-advisories";
import { pruneExpiredSessions } from "./session-prune";
import { reapExpiredRiskEvents } from "./risk-retention";
import { markStaleUnreadAlertsRead, pruneReadAlerts } from "./alertLogger";
import { deactivateExpiredFlashSales } from "./flashSaleWatcher";
import { runStockSweep } from "./stockWatcher";
import { reapExpiredCopilotPreviews } from "./copilot-reaper";
import { pruneExpiredOtps } from "../services/whatsapp-otp.service";

/**
 * 97-F1 (round-97 A6/D.2): flash-sale expiry catch-up, fired once at
 * leader start via the exported jobs/flashSaleWatcher.ts sweep (same
 * predicate, same alert, same per-sale 7-day dedupe key, so the boot
 * catch-up and the route-triggered sweeps collapse to one alert per
 * sale). Idempotent by construction.
 */
async function deactivateExpiredFlashSalesCatchUp(): Promise<{ deactivated: number }> {
  // The sweep logs its own outcome; the return shape only feeds the
  // fireOneShot logger on failure.
  await deactivateExpiredFlashSales();
  return { deactivated: -1 };
}

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

/**
 * Fire the leader-start catch-up chain. Safe to call from any process
 * that owns the schedulers (web leader or dedicated worker); every job
 * is idempotent, so a web→worker topology flip cannot double-run
 * anything materially (worst case: two overlapping prunes of the same
 * already-clean tables).
 *
 * One-shot roster (why each is here):
 *   - session prune: sessions that expired while the process was down;
 *   - TOTP advisory: weekly admin-TOTP nudge;
 *   - retention catch-up (B7-P2-12): alert + risk-events retention
 *     would otherwise be skipped entirely if the instance was down at
 *     the 00:00/03:30 slots;
 *   - auth-activity retention (B7-P1-2): the 90-day retention policy
 *     predates its cron wiring — boot firing keeps it enforced;
 *   - coupon + stock sweeps: the old 30 s / 60 s watcher initial
 *     passes, now the only boot-time trigger (route-triggered
 *     opportunistic sweeps carry the rest);
 *   - copilot reaper: the old hourly :45 cron slot, now boot +
 *     admin-surface-triggered;
 *   - whatsapp OTP prune + admin-session prune + flash-sale catch-up:
 *     97-F1 — the silent-outage restart-gap fix (these three were
 *     cron-only with no restart catch-up).
 */
export function runBootOneShots(): void {
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
    { category: "monitoring" },
    "[scheduler] sequential boot one-shots started (sessionPrune, securityAdvisories, alertRetention, riskRetention, authActivityRetention, couponSweep, stockSweep, copilotReaper, whatsappOtpPrune, adminSessionPrune, flashSaleCatchup)",
  );
}
