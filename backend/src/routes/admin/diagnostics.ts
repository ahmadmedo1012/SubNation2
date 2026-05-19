import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { Router, type IRouter } from "express";
import { getRedisClient } from "../../lib/redis-client";
import {
  captureMessage,
  captureSubsystemException,
} from "../../lib/sentry";
import { getIO } from "../../lib/socket";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router: IRouter = Router();

// ── Event-loop delay monitor ─────────────────────────────────────────────────
//
// Started exactly once at module load (process start). Reports nanoseconds;
// we expose milliseconds. Mean > 100ms or p99 > 1s is symptomatic of a
// blocked event loop.

let eventLoopHistogram: IntervalHistogram | null = null;
try {
  eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
  eventLoopHistogram.enable();
} catch {
  // monitorEventLoopDelay can throw on very old Node — keep null so the
  // diagnostics route still works.
  eventLoopHistogram = null;
}

router.get("/", requireAdmin, (_req, res) => {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const redis = getRedisClient();
  const io = getIO();

  const eventLoopLag = eventLoopHistogram
    ? {
        meanMs: eventLoopHistogram.mean / 1e6,
        p50Ms: eventLoopHistogram.percentile(50) / 1e6,
        p95Ms: eventLoopHistogram.percentile(95) / 1e6,
        p99Ms: eventLoopHistogram.percentile(99) / 1e6,
        maxMs: eventLoopHistogram.max / 1e6,
      }
    : null;

  res.json({
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    },
    runtime: {
      uptimeSec: Math.floor(process.uptime()),
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "unknown",
      env: process.env.NODE_ENV ?? "development",
      service: process.env.RENDER_SERVICE_NAME ?? "web",
    },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    cpu: {
      userMs: Math.round(cpu.user / 1000),
      systemMs: Math.round(cpu.system / 1000),
    },
    eventLoop: eventLoopLag,
    deps: {
      redis: { connected: redis !== null },
      socket: { initialized: io !== null },
    },
    flags: {
      ALERTING_ENABLED: process.env.ALERTING_ENABLED ?? "true",
      METRICS_ENABLED: process.env.METRICS_ENABLED ?? "true",
      NEW_HEALTH_CHECKS_ENABLED: process.env.NEW_HEALTH_CHECKS_ENABLED ?? "true",
      FIREBASE_AUTH_ENABLED: process.env.FIREBASE_AUTH_ENABLED ?? "false",
    },
  });
});

// ── Sentry verification endpoint ─────────────────────────────────────────────
//
// Admin-only. Used post-deploy to confirm the Sentry pipeline is wired
// end-to-end (DSN reachable, beforeSend fires, tags attach, source maps
// resolve, breadcrumbs land). NOT a public endpoint.
//
// Usage:
//   GET /api/admin/diagnostics/sentry-debug
//     → returns the current init snapshot (DSN configured?, env, release,
//       sample rates, process tags). No Sentry event sent.
//
//   GET /api/admin/diagnostics/sentry-debug?mode=message
//     → captureMessage at "error" level. Lands in Sentry's Issues list
//       under the `subnation-backend` project.
//
//   GET /api/admin/diagnostics/sentry-debug?mode=subsystem
//     → captureSubsystemException with subsystem=test. Verifies the
//       grouping/tag pipeline.
//
//   GET /api/admin/diagnostics/sentry-debug?mode=throw
//     → throws — caught by setupExpressErrorHandler → captured + 500
//       response. Verifies the Express integration end-to-end.
router.get("/sentry-debug", requireAdmin, (req, res, next) => {
  const mode = String(req.query.mode ?? "snapshot").toLowerCase();
  const dsnConfigured = Boolean(process.env.SENTRY_DSN);

  if (mode === "throw") {
    // Express's setupExpressErrorHandler captures + flushes; user-
    // facing error message comes from our own error middleware.
    return next(new Error("[sentry-debug] intentional admin-triggered error"));
  }

  if (mode === "message") {
    captureMessage("[sentry-debug] admin-triggered test message", "error");
    return res.json({
      ok: true,
      mode: "message",
      dsnConfigured,
      note: "Look in Sentry Issues for the 'admin-triggered test message' event.",
    });
  }

  if (mode === "subsystem") {
    captureSubsystemException(
      "test",
      new Error("[sentry-debug] admin-triggered subsystem test"),
      { triggered_by: "diagnostics endpoint" },
    );
    return res.json({
      ok: true,
      mode: "subsystem",
      dsnConfigured,
      note: "Look in Sentry — the issue should have subsystem=test tag.",
    });
  }

  // Default: snapshot.
  return res.json({
    ok: true,
    mode: "snapshot",
    sentry: {
      dsnConfigured,
      environment: process.env.NODE_ENV ?? "development",
      release: (process.env.RENDER_GIT_COMMIT ?? "unknown").slice(0, 7),
      tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1 (default)",
      profilesSampleRate: process.env.SENTRY_PROFILES_SAMPLE_RATE ?? "0.1 (default)",
      processTags: {
        instance_id: process.env.RENDER_INSTANCE_ID ?? "local",
        service_id: process.env.RENDER_SERVICE_ID ?? "subnation",
        deploy_id: process.env.RENDER_DEPLOY_ID ?? "dev",
        region: process.env.RENDER_REGION ?? "unknown",
        git_branch: process.env.RENDER_GIT_BRANCH ?? "unknown",
        subsystem: process.env.WORKER_ROLE === "true" ? "worker" : "web",
      },
    },
    usage: {
      throw: "?mode=throw       — triggers a captured exception via Express",
      message: "?mode=message     — sends a captureMessage at error level",
      subsystem: "?mode=subsystem   — sends via captureSubsystemException",
    },
  });
});

export { router as adminDiagnosticsRouter };
