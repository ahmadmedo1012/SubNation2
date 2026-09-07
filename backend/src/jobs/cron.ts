import cron from "node-cron";
import { markStaleUnreadAlertsRead, pruneReadAlerts } from "./alertLogger";
import { cleanupOldAuthActivity } from "./cleanup-auth-activity";
import { reapExpiredCopilotPreviews } from "./copilot-reaper";
import { runForecastIfPermitted } from "./forecast-runner";
import { runForecastRetention } from "./forecast-retention";
import { runEnrichmentIfPermitted } from "./enrichment-runner";
import { runEnrichmentRetention } from "./enrichment-retention";
import { reapExpiredRiskEvents } from "./risk-retention";
import { pruneExpiredSessions } from "./session-prune";
import { checkAdminTotpAdvisory } from "./security-advisories";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";
import { pruneExpiredOtps } from "../services/whatsapp-otp.service";

/** Stop handle for everything initCronJobs() started (R6/R8). */
export interface CronJobsHandle {
  /** Stop all cron tasks from this init call. Idempotent. */
  stop: () => void;
}

export function initCronJobs(): CronJobsHandle {
  // R8 (round-93 A3): node-cron's schedule() returns a task handle with
  // .stop() — the return values used to be discarded everywhere, so no
  // code path could ever stop the crons. The drain sequence (web-scheduler
  // stop) and the R6 leadership-demotion path both need real handles, so
  // every schedule() result is captured here and returned to the caller.
  const tasks: Array<{ stop: () => void }> = [];
  const schedule = (...args: Parameters<typeof cron.schedule>) => {
    const task = cron.schedule(...args);
    tasks.push(task);
    return task;
  };
  // 1. Every day at midnight: admin-alert retention.
  //
  //    Round-5 (db-audit 2026-09-07) — this slot previously held a
  //    second, duplicate low-stock alerter (SELECT products with < 5
  //    stock, insert one alert each, NO dedupe of any kind). It ran in
  //    parallel with stockWatcher.ts and is the main reason 321 unread
  //    alerts piled up. stockWatcher (30-min cadence, DB-level dedupe
  //    as of this round) is the single stock-alerting path now; this
  //    slot instead keeps the alert table small and readable:
  //      - unread older than 14 days → auto-marked read (stale, but
  //        the row stays inspectable)
  //      - read older than 30 days → deleted (admin_alerts is an
  //        operations surface, not the immutable audit trail — that
  //        is audit_logs' job)
  schedule("0 0 * * *", async () => {
    logger.info({ category: "alerts.retention" }, "Admin-alert retention job started");
    try {
      const staled = await markStaleUnreadAlertsRead(14);
      const pruned = await pruneReadAlerts(30);
      if (staled + pruned > 0)
        logger.info(
          { category: "alerts.retention", staled, pruned },
          "Admin-alert retention complete",
        );
    } catch (err) {
      logger.error({ err, category: "alerts.retention" }, "Admin-alert retention failed");
      captureSchedulerFailure("admin_alert_retention", err, {
        cron_expression: "0 0 * * *",
      });
    }
  });

  // 1a. Daily at 00:05 UTC: TOTP security advisory (A6 P3#14, round-93).
  //      checkAdminTotpAdvisory used to be a boot one-shot ONLY — its
  //      "weekly" cadence actually meant "on restart", and the keep-alive
  //      pings (see job 8 below) keep this process alive for weeks, so a
  //      no-deploy month meant zero nudges. Daily cadence is safe because
  //      the advisory carries the admin:no-totp dedupe key with a 7-day
  //      window — the cron re-creates it at most weekly. 00:05 keeps it
  //      off the 00:00 retention slot's first minute. When every ["all"]
  //      admin has TOTP enabled the same pass AUTO-RESOLVES the lingering
  //      unread advisory rows.
  schedule("5 0 * * *", async () => {
    try {
      await checkAdminTotpAdvisory();
    } catch (err) {
      logger.error({ err, category: "security" }, "TOTP advisory cron failed");
      captureSchedulerFailure("totp_advisory", err, {
        cron_expression: "5 0 * * *",
      });
    }
  });

  // 1b. Daily at 05:00 UTC: expired-session prune (Round-5). Sessions
  //     whose expires_at passed are already rejected by requireUser,
  //     but the rows were never deleted — sessions grow monotonically
  //     with every login forever. Deleting expired rows is safe (the
  //     JWT is dead regardless) and keeps the session-validity lookup
  //     fast. 05:00 UTC = 07:00 Libya, before the daily traffic peak.
  schedule("0 5 * * *", async () => {
    try {
      const removed = await pruneExpiredSessions();
      if (removed > 0)
        logger.info(
          { category: "sessions.retention", removed },
          `Pruned ${removed} expired session row(s)`,
        );
    } catch (err) {
      logger.error({ err, category: "sessions.retention" }, "Session prune failed");
      captureSchedulerFailure("session_prune", err, {
        cron_expression: "0 5 * * *",
      });
    }
  });

  // 2. Every hour: Health Check / Cleanup (Example)
  //    (Round-5 note: still a no-op heartbeat — kept for log cadence.)
  schedule("0 * * * *", () => {
    logger.debug("Hourly cron heartbeat");
  });

  // 3. Every hour at minute 15: prune expired WhatsApp OTP rows.
  //
  // Idempotent. Safe to run repeatedly. The pruneExpiredOtps()
  // helper deletes rows whose created_at is older than 24h — at
  // that age the row is long past its 5-minute TTL AND any user
  // retrying with such a code would already have received an
  // "expired" or "consumed" verify error, so no active session
  // is ever at risk.
  //
  // Minute 15 (vs the heartbeat at :00) introduces natural jitter
  // so the two jobs never compete for DB resources at the same
  // instant if the heartbeat ever does real work. Logging is
  // count-only — no OTP codes, no phone numbers, no PII.
  schedule("15 * * * *", async () => {
    logger.info({ category: "whatsapp.otp.cleanup" }, "OTP cleanup started");
    try {
      const removed = await pruneExpiredOtps();
      logger.info(
        { category: "whatsapp.otp.cleanup", removed },
        `OTP cleanup completed — ${removed} expired record(s) removed`,
      );
    } catch (err) {
      logger.error({ err, category: "whatsapp.otp.cleanup" }, "OTP cleanup failed");
      captureSchedulerFailure("whatsapp_otp_cleanup", err, {
        cron_expression: "15 * * * *",
      });
    }
  });

  // 4. Hourly at :45: copilot preview reaper (010-ai-admin-copilot).
  //    Deletes copilot_previews rows older than 24h past their expiry. The
  //    audit chain stays intact because copilot_actions.preview_id is
  //    `ON DELETE SET NULL`.
  //
  //    Hourly, not every-5-minutes: previews expire on hour-scale windows,
  //    so a 5-minute reap cadence bought nothing except keeping the Neon
  //    compute from ever idling (each wake resets autosuspend — the direct
  //    cause of the Aug 2026 free-tier quota exhaustion).
  schedule("45 * * * *", async () => {
    try {
      const removed = await reapExpiredCopilotPreviews();
      if (removed > 0) {
        logger.info(
          { category: "copilot.reaper", removed },
          `copilot reaper removed ${removed} expired preview row(s)`,
        );
      }
    } catch (err) {
      logger.error({ err, category: "copilot.reaper" }, "copilot reaper failed");
      captureSchedulerFailure("copilot_reaper", err, {
        cron_expression: "45 * * * *",
      });
    }
  });

  // 8. Every 10 minutes: deterministic keep-alive self-ping + gateway ping.
  //    GitHub-cron external pings jitter 30-55 min under load, breaching
  //    Render's ~15-min idle window. In-process schedule has no jitter: this
  //    keeps THIS service warm and the openwa gateway's WhatsApp session
  //    alive (a spun-down gateway loses its paired session registry).
  const keepAliveTargets = [
    process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, "")}/api/healthz` : null,
    "https://openwa-gateway-7aaa.onrender.com/healthz",
  ].filter(Boolean) as string[];
  schedule("*/10 * * * *", async () => {
    for (const target of keepAliveTargets) {
      try {
        const res = await fetch(target, { signal: AbortSignal.timeout(15_000) });
        logger.debug({ target, status: res.status }, "[keep-alive] pinged");
      } catch (err) {
        logger.warn({ err, target }, "[keep-alive] ping failed");
      }
    }
  });

  // 5. Daily at 03:30 UTC: risk_events 90-day retention (003-anomaly-detection).
  //    Unlabeled events older than 90 days are deleted. Labeled events get
  //    a 97-day grace so retroactive review still resolves the label join.
  schedule("30 3 * * *", async () => {
    try {
      const result = await reapExpiredRiskEvents();
      if (result.unlabeledDeleted + result.labeledExpiredDeleted > 0) {
        logger.info(
          {
            category: "risk.retention",
            unlabeled: result.unlabeledDeleted,
            labeled: result.labeledExpiredDeleted,
          },
          "risk-events retention purge complete",
        );
      }
    } catch (err) {
      logger.error({ err, category: "risk.retention" }, "risk-events retention failed");
      captureSchedulerFailure("risk_retention", err, {
        cron_expression: "30 3 * * *",
      });
    }
  });

  // 6. Daily at 02:15 UTC: inventory demand forecast (011-inventory-demand-
  //    forecast). Refuses to run unless WORKER_TIER=true AND
  //    FORECAST_RUNNER_ENABLED=true (the runner enforces the gate).
  //    02:15 lands outside the existing low_stock (00:00), OTP cleanup
  //    (every :15), and copilot-reaper (every 5 min) windows so no two
  //    heavy jobs compete for DB resources.
  schedule("15 2 * * *", async () => {
    try {
      await runForecastIfPermitted();
    } catch (err) {
      logger.error({ err, category: "forecast.cron" }, "forecast cron failed");
      captureSchedulerFailure("forecast_runner", err, {
        cron_expression: "15 2 * * *",
      });
    }
  });

  // 7. Daily at 03:35 UTC: forecast retention + capture-rate measurement
  //    (011-inventory-demand-forecast). Purges forecasts > 90 days, reaps
  //    orphaned in_flight runs, computes the rolling 14-day capture rate
  //    and pauses alerts when SC-008's kill criterion trips. Staggered five
  //    minutes after the risk retention so two heavy DELETE+aggregate jobs
  //    don't compete for the same connection slot at the same instant.
  schedule("35 3 * * *", async () => {
    if (process.env.WORKER_TIER !== "true") return;
    try {
      await runForecastRetention();
    } catch (err) {
      logger.error({ err, category: "forecast.retention" }, "forecast retention failed");
      captureSchedulerFailure("forecast_retention", err, {
        cron_expression: "35 3 * * *",
      });
    }
  });

  // 8. Daily at 03:50 UTC: catalog enrichment runner
  //    (012-arabic-catalog-enrichment). Refuses to run unless
  //    WORKER_TIER=true AND ENRICHMENT_RUNNER_ENABLED=true. 03:50 — B7-P2-3
  //    (round-92): moved off the :45 collision with the HOURLY copilot
  //    reaper, so the daily enrichment LLM run no longer shares its first
  //    minute with another DB writer. Still lands cleanly between the
  //    retention sweep at 03:30 and morning admin activity.
  schedule("50 3 * * *", async () => {
    try {
      await runEnrichmentIfPermitted();
    } catch (err) {
      logger.error({ err, category: "enrichment.cron" }, "enrichment cron failed");
      captureSchedulerFailure("enrichment_runner", err, {
        cron_expression: "50 3 * * *",
      });
    }
  });

  // 9. Daily at 04:00 UTC: enrichment retention (90-day purge of
  //    terminal-state drafts; reap orphaned in_flight runs).
  schedule("0 4 * * *", async () => {
    if (process.env.WORKER_TIER !== "true") return;
    try {
      await runEnrichmentRetention();
    } catch (err) {
      logger.error({ err, category: "enrichment.retention" }, "enrichment retention failed");
      captureSchedulerFailure("enrichment_retention", err, {
        cron_expression: "0 4 * * *",
      });
    }
  });

  // 10. Daily at 04:30 UTC: auth-activity retention (B7-P1-2, round-92).
  //     auth_activity grows with EVERY login/OTP event (success and failure)
  //     and this job was previously wired to NOTHING — the 90-day retention
  //     policy existed only in the file's docstring. Slot 04:30 sits between
  //     the enrichment retention (04:00) and the session prune (05:00) so
  //     the three DELETE-heavy retention jobs never share a minute. Also
  //     runs as a boot one-shot in web-scheduler.ts (idempotent, batched).
  schedule("30 4 * * *", async () => {
    try {
      const removed = await cleanupOldAuthActivity();
      if (removed > 0) {
        logger.info(
          { category: "auth.retention", removed },
          `auth-activity retention removed ${removed} row(s) older than 90 days`,
        );
      }
    } catch (err) {
      logger.error({ err, category: "auth.retention" }, "auth-activity retention failed");
      captureSchedulerFailure("auth_activity_retention", err, {
        cron_expression: "30 4 * * *",
      });
    }
  });

  logger.info("Cron jobs initialized");
  return {
    stop: () => {
      for (const task of tasks) {
        try {
          task.stop();
        } catch {
          // already stopped / destroyed — idempotent
        }
      }
    },
  };
}
