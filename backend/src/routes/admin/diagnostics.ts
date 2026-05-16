import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { Router, type IRouter } from "express";
import { getRedisClient } from "../../lib/redis-client";
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

export { router as adminDiagnosticsRouter };
