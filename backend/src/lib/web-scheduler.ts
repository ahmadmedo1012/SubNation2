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
 * Migration to a dedicated worker (when ready):
 *   1. Provision the `subnation-worker` Render service.
 *   2. Render MCP `update_environment_variables` to set
 *      `DISABLE_WEB_SCHEDULERS=true` on the web service.
 *   3. Web tier stops running these. The worker tier owns them by
 *      default (workerEntry calls `alertingService.start` / `startHeartbeat`
 *      directly, no leader gate — it's the only node running them).
 */

import type { RedisClientType } from "redis";
import { and, eq, lt } from "drizzle-orm";
import { db, flashSalesTable } from "@workspace/db";
import { logger } from "./logger";
import { pruneStaleAdminSessions } from "./admin-session";
import { startCouponWatcher } from "../jobs/couponWatcher";
import { initCronJobs } from "../jobs/cron";
import { cleanupOldAuthActivity } from "../jobs/cleanup-auth-activity";
import { checkAdminTotpAdvisory } from "../jobs/security-advisories";
import { pruneExpiredSessions } from "../jobs/session-prune";
import { reapExpiredRiskEvents } from "../jobs/risk-retention";
import { markStaleUnreadAlertsRead, pruneReadAlerts } from "../jobs/alertLogger";
import { startFlashSaleWatcher } from "../jobs/flashSaleWatcher";
import { startStockWatcher } from "../jobs/stockWatcher";
// 97-F3 (R97-A5 WA-06): channel-death watch — alerts when the WhatsApp
// OTP gateway session is not ready/settling for > 15 minutes.
import { startWhatsAppChannelWatch } from "../services/whatsapp-watch";
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

/**
 * 97-F1 (round-97 A6/D.2): flash-sale expiry catch-up, fired once at leader
 * start. Mirrors jobs/flashSaleWatcher.ts#deactivateExpiredFlashSales — that
 * function is module-private and this file cannot re-export it, so the
 * semantics are mirrored EXACTLY (same expired-active predicate, same alert
 * type/message, same per-sale 7-day dedupe key) so concurrent runs (this
 * one-shot racing the watcher's own 30 s initial pass) collapse to one alert
 * per sale instead of double-alerting. Idempotent by construction: only
 * rows that are both is_active=true AND ends_at<now() are flipped.
 *
 * logAdminAlert is imported LAZILY on purpose: this module's static import
 * surface feeds the existing demotion test's alertLogger mock (which exports
 * only the two retention helpers) — a static named import of logAdminAlert
 * would crash that suite at module-link time. Inside a one-shot the lazy
 * resolution failure is just a logged warn, never a scheduler crash.
 */
async function deactivateExpiredFlashSalesCatchUp(): Promise<{ deactivated: number }> {
  const now = new Date();
  const expired = await db
    .select({
      id: flashSalesTable.id,
      title: flashSalesTable.title,
      endsAt: flashSalesTable.endsAt,
    })
    .from(flashSalesTable)
    .where(and(eq(flashSalesTable.isActive, true), lt(flashSalesTable.endsAt, now)));

  if (expired.length === 0) return { deactivated: 0 };

  await db
    .update(flashSalesTable)
    .set({ isActive: false })
    .where(and(eq(flashSalesTable.isActive, true), lt(flashSalesTable.endsAt, now)));

  const { logAdminAlert } = await import("../jobs/alertLogger");
  for (const row of expired) {
    await logAdminAlert(
      "flash_sale_expired",
      `انتهت تخفيضات: ${row.title}`,
      `تم إنهاء التخفيضات تلقائياً بعد انتهاء وقتها (${row.endsAt.toISOString()}).`,
      // Same per-sale dedupe key + 7-day window as the watcher (F5,
      // round-94 A6): an expired sale can never expire again, so one alert
      // per sale is the truth — a late/duplicate catch-up collapses.
      {
        dedupeKey: `flash_sale_expired:${row.id}`,
        dedupeWindowMs: 7 * 24 * 60 * 60 * 1000,
      },
    );
  }

  return { deactivated: expired.length };
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
  const watchers: Array<{ stop: () => void }> = [];

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
    // B7-P2-11: watchers expose stop handles — actually stop the
    // intervals instead of relying on process exit.
    for (const watcher of watchers) watcher.stop();
    watchers.length = 0;
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

    // Cron + watchers — same code path used by worker.ts when a worker exists.
    watchers.push(
      startCouponWatcher(),
      startStockWatcher(),
      startFlashSaleWatcher(),
      // 97-F3: 60s channel-health probe with 15-min budget + dedupe-keyed
      // admin alerts (qr_ready that nobody scans, failed, disconnected…).
      startWhatsAppChannelWatch(),
    );
    cronJobs = initCronJobs();

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
    // 97-F1 (round-97 A6/D + R97-DB-03): the two prunes the silent outage
    // proved were cron-only — 5 expired whatsapp_otps (>24 h) and 5 stale
    // admin_sessions (>48 h) accumulated precisely because neither had a
    // boot one-shot to catch the restart gap. Both are idempotent deletes.
    fireOneShot("whatsapp-otp-prune", pruneExpiredOtps);
    fireOneShot("admin-session-prune", pruneStaleAdminSessions);
    // 97-F1: expired flash sales otherwise stay is_active=true in the admin
    // list (and block the active-sale singleton unique index) until the
    // first watcher tick — flip them immediately at leader start.
    fireOneShot("flash-sale-catchup", deactivateExpiredFlashSalesCatchUp);

    logger.info(
      { category: "monitoring", instanceId: leadership.instanceId },
      "[scheduler] cron + watchers + boot one-shots started (couponWatcher, stockWatcher, flashSaleWatcher, whatsappChannelWatch, cron, sessionPrune, securityAdvisories, alertRetention, riskRetention, authActivityRetention, whatsappOtpPrune, adminSessionPrune, flashSaleCatchup)",
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
