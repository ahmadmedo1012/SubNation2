import cron from "node-cron";
import { markStaleUnreadAlertsRead, pruneReadAlerts } from "./alertLogger";
import { cleanupOldAuthActivity } from "./cleanup-auth-activity";
import { runForecastIfPermitted } from "./forecast-runner";
import { runForecastRetention } from "./forecast-retention";
import { runEnrichmentIfPermitted } from "./enrichment-runner";
import { runEnrichmentRetention } from "./enrichment-retention";
import { reapExpiredRiskEvents } from "./risk-retention";
import { pruneExpiredSessions } from "./session-prune";
import { pruneStaleAdminSessions } from "../lib/admin-session";
import { pruneOldIdempotencyKeys } from "./idempotency-retention";
import { pruneOldNotifications } from "./notifications-retention";
import { checkAdminTotpAdvisory } from "./security-advisories";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

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
  //
  // F6 (round-94 A6): every wall-clock-sensitive (daily) schedule passes
  // timezone: "UTC" explicitly. node-cron without a timezone option uses
  // the process-local TZ — UTC only by Alpine's default accident — so a
  // base-image change or an injected TZ env would silently shift every
  // documented slot (incl. the 05:00 pre-peak window). The runtime image
  // also pins ENV TZ=UTC (Dockerfile); this is the belt to that suspender.
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
  schedule(
    "0 0 * * *",
    async () => {
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
    },
    { timezone: "UTC" },
  );

  // 1c. Daily at 00:00 UTC: idempotency_keys retention (97-F7, R97-A3
  //     retention audit). The durable purchase-dedup table had NO retention
  //     of any kind — rows only ever left via the order/user CASCADE
  //     deletes, so every guarded purchase grew the table by one row
  //     forever. 48h retention: the HTTP-layer dedup cache already expires
  //     keys after 24h, so 48h doubles that horizon as a clock-skew/
  //     cache-flush margin while deleting zero financial records (the
  //     money trail lives in orders + wallet_ledger). Own schedule in the
  //     round-5 00:00 retention policy slot (same slot as the admin-alert
  //     retention; the DELETE is a tiny bounded-batch job); own try/catch
  //     so a failure here can never skip the alert retention above.
  schedule(
    "0 0 * * *",
    async () => {
      try {
        const removed = await pruneOldIdempotencyKeys();
        if (removed > 0)
          logger.info(
            { category: "idempotency.retention", removed },
            `Pruned ${removed} idempotency key row(s) older than 48h`,
          );
      } catch (err) {
        logger.error(
          { err, category: "idempotency.retention" },
          "idempotency_keys retention failed",
        );
        captureSchedulerFailure("idempotency_keys_retention", err, {
          cron_expression: "0 0 * * *",
        });
      }
    },
    { timezone: "UTC" },
  );

  // 1a. Daily at 00:05 UTC: TOTP security advisory (A6 P3#14, round-93).
  //      checkAdminTotpAdvisory used to be a boot one-shot ONLY — its
  //      "weekly" cadence actually meant "on restart", so a no-deploy
  //      month meant zero nudges. Daily cadence is safe because the
  //      advisory carries the admin:no-totp dedupe key with a 7-day
  //      window — the cron re-creates it at most weekly. 00:05 keeps it
  //      off the 00:00 retention slot's first minute. When every ["all"]
  //      admin has TOTP enabled the same pass AUTO-RESOLVES the lingering
  //      unread advisory rows.
  schedule(
    "5 0 * * *",
    async () => {
      try {
        await checkAdminTotpAdvisory();
      } catch (err) {
        logger.error({ err, category: "security" }, "TOTP advisory cron failed");
        captureSchedulerFailure("totp_advisory", err, {
          cron_expression: "5 0 * * *",
        });
      }
    },
    { timezone: "UTC" },
  );

  // 1b. Daily at 05:00 UTC: expired-session prune (Round-5). Sessions
  //     whose expires_at passed are already rejected by requireUser,
  //     but the rows were never deleted — sessions grow monotonically
  //     with every login forever. Deleting expired rows is safe (the
  //     JWT is dead regardless) and keeps the session-validity lookup
  //     fast. 05:00 UTC = 07:00 Libya, before the daily traffic peak.
  schedule(
    "0 5 * * *",
    async () => {
      // R110-H: the three prunes in this slot are fully independent —
      // one failing can never skip the others (the old single try/catch
      // chain meant a user-session prune failure silently skipped the
      // admin-session AND notifications prunes), and each failure is
      // captured under its OWN Sentry job_name instead of the old
      // blanket "session_prune" tag that mislabeled which prune died.
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
      // V1-M13 (round-94 A8): same retention window for the admin
      // session rows — expired > 24h or revoked > 30 days.
      try {
        const adminRemoved = await pruneStaleAdminSessions();
        if (adminRemoved > 0)
          logger.info(
            { category: "sessions.retention", removed: adminRemoved },
            `Pruned ${adminRemoved} stale admin session row(s)`,
          );
      } catch (err) {
        logger.error({ err, category: "sessions.retention" }, "Admin-session prune failed");
        captureSchedulerFailure("admin_session_prune", err, {
          cron_expression: "0 5 * * *",
        });
      }
      // AUD103-1-F2 (r103): notifications retention — read > 90d,
      // unread > 180d. Rides the same 05:00 slot (tiny bounded-batch
      // job) + the boot one-shot for the restart gap.
      try {
        const notifRemoved = await pruneOldNotifications();
        if (notifRemoved > 0)
          logger.info(
            { category: "notifications.retention", removed: notifRemoved },
            `Pruned ${notifRemoved} old notification row(s)`,
          );
      } catch (err) {
        logger.error(
          { err, category: "notifications.retention" },
          "Notifications retention failed",
        );
        captureSchedulerFailure("notifications_retention", err, {
          cron_expression: "0 5 * * *",
        });
      }
    },
    { timezone: "UTC" },
  );

  // 2/3/4/8 — REMOVED (2026-09-20 free-infrastructure round):
  //
  //   job 2  "0 * * * *"   hourly no-op log heartbeat — served no
  //                          function; deleted.
  //   job 3  "15 * * * *"   hourly whatsapp_otps prune — now
  //                          OPPORTUNISTIC: throttled 60-min fire from
  //                          startOtp() ONLY (services/whatsapp-otp.
  //                          service.ts — verifyOtp() does not trigger
  //                          the prune; r110 comment-truth fix) + the
  //                          leader boot one-shot (jobs/boot-one-shots.
  //                          ts). A sleeping service has no OTP rows
  //                          accumulating.
  //   job 4  "45 * * * *"   hourly copilot-previews reaper — now
  //                          OPPORTUNISTIC: throttled 60-min fire from
  //                          the admin copilot surface (routes/admin/
  //                          copilot/ask.ts) + leader boot one-shot.
  //   job 8  "*/10 * * * *" keep-alive self-ping of /api/healthz + the
  //                          OpenWA gateway — pure artificial traffic;
  //                          the whole point of this round. Render Free
  //                          is ALLOWED to sleep; cold starts are handled
  //                          honestly (503 "starting" gate + frontend
  //                          retry) instead of with fake requests.
  //                          ("8" is the HISTORICAL number of this long-
  //                          dead job — unrelated to the current #8
  //                          enrichment slot below.)
  //
  // Rationale: every sub-hourly DB touch reset Neon's 5-minute
  // autosuspend while the process was awake, and the self-pings reset
  // Render's 15-minute idle timer outright — together they produced a
  // 24/7 "always-on" free-tier footprint that the quotas cannot carry.
  // Daily retention slots below survive (idempotent, boot catch-up'd).

  // 5. Daily at 03:30 UTC: risk_events 90-day retention (003-anomaly-detection).
  //    Unlabeled events older than 90 days are deleted. Labeled events get
  //    a 97-day grace so retroactive review still resolves the label join.
  schedule(
    "30 3 * * *",
    async () => {
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
    },
    { timezone: "UTC" },
  );

  // 6. Daily at 02:15 UTC: inventory demand forecast (011-inventory-demand-
  //    forecast). Refuses to run unless WORKER_TIER=true AND
  //    FORECAST_RUNNER_ENABLED=true (the runner enforces the gate).
  //    R101 (comment truth): the old justification cited the :15 OTP
  //    cleanup and the :45 copilot reaper — both became opportunistic in
  //    the 2026-09-20 free-infrastructure round, so the slot rationale
  //    is now purely the daily retention ladder: 00:00/00:05 retention
  //    pair → 02:15 forecast → 03:30+ retention block. No two heavy
  //    jobs share a minute.
  schedule(
    "15 2 * * *",
    async () => {
      try {
        await runForecastIfPermitted();
      } catch (err) {
        logger.error({ err, category: "forecast.cron" }, "forecast cron failed");
        captureSchedulerFailure("forecast_runner", err, {
          cron_expression: "15 2 * * *",
        });
      }
    },
    { timezone: "UTC" },
  );

  // 7. Daily at 03:35 UTC: forecast retention + capture-rate measurement
  //    (011-inventory-demand-forecast). Purges forecasts > 90 days, reaps
  //    orphaned in_flight runs, computes the rolling 14-day capture rate
  //    and pauses alerts when SC-008's kill criterion trips. Staggered five
  //    minutes after the risk retention so two heavy DELETE+aggregate jobs
  //    don't compete for the same connection slot at the same instant.
  schedule(
    "35 3 * * *",
    async () => {
      if (process.env.WORKER_TIER !== "true") return;
      try {
        await runForecastRetention();
      } catch (err) {
        logger.error({ err, category: "forecast.retention" }, "forecast retention failed");
        captureSchedulerFailure("forecast_retention", err, {
          cron_expression: "35 3 * * *",
        });
      }
    },
    { timezone: "UTC" },
  );

  // 8. Daily at 03:50 UTC: catalog enrichment runner
  //    (012-arabic-catalog-enrichment). Refuses to run unless
  //    WORKER_TIER=true AND ENRICHMENT_RUNNER_ENABLED=true. 03:50 — B7-P2-3
  //    (round-92): originally moved off a :45 collision with the then-
  //    hourly copilot reaper (that reaper is opportunistic since the
  //    2026-09-20 round — boot one-shot + admin-surface trigger). The
  //    slot now simply sits cleanly between the forecast retention
  //    (03:35) and the enrichment retention (04:00) in the daily ladder.
  schedule(
    "50 3 * * *",
    async () => {
      try {
        await runEnrichmentIfPermitted();
      } catch (err) {
        logger.error({ err, category: "enrichment.cron" }, "enrichment cron failed");
        captureSchedulerFailure("enrichment_runner", err, {
          cron_expression: "50 3 * * *",
        });
      }
    },
    { timezone: "UTC" },
  );

  // 9. Daily at 04:00 UTC: enrichment retention (90-day purge of
  //    terminal-state drafts; reap orphaned in_flight runs).
  schedule(
    "0 4 * * *",
    async () => {
      if (process.env.WORKER_TIER !== "true") return;
      try {
        await runEnrichmentRetention();
      } catch (err) {
        logger.error({ err, category: "enrichment.retention" }, "enrichment retention failed");
        captureSchedulerFailure("enrichment_retention", err, {
          cron_expression: "0 4 * * *",
        });
      }
    },
    { timezone: "UTC" },
  );

  // 10. Daily at 04:30 UTC: auth-activity retention (B7-P1-2, round-92).
  //     auth_activity grows with EVERY login/OTP event (success and failure)
  //     and this job was previously wired to NOTHING — the 90-day retention
  //     policy existed only in the file's docstring. Slot 04:30 sits between
  //     the enrichment retention (04:00) and the session prune (05:00) so
  //     the three DELETE-heavy retention jobs never share a minute. Also
  //     runs as a boot one-shot in web-scheduler.ts (idempotent, batched).
  schedule(
    "30 4 * * *",
    async () => {
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
    },
    { timezone: "UTC" },
  );

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
